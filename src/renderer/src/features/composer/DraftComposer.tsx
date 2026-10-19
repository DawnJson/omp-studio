// 草稿输入框（空状态里的输入框）：还没有任务，发送第一条时才创建任务。
// projectId 为 null（一个项目都没有）时，发送前先让主进程建好 AppInfo.chatsDir 并加入项目，任务在那里开始。
// 模型胶囊显示和修改的都是 omp 的默认值（modelRoles.default / defaultThinkingLevel，设计原则 7）；新任务不传 --model/--thinking。
import { reportError } from "../../ui/errors.ts";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type {
  DefaultModelInfo,
  ModelDefaults,
  ModelOption,
  ProjectFilesTarget,
  ProjectId,
  TaskId,
} from "../../../../shared/ipc.ts";
import { worktreeBlockerKey } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import { selectTask } from "../../store/index.ts";
import { saveOmpDefaultModel, saveOmpDefaultThinking } from "../settings/config-store.ts";
import { refreshProjects } from "../sidebar/projects-store.ts";
import { takePendingDraftText } from "../palette/index.ts";
import { pushToast } from "../dialogs/index.ts";
import { blockWorktree, ensureSetupApproved, getWorktreeDraft, setWorktreeOn, WorktreeChip } from "../git/index.ts";
import { convertImageFiles } from "./actions.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { Attachments } from "./Attachments.tsx";
import { getDraft, setDraft, setDraftText, useDraft } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { decideEnter, isShellDraft } from "./send-logic.ts";
import { SendStop } from "./SendStop.tsx";
import { DraftUsageMeter } from "./UsageMeter.tsx";
import { SessionCost } from "./SessionCost.tsx";
import { FileMenu } from "./FileMenu.tsx";
import { useFileMenu } from "./use-file-menu.ts";
import { clampThinkingLevel, effortOrder, thinkingLevelOptions } from "./thinking-levels.ts";
import "./composer.css";

/** 没有项目时 `@` 补全不开（目录还没建），这个目标不会被查询。 */
const noFilesTarget: ProjectFilesTarget = { kind: "project", projectId: "" as ProjectId };

export function DraftComposer({ projectId }: { projectId: ProjectId | null }) {
  const t = useT();
  const key = `new:${projectId ?? "chats"}` as TaskId;
  const draft = useDraft(key);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [omp, setOmp] = useState<DefaultModelInfo | null>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  // 这个项目里 omp 实际会用的默认值（项目 .omp/config.yml 会盖过全局）；refresh 递增时重读。
  const [defaults, setDefaults] = useState<ModelDefaults | null>(null);
  const [refresh, setRefresh] = useState(0);
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0;

  useEffect(() => {
    window.studio.getDefaultModel().then(setOmp, () => setOmp(null));
    return window.studio.onDefaultModel(setOmp);
  }, []);
  useEffect(() => {
    window.studio.listModels().then(setModels, () => setModels([]));
  }, []);
  useEffect(() => {
    let current = true;
    window.studio.getModelDefaults(projectId).then(
      (value) => current && setDefaults(value),
      () => current && setDefaults(null),
    );
    return () => {
      current = false;
    };
    // omp 变了（别处改了 omp 设置会推 defaultModel 事件）也重读。
  }, [projectId, omp, refresh]);
  useEffect(() => {
    // 命令面板"在新任务中提问"带来的文字：放进草稿并聚焦，不自动发送。
    const pending = takePendingDraftText();
    if (pending !== null) setDraftText(key, pending);
    fieldRef.current?.focus({ preventScroll: true });
  }, [projectId, key]);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft.text]);

  // 显示以项目目录里读到的 omp 配置为准：服务进程在配置重载后不会切换自己当前会话的模型（omp://settings.md
  // "Reloading does not ... switch a healthy active session's model"），它的 get_state 只在 modelRoles.default
  // 没设置时用来显示 omp 自选的模型。
  const role = defaults?.model ?? null;
  const model =
    (models ?? []).find((m) => {
      const id = `${m.key.provider}/${m.key.modelId}`;
      if (role !== null) return role === id || role.startsWith(`${id}:`);
      return m.key.provider === omp?.key.provider && m.key.modelId === omp?.key.modelId;
    }) ?? null;
  // 草稿没有进程可问：档位列表来自模型的 thinking.efforts（不含 off，defaultThinkingLevel 不接受），
  // 配置里的档位模型不支持时显示 omp 会钳到的那一档（thinking-levels.ts）。
  const levels = thinkingLevelOptions(model, []);
  const configuredLevel = effortOrder.find((level) => level === defaults?.thinkingLevel) ?? omp?.thinkingLevel ?? null;
  const thinkingLevel = configuredLevel === null ? null : clampThinkingLevel(configuredLevel, levels);
  const reread = () => setRefresh((count) => count + 1);

  // `@` 文件引用补全：目录是这个项目的目录。
  const fileMenu = useFileMenu(
    projectId === null ? noFilesTarget : { kind: "project", projectId },
    draft.text,
    projectId !== null,
    fieldRef,
    (next) => setDraftText(key, next),
  );

  const send = async () => {
    const current = getDraft(key);
    const text = current.text.trim();
    if (sending || (text === "" && current.images.length === 0)) return;
    // `!命令` 要在任务里跑；还没有任务，不能当成第一条消息发给模型。
    if (isShellDraft(current)) {
      pushToast({ level: "warning", message: t("conversation.shell.needsTask") });
      return;
    }
    setSending(true);
    const worktreeProject = projectId !== null && getWorktreeDraft(projectId).on ? projectId : null;
    try {
      if (worktreeProject !== null && !(await ensureSetupApproved(worktreeProject))) {
        // 拒绝运行脚本：不建 worktree，草稿保留。
        pushToast({ message: t("git.setup.declined") });
        return;
      }
      const target = projectId ?? (await window.studio.ensureChatsProject()).id;
      const task = await window.studio.createTask({
        projectId: target,
        ...(worktreeProject !== null ? { worktree: true } : {}),
      });
      await selectTask(task.id);
      // 主进程没有项目变更事件：新加的 chats 项目要重新取列表，侧栏才有它的分组。
      if (projectId === null) void refreshProjects();
      await window.studio.sendPrompt(task.id, {
        text,
        ...(current.images.length > 0 ? { images: [...current.images] } : {}),
        whenBusy: "steer",
      });
      setDraft(key, { text: "", images: [] });
      if (projectId !== null) setWorktreeOn(projectId, false);
    } catch (error) {
      if (worktreeProject !== null) {
        const blocker = worktreeBlockerKey(error);
        if (blocker !== null) blockWorktree(worktreeProject, blocker);
      }
      reportError(t, error, t("msg.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const addFiles = async (files: Iterable<File>) => {
    const converted = await convertImageFiles(files, t);
    if (converted.length > 0) {
      const current = getDraft(key);
      setDraft(key, { text: current.text, images: [...current.images, ...converted] });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (fileMenu.onKeyDown(event)) return;
    const action = decideEnter(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        isComposing: event.nativeEvent.isComposing,
        keyCode: event.keyCode,
      },
      { running: false, gate: false, hasContent, swapped: false, shell: false },
    );
    if (action !== "send") return;
    event.preventDefault();
    void send();
  };
  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addFiles(files);
    }
  };
  const onDrop = (event: DragEvent) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  return (
    <div className="composer-stack" data-testid="draft-composer" data-draft>
      <div className="composer" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
        <FileMenu
          id="file-menu-list"
          open={fileMenu.open}
          files={fileMenu.files}
          active={fileMenu.active}
          onHover={fileMenu.setActive}
          onPick={fileMenu.pick}
        />
        <div className="composer-body">
          <Attachments
            images={draft.images}
            onRemove={(index) =>
              setDraft(key, { text: draft.text, images: draft.images.filter((_, i) => i !== index) })
            }
          />
          <textarea
            ref={fieldRef}
            className="composer-field"
            data-composer-input
            data-testid="composer-input"
            rows={1}
            value={draft.text}
            placeholder={t("composer.placeholderNew")}
            aria-label={t("composer.placeholderNew")}
            aria-controls={fileMenu.open ? "file-menu-list" : undefined}
            aria-activedescendant={fileMenu.open ? `file-menu-list-${fileMenu.active}` : undefined}
            onChange={(event) => {
              setDraftText(key, event.target.value);
              fileMenu.trackCaret(event.target.selectionStart);
            }}
            onSelect={(event) => fileMenu.trackCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
        <div className="composer-tools">
          <button
            type="button"
            className="tool-btn"
            aria-label={t("composer.attach")}
            title={t("composer.attach")}
            onClick={() => fileRef.current?.click()}
          >
            <Plus size={16} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files ?? []);
              event.target.value = "";
            }}
          />
          <ModelChip
            model={model}
            thinkingLevel={thinkingLevel}
            thinkingLevels={levels}
            running={false}
            projectId={projectId}
            // omp 一个可用模型都读不到时 omp 为 null：有模型列表就写"默认模型"，确实一个都没有才是"未连接"。
            {...(omp
              ? { emptyLabel: omp.name }
              : models !== null && models.length > 0
                ? { emptyLabel: t("composer.defaultModel") }
                : {})}
            loadModels={() => window.studio.listModels()}
            setModel={(modelKey) => saveOmpDefaultModel(projectId, modelKey).finally(reread)}
            setThinking={(level) => saveOmpDefaultThinking(level).finally(reread)}
          />
          <ApprovalChip />
          {projectId !== null && <WorktreeChip projectId={projectId} />}
          <DraftUsageMeter model={model ?? null} projectId={projectId} />
          <span className="composer-spacer" />
          <SessionCost usage={null} provider={model?.key.provider ?? null} />
          <SendStop
            running={false}
            stopping={false}
            hasContent={hasContent}
            disabled={sending}
            onSend={() => void send()}
            onStop={() => undefined}
          />
        </div>
      </div>
    </div>
  );
}

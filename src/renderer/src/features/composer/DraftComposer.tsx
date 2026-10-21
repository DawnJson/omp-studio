// 草稿输入框（空状态里的输入框）：还没有任务，发送第一条时才创建任务。
// projectId 为 null（一个项目都没有）时，发送前先让主进程建好 AppInfo.chatsDir 并加入项目，任务在那里开始。
// 模型胶囊显示和修改的都是 omp 的默认值（modelRoles.default / defaultThinkingLevel，设计原则 7）；新任务不传 --model/--thinking。
import { reportError } from "../../ui/errors.ts";
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { DefaultModelInfo, ModelOption, ProjectFilesTarget, ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { draftKey } from "../../../../shared/ipc.ts";
import { worktreeBlockerKey } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { selectTask } from "../../store/index.ts";
import { saveOmpDefaultThinking, saveOmpModelRole } from "../settings/config-store.ts";
import { refreshProjects } from "../sidebar/projects-store.ts";
import { takePendingDraftText } from "../palette/index.ts";
import { pushToast } from "../dialogs/index.ts";
import { blockWorktree, ensureSetupApproved, getWorktreeDraft, setWorktreeOn } from "../git/index.ts";
import { handOverDraftTerminal, withDraftHandover } from "../terminal/index.ts";
import { convertImageFiles } from "./actions.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { Attachments } from "./Attachments.tsx";
import { getDraft, setDraft, setDraftText, useDraft } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { decideEnter, isShellDraft } from "./send-logic.ts";
import { SendStop } from "./SendStop.tsx";
import { DraftContextMeter } from "./UsageMeter.tsx";
import { SessionCost } from "./SessionCost.tsx";
import { FileMenu } from "./FileMenu.tsx";
import { useFileMenu } from "./use-file-menu.ts";
import {
  knownDefaults,
  knownModels,
  knownOmp,
  rememberDefaults,
  rememberModels,
  rememberOmp,
} from "./new-task-default.ts";
import { resolveNewTaskDefault } from "./new-task-resolve.ts";
import { clearFirstPrompt, setFirstPrompt } from "../tsp/first-prompt-store.ts";
import "./composer.css";

/** 没有项目时 `@` 补全不开（目录还没建），这个目标不会被查询。 */
const noFilesTarget: ProjectFilesTarget = { kind: "project", projectId: "" as ProjectId };

/** projectTools：工具行里紧跟审批胶囊的部分（空状态放项目按钮和工作树开关）。 */
export function DraftComposer({ projectId, projectTools }: { projectId: ProjectId | null; projectTools?: ReactNode }) {
  const t = useT();
  const terminalDraftKey = draftKey(projectId);
  // 草稿存储的键和草稿终端的键是同一个字符串。
  const key = terminalDraftKey as string as TaskId;
  const draft = useDraft(key);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  // 初值是上次读到的（本次运行里最近一次现读，没有就用启动缓存），现读的到了再替换；omp 为 undefined = 还没读到过。
  const [omp, setOmp] = useState<DefaultModelInfo | null | undefined>(knownOmp);
  const [models, setModels] = useState<ModelOption[] | null>(knownModels);
  // 这个项目里 omp 实际会用的默认值（项目 .omp/config.yml 会盖过全局）：每个项目各记各的（new-task-default.ts），
  // 切项目第一帧就是这个项目上次的值，不会短暂显示上一个项目的；refresh 递增时重读。
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [refresh, setRefresh] = useState(0);
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0;

  useEffect(() => {
    const apply = (value: DefaultModelInfo | null) => {
      rememberOmp(value);
      setOmp(value);
    };
    window.studio.getDefaultModel().then(apply, () => apply(null));
    return window.studio.onDefaultModel(apply);
  }, []);
  useEffect(() => {
    const apply = (value: ModelOption[]) => {
      rememberModels(value);
      setModels(value);
    };
    window.studio.listModels().then(apply, () => setModels([]));
  }, []);
  useEffect(() => {
    let current = true;
    // 读不到（omp 还没就绪等）：保持这个项目上次读到的值，不重绘。
    window.studio.getModelDefaults(projectId).then(
      (value) => {
        rememberDefaults(projectId, value);
        if (current) rerender();
      },
      () => undefined,
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

  const { model, levels, thinkingLevel } = resolveNewTaskDefault(knownDefaults(projectId), omp, models);
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
      // 建任务和交接终端之间项目列表可能刷新（草稿的键随之变），交接期间不关草稿的终端。
      const task = await withDraftHandover(async () => {
        const created = await window.studio.createTask({
          projectId: target,
          ...(worktreeProject !== null ? { worktree: true } : {}),
        });
        // 草稿开着终端：交给新任务（worktree 任务的目录不同，那种情况直接关掉）。在 selectTask 之前，
        // 任务的面板挂载时终端已经在任务的键下。
        await handOverDraftTerminal(terminalDraftKey, created.id, worktreeProject !== null);
        return created;
      });
      // TSP 任务：omp 建好 surface、回显用户消息之前，主区先把这句话画成气泡（features/tsp/first-prompt-store.ts）。
      const recordFirstPrompt = task.engine === "tsp" && text !== "";
      if (recordFirstPrompt) setFirstPrompt(task.id, { text, model, thinkingLevel });
      await selectTask(task.id);
      // 主进程没有项目变更事件：新加的 chats 项目要重新取列表，侧栏才有它的分组。
      if (projectId === null) void refreshProjects();
      try {
        await window.studio.sendPrompt(task.id, {
          text,
          ...(current.images.length > 0 ? { images: [...current.images] } : {}),
          whenBusy: "steer",
        });
      } catch (error) {
        if (recordFirstPrompt) clearFirstPrompt(task.id);
        throw error;
      }
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
  // 粘贴：图片作附件；其余文件由 preload 把路径插进输入框（src/preload/index.ts）。
  const onPaste = (event: ClipboardEvent) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    void addFiles(images);
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
          <ModelChip
            model={model}
            thinkingLevel={thinkingLevel}
            thinkingLevels={levels}
            running={false}
            projectId={projectId}
            // omp 一个可用模型都读不到时 omp 为 null：有模型列表就写"默认模型"，确实一个都没有才是"未连接"；
            // 还没读到过（第一次启动，没有缓存）时是"模型…"。
            {...(omp
              ? { emptyLabel: omp.name }
              : omp === undefined
                ? { emptyLabel: t("composer.modelLoading") }
                : models !== null && models.length > 0
                  ? { emptyLabel: t("composer.defaultModel") }
                  : {})}
            loadModels={() => window.studio.listModels()}
            setModel={(modelKey) => saveOmpModelRole(projectId, "default", modelKey).finally(reread)}
            setThinking={(level) => saveOmpDefaultThinking(level).finally(reread)}
          />
          <ApprovalChip />
          {projectTools}
          <span className="composer-spacer" />
          <DraftContextMeter model={model ?? null} projectId={projectId} />
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

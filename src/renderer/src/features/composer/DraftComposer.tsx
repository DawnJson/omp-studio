// 草稿输入框（空状态里的输入框）：还没有任务，发送第一条时才创建任务。
// projectId 为 null（一个项目都没有）时，发送前先让主进程建好 AppInfo.chatsDir 并加入项目，任务在那里开始。
// 模型胶囊显示和修改的都是 omp 的默认值（modelRoles.default / defaultThinkingLevel，设计原则 7）；新任务不传 --model/--thinking。
import { reportError } from "../../ui/errors.ts";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ProjectId, TaskId } from "../../../../shared/ipc.ts";
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
import { ApprovalChip } from "./ApprovalChip.tsx";
import { buildSubmission, slotsToNames, viewToText } from "./composer-tokens.ts";
import { ComposerInput } from "./ComposerInput.tsx";
import { clearDraft, getDraft, restoreDraft, setDraftText, useDraft } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { decideEnter } from "./send-logic.ts";
import { SendStop } from "./SendStop.tsx";
import { DraftContextMeter } from "./UsageMeter.tsx";
import { SessionCost } from "./SessionCost.tsx";
import { FileMenu } from "./FileMenu.tsx";
import { SlashMenu } from "./SlashMenu.tsx";
import { draftSlashRunner, useDraftSlashMenu } from "./use-draft-slash.ts";
import { useAttach } from "./use-attach.ts";
import { useDraftView } from "./use-draft-view.ts";
import { useFileMenu } from "./use-file-menu.ts";
import { useNewTaskDefault } from "./use-new-task-default.ts";
import { clearFirstPrompt, setFirstPrompt } from "../tsp/first-prompt-store.ts";
import "./composer.css";

/** projectTools：工具行里紧跟审批胶囊的部分（空状态放项目按钮和工作树开关）。 */
export function DraftComposer({ projectId, projectTools }: { projectId: ProjectId | null; projectTools?: ReactNode }) {
  const t = useT();
  const terminalDraftKey = draftKey(projectId);
  // 草稿存储的键和草稿终端的键是同一个字符串。
  const key = terminalDraftKey as string as TaskId;
  const draft = useDraft(key);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  // 新任务默认值（项目 .omp/config.yml 会盖过全局，所以按项目读；初值和占位规则见 use-new-task-default.ts）。
  const { resolved, omp, models, reread } = useNewTaskDefault(projectId);
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0 || draft.files.length > 0;
  const view = useDraftView(draft);

  useEffect(() => {
    // 命令面板"在新任务中提问"带来的文字：放进草稿并聚焦，不自动发送。
    const pending = takePendingDraftText();
    if (pending !== null) setDraftText(key, pending);
    // 模态对话框（如 omp 准备页的接管询问）已经拿着焦点时不抢：草稿输入框在项目载入后才挂上，可能晚于对话框。
    if (document.activeElement?.closest('[aria-modal="true"]') == null)
      fieldRef.current?.focus({ preventScroll: true });
  }, [projectId, key]);

  const { model, levels, thinkingLevel } = resolved;

  // `@` 文件引用补全：目录是这个项目的目录；没有项目 = 默认文件夹（主进程解析，目录还没建时没有候选）。
  const fileMenu = useFileMenu(
    projectId === null ? { kind: "defaultFolder" } : { kind: "project", projectId },
    view.text,
    true,
    fieldRef,
    (next) => setDraftText(key, viewToText(next, getDraft(key))),
  );
  // `/` 命令菜单：服务进程的命令列表加草稿页能用的 studio 命令（use-draft-slash.ts）。
  const slashMenu = useDraftSlashMenu(draft.text, (next) => setDraftText(key, next), fieldRef, t);

  const send = async () => {
    const current = getDraft(key);
    const submission = buildSubmission(current);
    const text = submission.text.trim();
    if (sending || (text === "" && submission.images.length === 0 && submission.files.length === 0)) return;
    // studio 接管的命令（/settings /usage /model …）：不创建任务，直接开 studio 的界面。
    const runStudio =
      submission.images.length === 0 && submission.files.length === 0 ? draftSlashRunner(text, t) : null;
    if (runStudio !== null) {
      clearDraft(key);
      try {
        await runStudio();
      } catch (error) {
        restoreDraft(key, current);
        reportError(t, error);
      }
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
      // omp 建好 surface、回显用户消息之前，主区先把这句话画成气泡（features/tsp/first-prompt-store.ts）。
      const recordFirstPrompt = text !== "";
      if (recordFirstPrompt)
        setFirstPrompt(task.id, { text: slotsToNames(text, submission.files), model, thinkingLevel });
      await selectTask(task.id);
      // 主进程没有项目变更事件：新加的 chats 项目要重新取列表，侧栏才有它的分组。
      if (projectId === null) void refreshProjects();
      try {
        await window.studio.sendPrompt(task.id, {
          text,
          ...(submission.images.length > 0 ? { images: submission.images } : {}),
          ...(submission.files.length > 0 ? { fileIds: submission.files.map((file) => file.id) } : {}),
          whenBusy: "steer",
        });
      } catch (error) {
        if (recordFirstPrompt) clearFirstPrompt(task.id);
        throw error;
      }
      clearDraft(key);
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

  const attach = useAttach(key, fieldRef, undefined);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenu.onKeyDown(event) || fileMenu.onKeyDown(event)) return;
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
      { running: false, gate: false, hasContent, swapped: false },
    );
    if (action !== "send") return;
    event.preventDefault();
    void send();
  };

  return (
    <div className="composer-stack" data-testid="draft-composer" data-draft>
      <div className="composer" data-composer-drop onDragOver={attach.onDragOver} onDrop={attach.onDrop}>
        <SlashMenu
          id="slash-menu"
          open={slashMenu.open}
          commands={slashMenu.matches}
          active={slashMenu.active}
          onHover={slashMenu.setActive}
          onPick={slashMenu.pick}
        />
        <FileMenu
          id="file-menu-list"
          open={fileMenu.open}
          files={fileMenu.files}
          active={fileMenu.active}
          onHover={fileMenu.setActive}
          onPick={fileMenu.pick}
        />
        <ComposerInput
          draftKey={key}
          draft={draft}
          view={view}
          fieldRef={fieldRef}
          placeholder={t("composer.placeholderNew")}
          controls={slashMenu.open ? "slash-menu" : fileMenu.open ? "file-menu-list" : undefined}
          activeDescendant={
            slashMenu.open && slashMenu.matches.length > 0
              ? `slash-menu-${slashMenu.active}`
              : fileMenu.open
                ? `file-menu-list-${fileMenu.active}`
                : undefined
          }
          addFiles={attach.addFiles}
          onEdit={(caret) => {
            slashMenu.reset();
            fileMenu.trackCaret(caret);
          }}
          onCaret={fileMenu.trackCaret}
          onKeyDown={onKeyDown}
        />
        <div className="composer-tools">
          <ModelChip
            model={model}
            thinkingLevel={thinkingLevel}
            thinkingLevels={levels}
            running={false}
            projectId={projectId}
            // 这个项目的默认值或模型目录还没读到过时是"模型…"；配置指向目录里没有的模型时写它的名字；
            // 没配模型时是 omp 自选的那个，omp 一个可用模型都读不到时有模型列表就写"默认模型"，确实一个都没有才是"未连接"。
            {...(resolved.pending || (resolved.unknownModel === null && omp === undefined)
              ? { emptyLabel: t("composer.modelLoading") }
              : resolved.unknownModel !== null
                ? { emptyLabel: resolved.unknownModel }
                : omp
                  ? { emptyLabel: omp.name }
                  : models !== null && models.length > 0
                    ? { emptyLabel: t("composer.defaultModel") }
                    : {})}
            loadModels={() => window.studio.listModels()}
            setModel={(modelKey) => saveOmpModelRole(projectId, "default", modelKey).finally(reread)}
            setThinking={(level) => saveOmpDefaultThinking(level).finally(reread)}
          />
          <ApprovalChip projectId={projectId} forgetTaskId={null} />
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

// 输入框 + 底部栈（门槽、编辑器建议条、队列条）。发送行为表见 spec 4.14，按键判定在 send-logic.ts。
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus, useSettings, useTask } from "../../store/index.ts";
import { onComposerText, onStudioCommand, refreshSlashCommands, useSlashCommands } from "../palette/index.ts";
import { sendDraft, stopAndRestore, type Delivery } from "./actions.ts";
import { reportError } from "../../ui/errors.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { SessionTogglesMenu } from "../session-toggles/SessionTogglesMenu.tsx";
import { getDraft, setDraftText, useDraft } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { matchSlash, slashQuery } from "./slash-match.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { ComposerTop } from "./ComposerTop.tsx";
import { ComposerInput } from "./ComposerInput.tsx";
import { historyText, viewToText } from "./composer-tokens.ts";
import { decideEnter } from "./send-logic.ts";
import { cycleHistory, isCycling, mergeEntries, resetHistoryCursor, shouldCycle } from "./input-history.ts";
import { recordHistory, useProjectHistory } from "./history-store.ts";
import { HistorySearch } from "./HistorySearch.tsx";
import { decideSlashSend } from "./slash-guard.ts";
import { withStudioSlash } from "./studio-slash.ts";
import { studioSlashCommands } from "./studio-slash-table.ts";
import { FileMenu } from "./FileMenu.tsx";
import { useFileMenu } from "./use-file-menu.ts";
import { SendStop } from "./SendStop.tsx";
import { useNewTaskDefault } from "./use-new-task-default.ts";
import { thinkingLevelOptions } from "../../../../shared/ui/new-task-default.ts";
import { SessionCost } from "./SessionCost.tsx";
import { ContextMeter, UsageMeter } from "./UsageMeter.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { useHeld } from "./use-held.ts";
import { useAttach } from "./use-attach.ts";
import { useDraftView } from "./use-draft-view.ts";
import { useReclaimFocus } from "./use-reclaim-focus.ts";
import { useFirstPrompt } from "../tsp/first-prompt-store.ts";
import { ShellTag } from "./ShellTag.tsx";
import { peekGateButton, peekTspDocument, useTspDerived, useTspPanelOpen } from "../tsp/tsp-store.ts";
import { focusedAgentName } from "../../../../shared/tsp/agent-hub.ts";
import { ModeChip } from "./ModeChip.tsx";
import { userMessageTexts } from "../../../../shared/tsp/user-messages.ts";
import { GATE_ACTION_APPROVE, GATE_ACTION_DETAILS, TSP_APPROVAL_DIALOG_ID } from "../../../../shared/tsp/gate.ts";
import { PathLabel } from "../empty/ProjectLabel.tsx";
import { Button } from "../../ui/controls.tsx";

export function Composer({ taskId, fromDraft = false }: { taskId: TaskId; fromDraft?: boolean }) {
  const t = useT();
  const task = useTask(taskId);
  // 新任务首发：omp 报出模型之前，模型胶囊先显示草稿页当时的模型（first-prompt-store.ts），不闪"未连接模型"。
  const firstPrompt = useFirstPrompt(taskId);
  // 起进程前（没启动 / 正在启动）任务状态里还没有模型：显示这个项目的新任务默认值（和草稿页、主进程随后报出的同源），
  // 切项目第一帧就是最终值，这个项目没读到过时是"模型…"，不经过全局默认值或"未连接模型"。
  const preStart =
    task !== null &&
    task.model === null &&
    firstPrompt === null &&
    (task.status === "stopped" || task.status === "starting");
  const projectDefault = useNewTaskDefault(task?.projectId ?? null, preStart).resolved;
  const draft = useDraft(taskId);
  const view = useDraftView(draft);
  const omp = useOmpStatus();
  const settings = useSettings();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useReclaimFocus(fieldRef);
  // 按任务记：切到别的任务不会继承"正在停止"。
  const [stoppingId, setStoppingId] = useState<TaskId | null>(null);
  const stopping = stoppingId === taskId;
  const ompCommands = useSlashCommands(taskId);
  // omp 的列表还没载入时保持空：守卫在空列表时一律放行（studio-slash 的命令发送时照样会被接管）。
  // studio 接管哪些命令、哪些交给 omp 由命令表按宿主（task / draft）定，见 studio-slash.ts。
  const commands = useMemo(
    () => (ompCommands.length === 0 ? ompCommands : withStudioSlash(ompCommands, studioSlashCommands, t)),
    [ompCommands, t],
  );
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosedFor, setSlashClosedFor] = useState<string | null>(null);
  // 刚用 ↑↓ 翻出来的历史文本：这段文本上不开斜杠/@ 菜单，免得抢走后面的 ↑↓。
  const [recalled, setRecalled] = useState<string | null>(null);
  const menusEnabled = recalled !== draft.text;
  const query = slashQuery(draft.text);
  const slashOpen = menusEnabled && query !== null && slashClosedFor !== draft.text && commands.length > 0;
  const slashMatches = slashOpen && query !== null ? matchSlash(commands, query) : [];
  const slashActive = Math.min(slashIndex, Math.max(slashMatches.length - 1, 0));
  // 用户开始敲 `/`：重新取一次命令表（项目里刚建的 skill / 自定义命令不用重启就出现）。
  const slashJustTyped = query === "";
  useEffect(() => {
    if (slashJustTyped) refreshSlashCommands(taskId);
  }, [slashJustTyped, taskId]);

  const completeSlash = (name: string) => {
    setDraftText(taskId, `/${name} `);
    setSlashIndex(0);
    fieldRef.current?.focus();
  };

  const fileMenu = useFileMenu({ kind: "task", taskId }, view.text, menusEnabled && !slashOpen, fieldRef, (next) =>
    setDraftText(taskId, viewToText(next, getDraft(taskId))),
  );

  const running = task?.status === "running" || task?.status === "needs_you";
  const gate = (task?.dialogs.length ?? 0) > 0;
  // TSP 任务：omp 正在画提问/审批（任务 needs_you，或有合成的 tsp-ask / tsp-approval 门）。提问要在过程区里回答，输入框这时不能发送；
  // 审批不拦：输入框里写的字发出去 = 拒绝并说明理由（omp 自己的行为），Ctrl+Enter 批准，Ctrl+O 看详情。
  const approval = task?.dialogs.some((dialog) => dialog.id === TSP_APPROVAL_DIALOG_ID) ?? false;
  const tspAsking = (task?.status === "needs_you" || gate) && !approval;
  // omp 的全屏面板（Agent Hub 等）开着：输入框不往主代理发（B5）。
  const screenOpen = useTspPanelOpen(taskId);
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0 || draft.files.length > 0;
  const swapped = settings?.enterWhileRunning === "followUp";
  const tooOld = omp?.state === "ready" && omp.belowMinimum;
  // worktree 被删了：只能查看记录（和 omp 一致），输入框禁用，说明在对话流末尾的错误条里。
  const worktreeGone = task?.error?.kind === "worktree_missing";

  // 斜杠命令守卫（slash-guard.ts）：命令表（omp 的 + TUI 才有的 + studio 接管的）里没有的 /命令先提示一次，对同一段文字再发一次（或点按钮）才发出去。
  const [slashNotice, setSlashNotice] = useState<{ text: string; name: string } | null>(null);
  const shownNotice = slashNotice?.text === draft.text.trim() ? slashNotice : null;
  // 提示收起的动画期间内容不能先消失。
  const heldNotice = useHeld(shownNotice);
  const allowSend = (): boolean => {
    const text = getDraft(taskId).text.trim();
    const guard = decideSlashSend(text, commands);
    if (guard.kind === "send" || slashNotice?.text === text) return true;
    setSlashNotice({ text, name: guard.name });
    return false;
  };
  const sendNow = (whenBusy: Delivery) => {
    if (task !== null) recordHistory(task.projectId, historyText(getDraft(taskId)));
    resetHistoryCursor(taskId);
    setSlashNotice(null);
    void sendDraft(taskId, whenBusy, t);
  };

  // 输入历史 = 会话里的用户消息 + 这个项目发过的（history-store.ts，studio 自己持久化）；↑ 翻看和 Ctrl+R 搜索用同一份。
  const projectHistory = useProjectHistory(task?.projectId ?? null);
  const historyEntries = () => mergeEntries(userMessageTexts(peekTspDocument(taskId)), projectHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const pickHistory = (text: string) => {
    setHistoryOpen(false);
    resetHistoryCursor(taskId);
    setRecalled(text);
    setDraftText(taskId, text);
    fieldRef.current?.focus();
    fileMenu.placeCaret(text.length);
  };

  /** 点审批卡上动作名为 `act` 的按钮（和用鼠标点同一个 `action` 事件）；卡上没有这个按钮就什么都不做。 */
  const gateAction = (act: string) => {
    const button = peekGateButton(taskId, act);
    if (button === null) return;
    window.studio
      .sendTspEvent(taskId, { ev: "action", sf: button.sf, id: button.id, act })
      .catch((error: unknown) => reportError(t, error));
  };

  // omp 聚焦到某个子代理时（状态行上方有横幅），输入框发的话都是给它的：占位符写明是谁。
  const focusedAgent = useTspDerived(taskId, focusedAgentName, Object.is);
  const placeholder = worktreeGone
    ? t("error.worktreeMissing")
    : screenOpen
      ? t("composer.placeholderScreen")
      : focusedAgent !== null
        ? t("modes.focus.placeholder", { name: focusedAgent })
        : tspAsking
          ? t("composer.placeholderAsk")
          : gate
            ? t("composer.placeholderGate")
            : running
              ? t(swapped ? "composer.placeholderRunningSwapped" : "composer.placeholderRunning")
              : task !== null && task.title !== ""
                ? t("composer.placeholder")
                : t("composer.placeholderNew");

  useEffect(() => {
    if (slashNotice !== null && slashNotice.text !== draft.text.trim()) setSlashNotice(null);
  }, [draft.text, slashNotice]);

  // 命令面板里需要参数的斜杠命令：把文本放进草稿并聚焦。
  useEffect(
    () =>
      onComposerText((text) => {
        setDraftText(taskId, text);
        fieldRef.current?.focus();
      }),
    [taskId],
  );

  useEffect(() => {
    if (!running) setStoppingId(null);
  }, [running]);

  const stop = useCallback(() => {
    // 全屏面板开着时的"停止"只是把 Esc 交给 omp 关面板：不能当成停止主代理（也不记 stopRequested）。
    if (screenOpen) {
      window.studio.sendTspKeys(taskId, "\x1b").catch((error: unknown) => reportError(t, error));
      return;
    }
    if (!running || stopping) return;
    setStoppingId(taskId);
    // 请求结束（成功或失败）都复位，否则失败后按钮永远停在"正在停止"。
    void stopAndRestore(taskId, t).finally(() => {
      setStoppingId((current) => (current === taskId ? null : current));
      fieldRef.current?.focus();
    });
  }, [running, screenOpen, stopping, taskId, t]);

  // Esc 栈第 4 层：前面的层（菜单、门、弹层）会消耗掉 Esc（preventDefault），没人消耗才停止任务。
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // TSP 过程区里的 Esc（关选择器、取消提问）是写给 omp 的按键，不是"停止任务"。
      if (event.target instanceof Element && event.target.closest('[data-testid="tsp-view"]') !== null) return;
      if (running || screenOpen) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, running, screenOpen]);

  useEffect(
    () =>
      onStudioCommand((command) => {
        if (command === "stop") stop();
      }),
    [stop],
  );

  const attach = useAttach(taskId, fieldRef, task?.model?.acceptsImages);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (slashOpen && !composing) {
      const picked = slashMatches[slashActive];
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = Math.max(slashMatches.length, 1);
        setSlashIndex((slashActive + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashClosedFor(draft.text);
        return;
      }
      // Tab 总是补全；Enter 只在候选是前缀匹配、且还没输完整命令名时补全。只是"包含"匹配
      // （/tree 命中别名 worktree 的 /wt）时 Enter 照常发送，交给斜杠命令守卫，不能悄悄换成别的命令。
      const prefixHit =
        picked !== undefined &&
        query !== null &&
        [picked.name, ...(picked.aliases ?? [])].some((name) => name.toLowerCase().startsWith(query.toLowerCase()));
      if (
        picked &&
        (event.key === "Tab" ||
          (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && prefixHit && draft.text !== `/${picked.name}`))
      ) {
        event.preventDefault();
        completeSlash(picked.name);
        return;
      }
    }
    if (fileMenu.onKeyDown(event)) return;
    // Ctrl+R：输入历史搜索（studio 自己持久化的历史）。焦点在输入框时 omp 自己的 Ctrl+R 到不了 omp（这里已处理，转发判定看 defaultPrevented）；
    // 焦点在过程区时照常转发给 omp，它的历史选择器选中的文字由主进程搬回这里（`composerPrefill`）。
    if (
      event.key.toLowerCase() === "r" &&
      event.ctrlKey &&
      !composing &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      setHistoryOpen(true);
      return;
    }
    // 输入历史：菜单没抢走 ↑↓ 时，空输入框（或光标在最开头）按 ↑ 翻看这个项目里发过的消息。
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !composing &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const field = event.currentTarget;
      const direction = event.key === "ArrowUp" ? "up" : "down";
      // 带附件 / 大段粘贴的草稿不翻历史：换掉文字会把它们一起丢掉。
      const entries = historyEntries();
      if (
        field.selectionStart === field.selectionEnd &&
        view.spans.length === 0 &&
        shouldCycle(direction, view.text, field.selectionStart, isCycling(taskId), entries.length > 0)
      ) {
        const next = cycleHistory(taskId, entries, draft.text, direction);
        if (next !== null) {
          event.preventDefault();
          setRecalled(next);
          fileMenu.placeCaret(next.length);
          setDraftText(taskId, next);
          return;
        }
      }
    }
    // 审批门：Ctrl+O = 键帽上的 Details（omp 的 `app.tools.expand`），输入框有焦点时 omp 收不到这个键。
    if (
      approval &&
      !composing &&
      event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "o"
    ) {
      event.preventDefault();
      gateAction(GATE_ACTION_DETAILS);
      return;
    }
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
      // `!` `/` 开头的文字原样发给 omp；门由 omp 画（tspAsking 时上面直接不发送）。
      { running, gate: approval, hasContent, swapped },
    );
    if (action === "default") return;
    event.preventDefault();
    if (tspAsking) return;
    if ((tooOld || worktreeGone) && action !== "gatePrimary") return;
    // omp 的全屏面板（Agent Hub 等）开着：消息只会变成对主代理的插话，不发（主进程也拒绝，见 tsp-runner 的 #awaitComposer）。
    if (screenOpen && action !== "gatePrimary") return;
    if (action === "gatePrimary") gateAction(GATE_ACTION_APPROVE);
    // TSP 审批：omp 收到消息就拒绝待批的调用并把消息当插话（approval-mode.md），不用另发 deny。
    else if (allowSend()) sendNow(action === "followUp" ? "followUp" : "steer");
  };

  if (!task) return null;
  const shownModel = task.model ?? firstPrompt?.model ?? (preStart ? projectDefault.model : null);
  const shownThinking =
    task.model === null
      ? (firstPrompt?.thinkingLevel ?? task.thinkingLevel ?? (preStart ? projectDefault.thinkingLevel : null))
      : task.thinkingLevel;
  return (
    <div className="composer-stack" data-testid="composer-stack" data-from-draft={fromDraft ? "" : undefined}>
      <Reveal open={shownNotice !== null}>
        {heldNotice && (
          <div className="suggest" role="status" data-testid="slash-guard">
            <span>{t("slash.unknown", { name: heldNotice.name })}</span>
            <Button
              size="sm"
              disabled={tooOld === true || worktreeGone}
              onClick={() => {
                sendNow("steer");
                fieldRef.current?.focus();
              }}
            >
              {t("slash.sendAnyway")}
            </Button>
          </div>
        )}
      </Reveal>
      <ComposerTop task={task} />
      <div className="composer" data-composer-drop onDragOver={attach.onDragOver} onDrop={attach.onDrop}>
        <SlashMenu
          id="slash-menu"
          open={slashOpen}
          commands={slashMatches}
          active={slashActive}
          onHover={setSlashIndex}
          onPick={(command) => completeSlash(command.name)}
        />
        <HistorySearch
          open={historyOpen}
          entries={historyEntries()}
          onPick={pickHistory}
          onClose={() => {
            setHistoryOpen(false);
            fieldRef.current?.focus();
          }}
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
          draftKey={taskId}
          draft={draft}
          view={view}
          fieldRef={fieldRef}
          placeholder={placeholder}
          disabled={worktreeGone}
          controls={slashOpen ? "slash-menu" : fileMenu.open ? "file-menu-list" : undefined}
          activeDescendant={
            slashOpen && slashMatches.length > 0
              ? `slash-menu-${slashActive}`
              : fileMenu.open
                ? `file-menu-list-${fileMenu.active}`
                : undefined
          }
          addFiles={attach.addFiles}
          onEdit={(caret) => {
            fileMenu.trackCaret(caret);
            setSlashIndex(0);
            resetHistoryCursor(taskId);
          }}
          onCaret={fileMenu.trackCaret}
          onKeyDown={onKeyDown}
        />
        <div className="composer-tools">
          <ModelChip
            model={shownModel}
            thinkingLevel={shownThinking}
            thinkingLevels={thinkingLevelOptions(shownModel, task.thinkingLevels)}
            running={running}
            projectId={task.projectId}
            loadModels={() => window.studio.listTaskModels(taskId)}
            setModel={(key) => window.studio.setTaskModel(taskId, key)}
            setThinking={(level) => window.studio.setTaskThinkingLevel(taskId, level)}
            taskId={taskId}
            speed={{
              fast: task.fastMode,
              slow: task.slowMode,
              setFast: (enabled) => window.studio.setTaskFastMode(taskId, enabled),
              setSlow: (enabled) => window.studio.setTaskSlowMode(taskId, enabled),
            }}
            // 起进程期间还不知道模型时和草稿一样写"模型…"，不写"未连接模型"
            {...(shownModel === null && (task.status === "starting" || (preStart && projectDefault.pending))
              ? { emptyLabel: t("composer.modelLoading") }
              : {})}
          />
          {/* 还没发过消息的任务（标题为空）不能发斜杠命令：第一次发送会拿它当标题 */}
          <ApprovalChip projectId={task.projectId} forgetTaskId={task.title === "" ? null : taskId} />
          {/* 和草稿工具行同一个位置：任务在哪个文件夹里跑（有 worktree 时是 worktree 根），发出第一句话后不消失 */}
          <PathLabel path={task.cwd} testId="composer-folder" />
          <SessionTogglesMenu taskId={taskId} task={task} />
          {/* 上下文和费用紧跟常驻的胶囊（2026-10-23 仓库所有者：不再挤在发送键左边）；模式、Shell、速度这些时有时无的排在后面，出现时不推动它们 */}
          <ContextMeter task={task} />
          <SessionCost usage={task.sessionUsage} provider={task.model?.key.provider ?? null} />
          <ModeChip taskId={taskId} task={task} />
          <ShellTag taskId={taskId} />
          <UsageMeter task={task} />
          <span className="composer-spacer" />
          {tooOld && <span className="composer-note">{t("composer.versionTooOld")}</span>}
          {screenOpen && <span className="composer-note">{t("composer.screenOpenNote")}</span>}
          <SendStop
            running={running}
            stopping={stopping}
            hasContent={hasContent}
            disabled={tooOld === true || worktreeGone || tspAsking || screenOpen}
            onSend={() => {
              if (allowSend()) sendNow("steer");
            }}
            onSendLater={() => {
              if (allowSend()) sendNow("followUp");
            }}
            onStop={stop}
          />
        </div>
      </div>
    </div>
  );
}

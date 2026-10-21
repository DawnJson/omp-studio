// 输入框 + 底部栈（门槽、编辑器建议条、队列条）。发送行为表见 spec 4.14，按键判定在 send-logic.ts。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useOmpStatus, useSettings, useTask, useTranscript } from "../../store/index.ts";
import { GateSlot } from "../dialogs/gate-slot.tsx";
import { getGateControl } from "../dialogs/gate-bus.ts";
import { pushToast } from "../dialogs/index.ts";
import { onComposerText, onStudioCommand, useSlashCommands } from "../palette/index.ts";
import { compactContext, convertImageFiles, sendDraft, stopAndRestore, type Delivery } from "./actions.ts";
import { getShellRun } from "../conversation/shell-run-store.ts";
import { reportError } from "../../ui/errors.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { SessionTogglesMenu } from "../session-toggles/SessionTogglesMenu.tsx";
import { Attachments } from "./Attachments.tsx";
import { getDraft, resolveSuggestion, setDraft, setDraftText, useDraft, useEditorSuggestion } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { matchSlash, slashQuery } from "./slash-match.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { QueueStrip } from "./QueueStrip.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { TspTodoBar } from "./TspTodoBar.tsx";
import { TspJobsBar } from "./TspJobsBar.tsx";
import { decideEnter, isShellDraft } from "./send-logic.ts";
import { cycleHistory, hasHistory, isCycling, recordSent, resetHistoryCursor, shouldCycle } from "./input-history.ts";
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
import { UsageLimitBanner } from "./UsageLimitBanner.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { useHeld } from "./use-held.ts";
import { JobsBoard } from "./JobsBoard.tsx";
import { useJobs } from "./use-jobs.ts";
import { useReclaimFocus } from "./use-reclaim-focus.ts";
import { useFirstPrompt } from "../tsp/first-prompt-store.ts";
import { peekGateButton, useTspPanelOpen } from "../tsp/tsp-store.ts";
import { GATE_ACTION_APPROVE, GATE_ACTION_DETAILS, TSP_APPROVAL_DIALOG_ID } from "../../../../shared/tsp/gate.ts";
import type { Transcript } from "../../../../shared/transcript.ts";
import { PathLabel } from "../empty/ProjectLabel.tsx";

/** 输入框上方的状态栏（运行状态 + 后台任务）：从 rpc 对话流和泳道推出来，只有 rpc 任务有。 */
function StatusBar({ taskId, task, transcript }: { taskId: TaskId; task: TaskState; transcript: Transcript | null }) {
  const jobs = useJobs(taskId, transcript);
  return (
    <div className="status-bar">
      <RunStatus task={task} transcript={transcript} jobs={jobs} />
      <JobsBoard taskId={taskId} jobs={jobs} projectPath={task.cwd} />
    </div>
  );
}

export function Composer({ taskId, fromDraft = false }: { taskId: TaskId; fromDraft?: boolean }) {
  const t = useT();
  const task = useTask(taskId);
  // TSP 任务（engine "tsp"）：过程区是 TspView，输入框功能不变；文字照常发给 omp（`/` `!` 开头的也原样交给它），studio 靠 rpc 的东西（studio 斜杠命令、队列条、状态栏）不出现。
  const tsp = task?.engine === "tsp";
  const transcript = useTranscript(taskId);
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
  const suggestion = useEditorSuggestion(taskId);
  const omp = useOmpStatus();
  const settings = useSettings();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useReclaimFocus(fieldRef, tsp);
  // 按任务记：切到别的任务不会继承"正在停止"。
  const [stoppingId, setStoppingId] = useState<TaskId | null>(null);
  const stopping = stoppingId === taskId;
  const ompCommands = useSlashCommands(taskId);
  // omp 的列表还没载入时保持空：守卫在空列表时一律放行（studio-slash 的命令发送时照样会被接管）。
  // studio 接管哪些命令、哪些交给 omp 由命令表按宿主（rpc / TSP）定，见 studio-slash.ts。
  const host = tsp ? "tsp" : "rpc";
  const commands = useMemo(
    () => (ompCommands.length === 0 ? ompCommands : withStudioSlash(ompCommands, studioSlashCommands, host, t)),
    [ompCommands, host, t],
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

  const completeSlash = (name: string) => {
    setDraftText(taskId, `/${name} `);
    setSlashIndex(0);
    fieldRef.current?.focus();
  };

  const fileMenu = useFileMenu({ kind: "task", taskId }, draft.text, menusEnabled && !slashOpen, fieldRef, (next) =>
    setDraftText(taskId, next),
  );

  const running = task?.status === "running" || task?.status === "needs_you";
  const gate = (task?.dialogs.length ?? 0) > 0;
  // TSP 任务：omp 正在画提问/审批（任务 needs_you，或有合成的 tsp-ask / tsp-approval 门）。提问要在过程区里回答，输入框这时不能发送；
  // 审批不拦：输入框里写的字发出去 = 拒绝并说明理由（omp 自己的行为），Ctrl+Enter 批准，Ctrl+O 看详情。
  const approval = tsp && (task?.dialogs.some((dialog) => dialog.id === TSP_APPROVAL_DIALOG_ID) ?? false);
  const tspAsking = tsp && (task?.status === "needs_you" || gate) && !approval;
  // omp 的全屏面板（Agent Hub 等）开着：输入框不往主代理发（B5）。
  const screenOpen = useTspPanelOpen(taskId) && tsp;
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0;
  const swapped = settings?.enterWhileRunning === "followUp";
  const tooOld = omp?.state === "ready" && omp.belowMinimum;
  // worktree 被删了：只能查看记录（和 omp 一致），输入框禁用，说明在对话流末尾的错误条里。
  const worktreeGone = task?.error?.kind === "worktree_missing";

  // 斜杠命令守卫（slash-guard.ts）：命令列表里没有的 /命令先提示一次，对同一段文字再发一次（或点按钮）才发出去。
  const [slashNotice, setSlashNotice] = useState<{ text: string; name: string; terminal: boolean } | null>(null);
  const shownNotice = slashNotice?.text === draft.text.trim() ? slashNotice : null;
  // 提示收起的动画期间内容不能先消失。
  const heldNotice = useHeld(shownNotice);
  const allowSend = (): boolean => {
    const text = getDraft(taskId).text.trim();
    const guard = decideSlashSend(text, commands);
    if (guard.kind === "send" || slashNotice?.text === text) return true;
    setSlashNotice({ text, name: guard.name, terminal: guard.terminal });
    return false;
  };
  const sendNow = (whenBusy: Delivery) => {
    recordSent(taskId, getDraft(taskId).text, transcript?.items ?? null);
    setSlashNotice(null);
    void sendDraft(taskId, whenBusy, t, running, tsp);
  };

  /** 点审批卡上动作名为 `act` 的按钮（和用鼠标点同一个 `action` 事件）；卡上没有这个按钮就什么都不做。 */
  const gateAction = (act: string) => {
    const button = peekGateButton(taskId, act);
    if (button === null) return;
    window.studio
      .sendTspEvent(taskId, { ev: "action", sf: button.sf, id: button.id, act })
      .catch((error: unknown) => reportError(t, error));
  };

  const placeholder = worktreeGone
    ? t("error.worktreeMissing")
    : screenOpen
      ? t("composer.placeholderScreen")
      : tspAsking
        ? t("composer.placeholderAsk")
        : gate
          ? t("composer.placeholderGate")
          : running
            ? t(swapped ? "composer.placeholderRunningSwapped" : "composer.placeholderRunning")
            : (transcript?.items.length ?? 0) > 0
              ? t("composer.placeholder")
              : t("composer.placeholderNew");

  // 自动增高：最小 2 行（CSS），最大 min(40vh, 12 行)（CSS）；超出内部滚动。
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [draft.text]);

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

  // Esc 栈第 4 层：前面的层（菜单、门、弹层）会消耗掉 Esc（preventDefault），没人消耗才动手：
  // 有 `!命令` 在跑先中止命令，否则停止任务。这是 Esc 中止的唯一入口（ShellBlock 里不另挂监听，免得顺序不定）。
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // TSP 过程区里的 Esc（关选择器、取消提问）是写给 omp 的按键，不是"停止任务"。
      if (event.target instanceof Element && event.target.closest('[data-testid="tsp-view"]') !== null) return;
      if (getShellRun(taskId) !== null) {
        event.preventDefault();
        window.studio.abortBash(taskId).catch((error: unknown) => reportError(t, error));
      } else if (running || screenOpen) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, running, screenOpen, taskId, t]);

  useEffect(
    () =>
      onStudioCommand((command) => {
        if (command === "stop") stop();
        if (command === "compact" && !tsp) void compactContext(taskId, t);
      }),
    [stop, taskId, t, tsp],
  );

  const addFiles = async (files: Iterable<File>) => {
    if (task?.model && !task.model.acceptsImages) {
      pushToast({ level: "warning", message: t("composer.attach.unsupported") });
      return;
    }
    const converted = await convertImageFiles(files, t);
    if (converted.length > 0) {
      const current = getDraft(taskId);
      setDraft(taskId, { text: current.text, images: [...current.images, ...converted] });
    }
  };

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
    // 输入历史：菜单没抢走 ↑↓ 时，空输入框（或光标在最开头）按 ↑ 翻看本任务发过的消息。
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
      const items = transcript?.items ?? null;
      if (
        field.selectionStart === field.selectionEnd &&
        shouldCycle(direction, draft.text, field.selectionStart, isCycling(taskId), hasHistory(taskId, items))
      ) {
        const next = cycleHistory(taskId, draft.text, direction, items);
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
      // TSP 任务：`!` 原样发给 omp，不当 shell 命令；门由 omp 画（tspAsking 时上面直接不发送）。
      {
        running,
        gate: (gate && !tsp) || approval,
        hasContent,
        swapped,
        shell: !tsp && isShellDraft(draft),
        ctrlApproves: approval,
      },
    );
    if (action === "default") return;
    event.preventDefault();
    if (tspAsking) return;
    if ((tooOld || worktreeGone) && action !== "gatePrimary") return;
    // omp 的全屏面板（Agent Hub 等）开着：消息只会变成对主代理的插话，不发（主进程也拒绝，见 tsp-runner 的 #awaitComposer）。
    if (screenOpen && action !== "gatePrimary") return;
    if (action === "gatePrimary") {
      if (tsp) gateAction(GATE_ACTION_APPROVE);
      else getGateControl()?.primary();
    } else if (action === "shell") sendNow("steer");
    else if (action === "denyAndSend") {
      if (!allowSend()) return;
      // TSP 审批：omp 收到消息就拒绝待批的调用并把消息当插话（approval-mode.md），不用另发 deny。
      if (tsp) {
        sendNow("steer");
        return;
      }
      void getGateControl()
        ?.deny()
        .then(
          () => sendNow("steer"),
          () => sendNow("steer"),
        );
    } else if (allowSend()) sendNow(action === "followUp" ? "followUp" : "steer");
  };

  // 粘贴：图片作附件；其余文件（资源管理器里复制的文件、文件夹）由 preload 把路径插进输入框（src/preload/index.ts）。
  const onPaste = (event: ClipboardEvent) => {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    void addFiles(images);
  };
  const onDragOver = (event: DragEvent) => {
    if ([...event.dataTransfer.items].some((item) => item.kind === "file")) event.preventDefault();
  };
  const onDrop = (event: DragEvent) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    void addFiles(event.dataTransfer.files);
  };

  if (!task) return null;
  const shownModel = task.model ?? firstPrompt?.model ?? (preStart ? projectDefault.model : null);
  const shownThinking =
    task.model === null
      ? (firstPrompt?.thinkingLevel ?? task.thinkingLevel ?? (preStart ? projectDefault.thinkingLevel : null))
      : task.thinkingLevel;
  return (
    <div className="composer-stack" data-testid="composer-stack" data-from-draft={fromDraft ? "" : undefined}>
      {/* 门（审批、提问）：rpc 任务由 DialogLayer 放进这里；TSP 任务的由 omp 画在过程区里，不挂槽。 */}
      {!tsp && <GateSlot />}
      <Reveal open={suggestion !== null}>
        <div className="suggest" role="status">
          <span>{t("gate.suggestReplace")}</span>
          <button type="button" className="queue-btn" onClick={() => resolveSuggestion(taskId, true)}>
            {t("gate.suggestReplaceYes")}
          </button>
          <button type="button" className="queue-btn" onClick={() => resolveSuggestion(taskId, false)}>
            {t("gate.suggestKeep")}
          </button>
        </div>
      </Reveal>
      <Reveal open={shownNotice !== null}>
        {heldNotice && (
          <div className="suggest" role="status" data-testid="slash-guard">
            <span>{heldNotice.terminal ? t("slash.terminalOnly") : t("slash.unknown", { name: heldNotice.name })}</span>
            <button
              type="button"
              className="queue-btn"
              disabled={tooOld === true || worktreeGone}
              onClick={() => {
                sendNow("steer");
                fieldRef.current?.focus();
              }}
            >
              {t("slash.sendAnyway")}
            </button>
          </div>
        )}
      </Reveal>
      <UsageLimitBanner limit={task.usageLimit} />
      {/* TSP 任务：排队、运行状态、后台任务是 omp 在过程区的 dock 里画的；待办是 studio 的待办板（HUD 药丸不画，TspChildren）。 */}
      {!tsp && <QueueStrip taskId={taskId} queue={task.queue} />}
      {!tsp && <StatusBar taskId={taskId} task={task} transcript={transcript} />}
      {tsp && <TspTodoBar task={task} />}
      {tsp && <TspJobsBar task={task} />}
      <div className="composer" data-gate={(gate && !tsp) || undefined} onDragOver={onDragOver} onDrop={onDrop}>
        <SlashMenu
          id="slash-menu"
          open={slashOpen}
          commands={slashMatches}
          active={slashActive}
          onHover={setSlashIndex}
          onPick={(command) => completeSlash(command.name)}
        />
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
              setDraft(taskId, { text: draft.text, images: draft.images.filter((_, i) => i !== index) })
            }
          />
          <textarea
            ref={fieldRef}
            className="composer-field"
            data-composer-input
            data-testid="composer-input"
            rows={1}
            value={draft.text}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={worktreeGone}
            aria-controls={slashOpen ? "slash-menu" : fileMenu.open ? "file-menu-list" : undefined}
            aria-activedescendant={
              slashOpen && slashMatches.length > 0
                ? `slash-menu-${slashActive}`
                : fileMenu.open
                  ? `file-menu-list-${fileMenu.active}`
                  : undefined
            }
            onChange={(event) => {
              setDraftText(taskId, event.target.value);
              fileMenu.trackCaret(event.target.selectionStart);
              setSlashIndex(0);
              resetHistoryCursor(taskId);
            }}
            onSelect={(event) => fileMenu.trackCaret(event.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
        </div>
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
            presetTaskId={taskId}
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
          <SessionTogglesMenu taskId={taskId} task={task} />
          {/* 和草稿工具行同一个位置：任务在哪个文件夹里跑（有 worktree 时是 worktree 根），发出第一句话后不消失 */}
          <PathLabel path={task.cwd} testId="composer-folder" />
          <UsageMeter task={task} />
          <span className="composer-spacer" />
          {tooOld && <span className="composer-note">{t("composer.versionTooOld")}</span>}
          {screenOpen && <span className="composer-note">{t("composer.screenOpenNote")}</span>}
          <ContextMeter task={task} />
          <SessionCost usage={task.sessionUsage} provider={task.model?.key.provider ?? null} />
          <SendStop
            running={running}
            stopping={stopping}
            hasContent={hasContent}
            disabled={tooOld === true || worktreeGone || tspAsking || screenOpen}
            onSend={() => {
              if (allowSend()) sendNow("steer");
            }}
            onStop={stop}
          />
        </div>
      </div>
    </div>
  );
}

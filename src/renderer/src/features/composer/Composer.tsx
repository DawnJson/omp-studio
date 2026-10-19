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
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";
import { useOmpStatus, useSettings, useTask, useTranscript } from "../../store/index.ts";
import { GateSlot } from "../dialogs/gate-slot.tsx";
import { getGateControl } from "../dialogs/gate-bus.ts";
import { pushToast } from "../dialogs/index.ts";
import { onComposerText, onStudioCommand, useSlashCommands } from "../palette/index.ts";
import { compactContext, convertImageFiles, sendDraft, stopAndRestore, type Delivery } from "./actions.ts";
import { getShellRun } from "../conversation/shell-run-store.ts";
import { reportError } from "../../ui/errors.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { Attachments } from "./Attachments.tsx";
import { getDraft, resolveSuggestion, setDraft, setDraftText, useDraft, useEditorSuggestion } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { matchSlash, slashQuery } from "./slash-match.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { QueueStrip } from "./QueueStrip.tsx";
import { RunStatus } from "./RunStatus.tsx";
import { decideEnter, isShellDraft } from "./send-logic.ts";
import { cycleHistory, hasHistory, isCycling, recordSent, resetHistoryCursor, shouldCycle } from "./input-history.ts";
import { decideSlashSend } from "./slash-guard.ts";
import { withStudioSlash } from "./studio-slash.ts";
import { studioSlashCommands } from "./studio-slash-table.ts";
import { FileMenu } from "./FileMenu.tsx";
import { useFileMenu } from "./use-file-menu.ts";
import { SendStop } from "./SendStop.tsx";
import { thinkingLevelOptions } from "./thinking-levels.ts";
import { SessionCost } from "./SessionCost.tsx";
import { ContextMeter, UsageMeter } from "./UsageMeter.tsx";
import { UsageLimitBanner } from "./UsageLimitBanner.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { useHeld } from "./use-held.ts";

export function Composer({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const task = useTask(taskId);
  const transcript = useTranscript(taskId);
  const draft = useDraft(taskId);
  const suggestion = useEditorSuggestion(taskId);
  const omp = useOmpStatus();
  const settings = useSettings();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 按任务记：切到别的任务不会继承"正在停止"。
  const [stoppingId, setStoppingId] = useState<TaskId | null>(null);
  const stopping = stoppingId === taskId;
  const ompCommands = useSlashCommands(taskId);
  // omp 的列表还没载入时保持空：守卫在空列表时一律放行（studio-slash 的命令发送时照样会被接管）。
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
    void sendDraft(taskId, whenBusy, t, running);
  };

  const placeholder = worktreeGone
    ? t("error.worktreeMissing")
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
    if (!running || stopping) return;
    setStoppingId(taskId);
    // 请求结束（成功或失败）都复位，否则失败后按钮永远停在"正在停止"。
    void stopAndRestore(taskId, t).finally(() => {
      setStoppingId((current) => (current === taskId ? null : current));
      fieldRef.current?.focus();
    });
  }, [running, stopping, taskId, t]);

  // Esc 栈第 4 层：前面的层（菜单、门、弹层）会消耗掉 Esc（preventDefault），没人消耗才动手：
  // 有 `!命令` 在跑先中止命令，否则停止任务。这是 Esc 中止的唯一入口（ShellBlock 里不另挂监听，免得顺序不定）。
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (getShellRun(taskId) !== null) {
        event.preventDefault();
        window.studio.abortBash(taskId).catch((error: unknown) => reportError(t, error));
      } else if (running) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, running, taskId, t]);

  useEffect(
    () =>
      onStudioCommand((command) => {
        if (command === "stop") stop();
        if (command === "compact") void compactContext(taskId, t);
      }),
    [stop, taskId, t],
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
      { running, gate, hasContent, swapped, shell: isShellDraft(draft) },
    );
    if (action === "default") return;
    event.preventDefault();
    if ((tooOld || worktreeGone) && action !== "gatePrimary") return;
    if (action === "gatePrimary") getGateControl()?.primary();
    else if (action === "shell") sendNow("steer");
    else if (action === "denyAndSend") {
      if (!allowSend()) return;
      void getGateControl()
        ?.deny()
        .then(
          () => sendNow("steer"),
          () => sendNow("steer"),
        );
    } else if (allowSend()) sendNow(action === "followUp" ? "followUp" : "steer");
  };

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files];
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addFiles(files);
    }
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
  return (
    <div className="composer-stack" data-testid="composer-stack">
      <GateSlot />
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
      <QueueStrip taskId={taskId} queue={task.queue} />
      <RunStatus task={task} transcript={transcript} />
      <div className="composer" data-gate={gate || undefined} onDragOver={onDragOver} onDrop={onDrop}>
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
            model={task.model}
            thinkingLevel={task.thinkingLevel}
            thinkingLevels={thinkingLevelOptions(task.model, task.thinkingLevels)}
            running={running}
            projectId={task.projectId}
            loadModels={() => window.studio.listTaskModels(taskId)}
            setModel={(key) => window.studio.setTaskModel(taskId, key)}
            setThinking={(level) => window.studio.setTaskThinkingLevel(taskId, level)}
            speed={{
              fast: task.fastMode,
              slow: task.slowMode,
              setFast: (enabled) => window.studio.setTaskFastMode(taskId, enabled),
              setSlow: (enabled) => window.studio.setTaskSlowMode(taskId, enabled),
            }}
          />
          <ApprovalChip />
          <UsageMeter task={task} />
          <span className="composer-spacer" />
          {tooOld && <span className="composer-note">{t("composer.versionTooOld")}</span>}
          <ContextMeter task={task} />
          <SessionCost usage={task.sessionUsage} provider={task.model?.key.provider ?? null} />
          <SendStop
            running={running}
            stopping={stopping}
            hasContent={hasContent}
            disabled={tooOld === true || worktreeGone}
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

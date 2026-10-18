// 输入框 + 底部栈（门槽、编辑器建议条、队列条）。发送行为表见 spec 4.14，按键判定在 send-logic.ts。
import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { compactContext, convertImageFiles, sendDraft, stopAndRestore } from "./actions.ts";
import { ApprovalChip } from "./ApprovalChip.tsx";
import { Attachments } from "./Attachments.tsx";
import { getDraft, resolveSuggestion, setDraft, setDraftText, useDraft, useEditorSuggestion } from "./draft-store.ts";
import { ModelChip } from "./ModelChip.tsx";
import { matchSlash, slashQuery } from "./slash-match.ts";
import { SlashMenu } from "./SlashMenu.tsx";
import { QueueStrip } from "./QueueStrip.tsx";
import { decideEnter } from "./send-logic.ts";
import { SendStop } from "./SendStop.tsx";
import { UsageMeter } from "./UsageMeter.tsx";
import "./composer.css";

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
  const commands = useSlashCommands(taskId);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosedFor, setSlashClosedFor] = useState<string | null>(null);
  const query = slashQuery(draft.text);
  const slashMatches =
    query === null || slashClosedFor === draft.text || commands.length === 0 ? [] : matchSlash(commands, query);
  const slashOpen = query !== null && slashClosedFor !== draft.text && commands.length > 0;
  const slashActive = Math.min(slashIndex, Math.max(slashMatches.length - 1, 0));

  const completeSlash = (name: string) => {
    setDraftText(taskId, `/${name} `);
    setSlashIndex(0);
    fieldRef.current?.focus();
  };

  const running = task?.status === "running" || task?.status === "needs_you";
  const gate = (task?.dialogs.length ?? 0) > 0;
  const hasContent = draft.text.trim() !== "" || draft.images.length > 0;
  const swapped = settings?.enterWhileRunning === "followUp";
  const tooOld = omp?.state === "ready" && omp.belowMinimum;

  const placeholder = gate
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

  // Esc 栈第 4 层：前面的层（菜单、门、弹层）会消耗掉 Esc（preventDefault），没人消耗才停止任务。
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && running) {
        event.preventDefault();
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, running]);

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
      // Tab 总是补全；Enter 在已经输入完整命令名时发送，否则补全。
      if (
        picked &&
        (event.key === "Tab" ||
          (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && draft.text !== `/${picked.name}`))
      ) {
        event.preventDefault();
        completeSlash(picked.name);
        return;
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
      { running, gate, hasContent, swapped },
    );
    if (action === "default") return;
    event.preventDefault();
    if (tooOld && action !== "gatePrimary") return;
    if (action === "gatePrimary") getGateControl()?.primary();
    else if (action === "denyAndSend")
      void getGateControl()
        ?.deny()
        .then(
          () => sendDraft(taskId, "steer", t),
          () => sendDraft(taskId, "steer", t),
        );
    else void sendDraft(taskId, action === "followUp" ? "followUp" : "steer", t);
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
      {suggestion !== null && (
        <div className="suggest" role="status">
          <span>{t("gate.suggestReplace")}</span>
          <button type="button" className="queue-btn" onClick={() => resolveSuggestion(taskId, true)}>
            {t("gate.suggestReplaceYes")}
          </button>
          <button type="button" className="queue-btn" onClick={() => resolveSuggestion(taskId, false)}>
            {t("gate.suggestKeep")}
          </button>
        </div>
      )}
      <QueueStrip taskId={taskId} queue={task.queue} />
      <div className="composer" data-gate={gate || undefined} onDragOver={onDragOver} onDrop={onDrop}>
        {slashOpen && (
          <SlashMenu
            id="slash-menu"
            commands={slashMatches}
            active={slashActive}
            onHover={setSlashIndex}
            onPick={(command) => completeSlash(command.name)}
          />
        )}
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
            rows={2}
            value={draft.text}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls={slashOpen ? "slash-menu" : undefined}
            aria-activedescendant={slashOpen && slashMatches.length > 0 ? `slash-menu-${slashActive}` : undefined}
            onChange={(event) => {
              setDraftText(taskId, event.target.value);
              setSlashIndex(0);
            }}
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
            thinkingLevels={task.thinkingLevels}
            running={running}
            loadModels={() => window.studio.listTaskModels(taskId)}
            setModel={(key) => window.studio.setTaskModel(taskId, key)}
            setThinking={(level) => window.studio.setTaskThinkingLevel(taskId, level)}
          />
          <ApprovalChip />
          <span className="composer-spacer" />
          {tooOld && <span className="composer-note">{t("composer.versionTooOld")}</span>}
          <SendStop
            running={running}
            stopping={stopping}
            hasContent={hasContent}
            disabled={tooOld === true}
            onSend={() => void sendDraft(taskId, "steer", t)}
            onStop={stop}
          />
        </div>
      </div>
      <UsageMeter task={task} />
    </div>
  );
}

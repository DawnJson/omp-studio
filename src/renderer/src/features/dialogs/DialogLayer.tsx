// 对话框层：把当前任务的第一个待答请求渲染成"门"，portal 进输入框上方的槽（Composer 里的 GateSlot）；toast 是主区面板上沿正中的气泡。
// 数据只从 useTask(taskId).dialogs 取；答复经 window.studio.respondDialog，主进程确认后 dialogs 才会变。
import { useEffect, useRef, useState } from "react";
import { usePresence } from "../../ui/presence.ts";
import { createPortal } from "react-dom";
import type { DialogRequest, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTask } from "../../store/index.ts";
import { startKeyActivityTracking } from "./activity.ts";
import { Gate } from "./Gate.tsx";
import { wasAnswered } from "./gate-bus.ts";
import { useGateSlot } from "./gate-slot.tsx";
import { Toasts } from "./Toasts.tsx";
import { useNeedsYouToasts, useTaskNotices } from "./use-task-notices.ts";
import "./dialogs.css";

let tracking = false;

function timeoutOf(dialog: DialogRequest): number | undefined {
  return dialog.kind === "editor" ? undefined : dialog.timeoutMs;
}

/** 当前门消失但不是我们答的（omp 发了 cancel：超时或中止）：收成一行，1.2 秒后消失。 */
function useDismissedNote(current: DialogRequest | undefined, taskId: TaskId | null): string | null {
  const t = useT();
  const [note, setNote] = useState<string | null>(null);
  const shown = useRef<{ dialog: DialogRequest; at: number; taskId: TaskId | null } | null>(null);

  useEffect(() => {
    const previous = shown.current;
    if (
      previous &&
      previous.taskId === taskId &&
      previous.dialog.id !== current?.id &&
      !wasAnswered(previous.dialog.id)
    ) {
      const timeout = timeoutOf(previous.dialog);
      const timedOut = timeout !== undefined && Date.now() - previous.at >= timeout - 800;
      setNote(timedOut ? t("gate.timedOut") : t("gate.cancelled"));
      const timer = setTimeout(() => setNote(null), 1200);
      shown.current = current ? { dialog: current, at: Date.now(), taskId } : null;
      return () => clearTimeout(timer);
    }
    shown.current = current
      ? { dialog: current, at: previous?.dialog.id === current.id ? previous.at : Date.now(), taskId }
      : null;
    return undefined;
  }, [current, taskId, t]);

  return note;
}

export function DialogLayer({ taskId }: { taskId: TaskId | null }) {
  const task = useTask(taskId);
  const slot = useGateSlot();
  const dialogs = task?.dialogs ?? [];
  const current = dialogs[0];

  useEffect(() => {
    if (tracking) return;
    tracking = true;
    startKeyActivityTracking();
  }, []);
  useTaskNotices();
  useNeedsYouToasts();
  const note = useDismissedNote(current, taskId);

  // 请求结束后门留着放完退出动画（最后一个请求的内容记在 ref 里）；换任务时不留。
  const gateOpen = current !== undefined && taskId !== null;
  const gatePresence = usePresence(gateOpen);
  const lastGate = useRef<{ taskId: TaskId; dialog: DialogRequest; pending: number } | null>(null);
  if (gateOpen) lastGate.current = { taskId, dialog: current, pending: dialogs.length - 1 };
  const leavingGate =
    !gateOpen && gatePresence.mounted && lastGate.current?.taskId === taskId ? lastGate.current : null;

  // "已取消"小字条的淡出：note 清掉后用最后一句文字放完退出动画。
  const notePresence = usePresence(note !== null);
  const lastNote = useRef<string | null>(null);
  if (note !== null) lastNote.current = note;

  return (
    <>
      {slot !== null &&
        createPortal(
          gateOpen ? (
            <Gate key={current.id} taskId={taskId} dialog={current} pending={dialogs.length - 1} />
          ) : leavingGate !== null ? (
            <Gate
              key={leavingGate.dialog.id}
              taskId={leavingGate.taskId}
              dialog={leavingGate.dialog}
              pending={leavingGate.pending}
              exit={gatePresence.exitProps}
            />
          ) : notePresence.mounted && lastNote.current !== null ? (
            <div className="gate-ghost" role="status" {...notePresence.exitProps}>
              {lastNote.current}
            </div>
          ) : null,
          slot,
        )}
      <Toasts />
    </>
  );
}

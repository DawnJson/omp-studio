// 对话框层：把当前任务的第一个待答请求渲染成"门"，portal 进输入框上方的槽（Composer 里的 GateSlot）；toast 在右下角。
// 数据只从 useTask(taskId).dialogs 取；答复经 window.studio.respondDialog，主进程确认后 dialogs 才会变。
import { useEffect, useRef, useState } from "react";
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
    if (previous && previous.taskId === taskId && previous.dialog.id !== current?.id && !wasAnswered(previous.dialog.id)) {
      const timeout = timeoutOf(previous.dialog);
      const timedOut = timeout !== undefined && Date.now() - previous.at >= timeout - 800;
      setNote(timedOut ? t("gate.timedOut") : t("gate.cancelled"));
      const timer = setTimeout(() => setNote(null), 1200);
      shown.current = current ? { dialog: current, at: Date.now(), taskId } : null;
      return () => clearTimeout(timer);
    }
    shown.current = current ? { dialog: current, at: previous?.dialog.id === current.id ? previous.at : Date.now(), taskId } : null;
    return undefined;
  }, [current, taskId, t]);

  return note;
}

export function DialogLayer({ taskId }: { taskId: TaskId | null }) {
  const task = useTask(taskId);
  const slot = useGateSlot();
  const dialogs = task?.dialogs ?? [];
  const current = dialogs[0];

  if (!tracking) {
    tracking = true;
    startKeyActivityTracking();
  }
  useTaskNotices();
  useNeedsYouToasts();
  const note = useDismissedNote(current, taskId);

  return (
    <>
      {slot !== null &&
        createPortal(
          current !== undefined && taskId !== null ? (
            <Gate key={current.id} taskId={taskId} dialog={current} pending={dialogs.length - 1} />
          ) : note !== null ? (
            <div className="gate-ghost" role="status">{note}</div>
          ) : null,
          slot,
        )}
      <Toasts />
    </>
  );
}

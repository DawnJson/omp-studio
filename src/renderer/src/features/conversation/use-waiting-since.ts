import { useEffect, useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";

/** 进入"等你确认"的时间（渲染进程自己记：帧里没有时间戳）。 */
export function useWaitingSince(task: TaskState | null): number | null {
  const [since, setSince] = useState<number | null>(null);
  const waiting = task?.status === "needs_you";
  useEffect(() => {
    setSince((current) => (waiting ? (current ?? Date.now()) : null));
  }, [waiting]);
  return since;
}

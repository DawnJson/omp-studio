// 本任务的后台任务：对话流里的工具记录 + 子代理泳道推出来（shared/ui/jobs.ts）。
import { useMemo } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { deriveJobs, type Job } from "../../../../shared/ui/jobs.ts";
import type { Transcript } from "../../../../shared/transcript.ts";
import { useLanes } from "../../store/lanes-store.ts";

export function useJobs(taskId: TaskId, transcript: Transcript | null): Job[] {
  const lanes = useLanes(taskId);
  return useMemo(() => deriveJobs(transcript, lanes), [transcript, lanes]);
}

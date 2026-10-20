// 运行中的一句话状态（输入框上方的状态栏用）：从对话流快照里找出"现在在做什么"，再拼成文字。
import type { TaskStatus } from "../../../../shared/ipc.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Transcript } from "../../../../shared/transcript.ts";
import { isWaitingOnJobs, type JobCounts } from "../../../../shared/ui/jobs.ts";
import { formatElapsed } from "./format.ts";
import { lastBlockKind, toolFromRun, type ToolStep } from "./model.ts";
import { toolLabel } from "./ProcessDetails.tsx";

export interface LiveScan {
  /** 压缩 / 重试这类状态行正在进行。 */
  phase: "compacting" | "retrying" | null;
  /** 本次运行里最近开始、仍在执行的工具。 */
  tool: ToolStep | null;
  /** 正在流式的助手消息当前在写什么。 */
  kind: "thinking" | "text" | "tool" | null;
  /** 本次运行里有 wait 工具在执行（agent 在等后台任务）。 */
  waitingOnJobs: boolean;
}

/** 只依赖对话流快照，调用方按快照 memo；倒着找，找到就停。 */
export function scanLive(transcript: Transcript | null): LiveScan {
  if (!transcript) return { phase: null, tool: null, kind: null, waitingOnJobs: false };
  let phase: LiveScan["phase"] = null;
  let phaseFound = false;
  let kind: LiveScan["kind"] = null;
  let messageFound = false;
  for (let index = transcript.items.length - 1; index >= 0 && !(phaseFound && messageFound); index -= 1) {
    const item = transcript.items[index];
    if (!item) continue;
    if (!phaseFound && item.kind === "status_line") {
      phaseFound = true;
      phase = item.phase === "start" ? (item.statusKind === "compaction" ? "compacting" : "retrying") : null;
    } else if (!messageFound && item.kind === "message") {
      messageFound = true;
      if (item.message.role === "assistant" && item.streaming) kind = lastBlockKind(item.message);
    }
  }
  // 只看本次运行开始之后的工具：被中断后残留的 running 记录不算。
  const since = transcript.runs[transcript.runs.length - 1]?.startedAt ?? 0;
  let latest: ToolStep | null = null;
  let latestAt = -1;
  for (const run of Object.values(transcript.tools)) {
    if (run.status !== "running" || run.startedAt < since || run.startedAt < latestAt) continue;
    latestAt = run.startedAt;
    latest = toolFromRun(run, `tool:${run.toolCallId}`);
  }
  return { phase, tool: latest, kind, waitingOnJobs: isWaitingOnJobs(transcript) };
}

export interface LiveStatusInput {
  status: TaskStatus;
  /** 进入"等你确认"的时间；null 表示没在等。 */
  waitingSince: number | null;
  subagentsRunning: number;
  scan: LiveScan;
  /** 本任务的后台任务计数；没有任何 job 时不传。 */
  jobs?: JobCounts | undefined;
}

/** 当前活动文字：等你确认（带暂停时长）/ 启动 / 压缩 / 重试 / 等后台任务 / 最近的工具（intent 优先）/ 回复 / 思考，再附子代理数。 */
export function liveStatusText(
  { status, waitingSince, subagentsRunning, scan, jobs }: LiveStatusInput,
  now: number,
  t: TFunction,
): string {
  if (status === "needs_you") return t("process.waiting", { duration: formatElapsed(now - (waitingSince ?? now)) });
  if (status === "starting") return t("process.starting");
  // agent 在 wait 后台任务：直接说在等几个，不再重复"N 个子代理"。
  if (scan.phase === null && jobs && jobs.running > 0 && scan.waitingOnJobs) return waitingJobsText(jobs, t);
  let text: string;
  if (scan.phase === "compacting") text = t("process.compacting");
  else if (scan.phase === "retrying") text = t("process.retryingNow");
  else if (scan.tool) text = toolLabel(scan.tool, t);
  else if (scan.kind === "text") text = t("process.replying");
  else text = t("process.thinking");
  return subagentsRunning > 0 ? `${text} · ${t("process.subagentsRunning", { count: subagentsRunning })}` : text;
}

/** `等待 2/3 个后台任务 · 1 个完成`；还没有完成的就只说在等几个。 */
function waitingJobsText(jobs: JobCounts, t: TFunction): string {
  return jobs.done === 0
    ? t("process.waitingJobsNone", { count: jobs.running })
    : t("process.waitingJobs", { running: jobs.running, total: jobs.total, done: jobs.done });
}

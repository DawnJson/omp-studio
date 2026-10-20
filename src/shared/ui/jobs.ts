// 后台任务（job）的推导：omp 没有"列出 job"的 RPC，只能从工具帧里拼——
// 异步 bash（args.async + details.async）、task 派出的子代理（"Spawned agent `X` (job `X`)" + 泳道状态）、
// wait 工具 details.jobs[] 的快照（有就以它为准）。纯函数，不碰 DOM。
import type { SubagentLane } from "../subagents.ts";
import type { ToolRun, Transcript } from "../transcript.ts";
import { isRecord } from "../type-guards.ts";

type JobStatus = "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  type: "bash" | "task";
  label: string;
  status: JobStatus;
  /** 主进程接收时间（ms）；只在 wait 快照里见过的 job 是按快照时长倒推的。 */
  startedAt: number;
  /** omp 量的时长；还没有时为 null（运行中的由界面用现在 - startedAt）。 */
  durationMs: number | null;
  /** bash 的输出尾部（累积输出的最后一段）；其他类型和没有输出时为 null。 */
  output: string | null;
}

export interface JobCounts {
  running: number;
  /** 已结束（完成、失败、取消）。 */
  done: number;
  failed: number;
  total: number;
}

const OUTPUT_TAIL_CHARS = 4000;

function isTerminal(status: JobStatus): boolean {
  return status !== "running";
}

function toStatus(value: unknown): JobStatus | null {
  switch (value) {
    case "running":
    case "pending":
    case "queued":
      return "running";
    case "completed":
    case "done":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "cancelled";
    default:
      return null;
  }
}

function laneStatus(status: SubagentLane["status"]): JobStatus {
  return status === "aborted" ? "cancelled" : status;
}

function resultTextOf(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function detailsOf(result: unknown): Record<string, unknown> | null {
  return isRecord(result) && isRecord(result.details) ? result.details : null;
}

function asyncInfoOf(result: unknown): { state: JobStatus | null; jobId: string | null } | null {
  const info = detailsOf(result)?.async;
  if (!isRecord(info)) return null;
  return { state: toStatus(info.state), jobId: typeof info.jobId === "string" ? info.jobId : null };
}

function tail(text: string): string {
  const trimmed = text.trimEnd();
  return trimmed.length > OUTPUT_TAIL_CHARS ? trimmed.slice(trimmed.length - OUTPUT_TAIL_CHARS) : trimmed;
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.trim();
}

function upsert(jobs: Map<string, Job>, job: Job): void {
  const old = jobs.get(job.id);
  if (!old) {
    jobs.set(job.id, job);
    return;
  }
  // 结束了的不会因为更早的"运行中"快照退回去；其余以新的为准，空值不盖掉已有的。
  if (isTerminal(old.status) && !isTerminal(job.status)) {
    jobs.set(job.id, { ...old, label: job.label || old.label });
    return;
  }
  jobs.set(job.id, {
    ...old,
    label: job.label || old.label,
    status: job.status,
    durationMs: job.durationMs ?? old.durationMs,
    output: job.output ?? old.output,
  });
}

function fromBash(run: ToolRun): Job | null {
  if (run.toolName !== "bash" || !isRecord(run.args) || run.args.async !== true) return null;
  // 后台命令启动后同一个 toolCallId 还会继续来 update：以最新的（partialResult）为准，其次是 end 的结果。
  const info = asyncInfoOf(run.partialResult) ?? asyncInfoOf(run.result);
  const text = resultTextOf(run.result);
  const id = info?.jobId ?? /Backgrounded as job (\S+)/.exec(text)?.[1] ?? null;
  if (id === null) return null;
  const command = typeof run.args.command === "string" ? run.args.command : "";
  const name = typeof run.args.name === "string" ? run.args.name : "";
  const wallTimeMs = detailsOf(run.partialResult)?.wallTimeMs;
  const status = info?.state ?? "running";
  return {
    id,
    type: "bash",
    label: firstLine(command) || name || id,
    status,
    startedAt: run.startedAt,
    durationMs: typeof wallTimeMs === "number" ? Math.round(wallTimeMs) : null,
    output: run.partialResult === undefined ? null : tail(resultTextOf(run.partialResult)) || null,
  };
}

const SPAWNED = /Spawned agent `([^`]+)` \(job `([^`]+)`\)/g;

function fromTask(run: ToolRun): Job[] {
  if (run.toolName !== "task") return [];
  const jobs: Job[] = [];
  for (const match of resultTextOf(run.result).matchAll(SPAWNED)) {
    const [, agent, id] = match;
    if (!agent || !id) continue;
    jobs.push({
      id,
      type: "task",
      label: agent,
      status: "running",
      startedAt: run.startedAt,
      durationMs: null,
      output: null,
    });
  }
  return jobs;
}

function fromWait(run: ToolRun): Job[] {
  if (run.toolName !== "wait") return [];
  // 结束时的结果比过程中的快照新；都没有 jobs 就没有可用的。
  const jobsOf = (value: unknown): unknown[] | null => {
    const jobs = detailsOf(value)?.jobs;
    return Array.isArray(jobs) ? jobs : null;
  };
  const raw = jobsOf(run.result) ?? jobsOf(run.partialResult);
  if (!raw) return [];
  const at = run.endedAt ?? run.startedAt;
  const out: Job[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    const status = toStatus(entry.status) ?? "running";
    const durationMs = typeof entry.durationMs === "number" ? entry.durationMs : null;
    out.push({
      id: entry.id,
      type: entry.type === "task" ? "task" : "bash",
      label: typeof entry.label === "string" && entry.label !== "" ? firstLine(entry.label) : entry.id,
      status,
      startedAt: durationMs === null ? at : at - durationMs,
      durationMs: isTerminal(status) ? durationMs : null,
      output: null,
    });
  }
  return out;
}

/** 从对话流工具记录和子代理泳道推出本任务这个会话里的所有后台 job，按首次出现的顺序。 */
export function deriveJobs(transcript: Transcript | null, lanes: readonly SubagentLane[]): Job[] {
  const jobs = new Map<string, Job>();
  const runs = transcript ? Object.values(transcript.tools).sort((a, b) => a.startedAt - b.startedAt) : [];
  for (const run of runs) {
    const bash = fromBash(run);
    if (bash) upsert(jobs, bash);
    for (const job of fromTask(run)) upsert(jobs, job);
  }
  // wait 快照靠后合并：它的状态和标签是 omp 自己报的；起始时间以先发现的（工具调用时间）为准。
  for (const run of runs) {
    for (const job of fromWait(run)) {
      const old = jobs.get(job.id);
      upsert(jobs, old ? { ...job, startedAt: old.startedAt } : job);
    }
  }
  const byLane = new Map(lanes.map((lane) => [lane.id, lane]));
  for (const [id, job] of jobs) {
    const lane = job.type === "task" ? byLane.get(id) : undefined;
    if (!lane) continue;
    const status = laneStatus(lane.status);
    const terminal = isTerminal(status);
    jobs.set(id, {
      ...job,
      // 泳道是实时的：它结束了就结束；它还在跑时不去推翻 wait 给的结果。
      status: terminal || !isTerminal(job.status) ? status : job.status,
      startedAt: lane.startedAt,
      durationMs:
        job.durationMs ?? (terminal ? (lane.durationMs ?? (lane.endedAt ?? lane.startedAt) - lane.startedAt) : null),
    });
  }
  // 重载后对话流里没有工具记录，但分离出去的子代理还在泳道里。
  for (const lane of lanes) {
    if (lane.detached !== true || jobs.has(lane.id)) continue;
    const status = laneStatus(lane.status);
    jobs.set(lane.id, {
      id: lane.id,
      type: "task",
      label: lane.id,
      status,
      startedAt: lane.startedAt,
      durationMs: isTerminal(status) ? (lane.durationMs ?? (lane.endedAt ?? lane.startedAt) - lane.startedAt) : null,
      output: null,
    });
  }
  return [...jobs.values()];
}

export function countJobs(jobs: readonly Job[]): JobCounts {
  let running = 0;
  let failed = 0;
  for (const job of jobs) {
    if (job.status === "running") running += 1;
    else if (job.status !== "completed") failed += 1;
  }
  return { running, done: jobs.length - running, failed, total: jobs.length };
}

/** 本次运行里有没有 wait 工具在执行：agent 正在等后台任务。 */
export function isWaitingOnJobs(transcript: Transcript | null): boolean {
  if (!transcript) return false;
  const since = transcript.runs[transcript.runs.length - 1]?.startedAt ?? 0;
  return Object.values(transcript.tools).some(
    (run) => run.toolName === "wait" && run.status === "running" && run.startedAt >= since,
  );
}

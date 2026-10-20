// 后台任务推导：回放真实录制 fixtures/rpc/bg-jobs.ndjson（一个 task 子代理 ListDir + 一个异步 bash bg_1，agent 用 wait 等它们），
// 在几个时间点上检查 deriveJobs / countJobs / isWaitingOnJobs。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { translateFrame } from "../src/main/tasks/translate.ts";
import type { RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import type { SubagentLane } from "../src/shared/subagents.ts";
import { applyTranscriptEvent, emptyTranscript } from "../src/shared/transcript.ts";
import { countJobs, deriveJobs, isWaitingOnJobs } from "../src/shared/ui/jobs.ts";

interface Line {
  kind: string;
  frame?: RpcServerFrame;
}

const lines = readFileSync(path.resolve(import.meta.dirname, "..", "fixtures", "rpc", "bg-jobs.ndjson"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line): Line => JSON.parse(line));

/** 回放前 count 行（1 起数），每帧的接收时间 = 行号 * 100ms。 */
function replay(count: number) {
  let transcript = emptyTranscript();
  lines.slice(0, count).forEach((line, index) => {
    if (line.kind !== "out" || !line.frame) return;
    for (const event of translateFrame(line.frame, 1, (index + 1) * 100))
      transcript = applyTranscriptEvent(transcript, event);
  });
  return transcript;
}

const lane = (id: string, extra: Partial<SubagentLane> = {}): SubagentLane => ({
  id,
  parentId: null,
  rev: 0,
  agent: "scout",
  description: null,
  task: null,
  assignment: null,
  detached: true,
  status: "running",
  startedAt: 29_000,
  endedAt: null,
  model: null,
  thinkingLevel: null,
  modelIsFallback: false,
  lastIntent: null,
  toolCount: 0,
  requests: 0,
  tokens: 0,
  cost: 0,
  durationMs: null,
  contextTokens: null,
  contextWindow: null,
  tools: [],
  touched: [],
  ...extra,
});

describe("deriveJobs（bg-jobs 录制）", () => {
  it("后台化之后：子代理和异步 bash 都在跑；被拒绝的那次 async bash（Service mode）不算 job", () => {
    const jobs = deriveJobs(replay(430), []);
    expect(jobs.map((job) => [job.id, job.type, job.status])).toEqual([
      ["ListDir", "task", "running"],
      ["bg_1", "bash", "running"],
    ]);
    expect(jobs[1]?.label).toContain("time.sleep(12)");
    expect(jobs[1]?.output).toBeNull();
  });

  it("wait 在执行：agent 在等 2 个，一个都还没完成", () => {
    const transcript = replay(485);
    expect(isWaitingOnJobs(transcript)).toBe(true);
    expect(countJobs(deriveJobs(transcript, []))).toEqual({ running: 2, done: 0, failed: 0, total: 2 });
  });

  it("第一次 wait 结束：以它的快照为准，ListDir 完成（带时长），bg_1 仍在跑", () => {
    const transcript = replay(496);
    expect(isWaitingOnJobs(transcript)).toBe(false);
    const jobs = deriveJobs(transcript, []);
    expect(jobs[0]).toMatchObject({ id: "ListDir", status: "completed", durationMs: 3826 });
    expect(jobs[1]).toMatchObject({ id: "bg_1", status: "running", durationMs: null });
    expect(countJobs(jobs)).toEqual({ running: 1, done: 1, failed: 0, total: 2 });
  });

  it("bash 的后续 update 带来累积输出", () => {
    const jobs = deriveJobs(replay(552), []);
    expect(jobs[1]).toMatchObject({ id: "bg_1", status: "running", output: "job-done" });
  });

  it("全部回放完：bg_1 完成，时长取 wait 的最终快照，输出留着", () => {
    const jobs = deriveJobs(replay(lines.length), []);
    expect(jobs.map((job) => [job.id, job.status])).toEqual([
      ["ListDir", "completed"],
      ["bg_1", "completed"],
    ]);
    expect(jobs[1]).toMatchObject({ durationMs: 12121 });
    expect(jobs[1]?.output).toContain("job-done");
    expect(countJobs(jobs)).toEqual({ running: 0, done: 2, failed: 0, total: 2 });
  });

  it("泳道结束了就结束：子代理被取消时 job 记为 cancelled，起始时间取泳道的", () => {
    const jobs = deriveJobs(replay(430), [lane("ListDir", { status: "aborted", endedAt: 31_000 })]);
    expect(jobs[0]).toMatchObject({ id: "ListDir", status: "cancelled", startedAt: 29_000, durationMs: 2000 });
    expect(countJobs(jobs)).toMatchObject({ running: 1, done: 1, failed: 1 });
  });

  it("没有工具记录（重载后）时，分离出去的子代理泳道也算 job；同步子代理不算", () => {
    const jobs = deriveJobs(null, [lane("Bg"), lane("Sync", { detached: false })]);
    expect(jobs.map((job) => job.id)).toEqual(["Bg"]);
  });
});

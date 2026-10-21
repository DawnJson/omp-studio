// TSP 作业推导（src/shared/tsp/jobs.ts），对着 omp 18.12.5 的真实录制：
// jobs-chart（一个后台 bash，跑完）、hub-steer（两个后台子代理）、jobs-kill（两个 sleep 和一个失败的 bash，kill 之后 /jobs 弹窗）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import {
  deriveTspJobs,
  findJobsHudSeg,
  findJobsOverlayItem,
  markJobsCancelled,
  mergeTspJobs,
  parseJobDuration,
  sameJobs,
} from "../src/shared/tsp/jobs.ts";
import type { Job } from "../src/shared/ui/jobs.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function docAt(name: string, count?: number): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture(name)).slice(0, count)) applyMessage(doc, message);
  return doc;
}

/** 逐条应用，每条后合并一次（模拟渲染进程每批消息后的 store）。 */
function replayMerged(name: string): { jobs: Job[]; doc: TspDocument } {
  const doc = createDocument();
  let jobs: Job[] = [];
  let now = 1_000_000;
  for (const { message } of tspDocMessages(loadTspFixture(name))) {
    applyMessage(doc, message);
    now += 1000;
    jobs = mergeTspJobs(jobs, deriveTspJobs(doc, now), doc, now);
  }
  return { jobs, doc };
}

describe("parseJobDuration", () => {
  it("认 omp 的时长写法", () => {
    expect(parseJobDuration("43.9s")).toBe(43_900);
    expect(parseJobDuration("305ms")).toBe(305);
    expect(parseJobDuration("1m 12s")).toBe(72_000);
    expect(parseJobDuration("")).toBeNull();
  });
});

describe("jobs-chart 录制（一个后台 bash）", () => {
  it("运行中：hud 胶囊给出 bg_1，类型 bash，命令是标题", () => {
    const jobs = deriveTspJobs(docAt("jobs-chart", 60), 5000);
    expect(jobs).toEqual([
      {
        id: "bg_1",
        type: "bash",
        label: "npx playwright test",
        status: "running",
        startedAt: 5000,
        durationMs: null,
        output: null,
      },
    ]);
  });

  it("跑完后 /jobs 弹窗给出 Done 和 omp 量的时长；hud 胶囊已经没了", () => {
    const doc = docAt("jobs-chart");
    expect(findJobsHudSeg(doc)).toBeNull();
    expect(deriveTspJobs(doc, 9000)).toEqual([
      {
        id: "bg_1",
        type: "bash",
        label: "npx playwright test",
        status: "completed",
        startedAt: 9000,
        durationMs: 43_900,
        output: null,
      },
    ]);
    expect(findJobsOverlayItem(doc, "bg_1")).toEqual({ sf: "s:1", id: "16.split/master/jobs/bg_1" });
    expect(findJobsOverlayItem(doc, "bg_9")).toBeNull();
  });

  it("逐批合并：开始时间沿用第一次看到的，最后是完成", () => {
    const { jobs } = replayMerged("jobs-chart");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "bg_1", status: "completed", durationMs: 43_900 });
    expect(jobs[0]?.startedAt).toBeLessThan(1_000_000 + 1000 * 200);
  });
});

describe("hub-steer 录制（两个后台子代理 Alpha / Beta）", () => {
  it("运行中：作业 id 是子代理名，类型 task", () => {
    const jobs = deriveTspJobs(docAt("hub-steer", 120), 1);
    expect(jobs.map((job) => [job.id, job.type, job.status])).toEqual([
      ["Alpha", "task", "running"],
      ["Beta", "task", "running"],
    ]);
    expect(findJobsHudSeg(docAt("hub-steer", 120))).not.toBeNull();
  });
  it("结束后 hud 没有作业：子代理按 agent 节点、其余记为完成；子代理自己起的 bash（bg_2）带树形前缀被去掉", () => {
    const { jobs } = replayMerged("hub-steer");
    expect(jobs.map((job) => [job.id, job.type, job.label, job.status])).toEqual([
      ["Alpha", "task", "Alpha", "completed"],
      ["Beta", "task", "Beta", "completed"],
      ["bg_2", "bash", "sleep 75", "completed"],
    ]);
  });
});

describe("jobs-kill 录制（/jobs kill bg_1、/jobs kill all 之后的 /jobs 弹窗）", () => {
  it("弹窗里三种终态：Cancelled / Cancelled / Failed", () => {
    const jobs = deriveTspJobs(docAt("jobs-kill", 88), 0);
    expect(jobs.map((job) => [job.id, job.label, job.status, job.durationMs])).toEqual([
      ["bg_1", "sleep 300", "cancelled", 7600],
      ["bg_2", "sleep 300", "cancelled", 21_800],
      ["bg_3", 'node -e "process.exit(3)"', "failed", 305],
    ]);
  });
});

describe("markJobsCancelled / sameJobs", () => {
  const running: Job = {
    id: "bg_1",
    type: "bash",
    label: "x",
    status: "running",
    startedAt: 100,
    durationMs: null,
    output: null,
  };
  const done: Job = { ...running, id: "bg_2", status: "completed", durationMs: 5 };
  it("只动运行中的；all 全部", () => {
    expect(markJobsCancelled([running, done], "bg_2", 500)).toEqual([running, done]);
    expect(markJobsCancelled([running, done], "bg_1", 500)).toEqual([
      { ...running, status: "cancelled", durationMs: 400 },
      done,
    ]);
    expect(markJobsCancelled([running, done], "all", 500)[0]?.status).toBe("cancelled");
  });
  it("内容相同才算相同", () => {
    expect(sameJobs([running], [{ ...running }])).toBe(true);
    expect(sameJobs([running], [{ ...running, status: "failed" }])).toBe(false);
    expect(sameJobs([running], [])).toBe(false);
  });
});

// TSP 作业推导（src/shared/tsp/jobs.ts），对着 omp 18.12.5 的真实录制：
// jobs-chart（一个后台 bash，跑完）、hub-steer（两个后台子代理）、jobs-kill（两个 sleep 和一个失败的 bash，kill 之后 /jobs 弹窗）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import {
  agentStatuses,
  deriveJobTiles,
  deriveTspJobs,
  findJobsHudSeg,
  findJobsOverlayItem,
  JOBS_NODES,
  markJobsCancelled,
  mergeTspJobs,
  parseJobDuration,
  sameJobs,
  type JobTile,
} from "../src/shared/tsp/jobs.ts";
import { NodeWatch } from "../src/shared/tsp/node-watch.ts";
import type { Job } from "../src/shared/ui/jobs.ts";
import { loadTspFixture, tspDocMessages, type TspRecordLine } from "./tsp-fixtures.ts";

function docAt(name: string, count?: number): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture(name)).slice(0, count)) applyMessage(doc, message);
  return doc;
}

function merge(jobs: readonly Job[], doc: TspDocument, now: number): Job[] {
  const agents = agentStatuses(doc);
  return mergeTspJobs(jobs, deriveTspJobs(doc, agents, now), agents, now);
}

/** 逐条应用，每条后合并一次；`steps` 是每条之后的作业。 */
function replayMerged(name: string | readonly TspRecordLine[]): { jobs: Job[]; doc: TspDocument; steps: Job[][] } {
  const doc = createDocument();
  let jobs: Job[] = [];
  let now = 1_000_000;
  const steps: Job[][] = [];
  for (const { message } of tspDocMessages(typeof name === "string" ? loadTspFixture(name) : name)) {
    applyMessage(doc, message);
    now += 1000;
    jobs = merge(jobs, doc, now);
    steps.push(jobs);
  }
  return { jobs, doc, steps };
}

/** 渲染进程 store 的做法：JOBS_NODES 那份 NodeWatch 的 version 变了才合并（o / x / move 整份重扫，同 tsp-store）。 */
function replayWatched(lines: readonly TspRecordLine[]): { steps: Job[][]; merges: number } {
  const doc = createDocument();
  const watch = new NodeWatch(doc, JOBS_NODES);
  let jobs: Job[] = [];
  let now = 1_000_000;
  let version = -1;
  let merges = 0;
  const steps: Job[][] = [];
  for (const { message } of tspDocMessages(lines)) {
    const { changed } = applyMessage(doc, message);
    const reset =
      message.verb === "o" ||
      message.verb === "x" ||
      (message.verb === "f" && message.body.ops.some((op) => op[0] === "move"));
    watch.update(doc, changed, reset);
    now += 1000;
    if (watch.version !== version) {
      version = watch.version;
      merges += 1;
      jobs = merge(jobs, doc, now);
    }
    steps.push(jobs);
  }
  return { steps, merges };
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
    const doc = docAt("jobs-chart", 60);
    const jobs = deriveTspJobs(doc, agentStatuses(doc), 5000);
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
    expect(deriveTspJobs(doc, agentStatuses(doc), 9000)).toEqual([
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
    expect(findJobsOverlayItem(doc, "bg_1")).toEqual({
      sf: "s:1",
      list: "16.split/master/jobs",
      item: "16.split/master/jobs/bg_1",
    });
    expect(findJobsOverlayItem(doc, "bg_9")).toBeNull();
  });

  it("逐批合并：开始时间沿用第一次看到的，最后是完成", () => {
    const { jobs } = replayMerged("jobs-chart");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: "bg_1", status: "completed", durationMs: 43_900 });
    expect(jobs[0]?.startedAt).toBeLessThan(1_000_000 + 1000 * 200);
  });

  it("hud 胶囊的悬停卡片：先是最近一行输出，omp 的作业小部件给了进度后是进度条 + 数字；跑完就没有", () => {
    const doc = createDocument();
    const seen: JobTile[] = [];
    for (const { message } of tspDocMessages(loadTspFixture("jobs-chart"))) {
      applyMessage(doc, message);
      seen.push(...deriveJobTiles(doc));
    }
    expect(seen[0]).toEqual({ id: "bg_1", title: "npx playwright test", meter: null, figure: "", notes: [] });
    expect(seen).toContainEqual({
      id: "bg_1",
      title: "npx playwright test",
      meter: null,
      figure: "",
      notes: ["Running 36 tests using 1 worker"],
    });
    const withMeter = seen.filter((tile) => tile.meter !== null);
    expect(withMeter.length).toBeGreaterThan(0);
    const last = withMeter.at(-1)!;
    expect(last.figure).toMatch(/^done \d+$/);
    expect(last.meter).toBeGreaterThan(0);
    expect(last.meter).toBeLessThanOrEqual(1);
    expect(last.notes[0]).toMatch(/^passed \d+ · failed 0$/);
    expect(deriveJobTiles(doc)).toEqual([]);
  });
});

describe("hub-steer 录制（两个后台子代理 Alpha / Beta）", () => {
  it("运行中：作业 id 是子代理名，类型 agent（有对应的 agent 节点）", () => {
    const doc = docAt("hub-steer", 120);
    const jobs = deriveTspJobs(doc, agentStatuses(doc), 1);
    expect(jobs.map((job) => [job.id, job.type, job.status])).toEqual([
      ["Alpha", "agent", "running"],
      ["Beta", "agent", "running"],
    ]);
    expect(findJobsHudSeg(doc)).not.toBeNull();
  });
  it("结束后 hud 没有作业：子代理按 agent 节点、其余记为完成；子代理自己起的 bash（bg_2）带树形前缀被去掉", () => {
    const { jobs } = replayMerged("hub-steer");
    expect(jobs.map((job) => [job.id, job.type, job.label, job.status])).toEqual([
      ["Alpha", "agent", "Alpha", "completed"],
      ["Beta", "agent", "Beta", "completed"],
      ["bg_2", "bash", "sleep 75", "completed"],
    ]);
  });
});

describe("jobs-kill 录制（/jobs kill bg_1、/jobs kill all 之后的 /jobs 弹窗）", () => {
  it("弹窗里三种终态：Cancelled / Cancelled / Failed", () => {
    const doc = docAt("jobs-kill", 88);
    const jobs = deriveTspJobs(doc, agentStatuses(doc), 0);
    expect(jobs.map((job) => [job.id, job.label, job.status, job.durationMs])).toEqual([
      ["bg_1", "sleep 300", "cancelled", 7600],
      ["bg_2", "sleep 300", "cancelled", 21_800],
      ["bg_3", 'node -e "process.exit(3)"', "failed", 305],
    ]);
  });
});

describe("只在作业相关节点（JOBS_NODES）变了时合并：tsp-jobs-store 的做法", () => {
  // jobs-bash-18126：弹窗开着时列表项的时长在走；jobs-kill：kill 之后弹窗列表项变成 Cancelled / Failed；
  // hub-steer：子代理作业的结束靠 agent 节点；jobs-chart：bash 跑完 hud 胶囊消失。
  // 这几份录制本来就是录作业的（hud 胶囊每秒换悬停卡片、agent 节点一直在更新），跳过的比例远低于普通对话的流式输出。
  it.each(["jobs-bash-18126", "jobs-kill", "hub-steer", "jobs-chart"])(
    "%s：每条消息之后的作业和每条都合并一样，但跳过了无关的消息",
    (name) => {
      const every = replayMerged(name);
      const watched = replayWatched(loadTspFixture(name));
      expect(watched.steps).toEqual(every.steps);
      expect(watched.merges).toBeLessThan(every.steps.length);
    },
  );

  it("弹窗开着时只有列表项（master → list → item 的孙子）变成 Done、hud 胶囊没动：作业也跟着结束", () => {
    const lines = loadTspFixture("jobs-bash-18126");
    const open = lines.findIndex((line) => JSON.stringify(line.body).includes('["set","u.split/master/jobs/bg_1"'));
    const done: TspRecordLine = {
      t: lines[open]!.t + 1,
      dir: "out",
      verb: "f",
      body: {
        sf: "s:1",
        s: 33,
        ops: [
          [
            "set",
            "u.split/master/jobs/bg_1",
            { title: "sleep 60\nDone · bash · bg_1", tone: "success", value: [{ t: "60.0s", s: "mono" }] },
          ],
        ],
      },
    };
    const replay = [...lines.slice(0, open + 1), done];
    const last = replayWatched(replay).steps.at(-1);
    expect(last).toEqual(replayMerged(replay).steps.at(-1));
    expect(last?.[0]).toMatchObject({ id: "bg_1", status: "completed", durationMs: 60_000 });
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

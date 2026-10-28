// 药丸右半段的作业计数（src/shared/tsp/jobs.ts 的 runningJobs）：除子代理外所有运行中的作业，类型照 omp 的叫法。
// 真实录制：hub-steer（omp 18.12.5：两个后台子代理，hud 作业胶囊里也列着它们）、jobs-kill（18.12.5：三个 bash）、
// jobs-bash-18126（18.12.6，2026-10-23：一个 `sleep 60` 后台 bash，`/jobs` 弹窗开着）。
// 没有录到 eval 作业（要模型用 eval 工具起异步单元）：eval 类型的那一条是把真实 18.12.6 弹窗帧里的 `bash` 换成 `eval`，格式来自 omp 源码 `jobs-panel.ts`。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import {
  agentStatuses,
  deriveTspJobs,
  findJobsOverlayItem,
  mergeTspJobs,
  runningJobs,
} from "../src/shared/tsp/jobs.ts";
import type { Job } from "../src/shared/ui/jobs.ts";
import { loadTspFixture, tspDocMessages, type TspRecordLine } from "./tsp-fixtures.ts";

function docAt(lines: readonly TspRecordLine[], count?: number): TspDocument {
  const doc = createDocument();
  for (const { message } of tspDocMessages(lines).slice(0, count)) applyMessage(doc, message);
  return doc;
}

describe("runningJobs：子代理不算", () => {
  it("hub-steer：hud 胶囊里列着 Alpha / Beta，但它们是子代理，作业数是 0", () => {
    const doc = docAt(loadTspFixture("hub-steer"), 120);
    const jobs = deriveTspJobs(doc, agentStatuses(doc), 1);
    expect(jobs.map((job) => [job.id, job.type])).toEqual([
      ["Alpha", "agent"],
      ["Beta", "agent"],
    ]);
    expect(runningJobs(jobs)).toEqual([]);
  });

  it("hub-steer：子代理自己起的 bash（bg_2）算作业，子代理不算", () => {
    const lines = loadTspFixture("hub-steer");
    const doc = createDocument();
    let jobs: Job[] = [];
    let now = 1000;
    const counts = new Set<string>();
    for (const { message } of tspDocMessages(lines)) {
      applyMessage(doc, message);
      now += 1000;
      const agents = agentStatuses(doc);
      jobs = mergeTspJobs(jobs, deriveTspJobs(doc, agents, now), agents, now);
      counts.add(
        runningJobs(jobs)
          .map((job) => job.id)
          .join(","),
      );
    }
    expect(counts.has("Alpha")).toBe(false);
    expect(counts.has("Beta")).toBe(false);
    expect(counts.has("bg_2")).toBe(true);
  });

  it("jobs-kill：三个 bash 同时运行时作业数是 3、类型 bash", () => {
    const lines = loadTspFixture("jobs-kill");
    const doc = createDocument();
    let jobs: Job[] = [];
    let now = 1000;
    let most: Job[] = [];
    for (const { message } of tspDocMessages(lines)) {
      applyMessage(doc, message);
      now += 1000;
      const agents = agentStatuses(doc);
      jobs = mergeTspJobs(jobs, deriveTspJobs(doc, agents, now), agents, now);
      const running = runningJobs(jobs);
      if (running.length > most.length) most = running;
    }
    expect(most.map((job) => [job.id, job.type])).toEqual([
      ["bg_1", "bash"],
      ["bg_2", "bash"],
      ["bg_3", "bash"],
    ]);
  });
});

describe("作业类型（18.12.6 的 /jobs 弹窗，真实帧）", () => {
  const lines = loadTspFixture("jobs-bash-18126");
  /** 弹窗开着的那一刻（录制末尾 Esc 把它关了）。 */
  function overlayOpen(from: readonly TspRecordLine[]): TspDocument {
    const doc = createDocument();
    let open: TspDocument | null = null;
    for (const { message } of tspDocMessages(from)) {
      applyMessage(doc, message);
      if (findJobsOverlayItem(doc, "bg_1") !== null) open = structuredClone(doc);
    }
    expect(open).not.toBeNull();
    return open as TspDocument;
  }

  it("hud 胶囊给出运行中的 bg_1，弹窗里是 Running · bash · bg_1，时长 37.9s 倒推出开始时间", () => {
    const doc = overlayOpen(lines);
    const [job] = deriveTspJobs(doc, agentStatuses(doc), 100_000);
    expect(job).toMatchObject({ id: "bg_1", type: "bash", label: "sleep 60", status: "running", durationMs: null });
    expect(job?.startedAt).toBeLessThan(100_000);
  });

  it("弹窗里类型写 eval 的作业是 eval、也算作业", () => {
    const swapped = lines.map((line) => ({
      ...line,
      body: JSON.parse(
        JSON.stringify(line.body).replaceAll("Running · bash · bg_1", "Running · eval · bg_1"),
      ) as unknown,
    }));
    const doc = overlayOpen(swapped);
    const jobs = deriveTspJobs(doc, agentStatuses(doc), 100_000);
    expect(jobs.map((job) => [job.id, job.type])).toEqual([["bg_1", "eval"]]);
    expect(runningJobs(jobs)).toHaveLength(1);
  });

  it("弹窗开过之后 hud 的猜测（bg_N 一律当 bash）不覆盖已知的 eval", () => {
    const evalJob: Job = {
      id: "bg_1",
      type: "eval",
      label: "x",
      status: "running",
      startedAt: 100,
      durationMs: null,
      output: null,
    };
    const hudGuess: Job = { ...evalJob, type: "bash" };
    const merged = mergeTspJobs([evalJob], [hudGuess], new Map(), 500);
    expect(merged[0]?.type).toBe("eval");
  });
});

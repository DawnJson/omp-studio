import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import { countActiveAgents, listAgents } from "../src/shared/tsp/agent-hub.ts";
import { deriveTaskStatus } from "../src/shared/tsp/task-status.ts";
import { HIDDEN_HUD_ROLES, deriveWorkingLabel } from "../src/shared/tsp/working.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 每份录制逐条消息重放，按顺序记下每一步的活动文字（相邻重复合并）和任务状态。 */
function labels(name: string) {
  const doc = createDocument();
  const seen: (string | null)[] = [];
  let working = 0;
  let workingWithoutLabel = 0;
  for (const { message } of tspDocMessages(loadTspFixture(name))) {
    applyMessage(doc, message);
    const label = deriveWorkingLabel(doc);
    if (seen[seen.length - 1] !== label) seen.push(label);
    if (deriveTaskStatus(doc).working) {
      working += 1;
      if (label === null) workingWithoutLabel += 1;
    }
  }
  return { seen, working, workingWithoutLabel };
}

describe("deriveWorkingLabel：omp 18.12.5 的运行状态行文字", () => {
  it("task：回合里依次是 omp 写的活动（Initializing plan → Locating tests …），回合结束没有文字", () => {
    const { seen } = labels("task");
    expect(seen[0]).toBeNull();
    expect(seen).toContain("Initializing plan");
    expect(seen).toContain("Locating tests");
    expect(seen.indexOf("Initializing plan")).toBeLessThan(seen.indexOf("Locating tests"));
    expect(seen[seen.length - 1]).toBeNull();
  });

  it("hub-steer / jobs-kill / goal-flow：等作业、启动后台作业、默认的 Working…", () => {
    expect(labels("hub-steer").seen).toContain("Waiting for sleep job to finish");
    expect(labels("hub-steer").seen).toContain("Working…");
    expect(labels("jobs-kill").seen).toContain("Starting background node exit job 3");
    expect(labels("goal-flow").seen).toContain("Waiting for sleep 20 to finish");
  });

  it("没有 dock 的文档没有文字", () => {
    expect(deriveWorkingLabel(createDocument())).toBeNull();
  });

  it('task：在跑的帧里绝大多数都有文字（没有的那几帧界面写"运行中"）', () => {
    const { working, workingWithoutLabel } = labels("task");
    expect(working).toBeGreaterThan(100);
    expect(workingWithoutLabel / working).toBeLessThan(0.2);
  });
});

describe("HIDDEN_HUD_ROLES", () => {
  it("只含 omp 的 hud 容器：药丸行和运行状态行", () => {
    expect([...HIDDEN_HUD_ROLES].sort()).toEqual(["omp.hud", "omp.hud.activity"]);
  });
});

describe("countActiveAgents：药丸左半段的子代理数", () => {
  it("hub-steer：两个后台子代理在跑时是 2，同名的 hud 和 task 卡片只算一个，全结束后回到 0；从不超过名字数", () => {
    const doc = createDocument();
    const counts: number[] = [];
    let maxNames = 0;
    for (const { message } of tspDocMessages(loadTspFixture("hub-steer"))) {
      applyMessage(doc, message);
      counts.push(countActiveAgents(doc));
      maxNames = Math.max(maxNames, listAgents(doc).length);
    }
    expect(counts[0]).toBe(0);
    expect(Math.max(...counts)).toBe(2);
    expect(maxNames).toBe(2);
  });

  it("task：并行派的两个子代理最多同时 2 个，回合结束时 0", () => {
    const doc = createDocument();
    const counts: number[] = [];
    for (const { message } of tspDocMessages(loadTspFixture("task"))) {
      applyMessage(doc, message);
      counts.push(countActiveAgents(doc));
    }
    expect(Math.max(...counts)).toBe(2);
    expect(counts[counts.length - 1]).toBe(0);
  });
});

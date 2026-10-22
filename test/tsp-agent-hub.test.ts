// 子代理面板的纯函数（src/shared/tsp/agent-hub.ts），逐帧重放 omp 18.12.5 的两份真实录制：
// hub-steer.jsonl（NativeUiPlan：两个后台子代理，打开 Hub → activate → 聚焦 → send）和 hub-kill.jsonl（S1Agents：select → kill → revive）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import {
  AGENT_NAME_PATTERN,
  HUB_ACTION_KILL,
  HUB_ACTION_REVIVE,
  countActiveAgents,
  countEchoNodes,
  findAgentHub,
  findFocus,
  findHubOpener,
  hubActionState,
  hubItemKilled,
  isAgentName,
  isHubOpenAction,
  listAgents,
} from "../src/shared/tsp/agent-hub.ts";
import { findMessageTarget } from "../src/shared/tsp/gate.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

/** 逐条应用并在每一步调用 `probe`（文档原地改，所以每步只返回探针的结果）。 */
function replay<T>(name: string, probe: (doc: TspDocument) => T): { t: number; value: T }[] {
  const doc = createDocument();
  return tspDocMessages(loadTspFixture(name)).map(({ t, message }) => {
    applyMessage(doc, message);
    return { t, value: probe(doc) };
  });
}

const userAt = (name: string, predicate: (event: Record<string, unknown>) => boolean): number =>
  recordedUserEvents(loadTspFixture(name)).find((entry) => predicate(entry.event))!.t;

const STEER_TEXT = "Also say PINEAPPLE in your final reply.";

describe("hub-steer.jsonl（omp 18.12.5）", () => {
  const opened = userAt("hub-steer", (event) => event["act"] === "agents.open");
  const activated = userAt("hub-steer", (event) => event["ev"] === "activate");
  const sent = userAt("hub-steer", (event) => event["ev"] === "send" && event["text"] === STEER_TEXT);
  const steps = replay("hub-steer", (doc) => ({
    agents: listAgents(doc).map((agent) => `${agent.name}:${agent.status}`),
    hub: findAgentHub(doc),
    focus: findFocus(doc),
    opener: findHubOpener(doc),
    echo: countEchoNodes(doc),
    target: findMessageTarget(doc),
  }));

  it("列表：两个后台子代理 Alpha / Beta，running 变成 done，带统计和 background 徽章", () => {
    const seen = new Set(steps.flatMap((step) => step.value.agents));
    expect(seen.has("Alpha:running")).toBe(true);
    expect(seen.has("Beta:running")).toBe(true);
    expect(steps.at(-1)!.value.agents.toSorted()).toEqual(["Alpha:done", "Beta:done"]);
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("hub-steer"))) applyMessage(doc, message);
    const beta = listAgents(doc).find((agent) => agent.name === "Beta")!;
    expect(beta).toMatchObject({ agent: "task", background: true, status: "done" });
    expect(beta.task).toContain("sleep 75");
    expect(beta.stats.tools).toBe(2);
    expect(beta.stats.cost).toBeGreaterThan(0);
    expect(beta.stats.took).toBeGreaterThan(0);
  });

  it("运行中的子代理带当前工具（hud 与 task 卡片各一份，取更活的）", () => {
    const doc = createDocument();
    let tool: { name: string } | null = null;
    for (const { message } of tspDocMessages(loadTspFixture("hub-steer"))) {
      applyMessage(doc, message);
      const running = listAgents(doc).find((agent) => agent.status === "running" && agent.tool !== null);
      if (running && tool === null) tool = running.tool;
    }
    expect(tool).toMatchObject({ name: "bash" });
  });

  it("agents.open 之前 hud 的 👥 胶囊在；Hub 开着时有两项、停在 agents 页，kill 可用、revive 被 omp 禁用", () => {
    expect(isHubOpenAction("agents.open")).toBe(true);
    expect(isHubOpenAction("copy")).toBe(false);
    const before = steps.findLast((step) => step.t < opened)!;
    expect(before.value.opener).toMatchObject({ sf: "s:1", id: "3.running/agents" });
    expect(before.value.hub).toBeNull();
    const hub = steps.find((step) => step.t > opened + 10 && step.t < activated && step.value.hub !== null)!.value.hub!;
    expect(hub.tab).toBe("agents");
    expect(hub.items.map((item) => item.id).toSorted()).toEqual(["Alpha", "Beta"]);
    expect(hubActionState(hub, HUB_ACTION_KILL)).toEqual({ state: "ready" });
    expect(hubActionState(hub, HUB_ACTION_REVIVE)).toEqual({
      state: "disabled",
      reason: "Only parked or killed agents can be revived",
    });
    expect(hubActionState(hub, "nope")).toEqual({ state: "missing" });
  });

  it("activate 之后 Hub 关闭、进入聚焦模式：聚焦行带名字和 focus:Main，输入框仍是发送目标；之前没有聚焦行", () => {
    const after = steps.findLast((step) => step.t < sent)!;
    expect(after.value.hub).toBeNull();
    expect(after.value.focus).toEqual({ sf: "s:1", name: "Beta", exit: { id: "j.focus/exit", act: "focus:Main" } });
    expect(after.value.target).toMatchObject({ kind: "ready", sf: "s:1", id: "j.line/input" });
    expect(steps.findLast((step) => step.t < activated)!.value.focus).toBeNull();
  });

  it("send 之后 omp 回显消息（回显节点个数增加）；之后聚焦行消失", () => {
    const echoBefore = steps.findLast((step) => step.t < sent)!.value.echo;
    expect(steps.some((step) => step.t > sent && step.value.echo > echoBefore)).toBe(true);
    const lastFocused = steps.findLastIndex((step) => step.value.focus !== null);
    expect(lastFocused).toBeGreaterThan(0);
    expect(lastFocused).toBeLessThan(steps.length - 1);
    expect(steps[lastFocused + 1]!.value.focus).toBeNull();
  });

  it("主进程要发的三个事件和录制逐字相同（action agents.open → activate → send）", () => {
    const opener = steps.findLast((step) => step.t < opened)!.value.opener!;
    const hub = steps.find((step) => step.t > opened + 10 && step.value.hub !== null)!.value.hub!;
    const target = steps.findLast((step) => step.t < sent)!.value.target;
    if (target.kind !== "ready") throw new Error("composer not ready");
    const driven = [
      { ev: "action", sf: opener.sf, id: opener.id, act: "agents.open" },
      { ev: "activate", sf: hub.sf, id: hub.id, item: "Beta" },
      { ev: "send", sf: target.sf, id: target.id, text: STEER_TEXT },
    ];
    const recorded = recordedUserEvents(loadTspFixture("hub-steer"))
      .map((entry) => entry.event)
      .filter((event) => event["act"] === "agents.open" || event["ev"] === "activate" || event["text"] === STEER_TEXT);
    expect(driven).toEqual(recorded);
  });
});

describe("hub-kill.jsonl（omp 18.12.5，S1Agents 真实录制）：select → kill → revive，没有确认框", () => {
  const events = recordedUserEvents(loadTspFixture("hub-kill")).map((entry) => entry.event);
  const select = userAt("hub-kill", (event) => event["ev"] === "select");
  const kill = userAt("hub-kill", (event) => event["act"] === "kill");
  const revive = userAt("hub-kill", (event) => event["act"] === "revive");
  const steps = replay("hub-kill", (doc) => ({
    hub: findAgentHub(doc),
    agents: listAgents(doc).map((agent) => `${agent.name}:${agent.status}`),
    dialog: [...doc.live].some((sf) =>
      [...(doc.surfaces.get(sf)?.nodes.values() ?? [])].some((node) => node.k === "confirm" || node.k === "dialog"),
    ),
  }));

  it("事件形状：select（带 item）、kill、revive 都发给 picker 节点", () => {
    const hubEvents = events.filter((event) => event["id"] !== "3.running/agents" && event["ev"] !== "send");
    expect(hubEvents.map((event) => [event["ev"], event["act"] ?? event["item"]])).toEqual([
      ["select", "Beta"],
      ["action", "kill"],
      ["select", "Beta"],
      ["action", "revive"],
    ]);
    const hub = steps.find((step) => step.value.hub !== null)!.value.hub!;
    expect(hubEvents.every((event) => event["id"] === hub.id && event["sf"] === hub.sf)).toBe(true);
  });

  it("select 把 selected 换成那一项；kill 之前 kill 可用、revive 被禁用", () => {
    const beforeSelect = steps.findLast((step) => step.t < select && step.value.hub !== null)!.value.hub!;
    expect(beforeSelect.selected).not.toBe("Beta");
    const beforeKill = steps.findLast((step) => step.t < kill)!.value.hub!;
    expect(beforeKill.selected).toBe("Beta");
    expect(hubActionState(beforeKill, HUB_ACTION_KILL)).toEqual({ state: "ready" });
    expect(hubActionState(beforeKill, HUB_ACTION_REVIVE).state).toBe("disabled");
    expect(hubItemKilled(beforeKill, "Beta")).toBe(false);
  });

  it("kill 之后：该项变 error、revive 解禁、agent 节点 aborted、其它子代理照跑、没有 confirm / dialog", () => {
    const killed = steps.find(
      (step) => step.t > kill && step.value.hub !== null && hubItemKilled(step.value.hub, "Beta"),
    )!;
    expect(hubActionState(killed.value.hub!, HUB_ACTION_REVIVE)).toEqual({ state: "ready" });
    expect(steps.some((step) => step.t > kill - 1 && step.value.dialog)).toBe(false);
    const aborted = steps.find((step) => step.t > kill && step.value.agents.includes("Beta:aborted"))!;
    expect(aborted.value.agents).toContain("Alpha:running");
  });

  it("revive 之后：该项不再是 error（复活后空闲，dot=success），revive 又被禁用", () => {
    const revived = steps.findLast((step) => step.value.hub !== null && step.t > revive)!.value.hub!;
    expect(hubItemKilled(revived, "Beta")).toBe(false);
    expect(revived.items.find((item) => item.id === "Beta")?.dot).toBe("success");
    expect(hubActionState(revived, HUB_ACTION_REVIVE).state).toBe("disabled");
  });

  it("Esc 键之后 Hub 关闭（录制末尾没有 Hub）", () => {
    expect(steps.at(-1)!.value.hub).toBeNull();
  });
});

describe("子代理名校验", () => {
  it("接受 omp 的名字，拒绝路径和空串", () => {
    for (const ok of ["Alpha", "Outer-3.Inner", "a_b", "x1"]) expect(isAgentName(ok)).toBe(true);
    for (const bad of ["", "..", "a/b", "a\\b", "../x", ".hidden", "a..b", " a", "x".repeat(200), 5, null])
      expect(isAgentName(bad)).toBe(false);
    expect(AGENT_NAME_PATTERN.test("Alpha")).toBe(true);
  });
});

describe("--resume 之后的旧子代理（omp 18.12.6 实测形状）", () => {
  const add = (id: string, parent: string, k: string, p: Record<string, unknown> = {}) =>
    ["add", id, parent, null, { id, k, p }] as const;
  function resumed(cardStatus: string): TspDocument {
    const doc = createDocument();
    applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline", title: "omp", role: "omp.session" } });
    applyMessage(doc, {
      verb: "f",
      body: {
        sf: "s:1",
        s: 1,
        ops: [
          add("main", "s:1", "col"),
          add("v", "main", "tool", { role: "omp.tool.task", status: cardStatus }),
          add("v.Alpha", "v", "agent", {
            name: "Alpha",
            task: "# Target No files. # Change 1. Run `echo hi`.",
            status: "pending",
            stats: { took: 0 },
          }),
          add("v.Alpha/0", "v.Alpha", "md", {
            role: "omp.task.assignment",
            text: "# Target\nNo files.\n\n# Change\n1. Run `echo hi`.",
          }),
        ],
      },
    } as never);
    return doc;
  }

  it("卡片已结束、子代理还写着 pending：当作挂起，不算运行中（药丸不亮），可以恢复", () => {
    const doc = resumed("done");
    expect(listAgents(doc).map((agent) => agent.status)).toEqual(["parked"]);
    expect(countActiveAgents(doc)).toBe(0);
  });

  it("卡片还在跑时 pending 照旧是等待中", () => {
    const doc = resumed("running");
    expect(listAgents(doc).map((agent) => agent.status)).toEqual(["pending"]);
    expect(countActiveAgents(doc)).toBe(1);
  });

  it("任务说明原文取 omp.task.assignment 子节点（带换行），不是压成一行的 task", () => {
    expect(listAgents(resumed("done"))[0]!.assignment).toBe("# Target\nNo files.\n\n# Change\n1. Run `echo hi`.");
  });
});

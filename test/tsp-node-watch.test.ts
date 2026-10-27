// NodeWatch（shared/tsp/node-watch.ts）：推导只在它声明的节点变了时重算。逐份录制、按几种批次大小重放，
// 每批之后：version 没变的推导，整篇重算的结果必须和缓存的一样（否则界面会停在旧值上）。
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_NODES, countActiveAgents, listAgents } from "../src/shared/tsp/agent-hub.ts";
import { applyMessage, createDocument, type TspDocMessage, type TspDocument } from "../src/shared/tsp/document.ts";
import { deriveJobTiles, findJobsHudSeg, JOB_HUD_NODES } from "../src/shared/tsp/jobs.ts";
import { NodeWatch, type NodeDeps } from "../src/shared/tsp/node-watch.ts";
import { USER_MESSAGE_NODES, userMessages } from "../src/shared/tsp/user-messages.ts";
import { buildRoleIndex, ROLE_INDEX_NODES, type RoleIndex } from "../src/renderer/src/features/tsp/role-index.ts";
import { loadTspFixture, tspDocMessages, tspFixtureDir } from "./tsp-fixtures.ts";

const fixtures = readdirSync(tspFixtureDir)
  .filter((name) => name.endsWith(".jsonl"))
  .map((name) => name.slice(0, -".jsonl".length));

const DERIVES: { name: string; deps: NodeDeps; derive: (doc: TspDocument) => unknown }[] = [
  { name: "userMessages", deps: USER_MESSAGE_NODES, derive: userMessages },
  { name: "listAgents", deps: AGENT_NODES, derive: listAgents },
  { name: "countActiveAgents", deps: AGENT_NODES, derive: countActiveAgents },
  { name: "findJobsHudSeg", deps: JOB_HUD_NODES, derive: findJobsHudSeg },
  { name: "deriveJobTiles", deps: JOB_HUD_NODES, derive: deriveJobTiles },
];

/** 按 tsp-store 的 applyMessages 的方式应用一批：合并 changed，有 o / x / move 就让 NodeWatch 重扫。 */
function applyBatch(doc: TspDocument, batch: readonly TspDocMessage[]) {
  const changed = new Map<string, Set<string>>();
  let reset = false;
  for (const message of batch) {
    if (message.verb === "o" || message.verb === "x") reset = true;
    if (message.verb === "f" && message.body.ops.some((op) => op[0] === "move")) reset = true;
    for (const [sf, ids] of applyMessage(doc, message).changed) {
      const set = changed.get(sf) ?? new Set();
      for (const id of ids) set.add(id);
      changed.set(sf, set);
    }
  }
  return { changed, reset };
}

function replay(name: string, size: number): { skipped: number; total: number } {
  const messages = tspDocMessages(loadTspFixture(name)).map((entry) => entry.message);
  const doc = createDocument();
  const watches = new Map<NodeDeps, NodeWatch>();
  for (const { deps } of [...DERIVES, { deps: ROLE_INDEX_NODES }]) watches.set(deps, new NodeWatch(doc, deps));
  const cached = DERIVES.map(({ derive, deps }) => ({ version: watches.get(deps)!.version, value: derive(doc) }));
  const roleCache = new Map<string, RoleIndex>();
  let skipped = 0;
  let total = 0;
  for (let at = 0; at < messages.length; at += size) {
    const { changed, reset } = applyBatch(doc, messages.slice(at, at + size));
    const dirtyRoles = new Set<string>();
    for (const [deps, watch] of watches) {
      const dirty = watch.update(doc, changed, reset);
      if (deps === ROLE_INDEX_NODES) for (const sf of dirty) dirtyRoles.add(sf);
    }
    DERIVES.forEach(({ name: label, deps, derive }, index) => {
      const entry = cached[index]!;
      const value = derive(doc);
      total += 1;
      const version = watches.get(deps)!.version;
      if (version === entry.version) {
        skipped += 1;
        expect(value, `${name} 第 ${at} 条起的一批：${label}`).toEqual(entry.value);
      }
      cached[index] = { version, value };
    });
    for (const surface of doc.surfaces.values()) {
      const index = buildRoleIndex(surface.nodes);
      const previous = roleCache.get(surface.id);
      total += 1;
      if (previous && !dirtyRoles.has(surface.id)) {
        skipped += 1;
        expect(index, `${name} 第 ${at} 条起的一批：role 索引 ${surface.id}`).toEqual(previous);
      }
      roleCache.set(surface.id, index);
    }
  }
  return { skipped, total };
}

describe("NodeWatch：没标脏的推导和整篇重算一致", () => {
  for (const size of [1, 5, 32]) {
    it(`每批 ${size} 条消息，全部录制`, () => {
      let skipped = 0;
      let total = 0;
      for (const name of fixtures) {
        const result = replay(name, size);
        skipped += result.skipped;
        total += result.total;
      }
      // 不是空测：大部分批次确实跳过了重算。
      expect(skipped / total).toBeGreaterThan(0.5);
    });
  }
});

// 录制里没有单独改子节点 / 父节点的批次：用造的文档钉住 children / parent 和 move 重扫。
describe("NodeWatch：子节点、父节点、move", () => {
  const frame = (ops: unknown[]): TspDocMessage => ({ verb: "f", body: { sf: "s", s: 1, ops } }) as TspDocMessage;
  const setup = (deps: NodeDeps) => {
    const doc = createDocument();
    for (const message of [
      { verb: "o", body: { id: "s", mode: "inline" } } as TspDocMessage,
      frame([
        ["add", "main", "s", null, { id: "main", k: "col" }],
        [
          "add",
          "u",
          "main",
          null,
          { id: "u", k: "card", p: { role: "omp.user" }, c: [{ id: "u.t", k: "md", p: { text: "hi" } }] },
        ],
        [
          "add",
          "card",
          "main",
          null,
          {
            id: "card",
            k: "card",
            p: { status: "running" },
            c: [{ id: "a", k: "agent", p: { name: "A", status: "running" } }],
          },
        ],
        [
          "add",
          "box",
          "main",
          null,
          {
            id: "box",
            k: "col",
            c: [{ id: "u2", k: "card", p: { role: "omp.user" }, c: [{ id: "u2.t", k: "md", p: { text: "second" } }] }],
          },
        ],
        ["add", "other", "main", null, { id: "other", k: "text", p: { text: "x" } }],
      ]),
    ])
      applyMessage(doc, message);
    const watch = new NodeWatch(doc, deps);
    const step = (message: TspDocMessage): boolean => {
      const before = watch.version;
      const { changed, reset } = applyBatch(doc, [message]);
      watch.update(doc, changed, reset);
      return watch.version !== before;
    };
    return { doc, step };
  };

  it("无关节点的文字不标脏，用户消息正文（子节点）标脏", () => {
    const { doc, step } = setup(USER_MESSAGE_NODES);
    expect(step(frame([["text", "other", "append", "y"]]))).toBe(false);
    expect(step(frame([["text", "u.t", "replace", "hello"]]))).toBe(true);
    expect(userMessages(doc).map((m) => m.text)).toEqual(["hello", "second"]);
  });

  it("子代理所在卡片（父节点）的状态变了标脏", () => {
    const { doc, step } = setup(AGENT_NODES);
    expect(step(frame([["set", "card", { status: "done" }]]))).toBe(true);
    expect(listAgents(doc)[0]?.status).toBe("parked");
  });

  it("move 改了祖先的位置（用户消息的顺序）就重扫标脏", () => {
    const { doc, step } = setup(USER_MESSAGE_NODES);
    expect(step(frame([["move", "box", "main", "u"]]))).toBe(true);
    expect(userMessages(doc).map((m) => m.text)).toEqual(["second", "hi"]);
  });
});

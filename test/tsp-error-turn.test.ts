import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, type DocNode } from "../src/shared/tsp/document.ts";
import { ERROR_CARD_ROLE, isOmpErrorDuplicate, trailingErrorCardId } from "../src/shared/tsp/error-turn.ts";
import { deriveTaskStatus } from "../src/shared/tsp/task-status.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/**
 * fixtures/tsp/error-turn.jsonl：omp 18.12.5，无效 API key（401）下发一条消息：用户消息、`omp.assistant` 里的 `omp.error` 卡
 * （头 "Request failed" + 401 徽章、正文、copy-error / switch-model 两个动作）。
 */
function replay() {
  const doc = createDocument();
  const steps = tspDocMessages(loadTspFixture("error-turn")).map(({ message }) => {
    applyMessage(doc, message);
    const nodes = doc.surfaces.get("s:1")?.nodes;
    return { trailing: nodes === undefined ? null : trailingErrorCardId(nodes), status: deriveTaskStatus(doc).status };
  });
  return { doc, steps };
}

describe("trailingErrorCardId：omp 错误卡的实测录制", () => {
  it("错误卡出现的那一帧起就是收尾的错误卡，卡片结构和录制一致", () => {
    const { doc, steps } = replay();
    const nodes = doc.surfaces.get("s:1")!.nodes;
    expect(steps.at(-1)!.trailing).toBe("q.0");
    // 错误卡出现之前没有。
    expect(steps[0]!.trailing).toBeNull();
    const card = nodes.get("q.0")!;
    expect(card.k).toBe("card");
    expect(card.p["role"]).toBe(ERROR_CARD_ROLE);
    const roles = [...nodes.values()].map((node) => node.p["role"]).filter((role) => typeof role === "string");
    expect(roles).toContain("omp.error.code");
    expect(roles).toContain("omp.error.message");
    expect(roles).toContain("omp.error.action");
    // 一轮结束后任务是空闲的（重试按钮只在空闲时显示）。
    expect(steps.at(-1)!.status).toBe("idle");
  });
});

// 合成文档：只验证"之后又有了新内容就不再是收尾的错误卡"的规则。
function node(id: string, role: string | null, children: string[] = []): DocNode {
  return { id, k: "col", p: role === null ? {} : { role }, c: children, parent: null };
}
const table = (...nodes: DocNode[]) => new Map(nodes.map((entry) => [entry.id, entry]));

describe("trailingErrorCardId：规则", () => {
  const error = (id: string) => node(id, ERROR_CARD_ROLE);

  it("没有错误卡 / 空文档：null", () => {
    expect(trailingErrorCardId(table())).toBeNull();
    expect(trailingErrorCardId(table(node("main", null, ["a"]), node("a", "omp.assistant")))).toBeNull();
  });

  it("之后又来了新的用户消息：不再是收尾的错误卡", () => {
    const nodes = table(
      node("main", null, ["a", "u"]),
      node("a", "omp.assistant", ["a.0"]),
      error("a.0"),
      node("u", "omp.user"),
    );
    expect(trailingErrorCardId(nodes)).toBeNull();
  });

  it("之后有不带错误的助手消息（重试成功了）：不再是收尾的错误卡", () => {
    const nodes = table(
      node("main", null, ["a", "b"]),
      node("a", "omp.assistant", ["a.0"]),
      error("a.0"),
      node("b", "omp.assistant", ["b.0"]),
      node("b.0", "omp.text"),
    );
    expect(trailingErrorCardId(nodes)).toBeNull();
  });

  it("重试又失败（实测）：新助手容器里的新错误卡才是收尾的，旧的不是", () => {
    const nodes = table(
      node("main", null, ["q", "u"]),
      node("q", "omp.assistant", ["q.0"]),
      error("q.0"),
      node("u", "omp.assistant", ["u.0"]),
      error("u.0"),
    );
    expect(trailingErrorCardId(nodes)).toBe("u.0");
  });

  it("同一条助手消息里错误卡后面还有别的节点（动作行等）：仍是收尾的", () => {
    const nodes = table(
      node("main", null, ["q"]),
      node("q", "omp.assistant", ["q.0", "q.1"]),
      error("q.0"),
      node("q.1", null),
    );
    expect(trailingErrorCardId(nodes)).toBe("q.0");
  });
});

describe("isOmpErrorDuplicate：不画的 omp 错误节点（实测录制）", () => {
  it("只有错误横幅和错误卡里的 retry 动作；复制错误、换模型、错误卡本身照常画", () => {
    const { doc } = replay();
    const nodes = doc.surfaces.get("s:1")!.nodes;
    const hidden = [...nodes.values()].filter((entry) => isOmpErrorDuplicate(entry, true));
    expect(hidden.map((entry) => entry.p["role"]).sort()).toEqual(["omp.error.action", "omp.errorBanner"]);
    expect(hidden.map((entry) => entry.id).sort()).toEqual(["q.0/actions/retry", "r"]);
    for (const id of ["q.0", "q.0/actions/copy-error", "q.0/actions/switch-model", "q.0/1"])
      expect(isOmpErrorDuplicate(nodes.get(id)!, true), id).toBe(false);
  });

  it("没有错误卡时（录制里删掉卡片那条 add）横幅是唯一的错误显示：不隐藏", () => {
    const doc = createDocument();
    for (const { message } of tspDocMessages(loadTspFixture("error-turn"))) {
      if (message.verb === "f")
        applyMessage(doc, {
          ...message,
          body: { ...message.body, ops: message.body.ops.filter((op) => !(op[0] === "add" && op[1] === "q")) },
        });
      else applyMessage(doc, message);
    }
    const nodes = doc.surfaces.get("s:1")!.nodes;
    expect(nodes.has("q.0")).toBe(false);
    const hasCard = trailingErrorCardId(nodes) !== null;
    expect(hasCard).toBe(false);
    expect(isOmpErrorDuplicate(nodes.get("r")!, hasCard)).toBe(false);
  });
});

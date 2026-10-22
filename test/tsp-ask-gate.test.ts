// 提问对话框（B3 / B6）：对着 omp 18.12.5 真实录制 fixtures/tsp/ask-multi.jsonl（三题：单选 / 多选 / 单选，走到 Review 页提交）
// 逐帧重放文档，核对节点结构和点击规则。录制里终端发出的事件就是 studio 点击后应该发的：
//   select 单选的非高亮项、select 多选的高亮项（Logging）、select 多选的另一项（Cache）、action submit（Next）、
//   select 第三题的非高亮项、action submit（Review 页的 Submit）。
import { describe, expect, it } from "vitest";
import { askItemClick, askItemDoubleActivates, askItemMarker } from "../src/shared/tsp/ask-gate.ts";
import { applyMessage, createDocument, findNode, nodeRole, type DocNode } from "../src/shared/tsp/document.ts";
import { deriveTaskStatus } from "../src/shared/tsp/task-status.ts";
import { loadTspFixture, recordedUserEvents, tspDocMessages } from "./tsp-fixtures.ts";

const lines = loadTspFixture("ask-multi");
const messages = tspDocMessages(lines);

/** 重放到第一次满足 `until` 的那条消息（含），返回文档。 */
function replayUntil(until: (doc: ReturnType<typeof createDocument>) => boolean) {
  const doc = createDocument();
  for (const { message } of messages) {
    applyMessage(doc, message);
    if (until(doc)) return doc;
  }
  throw new Error("录制里没有出现期望的状态");
}

const surface = (doc: ReturnType<typeof createDocument>) => doc.surfaces.get("s:1")!;
const byRole = (doc: ReturnType<typeof createDocument>, role: string) =>
  findNode(surface(doc), (n) => nodeRole(n) === role);
const kids = (doc: ReturnType<typeof createDocument>, node: DocNode) =>
  node.c.map((id) => surface(doc).nodes.get(id)!).filter(Boolean);

describe("ask-multi 录制：节点结构", () => {
  it("第一页（单选）：选项 role 是 omp.ask.option，高亮第一项，tabs 里有 3 题 + Review", () => {
    const doc = replayUntil((d) => byRole(d, "omp.ask.options") !== null);
    const list = byRole(doc, "omp.ask.options")!;
    expect(kids(doc, list).map((n) => nodeRole(n))).toEqual([
      "omp.ask.option",
      "omp.ask.option",
      "omp.ask.option",
      "omp.ask.other",
    ]);
    expect(list.p["selected"]).toBe(kids(doc, list)[0]!.id);
    const tabs = byRole(doc, "omp.ask.questions")!;
    expect((tabs.p["items"] as { id: string }[]).map((i) => i.id)).toEqual(["0", "1", "2", "submit"]);
  });

  it("多选页：选项 role 是 omp.ask.check；勾选后 item 带 icon=check + tone=accent，再选一次取消", () => {
    const doc = replayUntil((d) => {
      const list = byRole(d, "omp.ask.options");
      return list !== null && kids(d, list).some((n) => nodeRole(n) === "omp.ask.check");
    });
    const items = kids(doc, byRole(doc, "omp.ask.options")!).filter((n) => nodeRole(n) === "omp.ask.check");
    expect(items).toHaveLength(4);
    expect(items.every((n) => n.p["icon"] === undefined)).toBe(true);
    // 第一个 select（Logging，已高亮）之后：Logging 被勾上。
    const checked = replayUntil((d) => {
      const first = [...surface(d).nodes.values()].find(
        (n) => n.p["role"] === "omp.ask.check" && n.p["icon"] === "check",
      );
      return first !== undefined;
    });
    const mark = [...surface(checked).nodes.values()].find((n) => n.p["icon"] === "check")!;
    expect(mark.p["tone"]).toBe("accent");
    expect(nodeRole(mark)).toBe("omp.ask.check");
  });

  it("Review 页：没有 list、没有 editor（所以没有可聚焦的 data-tspi-keys 节点），有 answers kv 和带 action 的 Submit 按钮", () => {
    const doc = replayUntil((d) => byRole(d, "omp.ask.answers") !== null);
    const ask = byRole(doc, "omp.editor.ask")!;
    expect(findNode(surface(doc), (n) => n.k === "list" || n.k === "editor" || n.k === "input", ask.id)).toBeNull();
    const answers = byRole(doc, "omp.ask.answers")!;
    expect(answers.p["items"]).toEqual([
      { k: "Language", v: [{ t: "Rust" }] },
      { k: "Features", v: [{ t: "Logging" }, { t: ", ", s: "dim" }, { t: "Cache" }] },
      { k: "Project", v: [{ t: "beta" }] },
    ]);
    const submit = surface(doc).nodes.get(`${ask.id}.actions/submit`)!;
    expect(submit.p["role"]).toBe("omp.btn");
    expect(submit.p["actions"]).toEqual({ click: "submit" });
    expect(String(submit.p["title"])).toMatch(/Submit answers\s+enter/);
    // 底栏按钮的 kbd：Enter 提交。
    const kbd = kids(doc, submit).find((n) => n.k === "kbd")!;
    expect(kbd.p["keys"]).toEqual(["enter"]);
    // Review 页提问还在等用户。
    expect(deriveTaskStatus(doc).status).toBe("needs_you");
  });

  it("提交之后提问对话框消失，omp.tool.ask 带答案", () => {
    const doc = replayUntil((d) => byRole(d, "omp.tool.ask") !== null && byRole(d, "omp.editor.ask") === null);
    expect(byRole(doc, "omp.tool.ask")).not.toBeNull();
    expect(deriveTaskStatus(doc).ask).toBeNull();
  });
});

describe("提问选项的点击规则（B6）", () => {
  it("录制里终端发的事件：单选 select、多选 select ×2、Next 的 action、select、Submit 的 action", () => {
    const events = recordedUserEvents(lines)
      .map((e) => e.event)
      .filter((e) => e["ev"] !== "send");
    expect(events.map((e) => [e["ev"], e["id"] ?? null, e["item"] ?? e["act"]])).toEqual([
      ["select", expect.stringMatching(/\.q0$/), expect.stringMatching(/option:1$/)],
      ["select", expect.stringMatching(/\.q1$/), expect.stringMatching(/option:0$/)],
      ["select", expect.stringMatching(/\.q1$/), expect.stringMatching(/option:2$/)],
      ["action", expect.stringMatching(/\.actions\/submit$/), "submit"],
      ["select", expect.stringMatching(/\.q2$/), expect.stringMatching(/option:1$/)],
      ["action", expect.stringMatching(/\.actions\/submit$/), "submit"],
    ]);
  });

  it("多选选项（omp.ask.check）：不管是否高亮，单击都是 select（勾选切换）；双击不 activate", () => {
    expect(askItemClick("omp.ask.check", true)).toBe("select");
    expect(askItemClick("omp.ask.check", false)).toBe("select");
    expect(askItemDoubleActivates("omp.ask.check")).toBe(false);
  });

  it("单选选项和其它列表保持：点非高亮 = select（omp 直接作答），再点已高亮 = activate；双击 activate", () => {
    for (const role of ["omp.ask.option", "omp.ask.other", "omp.approval.option", undefined]) {
      expect(askItemClick(role, true)).toBe("activate");
      expect(askItemClick(role, false)).toBe("select");
      expect(askItemDoubleActivates(role)).toBe(true);
    }
  });
});

describe("提问选项的标记", () => {
  it("单选题的选项是单选圈，多选题的是勾选框，审批选项和其它列表没有", () => {
    expect(askItemMarker("omp.ask.option")).toBe("radio");
    expect(askItemMarker("omp.ask.other")).toBe("radio");
    expect(askItemMarker("omp.ask.check")).toBe("check");
    expect(askItemMarker("omp.ask.other.check")).toBe("check");
    expect(askItemMarker("omp.approval.choice")).toBeNull();
    expect(askItemMarker(undefined)).toBeNull();
  });
});

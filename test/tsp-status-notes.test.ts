// 两件 omp 终端里有、TSP 文档里留不住的东西（fixtures/tsp/compact.jsonl、picker.jsonl，omp 18.12.5 实录）：
// 压缩分隔（section omp.compaction）、状态行（toast omp.toast.status：切模型等）。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, restoreDocument, snapshotDocument } from "../src/shared/tsp/document.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

function replay(name: string) {
  const doc = createDocument();
  for (const { message } of tspDocMessages(loadTspFixture(name))) applyMessage(doc, message);
  return doc;
}

describe("状态行（omp.toast.status）：节点下一帧就没了，所以出现那一帧记在文档里", () => {
  it("切模型：Session-only model 记成一条，停在它出现时前面那个节点后面", () => {
    const doc = replay("compact");
    const notes = doc.surfaces.get("s:1")?.statusNotes ?? [];
    expect(notes.map((note) => note.text)).toEqual([
      "Session compacted 1 time",
      expect.stringMatching(/^xdev: /),
      "Session-only model: deepseek/deepseek-v4-pro. Use Alt+M or /model for roles.",
    ]);
    // 锚点是 main 里最后一个对话节点（助手回答 r）；toast 节点本身还在（最后一条），之前几条已经被换成隐藏的占位。
    expect(notes.every((note) => note.anchor === "r")).toBe(true);
    expect(doc.surfaces.get("s:1")?.nodes.get("main")?.c).toContain("r");
  });

  it("跟着快照走：任务界面晚于 omp 启动才打开，启动时的状态行也在", () => {
    const restored = restoreDocument(snapshotDocument(replay("compact")));
    expect(restored.surfaces.get("s:1")?.statusNotes.map((note) => note.text)).toHaveLength(3);
  });

  it("picker 录制：同一个 toast id 反复 del/add，每次文字不同都各记一条", () => {
    const notes = replay("picker").surfaces.get("s:1")?.statusNotes ?? [];
    expect(notes.map((note) => note.text)).toEqual([
      expect.stringMatching(/^xdev: /),
      "Session-only model: deepseek/deepseek-v4-flash. Use Alt+M or /model for roles.",
    ]);
  });

  it("不是 omp.toast.status 的 toast、没有文字的不记；surface 重开清空", () => {
    const doc = createDocument();
    const apply = (message: Parameters<typeof applyMessage>[1]) => applyMessage(doc, message);
    const open = { verb: "o", body: { id: "s:1", mode: "inline" } } as never;
    const frame = (ops: unknown[]) => ({ verb: "f", body: { sf: "s:1", s: 1, ops } }) as never;
    const toast = (id: string, props: object) => ["add", id, "main", null, { id, k: "toast", p: props }];
    apply(open);
    apply(frame([["add", "main", "s:1", null, { id: "main", k: "col" }]]));
    apply(frame([toast("a", { text: "hi", role: "other" })]));
    apply(frame([toast("b", { text: "  ", role: "omp.toast.status" })]));
    expect(doc.surfaces.get("s:1")?.statusNotes).toEqual([]);
    apply(frame([toast("c", { text: "ok", role: "omp.toast.status" })]));
    expect(doc.surfaces.get("s:1")?.statusNotes).toEqual([{ text: "ok", anchor: "b" }]);
    apply(open);
    expect(doc.surfaces.get("s:1")?.statusNotes).toEqual([]);
  });
});

describe("压缩分隔（omp.compaction）", () => {
  it("恢复一个压缩过的会话：折叠的 section，头文字是方法 · 压缩前 → 压缩后，里面是说明和摘要", () => {
    const doc = replay("compact");
    const surface = doc.surfaces.get("s:1");
    const section = [...(surface?.nodes.values() ?? [])].find((node) => node.p["role"] === "omp.compaction");
    expect(section?.k).toBe("section");
    expect(section?.p["collapsible"]).toBe(true);
    expect(section?.p["collapsed"]).toBe(true);
    const head = ((section?.p["head"] ?? []) as { t: string }[]).map((span) => span.t).join("");
    expect(head).toBe("Snap-compacted · 48K → 6.1K tokens");
    expect(section?.c.map((id) => surface?.nodes.get(id)?.k)).toEqual(["text", "md"]);
    // 它在 main 里夹在压缩前保留的最后一轮和压缩后的第一条用户消息之间。
    const roles = surface?.nodes.get("main")?.c.map((id) => surface.nodes.get(id)?.p["role"] ?? null);
    const at = roles?.indexOf("omp.compaction") ?? -1;
    expect(roles?.[at - 1]).toBe("omp.assistant");
    expect(roles?.[at + 1]).toBe("omp.user");
  });
});

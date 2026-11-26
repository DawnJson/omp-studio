// 防的是：omp（hello 声明 `scroll`）转发的键盘滚动没人执行——报告弹窗（/changelog 等）里按 PageDown 什么都不动；
// 一帧连发几步只执行最后一步；重拉快照后已执行过的又执行一遍；PageUp / PageDown 到不了 omp。
// 真实形状来自 omp 19.2.1 实测：/changelog 后按 PageDown → `["scroll","layer/report/0/body","page-down"]`。
import { describe, expect, it } from "vitest";
import { applyMessage, createDocument, restoreDocument, snapshotDocument } from "../src/shared/tsp/document.ts";
import { shouldSendOverlayPageKey, type OverlayEscInput } from "../src/shared/tsp/overlay-esc.ts";
import { scrollTopAfter } from "../src/shared/tsp/scroll-op.ts";
import type { TspOp } from "../src/shared/tsp/tsp.generated.ts";

function report() {
  const doc = createDocument();
  applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline" } });
  applyMessage(doc, {
    verb: "f",
    body: {
      sf: "s:1",
      s: 1,
      ops: [
        ["add", "layer", "s:1", null, { id: "layer", k: "col" }],
        ["add", "layer/report/0/body", "layer", null, { id: "layer/report/0/body", k: "col" }],
      ],
    },
  });
  return doc;
}

const frame = (s: number, ops: TspOp[]) => ({ verb: "f" as const, body: { sf: "s:1", s, ops } });

describe("scroll 操作进文档", () => {
  it("按顺序记下每一步，seq 递增；未知节点和未知方向被拒", () => {
    const doc = report();
    const result = applyMessage(
      doc,
      frame(2, [
        ["scroll", "layer/report/0/body", "page-down"],
        ["scroll", "layer/report/0/body", "page-down"],
        ["scroll", "nope", "end"],
        ["scroll", "layer/report/0/body", "sideways" as "end"],
      ]),
    );
    expect(result.errors.map((error) => error.op)).toEqual([2, 3]);
    const scrolls = doc.surfaces.get("s:1")?.scrolls ?? [];
    expect(scrolls.map((op) => op.by)).toEqual(["page-down", "page-down"]);
    expect(scrolls[1]!.seq).toBeGreaterThan(scrolls[0]!.seq);
  });

  it("和 reveal 共用一个递增号，快照还原后不变（渲染进程按 seq 不重复执行）", () => {
    const doc = report();
    applyMessage(doc, frame(2, [["reveal", "layer/report/0/body", "start"]]));
    applyMessage(doc, frame(3, [["scroll", "layer/report/0/body", "end"]]));
    const surface = doc.surfaces.get("s:1")!;
    expect(surface.scrolls[0]!.seq).toBeGreaterThan(surface.reveal!.seq);
    const restored = restoreDocument(structuredClone(snapshotDocument(doc)));
    expect(restored.surfaces.get("s:1")?.scrolls).toEqual(surface.scrolls);
    expect(restored.revealSeq).toBe(doc.revealSeq);
  });

  it("只留最近 32 步", () => {
    const doc = report();
    const ops: TspOp[] = Array.from({ length: 40 }, () => ["scroll", "layer/report/0/body", "line-down"]);
    applyMessage(doc, frame(2, ops));
    const scrolls = doc.surfaces.get("s:1")!.scrolls;
    expect(scrolls).toHaveLength(32);
    expect(scrolls.at(-1)!.seq).toBe(doc.revealSeq);
  });
});

describe("scrollTopAfter", () => {
  const box = { scrollTop: 100, scrollHeight: 1000, clientHeight: 300, line: 20 };
  it("一行、一屏少一行、两端，夹在可滚范围里", () => {
    expect(scrollTopAfter("line-down", box)).toBe(120);
    expect(scrollTopAfter("line-up", box)).toBe(80);
    expect(scrollTopAfter("page-down", box)).toBe(380);
    expect(scrollTopAfter("page-up", box)).toBe(0);
    expect(scrollTopAfter("end", box)).toBe(700);
    expect(scrollTopAfter("start", box)).toBe(0);
    expect(scrollTopAfter("page-down", { ...box, scrollTop: 600 })).toBe(700);
  });
});

describe("shouldSendOverlayPageKey", () => {
  const input = (over: Partial<OverlayEscInput>): OverlayEscInput => ({
    key: "PageDown",
    defaultPrevented: false,
    composing: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    target: "composer",
    isTop: true,
    pickerOpen: false,
    ...over,
  });
  it("焦点在输入框 / 弹窗上时，最上面的弹窗把 PageUp / PageDown 写给 omp", () => {
    expect(shouldSendOverlayPageKey(input({}))).toBe(true);
    expect(shouldSendOverlayPageKey(input({ key: "PageUp", target: "view" }))).toBe(true);
  });
  it("别的键、带修饰键、不是最上面、选择器开着、控件自己处理时不发", () => {
    for (const over of [
      { key: "ArrowDown" },
      { key: "Escape" },
      { shiftKey: true },
      { isTop: false },
      { pickerOpen: true },
      { target: "self-routing" as const },
      { defaultPrevented: true },
    ])
      expect(shouldSendOverlayPageKey(input(over))).toBe(false);
  });
});

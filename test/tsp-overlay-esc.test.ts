// 防的是：omp 的弹窗（/jobs /session /usage /changelog）按 Esc 关不掉；或者 Esc 同时被 studio 当成"停止任务"；
// 或者控件自己已经把 Esc 写给 omp、这里又发一次（两下 Esc）；以及 /tools 的第一列被挤成一个字宽。
import { describe, expect, it } from "vitest";
import { shouldSendOverlayEsc, type OverlayEscInput } from "../src/shared/tsp/overlay-esc.ts";
import { columnChars, columnTrack } from "../src/shared/tsp/table-layout.ts";

const esc = (over: Partial<OverlayEscInput> = {}): OverlayEscInput => ({
  key: "Escape",
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

describe("shouldSendOverlayEsc", () => {
  it("焦点在 studio 输入框、body、弹窗卡片上时，最上面的弹窗把 Esc 写给 omp", () => {
    for (const target of ["composer", "body", "view"] as const) {
      expect(shouldSendOverlayEsc(esc({ target }))).toBe(true);
    }
  });

  it("只有最上面的弹窗发：叠了几层也只发一下", () => {
    expect(shouldSendOverlayEsc(esc({ isTop: false }))).toBe(false);
  });

  it("tsp-view 里自己写 Esc 的控件（输入框、list）不重复发；studio 自己的对话框也不抢", () => {
    expect(shouldSendOverlayEsc(esc({ target: "self-routing" }))).toBe(false);
    expect(shouldSendOverlayEsc(esc({ target: "other" }))).toBe(false);
  });

  it("别人已经处理过的 Esc、输入法组合中的 Esc、带修饰键的 Esc 都不发", () => {
    expect(shouldSendOverlayEsc(esc({ defaultPrevented: true }))).toBe(false);
    expect(shouldSendOverlayEsc(esc({ composing: true }))).toBe(false);
    expect(shouldSendOverlayEsc(esc({ altKey: true }))).toBe(false);
    expect(shouldSendOverlayEsc(esc({ shiftKey: true }))).toBe(false);
  });

  it("选择器开着时它自己管 Esc；别的键不发", () => {
    expect(shouldSendOverlayEsc(esc({ pickerOpen: true }))).toBe(false);
    expect(shouldSendOverlayEsc(esc({ key: "Enter" }))).toBe(false);
  });
});

describe("table 列轨道", () => {
  it("columnChars：最长单元格、表头都算，缺的单元格不算，空串按 emptyChars", () => {
    expect(columnChars("Tool", ["xd://debug", "xd://lsp"], 8)).toBe(10);
    expect(columnChars(null, [null, ""], 8)).toBe(8);
    expect(columnChars("Tool", [null], 8)).toBe(4);
  });

  it("不撑开的列有字数下限（封顶 24 字），不会被挤成一个字宽", () => {
    expect(columnTrack(undefined, 10)).toBe("minmax(calc(10 * var(--tsp-cw, 8px) + 14px), auto)");
    expect(columnTrack(0, 80)).toBe("minmax(calc(24 * var(--tsp-cw, 8px) + 14px), auto)");
  });

  it("撑开的列保留比例，下限最多按 12 字算", () => {
    expect(columnTrack(2, 100)).toBe("minmax(calc(12 * var(--tsp-cw, 8px) + 14px), 2fr)");
    expect(columnTrack(1, 3)).toBe("minmax(calc(3 * var(--tsp-cw, 8px) + 14px), 1fr)");
  });
});

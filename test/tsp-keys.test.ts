// 防的是：键编码错了，omp 收到的不是用户按的键（Alt+P 打不开模型选择器、Ctrl+Enter 变成 Enter）；
// 输入法选词时的按键被写进终端；输入框里该留给 omp 的键被 Tern 吃掉（或反过来）。
import { describe, expect, it } from "vitest";
import {
  encodeKey,
  encodePaste,
  routeEditorKey,
  type EditorKeyState,
  type KeyEventLike,
} from "../src/renderer/src/features/tsp/keys.ts";

const ev = (key: string, over: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...over,
});

describe("encodeKey", () => {
  it("omp 在录制里用到的键", () => {
    expect(encodeKey(ev("Enter"))).toBe("\r");
    expect(encodeKey(ev("Escape"))).toBe("\x1b");
    expect(encodeKey(ev("p", { altKey: true, code: "KeyP" }))).toBe("\x1bp");
    expect(encodeKey(ev("h", { altKey: true, code: "KeyH" }))).toBe("\x1bh");
    expect(encodeKey(ev("o", { ctrlKey: true, code: "KeyO" }))).toBe("\x0f");
    expect(encodeKey(ev("Enter", { ctrlKey: true }))).toBe("\x1b[13;5u");
    expect(encodeKey(ev("n"))).toBe("n");
  });

  it("Mac 的 Option 让 key 变成别的字符时仍按物理键编码", () => {
    expect(encodeKey(ev("π", { altKey: true, code: "KeyP" }))).toBe("\x1bp");
  });

  it("非 QWERTY 布局：普通字符取 key，不取物理键", () => {
    expect(encodeKey(ev("a", { code: "KeyQ" }))).toBe("a");
  });

  it("Tab、Shift+Tab、方向键、Home/End、翻页、删除", () => {
    expect(encodeKey(ev("Tab"))).toBe("\t");
    expect(encodeKey(ev("Tab", { shiftKey: true }))).toBe("\x1b[Z");
    expect(encodeKey(ev("ArrowUp"))).toBe("\x1b[A");
    expect(encodeKey(ev("ArrowLeft", { ctrlKey: true }))).toBe("\x1b[1;5D");
    expect(encodeKey(ev("ArrowRight", { shiftKey: true, altKey: true }))).toBe("\x1b[1;4C");
    expect(encodeKey(ev("Home"))).toBe("\x1b[H");
    expect(encodeKey(ev("End"))).toBe("\x1b[F");
    expect(encodeKey(ev("PageUp"))).toBe("\x1b[5~");
    expect(encodeKey(ev("PageDown"))).toBe("\x1b[6~");
    expect(encodeKey(ev("Delete"))).toBe("\x1b[3~");
    expect(encodeKey(ev("Backspace"))).toBe("\x7f");
    expect(encodeKey(ev("Backspace", { altKey: true }))).toBe("\x1b\x7f");
  });

  it("Enter 的修饰组合不会塌成同一个", () => {
    expect(encodeKey(ev("Enter", { shiftKey: true }))).toBe("\x1b[13;2u");
    expect(encodeKey(ev("Enter", { altKey: true }))).toBe("\x1b\r");
    expect(encodeKey(ev("Enter", { ctrlKey: true, shiftKey: true }))).toBe("\x1b[13;6u");
  });

  it("Ctrl+字母 是控制字符，Alt+字母 是 ESC 前缀，Ctrl+Alt 两者叠加", () => {
    expect(encodeKey(ev("a", { ctrlKey: true }))).toBe("\x01");
    expect(encodeKey(ev("Z", { ctrlKey: true }))).toBe("\x1a");
    expect(encodeKey(ev("b", { altKey: true }))).toBe("\x1bb");
    expect(encodeKey(ev("B", { altKey: true, shiftKey: true }))).toBe("\x1bB");
    expect(encodeKey(ev("c", { ctrlKey: true, altKey: true }))).toBe("\x1b\x03");
    expect(encodeKey(ev("C", { ctrlKey: true, shiftKey: true }))).toBe("\x1b[99;6u");
    expect(encodeKey(ev("[", { ctrlKey: true }))).toBe("\x1b");
    expect(encodeKey(ev(" ", { ctrlKey: true }))).toBe("\x00");
  });

  it("F 键", () => {
    expect(encodeKey(ev("F1"))).toBe("\x1bOP");
    expect(encodeKey(ev("F4"))).toBe("\x1bOS");
    expect(encodeKey(ev("F5"))).toBe("\x1b[15~");
    expect(encodeKey(ev("F12"))).toBe("\x1b[24~");
    expect(encodeKey(ev("F2", { shiftKey: true }))).toBe("\x1b[1;2Q");
    expect(encodeKey(ev("F9", { ctrlKey: true }))).toBe("\x1b[20;5~");
  });

  it("AltGr 产生的字符是普通字符", () => {
    expect(encodeKey(ev("@", { ctrlKey: true, altKey: true, altGraph: true }))).toBe("@");
  });

  it("输入法组合期间、Process、单独的修饰键、Cmd/Win 组合都不发", () => {
    expect(encodeKey(ev("Enter", { isComposing: true }))).toBeNull();
    expect(encodeKey(ev("a", { keyCode: 229 }))).toBeNull();
    expect(encodeKey(ev("Process"))).toBeNull();
    expect(encodeKey(ev("Shift", { shiftKey: true }))).toBeNull();
    expect(encodeKey(ev("Control", { ctrlKey: true }))).toBeNull();
    expect(encodeKey(ev("c", { metaKey: true }))).toBeNull();
    expect(encodeKey(ev("Dead"))).toBeNull();
  });

  it("中文等非 ASCII 单字符原样发出", () => {
    expect(encodeKey(ev("中"))).toBe("中");
    expect(encodeKey(ev("😀"))).toBe("😀");
  });
});

describe("encodePaste", () => {
  it("用 bracketed paste 包起来，换行不变成 Enter", () => {
    expect(encodePaste("a\nb")).toBe("\x1b[200~a\nb\x1b[201~");
  });
});

describe("routeEditorKey", () => {
  const state = (over: Partial<EditorKeyState> = {}): EditorKeyState => ({
    hasSelection: false,
    empty: false,
    overlayAtCaret: false,
    firstLine: false,
    lastLine: false,
    ...over,
  });

  it("Ctrl+Z 总是 undo，空输入框也是", () => {
    expect(routeEditorKey(ev("z", { ctrlKey: true }), state())).toBe("undo");
    expect(routeEditorKey(ev("z", { ctrlKey: true }), state({ empty: true }))).toBe("undo");
    expect(routeEditorKey(ev("z", { ctrlKey: true, shiftKey: true }), state())).toBe("pty");
  });

  it("空输入框：其他键全归 omp", () => {
    expect(routeEditorKey(ev("a", { ctrlKey: true }), state({ empty: true }))).toBe("pty");
    expect(routeEditorKey(ev("ArrowUp"), state({ empty: true }))).toBe("pty");
  });

  it("Ctrl+A 全选；Ctrl+C / Ctrl+X 只在有选区时由 Tern 处理", () => {
    expect(routeEditorKey(ev("a", { ctrlKey: true }), state())).toBe("selectAll");
    expect(routeEditorKey(ev("c", { ctrlKey: true }), state())).toBe("pty");
    expect(routeEditorKey(ev("c", { ctrlKey: true }), state({ hasSelection: true }))).toBe("copy");
    expect(routeEditorKey(ev("x", { ctrlKey: true }), state())).toBe("pty");
    expect(routeEditorKey(ev("x", { ctrlKey: true }), state({ hasSelection: true }))).toBe("cut");
  });

  it("Shift+方向键扩展选区，不发事件", () => {
    expect(routeEditorKey(ev("ArrowLeft", { shiftKey: true }), state())).toBe("select");
    expect(routeEditorKey(ev("End", { shiftKey: true, ctrlKey: true }), state())).toBe("select");
  });

  it("↑↓：第一行 / 最后一行归 omp（历史），中间行移动光标；有锚在光标的 overlay 时归 omp（它的列表）", () => {
    expect(routeEditorKey(ev("ArrowUp"), state({ firstLine: true }))).toBe("pty");
    expect(routeEditorKey(ev("ArrowUp"), state())).toBe("move");
    expect(routeEditorKey(ev("ArrowDown"), state({ lastLine: true }))).toBe("pty");
    expect(routeEditorKey(ev("ArrowDown"), state())).toBe("move");
    expect(routeEditorKey(ev("ArrowUp"), state({ overlayAtCaret: true }))).toBe("pty");
    expect(routeEditorKey(ev("ArrowDown"), state({ overlayAtCaret: true }))).toBe("pty");
  });

  it("←→：没有选区归 omp，有选区时折叠选区并告诉 omp", () => {
    expect(routeEditorKey(ev("ArrowLeft"), state())).toBe("pty");
    expect(routeEditorKey(ev("ArrowLeft"), state({ hasSelection: true }))).toBe("move");
  });

  it("有选区时输入、删除、Shift+Enter 替换选区；没有选区时都归 omp", () => {
    const sel = state({ hasSelection: true });
    expect(routeEditorKey(ev("x"), sel)).toBe("replace");
    expect(routeEditorKey(ev("中"), sel)).toBe("replace");
    expect(routeEditorKey(ev("Backspace"), sel)).toBe("replace");
    expect(routeEditorKey(ev("Delete"), sel)).toBe("replace");
    expect(routeEditorKey(ev("Enter", { shiftKey: true }), sel)).toBe("replace");
    expect(routeEditorKey(ev("x"), state())).toBe("pty");
    expect(routeEditorKey(ev("Backspace"), state())).toBe("pty");
  });

  it("Enter、Esc、Tab、Alt 组合始终归 omp，即使有选区", () => {
    const sel = state({ hasSelection: true });
    expect(routeEditorKey(ev("Enter"), sel)).toBe("pty");
    expect(routeEditorKey(ev("Escape"), sel)).toBe("pty");
    expect(routeEditorKey(ev("Tab"), sel)).toBe("pty");
    expect(routeEditorKey(ev("p", { altKey: true }), sel)).toBe("pty");
    expect(routeEditorKey(ev("Enter", { ctrlKey: true }), sel)).toBe("pty");
  });

  it("输入法组合期间不由 Tern 处理", () => {
    expect(routeEditorKey(ev("a", { isComposing: true }), state({ hasSelection: true }))).toBe("pty");
  });
});

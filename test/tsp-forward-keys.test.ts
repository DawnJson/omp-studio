import { describe, expect, it } from "vitest";
import { applyMessage, createDocument } from "../src/shared/tsp/document.ts";
import {
  chordFromKbd,
  chordOf,
  kbdChordsIn,
  OMP_GLOBAL_CHORDS,
  shouldForwardChord,
  STUDIO_RESERVED,
  type ForwardKeyEvent,
} from "../src/shared/tsp/forward-keys.ts";
import { loadTspFixture, tspDocMessages } from "./tsp-fixtures.ts";

/** 回放录制，收集过程中任何一帧出现过的键帽（节点会随下一帧消失，如错误卡被新一轮顶掉、排队消息发出）。 */
function seen(name: string): Set<string> {
  const doc = createDocument();
  const all = new Set<string>();
  for (const { message } of tspDocMessages(loadTspFixture(name))) {
    applyMessage(doc, message);
    for (const chord of kbdChordsIn(doc)) all.add(chord);
  }
  return all;
}

function ev(init: Partial<ForwardKeyEvent> & { key: string }): ForwardKeyEvent {
  return {
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    defaultPrevented: false,
    target: "composer",
    ...init,
  };
}

describe("chordOf / chordFromKbd", () => {
  it("事件 → 规范写法（修饰键顺序固定、字母小写、方向键用名字）", () => {
    expect(chordOf(ev({ key: "P", ctrlKey: true, shiftKey: true }))).toBe("ctrl+shift+p");
    expect(chordOf(ev({ key: "P", altKey: true, shiftKey: true }))).toBe("alt+shift+p");
    expect(chordOf(ev({ key: "ArrowUp", altKey: true }))).toBe("alt+up");
    expect(chordOf(ev({ key: "Tab", shiftKey: true }))).toBe("shift+tab");
    expect(chordOf(ev({ key: "F5" }))).toBe("f5");
    // Mac 的 Option+P 产生 π：按物理键取。
    expect(chordOf(ev({ key: "π", code: "KeyP", altKey: true }))).toBe("alt+p");
    expect(chordOf(ev({ key: "Alt", altKey: true }))).toBeNull();
    expect(chordOf(ev({ key: "p", metaKey: true }))).toBeNull();
    expect(chordOf(ev({ key: "a", isComposing: true }))).toBeNull();
    expect(chordOf(ev({ key: "@", ctrlKey: true, altKey: true, altGraph: true }))).toBeNull();
  });

  it("kbd 节点的 keys：名字数组、符号字符串、Ctrl+X 写法都认", () => {
    expect(chordFromKbd(["alt", "up"])).toBe("alt+up");
    expect(chordFromKbd(["F5"])).toBe("f5");
    expect(chordFromKbd(["⌥P"])).toBe("alt+p");
    expect(chordFromKbd(["⌥⇧P"])).toBe("alt+shift+p");
    expect(chordFromKbd(["ctrl", "g"])).toBe("ctrl+g");
    expect(chordFromKbd(["Ctrl+Enter"])).toBe("ctrl+enter");
    expect(chordFromKbd(["esc"])).toBe("escape");
    expect(chordFromKbd(["escape"])).toBe("escape");
    expect(chordFromKbd(["⌘", "k"])).toBeNull();
    expect(chordFromKbd(["ctrl"])).toBeNull();
    expect(chordFromKbd([])).toBeNull();
    expect(chordFromKbd("f5")).toBeNull();
  });
});

describe("kbdChordsIn：omp 18.12.5 的录制", () => {
  it("错误卡上的键帽 = F5（Retry）和 ⌥P（Switch model）", () => {
    const chords = seen("error-turn");
    expect(chords.has("f5")).toBe(true);
    expect(chords.has("alt+p")).toBe(true);
    expect(chords.has("escape")).toBe(true);
  });

  it("排队的消息上的 Edit 键帽 = ⌥↑", () => {
    expect(seen("queue-esc").has("alt+up")).toBe(true);
  });
});

describe("shouldForwardChord", () => {
  const none = () => new Set<string>();

  it("omp 的全局键（⇧Tab ⌃P ⌃⇧P ⌥P ⌥⇧P ⌃T ⌃R F5 ⌥R ⌥↑）在输入框里转发", () => {
    const cases: Partial<ForwardKeyEvent>[] = [
      { key: "Tab", shiftKey: true },
      { key: "p", ctrlKey: true },
      { key: "P", ctrlKey: true, shiftKey: true },
      { key: "p", altKey: true },
      { key: "P", altKey: true, shiftKey: true },
      { key: "t", ctrlKey: true },
      { key: "r", ctrlKey: true },
      { key: "F5" },
      { key: "r", altKey: true },
      { key: "ArrowUp", altKey: true },
    ];
    for (const init of cases)
      expect(shouldForwardChord(ev({ key: "x", ...init }), none), JSON.stringify(init)).toBe(true);
    expect(OMP_GLOBAL_CHORDS.size).toBe(cases.length);
  });

  it("studio 自己的键永远不转发，哪怕键帽上写着", () => {
    const hinted = () => new Set(["ctrl+l", "alt+m", "ctrl+o", "ctrl+shift+o", "ctrl+enter", "alt+t", "ctrl+j"]);
    const studio: Partial<ForwardKeyEvent>[] = [
      { key: "l", ctrlKey: true },
      { key: "m", altKey: true },
      { key: "t", altKey: true },
      { key: "o", ctrlKey: true },
      { key: "O", ctrlKey: true, shiftKey: true },
      { key: "Enter", ctrlKey: true },
      { key: "j", ctrlKey: true },
      { key: "k", ctrlKey: true },
      { key: "n", ctrlKey: true },
      { key: "5", ctrlKey: true },
      { key: "F6" },
      { key: "ArrowLeft", altKey: true },
      { key: "ArrowRight", altKey: true },
      { key: "`", ctrlKey: true },
    ];
    for (const init of studio)
      expect(shouldForwardChord(ev({ key: "x", ...init }), hinted), JSON.stringify(init)).toBe(false);
    for (const chord of OMP_GLOBAL_CHORDS) expect(STUDIO_RESERVED.has(chord), chord).toBe(false);
  });

  it("文字输入和编辑键不转发：单字符、Enter、Esc、方向键、Shift+字母、Ctrl+C/V/Z", () => {
    const hinted = () => new Set(["enter", "escape", "x", "f", "up", "shift+x"]);
    const typing: Partial<ForwardKeyEvent>[] = [
      { key: "x" },
      { key: "X", shiftKey: true },
      { key: "Enter" },
      { key: "Escape" },
      { key: "ArrowUp" },
      { key: "Tab" },
      { key: "c", ctrlKey: true },
      { key: "v", ctrlKey: true },
      { key: "z", ctrlKey: true },
      { key: "a", ctrlKey: true },
    ];
    for (const init of typing)
      expect(shouldForwardChord(ev({ key: "x", ...init }), hinted), JSON.stringify(init)).toBe(false);
  });

  it("文档里的键帽提示（带 Ctrl/Alt 的、功能键）转发，没有提示的不转发", () => {
    const goal = () => new Set(["ctrl+g", "alt+h", "f2"]);
    expect(shouldForwardChord(ev({ key: "g", ctrlKey: true }), goal)).toBe(true);
    expect(shouldForwardChord(ev({ key: "h", altKey: true }), goal)).toBe(true);
    expect(shouldForwardChord(ev({ key: "F2" }), goal)).toBe(true);
    expect(shouldForwardChord(ev({ key: "g", ctrlKey: true }), none)).toBe(false);
    expect(shouldForwardChord(ev({ key: "F3" }), goal)).toBe(false);
  });

  it("别处已处理（defaultPrevented）、焦点在别的输入 / studio 对话框 / omp 自己写键的控件里 → 不转发", () => {
    const base = { key: "t", ctrlKey: true };
    expect(shouldForwardChord(ev({ ...base, defaultPrevented: true }), none)).toBe(false);
    expect(shouldForwardChord(ev({ ...base, target: "other" }), none)).toBe(false);
    expect(shouldForwardChord(ev({ ...base, target: "self-routing" }), none)).toBe(false);
    expect(shouldForwardChord(ev({ ...base, target: "view" }), none)).toBe(true);
    expect(shouldForwardChord(ev({ ...base, target: "body" }), none)).toBe(true);
  });

  it("⇧Tab 只在输入框里转发（别处是键盘焦点反向移动）", () => {
    const tab = { key: "Tab", shiftKey: true };
    expect(shouldForwardChord(ev({ ...tab, target: "composer" }), none)).toBe(true);
    expect(shouldForwardChord(ev({ ...tab, target: "view" }), none)).toBe(false);
    expect(shouldForwardChord(ev({ ...tab, target: "body" }), none)).toBe(false);
  });
});

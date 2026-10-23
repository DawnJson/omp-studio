import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOmpKeybindings } from "../src/main/omp-config/keybindings.ts";
import { shouldForwardChord, type ForwardKeyEvent } from "../src/shared/tsp/forward-keys.ts";
import {
  actionOfChord,
  chordKeys,
  forwardedChords,
  resolveOmpKeybindings,
  type OmpKeybinding,
} from "../src/shared/tsp/omp-keybindings.ts";

const chordsOf = (bindings: OmpKeybinding[], action: string): string[] | undefined =>
  bindings.find((binding) => binding.action === action)?.chords;

function ev(init: Partial<ForwardKeyEvent> & { key: string }): ForwardKeyEvent {
  return {
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 0,
    altGraph: false,
    defaultPrevented: false,
    target: "composer",
    ...init,
  } as ForwardKeyEvent;
}

describe("omp 键位：默认值", () => {
  it("没有 keybindings.yml 时是 omp 18.12.6 的默认键，Shift+Up（取回排队消息的第二个键）不转发：输入框里它是选中文字", () => {
    const bindings = resolveOmpKeybindings(null);
    expect(bindings).toEqual([
      { action: "app.thinking.cycle", chords: ["shift+tab"] },
      { action: "app.thinking.toggle", chords: ["ctrl+t"] },
      { action: "app.model.cycleForward", chords: ["ctrl+p"] },
      { action: "app.model.cycleBackward", chords: ["ctrl+shift+p"] },
      { action: "app.model.selectTemporary", chords: ["alt+p"] },
      { action: "app.plan.toggle", chords: ["alt+shift+p"] },
      { action: "app.history.search", chords: ["ctrl+r"] },
      { action: "app.retry", chords: ["f5", "alt+r"] },
      { action: "app.message.dequeue", chords: ["alt+up"] },
    ]);
  });
});

describe("omp 键位：用户 keybindings.yml 的覆盖", () => {
  it("覆盖整个动作（不是追加）；键不区分大小写、修饰键顺序随意；旧键不再转发，新键转发", () => {
    const bindings = resolveOmpKeybindings({
      "app.model.cycleForward": "SHIFT+Alt+K",
      "app.history.search": ["Ctrl+Alt+H", "f7"],
    });
    expect(chordsOf(bindings, "app.model.cycleForward")).toEqual(["alt+shift+k"]);
    expect(chordsOf(bindings, "app.history.search")).toEqual(["ctrl+alt+h", "f7"]);
    const chords = forwardedChords(bindings);
    expect(chords.has("ctrl+p")).toBe(false);
    expect(shouldForwardChord(ev({ key: "K", altKey: true, shiftKey: true }), chords, () => new Set())).toBe(true);
    expect(shouldForwardChord(ev({ key: "p", ctrlKey: true }), chords, () => new Set())).toBe(false);
    expect(actionOfChord(bindings, "f7")).toBe("app.history.search");
    expect(actionOfChord(bindings, "ctrl+t")).toBe("app.thinking.toggle");
    expect(actionOfChord(bindings, "ctrl+z")).toBeNull();
  });

  it("空数组 = 禁用这个动作；没写的动作照旧用默认键", () => {
    const bindings = resolveOmpKeybindings({ "app.retry": [] });
    expect(chordsOf(bindings, "app.retry")).toBeUndefined();
    expect(chordsOf(bindings, "app.thinking.cycle")).toEqual(["shift+tab"]);
    expect(forwardedChords(bindings).has("f5")).toBe(false);
  });

  it("覆盖到 studio 占用的键：studio 优先，不转发；单个字符这类输入框要用的键也不转发", () => {
    const bindings = resolveOmpKeybindings({
      "app.thinking.toggle": ["Ctrl+K", "Ctrl+N", "x", "Space", "Shift+Up"],
      "app.plan.toggle": ["Ctrl+Alt+Y", "Super+P"],
    });
    expect(chordsOf(bindings, "app.thinking.toggle")).toBeUndefined();
    // 带 Super / Cmd 的 studio 发不出去，跳过；其余照常。
    expect(chordsOf(bindings, "app.plan.toggle")).toEqual(["ctrl+alt+y"]);
  });

  it("旧版不带命名空间的动作名（omp 加载时迁移）也认，新名字赢", () => {
    const bindings = resolveOmpKeybindings({
      togglePlanMode: "Alt+O",
      cycleThinkingLevel: "Alt+J",
      "app.thinking.cycle": "Alt+K",
    });
    expect(chordsOf(bindings, "app.plan.toggle")).toEqual(["alt+o"]);
    expect(chordsOf(bindings, "app.thinking.cycle")).toEqual(["alt+k"]);
  });

  it("值的形状不对（数字、含非字符串的数组）当没写，用默认；根不是映射时整个忽略", () => {
    const bindings = resolveOmpKeybindings({ "app.retry": 5, "app.history.search": ["Ctrl+H", 3] });
    expect(chordsOf(bindings, "app.retry")).toEqual(["f5", "alt+r"]);
    expect(chordsOf(bindings, "app.history.search")).toEqual(["ctrl+r"]);
    for (const root of ["text", ["a"], 7, null, undefined])
      expect(resolveOmpKeybindings(root), String(root)).toEqual(resolveOmpKeybindings(null));
  });

  it("键帽文字：修饰键和方向键写成界面上的样子", () => {
    expect(chordKeys("ctrl+alt+shift+p")).toEqual(["Ctrl", "Alt", "Shift", "P"]);
    expect(chordKeys("alt+up")).toEqual(["Alt", "↑"]);
    expect(chordKeys("f5")).toEqual(["F5"]);
    expect(chordKeys("shift+tab")).toEqual(["Shift", "Tab"]);
  });
});

describe("读 agent 目录里的 keybindings 文件", () => {
  let scratch: string;
  let agentDir: string;
  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "omp 键位 测试-"));
    agentDir = path.join(scratch, "agent 目录");
    await mkdir(agentDir, { recursive: true });
  });
  afterEach(() => rm(scratch, { recursive: true, force: true, maxRetries: 5 }));

  it("没有文件：默认键位", async () => {
    expect(await readOmpKeybindings(agentDir)).toEqual(resolveOmpKeybindings(null));
  });

  it("keybindings.yml（带注释，键值写法和 omp 文档一致）", async () => {
    await writeFile(
      path.join(agentDir, "keybindings.yml"),
      "# 我的键位\napp.model.cycleForward: Ctrl+Alt+M # 下一个模型\napp.history.search: []\n",
      "utf8",
    );
    const bindings = await readOmpKeybindings(agentDir);
    expect(chordsOf(bindings, "app.model.cycleForward")).toEqual(["ctrl+alt+m"]);
    expect(chordsOf(bindings, "app.history.search")).toBeUndefined();
  });

  it("yml 优先于 yaml 优先于旧的 json；只有 json 时也读", async () => {
    await writeFile(path.join(agentDir, "keybindings.json"), '{"app.retry": "Alt+9"}', "utf8");
    expect(chordsOf(await readOmpKeybindings(agentDir), "app.retry")).toEqual(["alt+9"]);
    await writeFile(path.join(agentDir, "keybindings.yaml"), "app.retry: Alt+8\n", "utf8");
    expect(chordsOf(await readOmpKeybindings(agentDir), "app.retry")).toEqual(["alt+8"]);
    await writeFile(path.join(agentDir, "keybindings.yml"), "app.retry: Alt+7\n", "utf8");
    expect(chordsOf(await readOmpKeybindings(agentDir), "app.retry")).toEqual(["alt+7"]);
  });

  it("解析不了的文件按没有覆盖处理（omp 自己也是用默认键位），不抛错", async () => {
    await writeFile(path.join(agentDir, "keybindings.yml"), "app.retry: [unclosed\n", "utf8");
    expect(await readOmpKeybindings(agentDir)).toEqual(resolveOmpKeybindings(null));
  });
});

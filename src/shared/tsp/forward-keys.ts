// omp 自己的快捷键怎么到 omp：studio 的输入框是自己的 `<textarea>`（omp 的输入框节点不画），焦点在里面时 omp 收不到 ⇧Tab / ⌃T / ⌃P / ⌥P / ⌥⇧P / ⌃R / F5…，
// 节点上的键帽提示（`Retry F5`、`Edit ⌥↑`）也就只有点击有效（差距清单 B18）。这里是"这一下按键该不该原样写给 omp"的判定，纯函数，测试直接传普通对象。
// 白名单两部分：① omp 18.12.5 的全局默认键（`omp.exe` 里 `app.*` 的 defaultKeys）里 studio 没占用的；② 文档里 `kbd` 节点上写着的键（omp 自己说"按这个键"）。
// 优先级：studio 自己的键永远赢（STUDIO_RESERVED），不转发。

import type { EscTarget } from "./overlay-esc.ts";
import type { TspDocument } from "./document.ts";

/** 事件里用得到的字段（DOM KeyboardEvent 的子集 + 触发元素归类）。 */
export interface ForwardKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** 别处（输入框、全局快捷键）已经处理了这个键。 */
  defaultPrevented: boolean;
  isComposing?: boolean;
  keyCode?: number;
  /** AltGr（欧洲键盘上 Ctrl+Alt 产生字符）。 */
  altGraph?: boolean;
  target: EscTarget;
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set(["control", "alt", "shift", "meta", "altgraph", "os", "capslock"]);

const KEY_NAMES: Readonly<Record<string, string>> = {
  arrowup: "up",
  arrowdown: "down",
  arrowleft: "left",
  arrowright: "right",
  esc: "escape",
  return: "enter",
  " ": "space",
  del: "delete",
  "↑": "up",
  "↓": "down",
  "←": "left",
  "→": "right",
  "⇥": "tab",
  "⏎": "enter",
  "⌫": "backspace",
  "⌦": "delete",
  "⇞": "pageup",
  "⇟": "pagedown",
  "↖": "home",
  "↘": "end",
  "␣": "space",
};

function normalizeKey(raw: string): string {
  const lower = raw.toLowerCase();
  const named = KEY_NAMES[lower] ?? KEY_NAMES[raw];
  if (named !== undefined) return named;
  return lower;
}

interface Parts {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

function format(parts: Parts): string {
  return [parts.ctrl && "ctrl", parts.alt && "alt", parts.shift && "shift", parts.key].filter(Boolean).join("+");
}

/** 事件 → 规范写法 `ctrl+alt+shift+键`（键小写：字母、`tab`、`up`、`f5`…）。单独的修饰键、Cmd/Win 组合、AltGr、输入法组合期间返回 null。 */
export function chordOf(
  e: Pick<
    ForwardKeyEvent,
    "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "isComposing" | "keyCode" | "altGraph"
  >,
): string | null {
  if (e.isComposing === true || e.keyCode === 229 || e.key === "Process") return null;
  if (e.metaKey) return null;
  if (e.altGraph === true && e.ctrlKey && e.altKey) return null;
  if (MODIFIER_KEYS.has(e.key.toLowerCase())) return null;
  let key = normalizeKey(e.key);
  // Mac 的 Option、死键让 key 变成别的字符：字母 / 数字按物理键取。
  if ([...key].length === 1 && !/^[a-z0-9]$/.test(key) && e.code !== undefined) {
    const letter = /^Key([A-Z])$/.exec(e.code)?.[1];
    const digit = /^Digit(\d)$/.exec(e.code)?.[1];
    if (letter !== undefined) key = letter.toLowerCase();
    else if (digit !== undefined) key = digit;
  }
  return format({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, key });
}

const MODIFIER_GLYPHS: Readonly<Record<string, "ctrl" | "alt" | "shift" | "meta">> = {
  "⌃": "ctrl",
  "⌥": "alt",
  "⇧": "shift",
  "⌘": "meta",
};

const MODIFIER_WORDS: Readonly<Record<string, "ctrl" | "alt" | "shift" | "meta">> = {
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  super: "meta",
  win: "meta",
};

/**
 * `kbd` 节点的 `keys`（["alt","up"]、["F5"]、["⌥P"]、["ctrl","g"]、["Ctrl+Enter"]）→ 规范写法。
 * 带 Cmd/Meta、没有主键或认不出的返回 null。
 */
export function chordFromKbd(keys: unknown): string | null {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  const parts: Parts = { ctrl: false, alt: false, shift: false, key: "" };
  let meta = false;
  const addModifier = (modifier: "ctrl" | "alt" | "shift" | "meta"): void => {
    if (modifier === "meta") meta = true;
    else parts[modifier] = true;
  };
  for (const item of keys) {
    if (typeof item !== "string" || item === "") return null;
    // "Ctrl+Enter" / "Alt+Shift+P"（单独的 "+" 键不支持）。
    const tokens = item.length > 1 && item.includes("+") ? item.split("+") : [item];
    for (const token of tokens) {
      let rest = token.trim();
      if (rest === "") return null;
      // "⌥⇧P"：前面的修饰符号逐个吃掉，剩下的是主键。
      while ([...rest].length > 1 && MODIFIER_GLYPHS[[...rest][0]!] !== undefined) {
        addModifier(MODIFIER_GLYPHS[[...rest][0]!]!);
        rest = [...rest].slice(1).join("");
      }
      const glyph = MODIFIER_GLYPHS[rest];
      const word = MODIFIER_WORDS[rest.toLowerCase()];
      if (glyph !== undefined) addModifier(glyph);
      else if (word !== undefined) addModifier(word);
      else if (parts.key === "") parts.key = normalizeKey(rest);
      else return null;
    }
  }
  if (meta || parts.key === "") return null;
  return format(parts);
}

/** 文档里活着的 surface 上所有 `kbd` 节点的键（规范写法）。 */
export function kbdChordsIn(doc: TspDocument): Set<string> {
  const out = new Set<string>();
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k !== "kbd") continue;
      const chord = chordFromKbd(node.p["keys"]);
      if (chord !== null) out.add(chord);
    }
  }
  return out;
}

/**
 * omp 18.12.5 的全局默认键里 studio 没占用的（来源：omp 里 `app.*` 的 defaultKeys）：
 * thinking.cycle ⇧Tab、model.cycleForward ⌃P、cycleBackward ⌃⇧P、selectTemporary ⌥P、plan.toggle ⌥⇧P、thinking.toggle ⌃T、
 * history.search ⌃R、retry F5 / ⌥R、message.dequeue ⌥↑。
 */
export const OMP_GLOBAL_CHORDS: ReadonlySet<string> = new Set([
  "shift+tab",
  "ctrl+p",
  "ctrl+shift+p",
  "alt+p",
  "alt+shift+p",
  "ctrl+t",
  "ctrl+r",
  "f5",
  "alt+r",
  "alt+up",
]);

/**
 * studio 自己占用（或属于输入框的文字编辑 / 窗口）的键，永远不转发，哪怕 omp 的键帽上写着。
 * 冲突（omp 同键另有含义）：Ctrl+L（omp 实时模式 ↔ studio 聚焦输入框）、Alt+M（omp 选模型 ↔ studio 模型弹层，含义相同）、Ctrl+Shift+O（omp 工具可见性 ↔ studio 打开文件夹）、
 * Ctrl+D（omp 退出，studio 没绑，但输入框里是删字符）、Ctrl+Z / Ctrl+C（挂起 / 清空，输入框是撤销 / 复制）、Ctrl+O（含义相同，studio 自己处理展开）、Ctrl+Enter（含义相同，输入框发送）。
 */
export const STUDIO_RESERVED: ReadonlySet<string> = new Set([
  // use-shortcuts.ts（spec §5.1）
  "ctrl+n",
  "ctrl+shift+n",
  "ctrl+shift+o",
  "ctrl+shift+d",
  "ctrl+shift+e",
  "ctrl+k",
  "ctrl+f",
  "ctrl+,",
  "ctrl+b",
  "ctrl+j",
  "ctrl+l",
  "ctrl+`",
  "ctrl+shift+{",
  "ctrl+shift+}",
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `ctrl+${n}`),
  "f6",
  "shift+f6",
  "alt+left",
  "alt+right",
  // 输入框 / 对话区自己的键
  "ctrl+o",
  "ctrl+enter",
  "ctrl+shift+c",
  "ctrl+alt+c",
  "alt+m",
  "alt+t",
  "alt+shift+m",
  "alt+shift+t",
  // 文字编辑和窗口
  "ctrl+a",
  "ctrl+c",
  "ctrl+x",
  "ctrl+v",
  "ctrl+z",
  "ctrl+y",
  "ctrl+shift+z",
  "ctrl+shift+v",
  "ctrl+d",
  "ctrl+w",
  "ctrl+q",
  "ctrl+backspace",
  "ctrl+delete",
  "ctrl+left",
  "ctrl+right",
  "ctrl+up",
  "ctrl+down",
  "ctrl+home",
  "ctrl+end",
  "ctrl+shift+left",
  "ctrl+shift+right",
]);

/** 键帽提示（kbd 节点）里的键只有这些才值得转发：带 Ctrl / Alt 的，或者单独的功能键。单个字符、Enter、Esc、方向键这类输入框要用，不转发。 */
function isForwardableHint(chord: string): boolean {
  const parts = chord.split("+");
  if (parts.includes("ctrl") || parts.includes("alt")) return true;
  return /^f\d{1,2}$/.test(parts[parts.length - 1]!);
}

/** 焦点在 studio 输入框、tsp-view 的普通元素或没有焦点时，omp 收不到的键；tsp-view 里自己写键的控件（list、编辑器）已经发了，不在这里重复。 */
const FORWARD_TARGETS: ReadonlySet<EscTarget> = new Set(["body", "view", "composer"]);

/** 这一下 keydown 该不该原样写给 omp。`hints` 惰性取（只在白名单没命中时才遍历文档）。 */
export function shouldForwardChord(e: ForwardKeyEvent, hints: () => ReadonlySet<string>): boolean {
  if (e.defaultPrevented || !FORWARD_TARGETS.has(e.target)) return false;
  const chord = chordOf(e);
  if (chord === null || STUDIO_RESERVED.has(chord)) return false;
  // ⇧Tab 在输入框外是键盘焦点反向移动（按钮、链接），只有输入框里才转发。
  if (chord === "shift+tab" && e.target !== "composer") return false;
  if (OMP_GLOBAL_CHORDS.has(chord)) return true;
  return isForwardableHint(chord) && hints().has(chord);
}

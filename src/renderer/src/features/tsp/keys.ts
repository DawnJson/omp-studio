// DOM 键盘事件 → 写进伪终端的字节序列（xterm 习惯）。纯函数，不碰 DOM，测试直接传普通对象。
// omp 在 Tern 里用到的键见录制里 `kbd` 节点：Enter、Esc、n、Alt+H、Alt+P、Ctrl+O、Ctrl+Enter。
// 没法用传统序列区分的组合（Shift+Enter、Ctrl+Enter、Ctrl+Tab、Ctrl+Shift+字母…）用 CSI u（`ESC [ 码点 ; 修饰 u`），
// omp 的按键解析认这种写法。

/** encodeKey 需要的 KeyboardEvent 字段。 */
export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** 输入法组合期间（含 keyCode 229 的 Process 事件）一律不发。 */
  isComposing?: boolean;
  keyCode?: number;
  /** AltGr（Windows 上表现为 Ctrl+Alt 同时按下）：此时产生的字符是普通输入。 */
  altGraph?: boolean;
}

const ESC = "\x1b";

/** xterm 修饰参数：1 + Shift(1) + Alt(2) + Ctrl(4)。 */
export function modifierParam(e: Pick<KeyEventLike, "shiftKey" | "altKey" | "ctrlKey">): number {
  return 1 + (e.shiftKey ? 1 : 0) + (e.altKey ? 2 : 0) + (e.ctrlKey ? 4 : 0);
}

const CURSOR_FINAL: Readonly<Record<string, string>> = {
  ArrowUp: "A",
  ArrowDown: "B",
  ArrowRight: "C",
  ArrowLeft: "D",
  Home: "H",
  End: "F",
};

const TILDE_CODE: Readonly<Record<string, number>> = {
  Insert: 2,
  Delete: 3,
  PageUp: 5,
  PageDown: 6,
  F5: 15,
  F6: 17,
  F7: 18,
  F8: 19,
  F9: 20,
  F10: 21,
  F11: 23,
  F12: 24,
};

const SS3_FINAL: Readonly<Record<string, string>> = { F1: "P", F2: "Q", F3: "R", F4: "S" };

/** Ctrl + 标点 的传统控制字符。 */
const CTRL_PUNCT: Readonly<Record<string, string>> = {
  "@": "\x00",
  "[": "\x1b",
  "\\": "\x1c",
  "]": "\x1d",
  "^": "\x1e",
  _: "\x1f",
  "/": "\x1f",
  "?": "\x7f",
  "2": "\x00",
  "3": "\x1b",
  "4": "\x1c",
  "5": "\x1d",
  "6": "\x1e",
  "7": "\x1f",
  "8": "\x7f",
};

function csiU(codePoint: number, mod: number): string {
  return `${ESC}[${codePoint};${mod}u`;
}

/** 按键对应的"基础字符"：key 是可打印 ASCII 就用它（保持布局原样）；Mac 的 Option、死键让 key 变成别的字符时按物理键取。 */
function baseChar(e: KeyEventLike): string | null {
  if (/^[\x20-\x7e]$/.test(e.key)) return e.key;
  // Mac 的 Option、死键会让 key 变成别的字符（Alt+P → π）：按物理键取。
  const code = e.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return e.shiftKey ? letter[1] : letter[1].toLowerCase();
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit?.[1] && !e.shiftKey) return digit[1];
  return [...e.key].length === 1 ? e.key : null;
}

function isLetter(ch: string): boolean {
  return /^[a-zA-Z]$/.test(ch);
}

/** 这个事件是不是输入法在用（组合中、或 Process 事件）。 */
export function isComposingKey(e: Pick<KeyEventLike, "isComposing" | "keyCode" | "key">): boolean {
  return e.isComposing === true || e.keyCode === 229 || e.key === "Process";
}

/**
 * 编码一个 keydown。返回 null = 不该写进终端：输入法组合期间、单独的修饰键、Cmd/Win 组合（留给系统和应用）、
 * 没有对应序列的键。
 */
export function encodeKey(e: KeyEventLike): string | null {
  if (isComposingKey(e)) return null;
  if (e.metaKey) return null;
  const { key } = e;
  // AltGr 产生的字符（欧洲键盘的 @ { } 等）就是普通字符。
  const altGr = e.altGraph === true && e.ctrlKey && e.altKey;
  const ctrl = e.ctrlKey && !altGr;
  const alt = e.altKey && !altGr;
  const shift = e.shiftKey;
  const mod = modifierParam({ shiftKey: shift, altKey: alt, ctrlKey: ctrl });
  const hasMod = mod !== 1;

  switch (key) {
    case "Enter":
      if (!ctrl && !shift) return alt ? `${ESC}\r` : "\r";
      return csiU(13, mod);
    case "Escape":
      return alt ? `${ESC}${ESC}` : ESC;
    case "Tab":
      if (!ctrl && !alt) return shift ? `${ESC}[Z` : "\t";
      return csiU(9, mod);
    case "Backspace":
      if (ctrl && alt) return `${ESC}\b`;
      if (ctrl) return "\b";
      return alt ? `${ESC}\x7f` : "\x7f";
    case " ":
      if (ctrl) return alt ? `${ESC}\x00` : "\x00";
      return alt ? `${ESC} ` : " ";
    default:
      break;
  }

  const cursorFinal = CURSOR_FINAL[key];
  if (cursorFinal !== undefined) return hasMod ? `${ESC}[1;${mod}${cursorFinal}` : `${ESC}[${cursorFinal}`;
  const tilde = TILDE_CODE[key];
  if (tilde !== undefined) return hasMod ? `${ESC}[${tilde};${mod}~` : `${ESC}[${tilde}~`;
  const ss3 = SS3_FINAL[key];
  if (ss3 !== undefined) return hasMod ? `${ESC}[1;${mod}${ss3}` : `${ESC}O${ss3}`;

  if (altGr) return [...key].length === 1 ? key : null;
  const ch = baseChar(e);
  if (ch === null) return null;

  if (ctrl) {
    if (isLetter(ch)) {
      const control = String.fromCharCode(ch.toLowerCase().charCodeAt(0) - 96);
      // Ctrl+Shift+字母 传统序列和 Ctrl+字母 相同，区分不了，用 CSI u。
      if (shift) return csiU(ch.toLowerCase().charCodeAt(0), mod);
      return alt ? `${ESC}${control}` : control;
    }
    const punct = CTRL_PUNCT[ch];
    if (punct !== undefined && !shift) return alt ? `${ESC}${punct}` : punct;
    const cp = ch.codePointAt(0);
    return cp === undefined ? null : csiU(cp, mod);
  }
  if (alt) return `${ESC}${ch}`;
  return ch;
}

/** 粘贴：bracketed paste，omp 按一次粘贴处理（长文本折叠、不把换行当 Enter）。 */
export function encodePaste(text: string): string {
  return `${ESC}[200~${text}${ESC}[201~`;
}

/**
 * 输入框里 Tern 自己处理（不写进伪终端）的编辑类按键，规范 protocol-input.md「Native editing」。
 * `hasSelection`：Tern 当前有非空选区；`empty`：输入框没有文字；`overlayAtCaret`：有锚在这个输入框光标上的 overlay。
 * `firstLine` / `lastLine`：光标在画出来的第一行 / 最后一行（软换行只有这边知道，由调用方量）。
 *
 * - "pty"：照常编码写进伪终端；
 * - "select"：浏览器原生移动 / 扩展选区（Shift+方向键、Ctrl+Shift+←/→/Home/End、拖选），不发事件；
 * - "move"：原生移动光标，随后作为一个 `edit` 事件（from == to）告诉 omp；
 * - "selectAll"：全选；"copy"：本地复制选区；"cut"：复制并发 edit 删除；
 * - "replace"：删除 / 输入 / 粘贴等替换选区，发 edit；
 * - "undo"：发 `undo` 事件。
 */
export type EditorKeyRoute = "pty" | "select" | "move" | "selectAll" | "copy" | "cut" | "replace" | "undo";

export interface EditorKeyState {
  hasSelection: boolean;
  empty: boolean;
  overlayAtCaret: boolean;
  firstLine: boolean;
  lastLine: boolean;
}

export function routeEditorKey(e: KeyEventLike, s: EditorKeyState): EditorKeyRoute {
  if (isComposingKey(e)) return "pty";
  // 空输入框没有可选的东西：除撤销外全部归 omp。
  const key = e.key;
  const lower = key.toLowerCase();
  const ctrlOnly = e.ctrlKey && !e.altKey && !e.metaKey;
  if (ctrlOnly && !e.shiftKey && lower === "z") return "undo";
  if (s.empty) return "pty";
  if (e.metaKey || e.altKey) return "pty";

  if (ctrlOnly && !e.shiftKey) {
    if (lower === "a") return "selectAll";
    if (lower === "c" && s.hasSelection) return "copy";
    if (lower === "x" && s.hasSelection) return "cut";
    if (s.hasSelection && (key === "Backspace" || key === "Delete")) return "replace";
  }

  const arrow = key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
  const homeEnd = key === "Home" || key === "End";
  if (e.shiftKey && (arrow || homeEnd)) {
    // Shift（+Ctrl 按词 / 按文本首尾）扩展选区；Shift+PageUp 等不在此列。
    return "select";
  }
  if (e.ctrlKey && (arrow || homeEnd)) {
    // Ctrl+←/→ 按词、Ctrl+Home/End 文本首尾：有选区时折叠选区（原生），没有时是 omp 自己的键。
    return s.hasSelection ? "move" : "pty";
  }
  if (!e.ctrlKey && !e.shiftKey) {
    if (key === "ArrowLeft" || key === "ArrowRight") return s.hasSelection ? "move" : "pty";
    if (key === "ArrowUp") {
      if (s.overlayAtCaret) return "pty";
      return s.firstLine && !s.hasSelection ? "pty" : "move";
    }
    if (key === "ArrowDown") {
      if (s.overlayAtCaret) return "pty";
      return s.lastLine && !s.hasSelection ? "pty" : "move";
    }
    if (homeEnd) return "move";
  }

  if (s.hasSelection) {
    if (!e.ctrlKey && (key === "Backspace" || key === "Delete")) return "replace";
    if (!e.ctrlKey && [...key].length === 1) return "replace";
    if (key === "Enter" && e.shiftKey && !e.ctrlKey) return "replace";
  }
  return "pty";
}

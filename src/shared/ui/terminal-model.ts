// 终端面板的纯逻辑（可单测，不碰 DOM）：高度夹取、输入分块、cwd 显示、从设计 token 推出 xterm 的配色。
import { limits } from "../ipc.ts";

const terminalMinHeight = limits.terminalHeightRange[0];
/** 面板最高占主区的比例（spec：最小 120px，最大 70%）。 */
const terminalMaxFraction = 0.7;
export const defaultTerminalHeight = 280;

/** containerHeight 是主区面板的高度；它太矮时最小值优先（宁可挤占对话区，也不让终端小到不能用）。 */
export function clampTerminalHeight(height: number, containerHeight: number): number {
  const max = Math.max(terminalMinHeight, Math.floor(containerHeight * terminalMaxFraction));
  return Math.round(Math.min(max, Math.max(terminalMinHeight, height)));
}

/** 把一次输入切成不超过 max 个字符的段，不把代理对（emoji 等）从中间切开。 */
export function chunkInput(data: string, max: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = Math.min(data.length, start + max);
    if (end < data.length) {
      const last = data.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

/** 面板头里显示的目录：最后一段（盘符根目录等没有最后一段时用整串）。 */
export function cwdLabel(cwd: string): string {
  const segments = cwd.split(/[\\/]+/).filter(Boolean);
  return segments.at(-1) ?? cwd;
}

// ───────── xterm 配色 ─────────

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 认 `#rgb` `#rrggbb` `rgb()` `rgba()`（getComputedStyle 的 color 输出）；其他写法返回 null。 */
export function parseColor(text: string): Rgba | null {
  const value = text.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(value);
  if (!fn) return null;
  const alpha =
    fn[4] === undefined ? 1 : fn[4].endsWith("%") ? Number.parseFloat(fn[4]) / 100 : Number.parseFloat(fn[4]);
  return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: alpha };
}

function formatColor(color: Rgba): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value)));
  const rgb = `${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}`;
  return color.a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${Math.round(color.a * 1000) / 1000})`;
}

/** 从 from 朝 to 走 amount（0–1）。 */
function mixColor(from: Rgba, to: Rgba, amount: number): Rgba {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
    a: 1,
  };
}

/** 相对亮度（WCAG），0 黑 1 白。 */
export function luminance(color: Rgba): number {
  const linear = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** 配色用到的 token；调用方把它们解析成颜色字符串传进来（见 TerminalPanel 的 readToken）。 */
const paletteTokens = [
  "--bg-sunken",
  "--text",
  "--text-2",
  "--text-3",
  "--accent",
  "--selection-bg",
  "--st-error",
  "--st-waiting-text",
  "--syn-string",
  "--syn-func",
  "--syn-keyword",
  "--syn-type",
] as const;

export type PaletteToken = (typeof paletteTokens)[number];

const fallback: Rgba = { r: 128, g: 128, b: 128, a: 1 };

/**
 * ANSI 色板从语义 token 推：红 = 错误、绿 = 字符串、黄 = 等待、蓝 = 函数、品红 = 关键字、青 = 类型，
 * 这些 token 在浅色和深色下各自都满足对比度；"亮"色是朝正文色再走一段。黑/白两端随主题翻转，保证在底色上看得见。
 */
export function buildTerminalPalette(read: (token: PaletteToken) => string): TerminalPalette {
  const color = (token: PaletteToken) => parseColor(read(token)) ?? fallback;
  const background = color("--bg-sunken");
  const text = color("--text");
  const dark = luminance(background) < 0.4;
  const brighten = (base: Rgba) => mixColor(base, text, dark ? 0.28 : 0.18);
  const hues = {
    red: color("--st-error"),
    green: color("--syn-string"),
    yellow: color("--st-waiting-text"),
    blue: color("--syn-func"),
    magenta: color("--syn-keyword"),
    cyan: color("--syn-type"),
  };
  const black = dark ? mixColor(background, text, 0.2) : text;
  const white = dark ? color("--text-2") : color("--text-3");
  return {
    background: formatColor(background),
    foreground: formatColor(text),
    cursor: formatColor(color("--accent")),
    cursorAccent: formatColor(background),
    selectionBackground: formatColor(color("--selection-bg")),
    black: formatColor(black),
    red: formatColor(hues.red),
    green: formatColor(hues.green),
    yellow: formatColor(hues.yellow),
    blue: formatColor(hues.blue),
    magenta: formatColor(hues.magenta),
    cyan: formatColor(hues.cyan),
    white: formatColor(white),
    brightBlack: formatColor(color("--text-3")),
    brightRed: formatColor(brighten(hues.red)),
    brightGreen: formatColor(brighten(hues.green)),
    brightYellow: formatColor(brighten(hues.yellow)),
    brightBlue: formatColor(brighten(hues.blue)),
    brightMagenta: formatColor(brighten(hues.magenta)),
    brightCyan: formatColor(brighten(hues.cyan)),
    brightWhite: formatColor(text),
  };
}

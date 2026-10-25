// 应用快捷键的"主修饰键"和显示文字，按平台分支：Windows / Linux 是 Ctrl，mac 是 Cmd（⌘）。
// 只管 studio 自己的应用快捷键；发给 omp / 终端的真 Ctrl 键（features/tsp/keys.ts、shared/tsp/forward-keys.ts、终端里的 Ctrl+C）不走这里。
// 平台来自 AppInfo.platform（useAppInfo / currentPlatform），还没载入时按 win32。mac 分支没有在 mac 上实测（推测），单测和 e2e 靠传入 platform / stub getAppInfo 覆盖。
import type { AppInfo } from "../../../shared/ipc.ts";
import { currentPlatform, useAppInfo } from "../store/index.ts";

export type Platform = AppInfo["platform"];

export function usePlatform(): Platform {
  return useAppInfo()?.platform ?? "win32";
}

interface ModifierState {
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * 应用快捷键的主修饰键是否按下（且另一个没按）：mac 是 Cmd（不含 Ctrl），其他平台是 Ctrl（不含 Win 键）。
 * Alt / Shift 由调用方自己判。
 */
export function primaryMod(event: ModifierState, platform: Platform = currentPlatform()): boolean {
  return platform === "darwin" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/**
 * mac 上 Option+字母产生的是特殊字符（Option+M = µ），`event.key` 认不出字母：Alt 加字母的快捷键按物理键位 `event.code` 认。
 * `letter` 小写单个字母。其他平台 `event.key` 和 `event.code` 在常见布局上一致，但仍保持原来按 `key` 的行为。
 */
export function isLetterKey(
  event: { key: string; code: string },
  letter: string,
  platform: Platform = currentPlatform(),
): boolean {
  if (platform === "darwin") return event.code === `Key${letter.toUpperCase()}`;
  return event.key.toLowerCase() === letter;
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  Ctrl: "⌘",
  Shift: "⇧",
  Alt: "⌥",
  Enter: "↩",
};

/**
 * 把 Windows 写法的快捷键（"Ctrl Shift N"、"Alt T"、"Ctrl `"、"Ctrl Shift [ / ]"）拆成键帽列表：
 * Windows / Linux 原样（["Ctrl", "Shift", "N"]）；mac 换符号并按 mac 惯例各自成键（["⌘", "⇧", "N"]）。
 * 源文字里的 "Ctrl" 一律指"应用主修饰键"，所以 mac 上是 ⌘。前导修饰键之后的部分整体作为主键（"[ / ]" 里有空格）。
 */
export function shortcutKeys(windowsText: string, platform: Platform = currentPlatform()): string[] {
  const parts = windowsText.trim().split(/\s+/);
  const mods: string[] = [];
  while (parts.length > 1 && (parts[0] === "Ctrl" || parts[0] === "Shift" || parts[0] === "Alt"))
    mods.push(parts.shift()!);
  const key = parts.join(" ");
  if (platform !== "darwin") return [...mods, key];
  return [...mods.map((mod) => MAC_SYMBOLS[mod]!), MAC_SYMBOLS[key] ?? key];
}

/** 显示用的单个字符串：Windows `Ctrl Shift N`；mac `⌘⇧N`（无分隔，mac 惯例）。 */
export function shortcutLabel(windowsText: string, platform: Platform = currentPlatform()): string {
  const keys = shortcutKeys(windowsText, platform);
  return platform === "darwin" ? keys.join("") : keys.join(" ");
}

/** 悬停提示：`文字 (快捷键)`，末尾的快捷键由 Tooltip 的 splitShortcut 拆出来画成键帽。 */
export function withShortcut(text: string, windowsShortcut: string, platform: Platform = currentPlatform()): string {
  return `${text} (${shortcutLabel(windowsShortcut, platform)})`;
}

/** 文案（i18n）里写死的 "Ctrl+Enter" 换成当前平台的写法；mac 上 `⌘↩`。 */
export function localizeKeys(text: string, platform: Platform = currentPlatform()): string {
  return platform === "darwin" ? text.replaceAll("Ctrl+Enter", "⌘↩") : text;
}

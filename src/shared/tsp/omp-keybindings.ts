// omp 的键位 → "转发给 omp 的键"：默认键位（omp 18.12.6 的 `app.*` defaultKeys）加用户在 `<agent 目录>/keybindings.yml` 里的覆盖。
// 纯函数，主进程读文件后调它，结果经 IPC 给渲染进程（转发判定在 forward-keys.ts，设置页的快捷键表也用这份）。
// 只管 studio 的输入框收不到、值得转发的那几个全局动作；studio 自己占用的键（STUDIO_RESERVED）永远赢，不在结果里。
// omp 的规则（packages/tui/src/app-keybindings.ts）：文件是 `动作 ID: 键 | [键…]` 的映射，键不区分大小写，写法同界面上显示的（`Ctrl+P`、
// `Alt+Shift+P`）；覆盖是整个动作换掉（不是追加）；`[]` 表示禁用；值不是字符串 / 字符串数组的条目被忽略（回到默认）；
// 旧版不带命名空间的动作名（`cycleThinkingLevel`…）加载时迁移成新名。
import { chordFromKbd, STUDIO_RESERVED } from "./forward-keys.ts";

/** 一个会转发给 omp 的动作和它当前的键（规范写法 `ctrl+alt+shift+键`，已去掉 studio 占用的和不适合转发的）。 */
export interface OmpKeybinding {
  /** omp 的动作 ID（`app.thinking.cycle`）。 */
  action: string;
  chords: string[];
}

interface ActionDef {
  action: string;
  /** omp 迁移用的旧名字。 */
  legacy: string;
  defaults: readonly string[];
}

/**
 * 转发给 omp 的动作及其默认键（omp 18.12.6）。
 * `app.message.dequeue` 的默认还有 Shift+Up：不带 Ctrl / Alt，输入框里是选中文字，所以不会出现在结果里。
 */
const ACTIONS: readonly ActionDef[] = [
  { action: "app.thinking.cycle", legacy: "cycleThinkingLevel", defaults: ["shift+tab"] },
  { action: "app.thinking.toggle", legacy: "toggleThinking", defaults: ["ctrl+t"] },
  { action: "app.model.cycleForward", legacy: "cycleModelForward", defaults: ["ctrl+p"] },
  { action: "app.model.cycleBackward", legacy: "cycleModelBackward", defaults: ["shift+ctrl+p"] },
  { action: "app.model.selectTemporary", legacy: "selectModelTemporary", defaults: ["alt+p"] },
  { action: "app.plan.toggle", legacy: "togglePlanMode", defaults: ["alt+shift+p"] },
  { action: "app.history.search", legacy: "historySearch", defaults: ["ctrl+r"] },
  { action: "app.retry", legacy: "retry", defaults: ["f5", "alt+r"] },
  { action: "app.message.dequeue", legacy: "dequeue", defaults: ["alt+up", "shift+up"] },
];

/** 转发的动作 ID（设置页的快捷键表按它找文字）。 */
export const OMP_FORWARDED_ACTIONS: readonly string[] = ACTIONS.map((def) => def.action);

/** 键只有这些才值得转发：带 Ctrl / Alt 的、功能键、Shift+Tab；单个字符、Shift+方向键这类输入框要用。 */
function isForwardable(chord: string): boolean {
  const parts = chord.split("+");
  if (parts.includes("ctrl") || parts.includes("alt")) return true;
  return chord === "shift+tab" || /^f\d{1,2}$/.test(parts[parts.length - 1]!);
}

/** omp 的 B4a：只收字符串和全是字符串的数组，其余条目当没写。 */
function validKeys(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value as string[];
  return null;
}

/** 用户文件（解析后的 YAML / JSON 值）里这个动作的覆盖；没有、或形状不对时 null。 */
function overrideOf(user: Record<string, unknown>, def: ActionDef): string[] | null {
  // 先旧名再新名：同时写了，新名赢（omp 迁移时按文件顺序覆盖，这里取确定的顺序）。
  return validKeys(user[def.action]) ?? validKeys(user[def.legacy]);
}

/**
 * 默认键位加用户覆盖，算出转发给 omp 的键。`user` 是 keybindings 文件解析后的值（null = 没有文件）。
 * 没有可转发键的动作（被禁用、都被 studio 占用）不在结果里。
 */
export function resolveOmpKeybindings(user: unknown): OmpKeybinding[] {
  const record =
    typeof user === "object" && user !== null && !Array.isArray(user) ? (user as Record<string, unknown>) : {};
  const out: OmpKeybinding[] = [];
  for (const def of ACTIONS) {
    const keys = overrideOf(record, def) ?? def.defaults;
    const chords = [
      ...new Set(
        keys.flatMap((key) => {
          const chord = chordFromKbd([key]);
          return chord !== null && isForwardable(chord) && !STUDIO_RESERVED.has(chord) ? [chord] : [];
        }),
      ),
    ];
    if (chords.length > 0) out.push({ action: def.action, chords });
  }
  return out;
}

/** 所有要转发的键（规范写法）。 */
export function forwardedChords(bindings: readonly OmpKeybinding[]): ReadonlySet<string> {
  return new Set(bindings.flatMap((binding) => binding.chords));
}

const KEY_CAPS: Readonly<Record<string, string>> = {
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  escape: "Esc",
};

/** 规范写法 `ctrl+shift+p` → 键帽文字 `["Ctrl", "Shift", "P"]`（设置页的快捷键表用，和那里其它行的写法一致）。 */
export function chordKeys(chord: string): string[] {
  return chord
    .split("+")
    .map((part) => KEY_CAPS[part] ?? (part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)));
}

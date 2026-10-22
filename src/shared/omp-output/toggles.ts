// 会话开关（/skillful /extended-context /computer /advisor /browser /prewalk，以及 /fast /slow）的 omp 状态 toast 解析。
// omp 18.12.5 在 TSP 里用 `omp.toast.status` 报告这些命令的结果；rpc-ui 用 `command_output` 给出同样的文字。文字格式不是 omp 的契约：
// 认不出的文字返回 null（调用方原样显示 omp 的原文，不吞）。
//
// 实测原文（omp 18.12.5，fixtures/tsp/status-toggles.jsonl 与 native-ui-plan §2.1/§2.2）：
//   /skillful            → "Skill listing disabled for this session."（不带参数是切换）
//   /skillful status     → "Skill listing: on."；rpc-ui："Skill listing: on (session override; default from the skillful setting)."
//   /extended-context    → "Extended context enabled."；status → "Extended context is off."
//   /computer            → "Computer use enabled for this session. Computer use: enabled · prelude: active · configured: …"
//   /computer status     → "Computer use: disabled · prelude: inactive · configured: display=active, …"
//   /advisor             → "Advisor enabled."；rpc-ui /advisor status → "Advisor is disabled."
//   /browser             → "Browser mode: visible"；/browser status → "Usage: /browser [headless|visible]"（不是状态）
//   /prewalk             → "prewalk: Prewalk: target … already matches …"；/prewalk status → "Usage: /prewalk [restart|off]"
//   /fast status → "Fast mode is off."；/slow status → "Slow mode is off."；/fast on|off → "Fast mode enabled" / "Fast mode disabled"；
//   /slow on|off → "Slow mode on: …" / "Slow mode off: …"（task-speed-modes 沿用的原文）
//   不支持的模型：/fast → "priority: The current model has no service-tier control for /fast to toggle."（不是状态，返回 null）
// 没有实测、按对称文字推断的写法（disabled / off 的另一半）在下面的正则里用同一个动词表，omp 改措辞时只会退回"认不出"。
import type { TOGGLE_NAMES } from "./index.ts";

export type ToggleName = (typeof TOGGLE_NAMES)[number];
export type BrowserMode = "visible" | "headless";

/** 一条 toast 读出来的开关状态。prewalk 没有开/关状态，只有 omp 的最后一句话。 */
export type ToggleObservation =
  { name: ToggleName; on: boolean } | { name: "browser"; mode: BrowserMode } | { name: "prewalk"; message: string };

/**
 * 本会话里被 `/命令` 改过（或查询过）的值。null = 本会话没动过，生效的是配置默认值（界面用 `omp config list` 的值补）。
 * fast / slow 不在这里：它们已有 `TaskState.fastMode` / `slowMode`。
 */
export interface SessionToggles {
  skillful: boolean | null;
  extendedContext: boolean | null;
  computer: boolean | null;
  advisor: boolean | null;
  browser: BrowserMode | null;
  /** omp 对最近一次 `/prewalk` 的回话原文（"prewalk: " 前缀已去掉）；没发过为 null。 */
  prewalk: string | null;
}

export function emptySessionToggles(): SessionToggles {
  return { skillful: null, extendedContext: null, computer: null, advisor: null, browser: null, prewalk: null };
}

/**
 * omp 直接写进全局 config.yml 的开关（实测 omp 18.12.6：`/extended-context on` 写 `extendedContext: true`，
 * `/browser headless` 写 `browser.headless: true`，重开会话、新任务都沿用）。其余（skillful / computer / advisor）只对本会话生效，
 * 重开会话后回到配置默认值。见 docs/architecture/session-toggles.md。
 */
export const SAVED_TO_CONFIG: ReadonlySet<ToggleName | "browser"> = new Set(["extendedContext", "browser"]);

/** 每个开关的状态句式：`word` 捕获开/关词。 */
const ENABLE_WORDS = "enabled|disabled|on|off";
const patterns: readonly { name: ToggleName; pattern: RegExp }[] = [
  // "Skill listing disabled for this session." / "Skill listing: on." / "Skill listing: on (session override; …)."
  { name: "skillful", pattern: new RegExp(`^Skill listing:? (${ENABLE_WORDS})\\b`, "i") },
  // "Extended context enabled." / "Extended context is off."
  { name: "extendedContext", pattern: new RegExp(`^Extended context (?:is )?(${ENABLE_WORDS})\\b`, "i") },
  // "Computer use enabled for this session. …" / "Computer use: disabled · prelude: …"
  { name: "computer", pattern: new RegExp(`^Computer use:? (${ENABLE_WORDS})\\b`, "i") },
  // "Advisor enabled." / "Advisor is disabled."
  { name: "advisor", pattern: new RegExp(`^Advisor (?:is )?(${ENABLE_WORDS})\\b`, "i") },
  // "Fast mode enabled" / "Fast mode is off."
  { name: "fast", pattern: new RegExp(`^Fast mode (?:is )?(${ENABLE_WORDS})\\b`, "i") },
  // "Slow mode on: …" / "Slow mode is off."
  { name: "slow", pattern: new RegExp(`^Slow mode (?:is )?(${ENABLE_WORDS})\\b`, "i") },
];

const browserPattern = /^Browser mode: (visible|headless)\b/i;
const prewalkPattern = /^prewalk:\s*(.+)$/is;

const isOn = (word: string): boolean => {
  const lower = word.toLowerCase();
  return lower === "enabled" || lower === "on";
};

/** 解析一条 omp 状态文字；不是开关的状态（用法提示、不支持的模型、别的命令）返回 null。 */
export function parseToggleToast(text: string): ToggleObservation | null {
  const trimmed = text.trim();
  for (const entry of patterns) {
    const hit = entry.pattern.exec(trimmed);
    if (hit?.[1] !== undefined) return { name: entry.name, on: isOn(hit[1]) };
  }
  const browser = browserPattern.exec(trimmed);
  if (browser?.[1] !== undefined) return { name: "browser", mode: browser[1].toLowerCase() as BrowserMode };
  const prewalk = prewalkPattern.exec(trimmed);
  if (prewalk?.[1] !== undefined) return { name: "prewalk", message: prewalk[1].trim() };
  return null;
}

/**
 * 文档里的状态 toast 文字列表（statusToastTexts，节点按到达顺序、不会自己消失）相对上一次新出现的那些：
 * 多出来的尾部，加上同一个位置上文字变了的（omp 复用节点改文字）。删除节点造成的错位只会把旧句子再读一遍，
 * 按文档顺序依次合并，结果仍是每个开关最后一次的值。
 */
export function freshToasts(previous: readonly string[], current: readonly string[]): string[] {
  return current.filter((text, index) => index >= previous.length || previous[index] !== text);
}

/** 把一条观察合进开关状态（fast / slow 不在这里，原样返回）；值没变时返回同一个对象。 */
export function applyToggleObservation(state: SessionToggles, observation: ToggleObservation): SessionToggles {
  switch (observation.name) {
    case "skillful":
    case "extendedContext":
    case "computer":
    case "advisor":
      return state[observation.name] === observation.on ? state : { ...state, [observation.name]: observation.on };
    case "browser":
      return state.browser === observation.mode ? state : { ...state, browser: observation.mode };
    case "prewalk":
      return state.prewalk === observation.message ? state : { ...state, prewalk: observation.message };
    case "fast":
    case "slow":
      return state;
  }
}

/**
 * 配置项（`omp config list --json`）→ 每个开关的默认值，用来给"本会话没动过"的开关补值，以及判断"和默认不同"的小圆点。
 * `values` 取 key → 生效值；读不到的项为 null（界面不画点）。
 */
export interface ToggleDefaults {
  skillful: boolean | null;
  extendedContext: boolean | null;
  computer: boolean | null;
  advisor: boolean | null;
  /** `browser.headless`：true = 后台。 */
  browser: BrowserMode | null;
  /** `prewalk.enabled`。 */
  prewalk: boolean | null;
}

export const TOGGLE_CONFIG_KEYS = {
  skillful: "skillful",
  extendedContext: "extendedContext",
  computer: "computer.enabled",
  advisor: "advisor.enabled",
  browserHeadless: "browser.headless",
  prewalk: "prewalk.enabled",
} as const;

export function toggleDefaults(read: (key: string) => unknown): ToggleDefaults {
  const flag = (key: string): boolean | null => {
    const value = read(key);
    return typeof value === "boolean" ? value : null;
  };
  const headless = flag(TOGGLE_CONFIG_KEYS.browserHeadless);
  return {
    skillful: flag(TOGGLE_CONFIG_KEYS.skillful),
    extendedContext: flag(TOGGLE_CONFIG_KEYS.extendedContext),
    computer: flag(TOGGLE_CONFIG_KEYS.computer),
    advisor: flag(TOGGLE_CONFIG_KEYS.advisor),
    browser: headless === null ? null : headless ? "headless" : "visible",
    prewalk: flag(TOGGLE_CONFIG_KEYS.prewalk),
  };
}

/** 一行开关在菜单里的显示：生效值（会话值优先，其次默认值）、是不是本会话改过、是否和默认不同。 */
export interface ToggleView<T> {
  value: T | null;
  /** 本会话里改过或查询过（值来自 omp 的 toast，不是配置默认值）。 */
  session: boolean;
  /** 会话值和配置默认值都有且不同：菜单画一个小圆点。 */
  differs: boolean;
}

export function toggleView<T>(session: T | null, fallback: T | null): ToggleView<T> {
  return {
    value: session ?? fallback,
    session: session !== null,
    differs: session !== null && fallback !== null && session !== fallback,
  };
}

// ───────── 模型预设（配置项 modelPresets：名字 → { modelRoles, defaultThinkingLevel }）─────────

export interface ModelPresetSummary {
  name: string;
  /** `modelRoles.default` 原文（可能带 `:high` 之类后缀）；没有时为 null。 */
  model: string | null;
  thinkingLevel: string | null;
}

/** 读配置里的 `modelPresets`（record）；形状不对的项跳过，整体不是 record 时为空数组。 */
export function listModelPresets(value: unknown): ModelPresetSummary[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const presets: ModelPresetSummary[] = [];
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const roles = record["modelRoles"];
    const model =
      typeof roles === "object" && roles !== null && typeof (roles as Record<string, unknown>)["default"] === "string"
        ? ((roles as Record<string, string>)["default"] ?? null)
        : null;
    const thinking = record["defaultThinkingLevel"];
    presets.push({ name, model, thinkingLevel: typeof thinking === "string" ? thinking : null });
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name));
}

/** 新预设名能不能交给 `/modelpreset save`（和 omp-output/index.ts 的 PRESET_NEW 同一规则：字母开头，之后字母数字 _ -）。 */
export function presetNameUsable(name: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(name);
}

/** 已有预设能不能经 `/modelpreset switch|delete` 引用（和 omp-output/index.ts 的 PRESET_REF 同一规则）。omp 18.12.5 实测：参数按空白切开再用单个空格拼回，`my preset` 能切换；连续空格、首尾空白、控制字符的名字找不到。 */
export function presetRefUsable(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.length <= 200 && /^[^\s\u0000-\u001f\u007f]+(?: [^\s\u0000-\u001f\u007f]+)*$/.test(name);
}

// 数字格式（纯函数）：elapsed 的 short / seconds / clock、rate、紧凑计数和费用。过程区、输入框状态行、子代理面板共用。

const pad2 = (n: number): string => String(n).padStart(2, "0");

export type ElapsedFormat = "short" | "seconds" | "clock";

/**
 * 已用时间（规范 Motion/elapsed）：负数按 0，都向下取整（不会跑到真实时间前面）。
 * short：不到 1 分钟带十分位 12.3s，之后 4m 05s、1h 02m；seconds：同 short，但不到 1 分钟只到整秒 12s（按秒刷新的地方）；
 * clock：0:12、4:05、1:02:03。
 */
export function formatElapsed(ms: number, format: ElapsedFormat = "short"): string {
  const total = Math.max(0, ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  if (format === "clock") {
    if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    return `${minutes}:${pad2(seconds)}`;
  }
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad2(seconds)}s`;
  if (format === "seconds") return `${seconds}s`;
  return `${(Math.floor(total / 100) / 10).toFixed(1)}s`;
}

/** formatElapsed 的文字最少隔多久变一次（ms）：计时按它取整，文字没变就不重画。按绝对值算（倒计时显示 -ms）。 */
export function elapsedStep(ms: number, format: ElapsedFormat = "short"): number {
  const total = Math.abs(ms);
  if (format !== "clock" && total >= 3_600_000) return 60_000;
  if (format === "short" && total < 60_000) return 100;
  return 1000;
}

/** rate：一位小数，100 以上取整；有单位时空一格接在后面。 */
export function formatRate(value: number, unit?: string): string {
  const text = Math.abs(value) < 100 ? value.toFixed(1) : String(Math.round(value));
  return unit ? `${text} ${unit}` : text;
}

/** 紧凑计数：999、12K、1.2M。 */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

function trim(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}

/** 费用：$0.42，不到一美分写 <$0.01，正好 0 写 $0。 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** 0–1（或大于 1 的百分数）归一成 0–1。 */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * extent（"40ch" / "10lines" / 数字）转 CSS；不认识的返回 undefined。
 * 数字：规范里是 0–1 的比例；大于 1 的不可能是比例（omp 的 find 发 `max:{w:40}`），按单位数算——宽 `w` 是字符数，高 `h` 是行数。
 */
export function extentToCss(extent: unknown, axis: "w" | "h" = "w"): string | undefined {
  if (typeof extent === "number") {
    if (!(extent > 0)) return undefined;
    if (extent <= 1) return `${extent * 100}%`;
    return `calc(${extent} * var(${axis === "w" ? "--tsp-cw" : "--tsp-lh"}))`;
  }
  if (typeof extent !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)(ch|lines)$/.exec(extent);
  if (!match) return undefined;
  return `calc(${match[1]} * var(${match[2] === "ch" ? "--tsp-cw" : "--tsp-lh"}))`;
}

const KEYCAPS: Record<string, string> = {
  ctrl: "⌃",
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  opt: "⌥",
  shift: "⇧",
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  super: "⌘",
  win: "⌘",
  enter: "⏎",
  return: "⏎",
  esc: "esc",
  escape: "esc",
  tab: "⇥",
  backspace: "⌫",
  delete: "⌦",
  del: "⌦",
  space: "␣",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "⇞",
  pagedown: "⇟",
  home: "↖",
  end: "↘",
};

/** 键名 → 键帽上的字（规范 Data/kbd 的表）：修饰键和命名键用符号，单个字符和 F1–F24 大写，其它原样。 */
export function keycapLabel(name: string): string {
  const key = name.toLowerCase();
  const named = KEYCAPS[key];
  if (named !== undefined) return named;
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  if ([...name].length === 1) return name.toUpperCase();
  return name;
}

const GATE_KEY_NAMES: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  shift: "Shift",
  cmd: "Win",
  command: "Win",
  meta: "Win",
  super: "Win",
  win: "Win",
  enter: "Enter",
  return: "Enter",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Del",
  del: "Del",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
};

/**
 * 门（提问 / 审批）和 omp 弹层里按钮的快捷键提示：Windows 上写键名（`Ctrl+Enter`、`Alt+H`、`Esc`），不用 mac 符号。
 * 过程区的 kbd 节点仍走 keycapLabel，不受影响。
 */
export function gateKeyHint(keys: readonly string[]): string {
  return keys
    .map((name) => {
      const key = name.toLowerCase();
      const named = GATE_KEY_NAMES[key];
      if (named !== undefined) return named;
      if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
      return [...name].length === 1 ? name.toUpperCase() : name;
    })
    .join("+");
}

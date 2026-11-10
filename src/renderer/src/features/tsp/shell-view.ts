// `shell` 节点（omp 18.17 起 bash 卡片的命令区，ShellVizPresentation）→ 要画的行（纯函数，单测直接用）。
// 规范：终端只画 omp 算好的行、转发控件事件，不自己解析 shell（tsp.generated.ts TspShellProps）。
// 规则照 omp 的 ANSI 渲染器 `tui/src/tools/shell-viz-render.ts`（v18.18.5）：
// - 每个 row 一行，按 depth 缩进；槽位：语句失败且失败不在片段上 → ×，运行中且有 active 片段 → ▶，被选中 → ›。
// - 运行中（presentation.running）不是 active 的片段淡化、skipped 的淡化，运行中的 active 片段加粗；不打成功勾。
// - 失败片段前的 × 对同一个 executionNode（没有就 node / 行的 node）只打一次。
// - meta 跟在行尾（行失败时错误色，否则淡色）；变量注释 `‹ name = "value" · … ›`，值被截断时加 …。
// - effects 图标在缩进后面，effects 图层关掉时不画；颜色图层关掉时只有 chip / badge / secret 还着色。
// 实测 omp 18.18.6：fixtures/tsp/shell-bash.jsonl（test/tsp-shell-view.test.ts 逐帧验证）。
import type {
  ShellVizEffect,
  ShellVizPresentation,
  ShellVizRow,
  ShellVizSegment,
  ShellVizWatch,
} from "../../../../shared/tsp/shell-viz.generated.ts";
import { isRecord } from "../../../../shared/type-guards.ts";

/** 片段的颜色类（omp ANSI 渲染器 color() 的顺序：先匹配到的为准）；null = 正文色。 */
export type ShellTone = "comment" | "kw" | "var" | "str" | "num" | "op" | "fn" | "accent";

export interface ShellPiece {
  text: string;
  /** omp 给的语义 token 原样（空格分隔），测试和 data 属性用。 */
  style: string;
  tone: ShellTone | null;
  /** chip / badge：画成小药丸。 */
  pill: boolean;
  dim: boolean;
  strong: boolean;
  /** 前面画一个失败标记 ×（同一个 executionNode 只打一次）。 */
  fail: boolean;
  /** 悬停提示：omp 的 tip，没有就是折叠块的原文。 */
  tip: string | null;
  /** 折叠块的节点（点了发 `expand:<node>`，omp 那边是开关）；不能展开为 null。 */
  expand: string | null;
}

export interface ShellEffect {
  glyph: string;
  /** `label: why`（启发式，不保证安全）。 */
  tip: string;
}

export interface ShellAnnotation {
  name: string;
  /** JSON 字符串形式的值（带引号），被截断时末尾加 …。 */
  value: string;
}

export interface ShellLine {
  id: string;
  depth: number;
  role: string | null;
  gutter: "fail" | "active" | "selected" | null;
  /** 运行中、这一行不在执行：槽位标记、effects、注释都淡化。 */
  muted: boolean;
  effects: ShellEffect[];
  pieces: ShellPiece[];
  meta: { text: string; fail: boolean } | null;
  annotations: ShellAnnotation[];
}

export interface ShellView {
  view: "raw" | "pseudo";
  message: string | null;
  lines: ShellLine[];
}

const TONE_ORDER: readonly [readonly string[], ShellTone][] = [
  [["comment"], "comment"],
  [["kw"], "kw"],
  [["var", "secret"], "var"],
  [["str", "path"], "str"],
  [["num"], "num"],
  [["op"], "op"],
  [["cmd", "fn"], "fn"],
  [["chip", "badge"], "accent"],
];

const SEMANTIC = new Set(["chip", "badge", "secret"]);

function tone(tokens: readonly string[]): ShellTone | null {
  for (const [names, value] of TONE_ORDER) if (names.some((name) => tokens.includes(name))) return value;
  return null;
}

/** 片段文字里不该有换行（行是物理行），有也压成空格，同 omp 的 shellVizText。 */
function oneLine(text: string): string {
  return text.replace(/[\r\n]/g, " ");
}

function segments(row: ShellVizRow): ShellVizSegment[] {
  return Array.isArray(row.segments)
    ? row.segments.filter((s): s is ShellVizSegment => isRecord(s) && typeof s.text === "string")
    : [];
}

function effects(row: ShellVizRow): ShellVizEffect[] {
  return Array.isArray(row.effects)
    ? row.effects.filter((e): e is ShellVizEffect => isRecord(e) && typeof e.glyph === "string")
    : [];
}

function annotations(row: ShellVizRow): ShellAnnotation[] {
  const list = Array.isArray(row.annotations) ? row.annotations : [];
  return list
    .filter((w): w is ShellVizWatch => isRecord(w) && typeof w.name === "string" && typeof w.value === "string")
    .map((w) => {
      // fullLength 是原值的 UTF-8 字节数；比发来的值长 = 被 omp 截断了。
      const cut = typeof w.fullLength === "number" && w.fullLength > new TextEncoder().encode(w.value).length;
      return { name: oneLine(w.name), value: `${oneLine(JSON.stringify(w.value))}${cut ? "…" : ""}` };
    });
}

function line(row: ShellVizRow, presentation: ShellVizPresentation): ShellLine {
  const prefs = presentation.preferences;
  const running = presentation.running === true;
  const segs = segments(row);
  const selected =
    prefs.selectedNode !== undefined &&
    (row.node === prefs.selectedNode || segs.some((s) => s.node === prefs.selectedNode));
  const failedInSegments = segs.some((s) => s.state === "fail");
  const failedStatement =
    row.state === "fail" && !failedInSegments && row.role !== "head" && row.role !== "mid" && row.role !== "tail";
  const gutter = failedStatement
    ? "fail"
    : running && segs.some((s) => s.active === true)
      ? "active"
      : selected
        ? "selected"
        : null;
  const failures = new Set<string>();
  const pieces = segs.map((segment): ShellPiece => {
    const execution = segment.executionNode ?? segment.node ?? row.node;
    const fail = segment.state === "fail" && execution !== undefined && !failures.has(execution);
    if (fail) failures.add(execution);
    const tokens = segment.style?.split(" ").filter(Boolean) ?? [];
    const colored = prefs.layers?.color !== false || tokens.some((token) => SEMANTIC.has(token));
    const inactive = (running && !(segment.active ?? row.active)) || (segment.state ?? row.state) === "skipped";
    const foldNode = typeof segment.expanded === "string" && typeof segment.node === "string" ? segment.node : null;
    return {
      text: oneLine(segment.text),
      style: tokens.join(" "),
      tone: colored ? tone(tokens) : null,
      pill: tokens.includes("chip") || tokens.includes("badge"),
      dim: inactive,
      strong: !inactive && segment.active === true && running,
      fail,
      tip: segment.tip ?? (foldNode !== null ? (segment.expanded ?? null) : null),
      expand: foldNode,
    };
  });
  return {
    id: row.id,
    depth: typeof row.depth === "number" && row.depth > 0 ? Math.floor(row.depth) : 0,
    role: row.role ?? null,
    gutter,
    muted: running && row.active !== true,
    effects:
      prefs.layers?.effects === false
        ? []
        : effects(row).map((e) => ({ glyph: oneLine(e.glyph), tip: `${e.label}: ${e.why}` })),
    pieces,
    meta:
      typeof row.meta === "string" && row.meta !== "" ? { text: oneLine(row.meta), fail: row.state === "fail" } : null,
    annotations: annotations(row),
  };
}

/** presentation 不是 omp 的形状（缺 preferences / rows）时为 null，组件不画命令区。 */
export function shellView(presentation: unknown): ShellView | null {
  if (!isRecord(presentation) || !isRecord(presentation.preferences) || !Array.isArray(presentation.rows)) return null;
  const p = presentation as unknown as ShellVizPresentation;
  return {
    view: p.preferences.view === "raw" ? "raw" : "pseudo",
    message: typeof p.message === "string" && p.message !== "" ? oneLine(p.message) : null,
    lines: p.rows
      .filter((row): row is ShellVizRow => isRecord(row) && typeof row.id === "string")
      .map((row) => line(row, p)),
  };
}

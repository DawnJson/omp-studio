// 输入框卡片上的上下文 meter（role `omp.composer.context`）里 omp 自己给的自动压缩信息。实测 omp 18.12.6（fixtures/tsp/task.jsonl、
// goal-budget.jsonl 的真实帧）+ 源码 `packages/tui/src/status-line/component.ts`（`#Nt`）：
// - `p.marks`：`{ at: 0.9, icon: "context.compaction", title: "Auto-compact at 90%" }`，`at` 是占窗口的比例；
//   omp 开着"压缩摘要预生成"（compaction.asyncEnabled）时再有 `{ at: 0.818, icon: "context.speculation", title: "Compaction summary starts at 82%" }`。
//   自动压缩关着（compaction.enabled = false）时没有 `marks`。阈值是 omp 算好的生效值：已经套了项目配置、按模型的 `modelThresholds`、
//   固定 token 数和"窗口减预留"，所以任务里直接用它，不用 studio 自己按 `omp config list` 的设置再算一遍（草稿页还没有 omp 进程才算，见 shared/compaction-trigger.ts）。
// - `p.title` 的行：`Auto-compact at 90%`；预生成摘要在跑时多一行 `Compaction summary in progress`，生成好待用时是 `Compaction summary ready`
//   （源码里 `compactionSpeculation` = running / armed；没有这行就是没在生成）。这两行没有在真机上触发过（要把上下文用到预生成起点），按源码写。
// role 和 icon 都是 omp 自己的命名，不在 TSP 规范里：判断集中在这里，omp 改名就失效。
import type { ContextCompaction } from "../ipc.ts";
import { isRecord } from "../type-guards.ts";
import { findNode, nodeRole, type TspDocument } from "./document.ts";
import { findComposerCard } from "./composer-state.ts";

const CONTEXT_ROLE = "omp.composer.context";
const AUTO_ICON = "context.compaction";
const SPECULATION_ICON = "context.speculation";

/** 比例 → 百分数，保留一位小数（0.818 → 81.8），夹在 0–100。 */
function percentOf(at: unknown): number | null {
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return Math.round(Math.min(1, Math.max(0, at)) * 1000) / 10;
}

/** meter 节点的属性 → 自动压缩信息；自动压缩关着（没有阈值）为 null。 */
export function parseContextCompaction(props: Readonly<Record<string, unknown>>): ContextCompaction | null {
  const marks = Array.isArray(props["marks"]) ? (props["marks"] as unknown[]).filter(isRecord) : [];
  const title = typeof props["title"] === "string" ? props["title"] : "";
  let autoAtPercent: number | null = null;
  let summaryStartsAtPercent: number | null = null;
  for (const mark of marks) {
    if (mark["icon"] === AUTO_ICON) autoAtPercent = percentOf(mark["at"]);
    else if (mark["icon"] === SPECULATION_ICON) summaryStartsAtPercent = percentOf(mark["at"]);
  }
  if (autoAtPercent === null) {
    // 没有 marks 时标题里的 "Auto-compact at 90%" 也行（整数）。
    const match = /^Auto-compact at (\d+(?:\.\d+)?)%$/m.exec(title);
    if (match) autoAtPercent = Number(match[1]);
  }
  if (autoAtPercent === null) return null;
  const lines = title.split("\n");
  const summary = lines.includes("Compaction summary in progress")
    ? "running"
    : lines.includes("Compaction summary ready")
      ? "ready"
      : null;
  return { autoAtPercent, summaryStartsAtPercent, summary };
}

/**
 * 文档里输入框卡片上的自动压缩信息；输入框不在文档里（提问 / 审批换掉了它）时为 `undefined`（调用方沿用上一次的值），
 * 在但 omp 没给阈值（自动压缩关着）时为 null。
 */
export function deriveContextCompaction(doc: TspDocument): ContextCompaction | null | undefined {
  const found = findComposerCard(doc);
  if (!found) return undefined;
  const meter = findNode(found.surface, (node) => nodeRole(node) === CONTEXT_ROLE, found.card.id);
  return meter ? parseContextCompaction(meter.p) : undefined;
}

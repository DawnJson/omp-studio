// 从 TSP 文档读 omp 输入框卡片（dock 里 role `omp.editor` 的 col）上的状态：模型名、思考强度、上下文用量、费用，
// 以及模型选择器（layer 里的 `picker`）。纯函数，主进程每次文档变化时调用。
//
// 依据是 omp 18.12.3 的实测录制（fixtures/tsp/{task,picker}.jsonl，test/tsp-composer-state.test.ts 逐帧验证）：
// - `omp.composer.context`（meter）：`p.value` 0..1，`p.total` 窗口（如 "1M"），`p.title` 如
//   "Context 1% used\n8.7K of 1M tokens\nAuto-compact at 90%"。
// - `omp.composer.model`（row，点击 action `status.model` 打开模型选择器）：子孙里有一个 text（模型显示名）和一个
//   `omp.composer.model.effort`（`p.level`，点击 action `thinking.cycle`，等于 ⇧⇥）。
// - `omp.composer.usage`（text）：`p.text` 如 "$0.00 (+0.02) ↓"，`p.title` 如 "Session cost $0.00 (+0.02) ↓"。订阅登录的模型
//   omp 不写 `$`：花费前面是订阅记号（"S0.44"，nerd 字形时是一个图标加空格），还没花费时只有 "(sub)"（omp 18.12.6 `formatBillingSummary`）。
//   第一个数是主会话自己的花费（omp 用会话总花费减去子代理的），括号里的 `(+0.02)` 是子代理（整棵子代理树）的花费
//   （omp 18.12.6 源码 status-line 的 cost 段：`cost - subagentCost`、`max(subagentTreeCost, subagentCost)`）。
// - 模型选择器：layer 里 `k: "picker"`，`p.items[].id` 是 `provider/model`，`p.current` 是当前模型的 id 列表。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import { findNode, nodeRole, plainText, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

export const COMPOSER_ROLE = "omp.editor";
const MODEL_ROLE = "omp.composer.model";
const EFFORT_ROLE = "omp.composer.model.effort";
const CONTEXT_ROLE = "omp.composer.context";
const USAGE_ROLE = "omp.composer.usage";

/**
 * 提问/审批把输入框换掉时，`sendPrompt`、切模型、切思考强度都没有可操作的节点：主进程立刻用这条消息 reject
 * （IPC 只带得过 message，渲染进程按 `composer_unavailable` 识别后给文案，不用等 30 秒超时）。
 */
export const TSP_COMPOSER_UNAVAILABLE =
  "composer_unavailable: omp is waiting for an answer to its question or approval; answer it first";

/** omp 的 action 名：点模型胶囊、点思考强度。 */
export const ACTION_PICK_MODEL = "status.model";
export const ACTION_CYCLE_THINKING = "thinking.cycle";

export interface TspContextInfo {
  /** 0–100。 */
  percent: number;
  /** 标题里 "8.7K of 1M tokens" 的前一半；标题没有这一行时为 null。 */
  tokens: number | null;
  /** 标题里的窗口，没有时取 `p.total`；都没有为 null。 */
  contextWindow: number | null;
}

export interface TspComposerInfo {
  /** 模型显示名（如 "DeepSeek V4 Flash"）。 */
  modelName: string | null;
  /** omp 的思考强度原文：off / minimal / … / max，还有 TaskState 没有的 auto。 */
  effort: string | null;
  context: TspContextInfo | null;
  /** 美元；"$0.00 (+0.02) ↓" 取第一个数（主会话自己的花费）。 */
  cost: number | null;
  /** 子代理的花费：括号里的 "(+0.02)"；没有括号是 0，没有费用节点为 null。 */
  subagentCost: number | null;
  /** 模型名后面有闪电图标 = `/fast` 开着。 */
  fast: boolean;
}

/** composer 上能接收 action 的节点（`action` 事件的 sf / id）。 */
export interface TspComposerTargets {
  sf: string;
  model: string | null;
  effort: string | null;
  /** 上下文 meter（`actions.click` 是 `status.context`，打开 omp 的 /context 报告）。 */
  context: string | null;
}

export interface TspPicker {
  sf: string;
  id: string;
  /** `provider/model`。 */
  items: string[];
  current: string[];
}

/** `/fast` 打开时 omp 在模型名后面加一个闪电图标 span（Nerd Font U+F0E7，样式含 `icon`；实测 sonnet-5-5 的 /fast on / off）。 */
const FAST_ICON = "\uF0E7";

/** 模型名节点的 spans：名字取非图标 span，闪电图标 = fast 开着。 */
function modelNameParts(node: DocNode): { name: string; fast: boolean } {
  const { spans } = node.p;
  if (!Array.isArray(spans)) return { name: plainText(node).trim(), fast: false };
  let name = "";
  let fast = false;
  for (const span of spans as readonly unknown[]) {
    if (span === null || typeof span !== "object" || !("t" in span) || typeof span.t !== "string") continue;
    const style = "s" in span && typeof span.s === "string" ? span.s : "";
    if (/\bicon\b/.test(style)) fast ||= span.t.includes(FAST_ICON);
    else name += span.t;
  }
  return { name: name.trim(), fast };
}

/**
 * 输入框上的模型名是不是目录里这个模型：omp 的状态栏去掉了名字开头的 `Claude `（omp 18.12.6
 * `packages/tui/src/status-line/segments.ts` 的 `modelDisplayName`），目录里是 "Claude Opus 5.5"，卡片上是 "Opus 5.5"。
 */
export function isShownModelName(catalogName: string, shown: string): boolean {
  return catalogName === shown || (catalogName.startsWith("Claude ") && catalogName.slice(7) === shown);
}

/** "8.7K" / "1M" / "1,234" → 数。K = 10^3（实测：0.00797 × 1M ≈ 8K）。解析不了为 null。 */
export function parseTokenCount(text: string): number | null {
  const match = /^\s*([\d.,]+)\s*([kKmMbB])?\s*$/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1]!.replaceAll(",", ""));
  if (!Number.isFinite(value)) return null;
  const unit = match[2]?.toLowerCase();
  const scale = unit === "k" ? 1e3 : unit === "m" ? 1e6 : unit === "b" ? 1e9 : 1;
  return Math.round(value * scale);
}

/** meter 节点 → 上下文用量；`value` 不是数时为 null。 */
export function parseContextMeter(props: Readonly<Record<string, unknown>>): TspContextInfo | null {
  const value = props.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const title = typeof props.title === "string" ? props.title : "";
  const match = /([\d.,]+\s*[kKmMbB]?)\s+of\s+([\d.,]+\s*[kKmMbB]?)\s+tokens/.exec(title);
  const total = typeof props.total === "string" ? parseTokenCount(props.total) : null;
  return {
    percent: Math.min(100, Math.max(0, value * 100)),
    tokens: match ? parseTokenCount(match[1]!) : null,
    contextWindow: (match ? parseTokenCount(match[2]!) : null) ?? total,
  };
}

/**
 * 本会话花费：第一个带小数点的数（omp 总是保留两位小数；`$`、订阅记号 "S" 或图标在它前面）；括号里的子代理增量、★ 高级请求数在后面，不取。
 * 只有 "(sub)" = 订阅、还没花费，算 0。都没有为 null。
 */
export function parseCost(text: string): number | null {
  const match = /(?<![\d(+])([\d,]*\d\.\d+)/.exec(text);
  if (!match) return /\(sub\)/.test(text) ? 0 : null;
  const value = Number.parseFloat(match[1]!.replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

/** 子代理花费：omp 费用段括号里的 "(+0.02)"；omp 只在有子代理花费时写它，没有就是 0。 */
export function parseSubagentCost(text: string): number {
  const match = /\(\+([\d,]*\d(?:\.\d+)?)\)/.exec(text);
  const value = match ? Number.parseFloat(match[1]!.replaceAll(",", "")) : 0;
  return Number.isFinite(value) ? value : 0;
}

/** 文档里的 omp 输入框卡片：dock 里 role `omp.editor` 的节点。composer 被提问/审批替换时没有。 */
export function findComposerCard(doc: TspDocument): { surface: DocSurface; card: DocNode } | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    const card = findNode(surface, (node) => nodeRole(node) === COMPOSER_ROLE, "dock");
    if (card) return { surface, card };
  }
  return null;
}

/** 输入框卡片上的状态；composer 当前不在文档里（还没出现、被提问/审批替换）时为 null。 */
export function deriveComposerInfo(doc: TspDocument): TspComposerInfo | null {
  const found = findComposerCard(doc);
  if (!found) return null;
  const { surface, card } = found;
  const modelNode = findNode(surface, (node) => nodeRole(node) === MODEL_ROLE, card.id);
  const nameNode = modelNode
    ? findNode(surface, (node) => node.k === "text" && node.id !== modelNode.id, modelNode.id)
    : null;
  const effortNode = findNode(surface, (node) => nodeRole(node) === EFFORT_ROLE, card.id);
  const contextNode = findNode(surface, (node) => nodeRole(node) === CONTEXT_ROLE, card.id);
  const usageNode = findNode(surface, (node) => nodeRole(node) === USAGE_ROLE, card.id);
  const name = nameNode ? modelNameParts(nameNode) : { name: "", fast: false };
  const level = effortNode?.p.level;
  const usageText = usageNode ? plainText(usageNode) || String(usageNode.p.title ?? "") : null;
  return {
    modelName: name.name === "" ? null : name.name,
    fast: name.fast,
    effort: typeof level === "string" ? level : null,
    context: contextNode ? parseContextMeter(contextNode.p) : null,
    cost: usageText === null ? null : parseCost(usageText),
    subagentCost: usageText === null ? null : parseSubagentCost(usageText),
  };
}

/** 模型胶囊和思考强度节点（给 `action` 事件用）；composer 不在文档里为 null。 */
export function findComposerTargets(doc: TspDocument): TspComposerTargets | null {
  const found = findComposerCard(doc);
  if (!found) return null;
  const { surface, card } = found;
  return {
    sf: surface.id,
    model: findNode(surface, (node) => nodeRole(node) === MODEL_ROLE, card.id)?.id ?? null,
    effort: findNode(surface, (node) => nodeRole(node) === EFFORT_ROLE, card.id)?.id ?? null,
    context: findNode(surface, (node) => nodeRole(node) === CONTEXT_ROLE, card.id)?.id ?? null,
  };
}

/** layer 里的选择器（omp 的模型选择器）；没有为 null。 */
export function findPicker(doc: TspDocument): TspPicker | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const node = findNode(surface, (candidate) => candidate.k === "picker", "layer");
    if (!node) continue;
    const items: string[] = [];
    if (Array.isArray(node.p.items)) {
      for (const item of node.p.items as readonly unknown[]) {
        if (item !== null && typeof item === "object" && "id" in item && typeof item.id === "string")
          items.push(item.id);
      }
    }
    const current = Array.isArray(node.p.current)
      ? (node.p.current as readonly unknown[]).filter((entry): entry is string => typeof entry === "string")
      : [];
    return { sf, id: node.id, items, current };
  }
  return null;
}

/** layer / main 里 omp 的状态 toast（role `omp.toast.status`）的文字；切模型成功时是 "Session-only model: <id>. …"。 */
export function statusToastTexts(doc: TspDocument): string[] {
  const texts: string[] = [];
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface) continue;
    for (const node of surface.nodes.values()) {
      if (node.k === "toast" && (nodeRole(node) ?? "").startsWith("omp.toast")) texts.push(plainText(node));
    }
  }
  return texts;
}

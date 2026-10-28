// omp 的 `/context` 报告（点输入框上的上下文 meter：`actions.click` = `status.context`）。layer 里一个 modal 弹窗，
// overlay role `omp.overlay.report`，正文 `omp.context`，底栏一个 `omp.btn`（Close），`actions.click` 是关闭动作。
// 每类一行的写法 omp 改过一次，两种都认（PATH 上的 omp 版本不由 studio 定）：
// - omp 18.12.6（fixtures/tsp/context-report.jsonl）：`omp.context.cats` 下每类一行 role `omp.context.cat`，节点 id 末段是
//   类别 id（systemPrompt / systemTools / systemContext / skills / messages），之后是 `omp.context.cat.free`、有预留时
//   `omp.context.cat.buffer`；title `<名称> · <token 数，en-US 千分位> tokens` 是精确值。
// - omp 18.13.2（fixtures/tsp/context-report-18.13.jsonl）：一个 id 以 `/categories` 结尾的 `list`，每类一个 `item`，id 末段是
//   连字符写法的类别 id（system-prompt / skills / built-in-tools / custom-tools / user-messages / assistant-messages /
//   assistant-thinking / tool-calls / tool-output），最后 `buffer`、`free`；label 第二段是名称，value 是 `3.1K · 0.3%`
//   （omp 自己也只显示这个缩写）。已用取 `omp.context.used` 的第一段（`8.2K`），不是各类缩写之和。
// role 和 id 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import type { ContextReport, ContextReportRow } from "../ipc.ts";
import { isRecord } from "../type-guards.ts";
import { parseTokenCount } from "./composer-state.ts";
import { findNode, nodeRole, type DocNode, type DocSurface, type TspDocument } from "./document.ts";

export const ACTION_CONTEXT_REPORT = "status.context";
const REPORT_ROLE = "omp.overlay.report";
const CONTEXT_ROLE = "omp.context";
const CATS_ROLE = "omp.context.cats";
const ROW_ROLE = "omp.context.cat";
const USED_ROLE = "omp.context.used";
const CATEGORIES_SUFFIX = "/categories";
const BUTTON_ROLE = "omp.btn";
const NON_CATEGORY = new Set(["free", "buffer"]);
const ROW_TITLE = /^(.+) · ([\d,]+) tokens$/;

export interface OmpContextReport {
  sf: string;
  /** 底栏 Close 按钮（`action` 事件的 id / act）；没有为 null。 */
  close: { id: string; act: string } | null;
  report: ContextReport;
}

/** 文档里 omp 的 /context 报告；没打开、行还没画全（没有剩余空间那一行）时为 null。 */
export function findContextReport(doc: TspDocument): OmpContextReport | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const overlay = findNode(surface, (node) => node.k === "overlay" && nodeRole(node) === REPORT_ROLE, "layer");
    if (!overlay) continue;
    const body = findNode(surface, (node) => nodeRole(node) === CONTEXT_ROLE, overlay.id);
    if (!body) continue;
    const parsed = catRows(surface, body) ?? listRows(surface, body);
    if (!parsed?.rows.some((row) => row.key === "free")) continue;
    const { rows } = parsed;
    const used = parsed.used ?? rows.reduce((sum, row) => (NON_CATEGORY.has(row.key) ? sum : sum + row.tokens), 0);
    const total = used + rows.reduce((sum, row) => (NON_CATEGORY.has(row.key) ? sum + row.tokens : sum), 0);
    const button = findNode(surface, (node) => nodeRole(node) === BUTTON_ROLE, overlay.id);
    const actions = button?.p["actions"];
    const act = isRecord(actions) && typeof actions["click"] === "string" ? actions["click"] : null;
    return {
      sf,
      close: button && act !== null ? { id: button.id, act } : null,
      report: { rows, used, window: total > used ? total : null },
    };
  }
  return null;
}

interface ParsedRows {
  rows: ContextReportRow[];
  /** omp 写出来的已用；没有时按类别相加。 */
  used: number | null;
}

/** omp 18.12：`omp.context.cats` 下的行，title 里是精确的 token 数。 */
function catRows(surface: DocSurface, body: DocNode): ParsedRows | null {
  const cats = findNode(surface, (node) => nodeRole(node) === CATS_ROLE, body.id);
  if (!cats) return null;
  const rows: ContextReportRow[] = [];
  for (const id of cats.c) {
    const node = surface.nodes.get(id);
    const role = node ? nodeRole(node) : null;
    if (!node || (role !== ROW_ROLE && !role?.startsWith(`${ROW_ROLE}.`))) continue;
    const match = typeof node.p["title"] === "string" ? ROW_TITLE.exec(node.p["title"]) : null;
    if (!match) continue;
    rows.push({ key: lastSegment(node.id), label: match[1]!, tokens: Number(match[2]!.replaceAll(",", "")) });
  }
  return { rows, used: null };
}

/** omp 18.13：`…/categories` 列表的 item，value 是 `3.1K · 0.3%` 这样的缩写。 */
function listRows(surface: DocSurface, body: DocNode): ParsedRows | null {
  const list = findNode(surface, (node) => node.k === "list" && node.id.endsWith(CATEGORIES_SUFFIX), body.id);
  if (!list) return null;
  const rows: ContextReportRow[] = [];
  for (const id of list.c) {
    const node = surface.nodes.get(id);
    if (node?.k !== "item") continue;
    // label 是 [色块 `■ `, 名称]。
    const spans = node.p["label"];
    const label = spansText(Array.isArray(spans) && spans.length > 1 ? spans.slice(1) : spans).trim();
    const tokens = parseTokenCount(spansText(node.p["value"]).split(" · ")[0] ?? "");
    if (label === "" || tokens === null) continue;
    rows.push({ key: camelCase(lastSegment(node.id)), label, tokens });
  }
  const usedNode = findNode(surface, (node) => nodeRole(node) === USED_ROLE, body.id);
  const usedSpans = usedNode?.p["spans"];
  const first = Array.isArray(usedSpans) && isRecord(usedSpans[0]) ? usedSpans[0]["t"] : undefined;
  return { rows, used: typeof first === "string" ? parseTokenCount(first) : null };
}

/** `text` 的 spans（或直接是字符串）连成纯文字。 */
function spansText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((span) => (isRecord(span) && typeof span["t"] === "string" ? span["t"] : "")).join("");
}

function lastSegment(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

/** omp 18.13 的连字符 id 换成 18.12 的写法（`built-in-tools` -> `builtInTools`），界面按同一套 key 起名、上色。 */
function camelCase(id: string): string {
  return id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

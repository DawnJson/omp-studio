// omp 的 `/context` 报告（点输入框上的上下文 meter：`actions.click` = `status.context`）。实测 omp 18.12.6
// （真实 omp 探针 + omp 源码 `describeContextFrame`）：
// - layer 里一个 modal 弹窗，overlay role `omp.overlay.report`，正文 `omp.context`。
// - `omp.context.cats` 下每类一行：role `omp.context.cat`，节点 id 末段是类别 id（systemPrompt / systemTools / systemContext /
//   skills / messages）；之后是剩余空间 `omp.context.cat.free`、有预留时自动压缩预留 `omp.context.cat.buffer`。
// - 每行的 title 是 `<名称> · <token 数，en-US 千分位> tokens`：精确值（行里显示的是 "3K" 这样的缩写）。
// - 底栏一个 `omp.btn`（Close），`actions.click` 是关闭动作。
// role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在这里。
import type { ContextReport, ContextReportRow } from "../ipc.ts";
import { isRecord } from "../type-guards.ts";
import { findNode, nodeRole, type TspDocument } from "./document.ts";

export const ACTION_CONTEXT_REPORT = "status.context";
const REPORT_ROLE = "omp.overlay.report";
const CONTEXT_ROLE = "omp.context";
const CATS_ROLE = "omp.context.cats";
const ROW_ROLE = "omp.context.cat";
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
    const cats = body && findNode(surface, (node) => nodeRole(node) === CATS_ROLE, body.id);
    if (!cats) continue;
    const rows: ContextReportRow[] = [];
    for (const id of cats.c) {
      const node = surface.nodes.get(id);
      const role = node ? nodeRole(node) : null;
      if (!node || (role !== ROW_ROLE && !role?.startsWith(`${ROW_ROLE}.`))) continue;
      const match = typeof node.p["title"] === "string" ? ROW_TITLE.exec(node.p["title"]) : null;
      if (!match) continue;
      rows.push({
        key: node.id.slice(node.id.lastIndexOf("/") + 1),
        label: match[1]!,
        tokens: Number(match[2]!.replaceAll(",", "")),
      });
    }
    if (!rows.some((row) => row.key === "free")) continue;
    const used = rows.reduce((sum, row) => (NON_CATEGORY.has(row.key) ? sum : sum + row.tokens), 0);
    const total = rows.reduce((sum, row) => sum + row.tokens, 0);
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

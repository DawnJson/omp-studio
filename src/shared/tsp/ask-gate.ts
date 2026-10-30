// omp 的提问对话框（dock 里 role `omp.editor.ask`）在 studio 里怎么响应鼠标：纯函数。
// 依据 omp 18.12.5 的实录 `fixtures/tsp/ask-multi.jsonl`（三题：单选、多选、单选 + Review 页）：
// - 单选题的选项 role 是 `omp.ask.option`：`select` 事件就是"回答并跳到下一页"（高亮的那一项也一样），`activate` 同效。
// - 多选题的选项 role 是 `omp.ask.check`：`select` 事件 = 勾选 / 取消勾选这一项（已高亮的也切换，选中状态是 item 的
//   `icon:"check"` + `tone:"accent"`）；`activate` = "下一页"，不管点的是哪一项（所以多选题点高亮项发 activate 会跳页并记成 Unanswered）。
// - 提问工具卡（main 里 role `omp.tool.ask`）头上的 `target` 是第一道题，对话框开着时它的标题（`omp.ask.question`）也是这道题
//   （`fixtures/tsp/ask.jsonl` 第 38 帧：卡片 running、对话框同一帧出现；第 43 帧答完：卡片 done、对话框删掉）。
import { findNode, nodeRole, type TspDocument } from "./document.ts";
import type { NodeDeps } from "./node-watch.ts";

/** 提问对话框的根节点 role；审批门是 `omp.editor.ask.approval`、隐藏后是 `omp.editor.ask.hidden`，不归这里管。 */
export const ASK_GATE_ROLE = "omp.editor.ask";
/** 提问 / 审批的按钮（Hide / Note / Skip / Next / Submit、Details / Deny / Approve）：一个 row，子节点是文字和 `kbd`，`actions.click` 是动作名。 */
export const ASK_BUTTON_ROLE = "omp.btn";

/** 多选题的选项。 */
const ASK_CHECK_ROLE = "omp.ask.check";
/** 提问工具卡。 */
export const ASK_TOOL_ROLE = "omp.tool.ask";

/**
 * 点一个列表项该发什么事件：`select` 或 `activate`。
 * 通用规则：再点已高亮的行 = activate（picker、审批门、单选提问）；多选提问的选项永远是 `select`（= 勾选切换）。
 */
export function askItemClick(role: unknown, isSelected: boolean): "select" | "activate" {
  if (role === ASK_CHECK_ROLE) return "select";
  return isSelected ? "activate" : "select";
}

/** 双击一项要不要 activate：多选的选项不要（双击 = 勾选两次，再 activate 会跳页）。 */
export function askItemDoubleActivates(role: unknown): boolean {
  return role !== ASK_CHECK_ROLE;
}

/**
 * 提问选项行前面画哪种标记：单选题的选项（`omp.ask.option`、`omp.ask.other`）是单选圈，多选题的（`omp.ask.check`、
 * `omp.ask.other.check`）是勾选框，其它列表项没有标记。标记只是画出来，点击仍走 askItemClick 的规则。
 */
export function askItemMarker(role: unknown): "radio" | "check" | null {
  if (role === "omp.ask.option" || role === "omp.ask.other") return "radio";
  if (role === ASK_CHECK_ROLE || role === "omp.ask.other.check") return "check";
  return null;
}

/** openAskTool 读的节点（NodeWatch）：提问对话框和提问工具卡。 */
export const ASK_TOOL_NODES: NodeDeps = { roles: [ASK_GATE_ROLE, ASK_TOOL_ROLE] };

/** 对话框开着时卡片头不写题目的那张提问工具卡。 */
export interface OpenAskTool {
  sf: string;
  id: string;
}

/**
 * 提问对话框开着（dock 里 role 正好是 `omp.editor.ask`；隐藏后是 `omp.editor.ask.hidden`，不算）时，它对应的提问工具卡：
 * 同一个 surface 里最后一张还没结束（pending / running）的 `omp.tool.ask`。这张卡片头上的题目和对话框的标题重复，不写
 * （2026-10-29 仓库所有者：删掉重复的）；答完（卡片 done、对话框删掉）或对话框隐藏后照常写。没有这样的卡片为 null。
 */
export function openAskTool(doc: TspDocument): OpenAskTool | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock") || !findNode(surface, (node) => nodeRole(node) === ASK_GATE_ROLE, "dock")) continue;
    let open: OpenAskTool | null = null;
    for (const node of surface.nodes.values()) {
      if (nodeRole(node) === ASK_TOOL_ROLE && (node.p.status === "pending" || node.p.status === "running"))
        open = { sf, id: node.id };
    }
    if (open) return open;
  }
  return null;
}

export function sameOpenAskTool(a: OpenAskTool | null, b: OpenAskTool | null): boolean {
  return a === b || (a !== null && b !== null && a.sf === b.sf && a.id === b.id);
}

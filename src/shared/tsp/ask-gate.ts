// omp 的提问对话框在 studio 里怎么响应鼠标：纯函数。两种形状：
// - omp 19（实测 19.2.1，2026-11-26，`fixtures/tsp/ask-19.jsonl`、`ask-19-other.jsonl`）：`main` 的直接子节点
//   `col role=omp.ask.card`（ask 工具的 HTML 表单），dock 里的输入框还在。所有题在一张卡里：打开的一题是 `omp.ask.open`
//   （`omp.ask.legend` / `omp.ask.label` + `list omp.ask.options` 或文字 `input`），其余折成 `omp.ask.fold`（`actions.click` =
//   `open:<i>`，里面的 `omp.ask.pill` 按钮 `pick:<i>:<j>` 直接答）。没有 Review 页，底栏是 cancel / note / submit。
//   单选的 `select` / `activate` 都只是选中、不跳题（Enter 选中并跳到下一题，只有一题时 Enter = 提交）；选中的单选项带
//   `tone:"accent"`，list 的 `selected` 只是高亮（askItemChecked）。多选照旧：`select` 切换勾选。"Other…" 和选项同一个 role，
//   id 以 `/other` 结尾；选它后题下面加一个 `input`，打的字写进去。surface 的 `focus` 一直是 null：按键由卡片根节点接。
// - omp 18：dock 里的 `col role=omp.editor.ask`（把输入框换掉）。依据 omp 18.12.5 的实录 `fixtures/tsp/ask-multi.jsonl`
//   （三题：单选、多选、单选 + Review 页）：
// - 单选题的选项 role 是 `omp.ask.option`：`select` 事件就是"回答并跳到下一页"（高亮的那一项也一样），`activate` 同效。
// - 多选题的选项 role 是 `omp.ask.check`：`select` 事件 = 勾选 / 取消勾选这一项（已高亮的也切换，选中状态是 item 的
//   `icon:"check"` + `tone:"accent"`）；`activate` = "下一页"，不管点的是哪一项（所以多选题点高亮项发 activate 会跳页并记成 Unanswered）。
// - 提问工具卡（main 里 role `omp.tool.ask`）头上的 `target` 是第一道题，对话框开着时它的标题（`omp.ask.question`）也是这道题
//   （`fixtures/tsp/ask.jsonl` 第 38 帧：卡片 running、对话框同一帧出现；第 43 帧答完：卡片 done、对话框删掉）。
// - omp 18.18.3（`fixtures/tsp/ask-other.jsonl`，2026-11-09 实测）：题目包在 `omp.ask.form` / `section` / `field` 里，"Other…" 也是
//   `omp.ask.option`（id 以 `/other` 结尾）；`select` 它时 omp 在题下面加一个带焦点的 `input`（studio 的 Editor 直接拿键盘），
//   打的字写进去、Enter 收起；数字键 omp 不认（按 `2` 选中项不变，↓ 会动）。
import {
  findNode,
  liveSurfaces,
  nodeRole,
  treeNodes,
  type DocNode,
  type DocSurface,
  type TspDocument,
} from "./document.ts";
import type { NodeDeps } from "./node-watch.ts";

/** omp 18 的提问对话框根节点 role（dock 里）；审批门是 `omp.editor.ask.approval`、隐藏后是 `omp.editor.ask.hidden`，不归这里管。 */
export const ASK_GATE_ROLE = "omp.editor.ask";
/** omp 19 的提问卡根节点 role（`main` 的直接子节点）。 */
export const ASK_CARD_ROLE = "omp.ask.card";

/** 是不是提问对话框的根节点（18 的 `omp.editor.ask` 或 19 的 `omp.ask.card`）。 */
export function isAskGateRole(role: unknown): boolean {
  return role === ASK_GATE_ROLE || role === ASK_CARD_ROLE;
}

/** omp 19 的提问卡：`main` 直接子节点里的 `omp.ask.card`（从后往前找：卡片挂在对话末尾，只看直接子节点，不遍历整段对话）。 */
export function findAskCard(surface: DocSurface): DocNode | null {
  const main = surface.nodes.get("main");
  if (main === undefined) return null;
  for (let index = main.c.length - 1; index >= 0; index -= 1) {
    const node = surface.nodes.get(main.c[index]!);
    if (node !== undefined && nodeRole(node) === ASK_CARD_ROLE) return node;
  }
  return null;
}

/** 开着的提问对话框根节点：dock 里的 `omp.editor.ask`（18）或 findAskCard（19）。没有为 null。 */
function findAskGate(surface: DocSurface): DocNode | null {
  const gate = surface.nodes.has("dock") ? findNode(surface, (node) => nodeRole(node) === ASK_GATE_ROLE, "dock") : null;
  return gate ?? findAskCard(surface);
}

/**
 * 提问选项行的单选圈 / 勾选框是不是选中：多选看 omp 的 `icon:"check"`；单选在 19 的卡片里看 `tone:"accent"`（高亮 ≠ 已答），
 * 18 的对话框里单选选中就是跳题，画的是高亮项。
 */
export function askItemChecked(
  marker: "radio" | "check",
  gateRole: string | null,
  item: { icon?: unknown; tone?: unknown },
  isSelected: boolean,
): boolean {
  if (marker === "check") return item.icon === "check";
  return gateRole === ASK_CARD_ROLE ? item.tone === "accent" : isSelected;
}

/** 提问 / 审批的按钮（Hide / Note / Skip / Next / Submit、Details / Deny / Approve）：`actions.click` 是动作名。声明了 `button` 的 omp（≥18.14.2）发 `button` 节点，更早的发 row（子节点是文字和 `kbd`）。 */
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

/** 数字键选项：提问列表上按 1–9 选第几项（omp 自己不认数字键，实测 18.18.3 按 `2` 没反应，2026-11-09）。 */
export const ASK_DIGIT_MAX = 9;

/**
 * 提问列表上按了数字键（不带修饰键的 `1`–`9`）该发什么：和点第 N 个带标记的选项一样（askItemClick）。
 * 不是提问列表（没有带标记的项）、数字超出项数、不是数字键时为 null（按键照常写给 omp）。
 */
export function askDigitPick(
  key: string,
  items: readonly { id: string; role: unknown }[],
  selected: string | null,
): { ev: "select" | "activate"; item: string } | null {
  if (!/^[1-9]$/.test(key)) return null;
  const target = items.filter((item) => askItemMarker(item.role) !== null)[Number(key) - 1];
  if (target === undefined) return null;
  return { ev: askItemClick(target.role, target.id === selected), item: target.id };
}

/**
 * 焦点在提问对话框根节点上（刚从输入框发出消息、换页后）时按数字键：对话框里只有一组带标记的选项时选它的第 N 项，
 * 返回要发的事件（list 的 id + askDigitPick 的结果）；没有或不止一组（分不清是哪一题）时为 null，按键照常写给 omp。
 */
export function askDigitInGate(
  surface: DocSurface,
  gateId: string,
  key: string,
): { list: string; ev: "select" | "activate"; item: string } | null {
  const lists: DocNode[] = [];
  const walk = (id: string) => {
    const node = surface.nodes.get(id);
    if (node === undefined) return;
    if (node.k === "list" && node.c.some((child) => askItemMarker(surface.nodes.get(child)?.p["role"]) !== null))
      lists.push(node);
    node.c.forEach(walk);
  };
  walk(gateId);
  if (lists.length !== 1) return null;
  const list = lists[0]!;
  const items = list.c.map((id) => ({ id, role: surface.nodes.get(id)?.p["role"] }));
  const selected = typeof list.p["selected"] === "string" ? list.p["selected"] : null;
  const pick = askDigitPick(key, items, selected);
  return pick === null ? null : { list: list.id, ...pick };
}

/** openAskTool 读的节点（NodeWatch）：提问对话框（18 / 19）和提问工具卡。 */
export const ASK_TOOL_NODES: NodeDeps = { roles: [ASK_GATE_ROLE, ASK_CARD_ROLE, ASK_TOOL_ROLE] };

/** 对话框开着时卡片头不写题目的那张提问工具卡。 */
export interface OpenAskTool {
  sf: string;
  id: string;
}

/**
 * 提问对话框开着（findAskGate：18 的 dock 里 role 正好是 `omp.editor.ask`，隐藏后的 `omp.editor.ask.hidden` 不算；19 的
 * `omp.ask.card`）时，它对应的提问工具卡：同一个 surface 里最后一张还没结束（pending / running）的 `omp.tool.ask`。这张卡片头上的
 * 题目和对话框的标题重复，不写（2026-10-29 仓库所有者：删掉重复的）；答完（卡片 done、对话框删掉）或对话框隐藏后照常写。
 * 没有这样的卡片为 null。
 */
export function openAskTool(doc: TspDocument): OpenAskTool | null {
  for (const surface of liveSurfaces(doc)) {
    if (findAskGate(surface) === null) continue;
    let open: OpenAskTool | null = null;
    for (const node of treeNodes(surface)) {
      if (nodeRole(node) === ASK_TOOL_ROLE && (node.p.status === "pending" || node.p.status === "running"))
        open = { sf: surface.id, id: node.id };
    }
    if (open) return open;
  }
  return null;
}

export function sameOpenAskTool(a: OpenAskTool | null, b: OpenAskTool | null): boolean {
  return a === b || (a !== null && b !== null && a.sf === b.sf && a.id === b.id);
}

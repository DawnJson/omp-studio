// omp 的 `/tree`（会话树选择器）在 TSP 文档里的样子，和回溯（跳到树里的一个用户消息）后的结果。纯函数，不碰 IO。
// 实测 omp 18.12.5（fixtures/tsp/session-tree.jsonl）：
//   · `send "/tree"` → layer 里出现 `picker`（title "Session tree"、`layout:"tree"`、`items[].id` 就是会话条目 id、`current` 是叶子所在条目）；
//   · `activate item=<用户消息的条目 id>` → 选择器关闭，叶子移到这条消息的**父条目**，输入框（dock 里的 editor）被填成这条消息的文字，
//     出现 toast "Navigated to selected point"（omp.toast.status）；会话文件不变、OSC omp_session_file 也不变（同一个文件内的移动）。
//   · 选当前叶子：什么都不发生（选择器留着、没有 toast）；调用方超时后按 Esc 并报错。omp 文档说 branchSummary.enabled 打开时会先问要不要摘要（未实测），选择器同样不会立刻关。
import { nodeRole, findNode, type TspDocument } from "./document.ts";
import { statusToastTexts } from "./composer-state.ts";

export interface TspTreePicker {
  sf: string;
  /** `activate` 事件的节点 id。 */
  id: string;
  /** 选择器里列出的条目 id（默认过滤下只有可见的）。 */
  items: string[];
  /** 叶子条目 id。 */
  current: string[];
  /** 选择器底栏的动作 id（`switch`、`summarize`、`label`…）；`action` 事件的 `act`。 */
  actions: string[];
}

/** layer 里的会话树选择器（`layout:"tree"` 的 picker）；没有为 null。模型选择器不是 tree 布局，不会认错。 */
export function findTreePicker(doc: TspDocument): TspTreePicker | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const node = findNode(surface, (candidate) => candidate.k === "picker" && candidate.p.layout === "tree", "layer");
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
    const actions: string[] = [];
    if (Array.isArray(node.p.actions)) {
      for (const action of node.p.actions as readonly unknown[]) {
        if (action !== null && typeof action === "object" && "id" in action && typeof action.id === "string")
          actions.push(action.id);
      }
    }
    return { sf, id: node.id, items, current, actions };
  }
  return null;
}

/** omp 的摘要选择：`branchSummary.enabled` 打开时选了用户消息后弹出（title "Summarize branch?"，items 0 No summary / 1 Summarize / 2 Summarize with custom prompt）。 */
export const SUMMARY_NO = "0";

export function findSummaryPicker(doc: TspDocument): { sf: string; id: string } | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("layer")) continue;
    const node = findNode(
      surface,
      (candidate) =>
        candidate.k === "picker" &&
        candidate.p.title === "Summarize branch?" &&
        Array.isArray(candidate.p.items) &&
        (candidate.p.items as readonly { id?: unknown }[]).map((item) => item.id).join() === "0,1,2",
      "layer",
    );
    if (node) return { sf, id: node.id };
  }
  return null;
}

export interface TspComposerEditor {
  sf: string;
  id: string;
  text: string;
}

/** dock 里 omp 输入框（editor 节点）和它当前的文字；没有输入框（被提问/审批换掉、还没出现）为 null。回溯后它是那条用户消息的文字。 */
export function findComposerEditor(doc: TspDocument): TspComposerEditor | null {
  for (const sf of doc.live) {
    const surface = doc.surfaces.get(sf);
    if (!surface?.nodes.has("dock")) continue;
    const card = findNode(surface, (node) => nodeRole(node) === "omp.editor", "dock");
    const editor = card ? findNode(surface, (node) => node.k === "editor", card.id) : null;
    if (editor) return { sf, id: editor.id, text: typeof editor.p.text === "string" ? editor.p.text : "" };
  }
  return null;
}

/** omp 的状态 toast "Navigated to selected point" 在文档里（回溯完成的信号之一；输入框预填可能晚一帧）。 */
export function hasNavigatedToast(doc: TspDocument): boolean {
  return statusToastTexts(doc).some((text) => text.startsWith("Navigated to selected point"));
}

/** 树选择器里"给条目打标签"的输入框（`select` 一个条目再 `action label`；omp 18.12.6 源码：选择器预览里换成 `input` 节点，底栏动作换成 `label-save` / `close`）。 */
export interface TspTreeLabelInput {
  sf: string;
  /** 选择器节点 id（`action label-save` 发给它）。 */
  pickerId: string;
  /** `edit` 事件的输入框节点 id。 */
  id: string;
  text: string;
}

export const TREE_ACT_LABEL = "label";
export const TREE_ACT_LABEL_SAVE = "label-save";

/** 标签输入框；选择器没进入打标签状态（动作里没有 `label-save`、没有 input 节点）为 null。 */
export function findTreeLabelInput(doc: TspDocument): TspTreeLabelInput | null {
  const picker = findTreePicker(doc);
  if (picker === null || !picker.actions.includes(TREE_ACT_LABEL_SAVE)) return null;
  const surface = doc.surfaces.get(picker.sf);
  const input = surface ? findNode(surface, (node) => node.k === "input", picker.id) : null;
  if (!input) return null;
  return {
    sf: picker.sf,
    pickerId: picker.id,
    id: input.id,
    text: typeof input.p.text === "string" ? input.p.text : "",
  };
}

/**
 * omp 在用户消息卡片（role `omp.user`）的工具行里画了一个"回退"图标（`actions.click: "rewind"`，omp 自己的回退选择器）。
 * studio 接管它：点了打开会话树面板，并定位到这条消息。卡片没有条目 id，只能按位置对：返回 `nodeId`（卡片里的节点）所在卡片
 * 是 main 里倒数第几张用户消息卡片（0 = 最后一张）。从末尾数是因为压缩过的会话 omp 只画压缩点之后的消息，从头数会错位。
 * 找不到卡片返回 null。
 */
export function userCardFromEnd(doc: TspDocument, sf: string, nodeId: string): number | null {
  const surface = doc.surfaces.get(sf);
  if (!surface) return null;
  let card: string | null = null;
  for (
    let node = surface.nodes.get(nodeId);
    node;
    node = node.parent === null ? undefined : surface.nodes.get(node.parent)
  ) {
    if (nodeRole(node) === "omp.user") {
      card = node.id;
      break;
    }
  }
  if (card === null) return null;
  const cards: string[] = [];
  const stack = ["main"];
  while (stack.length > 0) {
    const node = surface.nodes.get(stack.pop() as string);
    if (!node) continue;
    if (nodeRole(node) === "omp.user") {
      cards.push(node.id);
      continue;
    }
    for (let index = node.c.length - 1; index >= 0; index -= 1) stack.push(node.c[index] as string);
  }
  const position = cards.indexOf(card);
  return position < 0 ? null : cards.length - 1 - position;
}

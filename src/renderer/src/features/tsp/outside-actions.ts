// 节点的 `actions.outside`（规范：每次按下落在节点外面、也不在输入框里时执行，如 omp 19 旁路便签的 `btw-blur`）。
// 渲染时登记（nodeActionHandlers），document 上一个捕获阶段的 pointerdown 统一判断；按下时再读一遍节点，动作没了就注销。
// 节点不在页面上（没画、所在任务的视图藏着）不算；菜单、浮层（`[data-floating]`，含这个节点自己的右键菜单）和 studio 的输入框里按下不算外面。
import type { TspContext } from "./node-props.ts";
import { runAction } from "./actions.ts";
import { peekTspNode } from "./tsp-store.ts";
import { isRecord } from "../../../../shared/type-guards.ts";
import type { DocNode } from "../../../../shared/tsp/document.ts";

const watched = new Map<string, { id: string; ctx: TspContext }>();
let listening = false;

/** 这个节点在页面上画出来的元素（按任务视图和 surface 找，同一个 id 可能在别的任务里也有）。 */
function shownElement(id: string, ctx: TspContext): Element | null {
  const view = document.querySelector(`[data-testid="tsp-view"][data-task-id="${CSS.escape(ctx.taskId)}"]`);
  for (const element of view?.querySelectorAll(`[data-id="${CSS.escape(id)}"]`) ?? []) {
    const surface = element.closest<HTMLElement>("[data-sf]");
    if (surface !== null && surface.dataset["sf"] !== ctx.sf) continue;
    if (element.getClientRects().length > 0) return element;
  }
  return null;
}

function onPress(event: PointerEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest("[data-floating], .composer-stack")) return;
  for (const [key, { id, ctx }] of watched) {
    const node: DocNode | null = peekTspNode(ctx.taskId, ctx.sf, id);
    const act = node !== null && isRecord(node.p.actions) ? node.p.actions.outside : undefined;
    if (node === null || typeof act !== "string") {
      watched.delete(key);
      continue;
    }
    const element = shownElement(id, ctx);
    if (element === null || (target !== null && element.contains(target))) continue;
    runAction(act, node, ctx);
  }
}

export function watchOutside(node: DocNode, ctx: TspContext): void {
  watched.set(`${ctx.taskId}\n${ctx.sf}\n${node.id}`, { id: node.id, ctx });
  if (listening) return;
  listening = true;
  document.addEventListener("pointerdown", onPress, true);
}

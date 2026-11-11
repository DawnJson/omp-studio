// 节点上的指针动作（规范 Elements `actions`）：click / dblclick / menu 里写的动作名怎么执行。
//   终端自己做：toggle（翻折叠）、copy（复制文字并提示）、open（打开 href）、zoom（放大图片）、select / activate（发同名事件）；
//   其它名字原样发 `action` 事件（{ev:"action", sf, id, act, mods?}）交给 omp。
import type { MouseEvent } from "react";
import { createT } from "../../../../shared/i18n/index.ts";
import type { DocNode } from "../../../../shared/tsp/document.ts";
import { answerNodeIds } from "../../../../shared/tsp/last-answer.ts";
import { currentLocale } from "../../store/settings-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { openFilePreview } from "../file-preview/index.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { userCardFromEnd } from "../../../../shared/tsp/session-tree.ts";
import type { TspContext } from "./node-props.ts";
import { isHubOpenAction } from "../../../../shared/tsp/agent-hub.ts";
import { openAgentsPanel } from "../agents/agents-store.ts";
import { peekTspDocument, peekTspNode } from "./tsp-store.ts";
import { showTspMenu } from "./menu-store.ts";
import { isRecord } from "../../../../shared/type-guards.ts";

/** 节点自己才知道怎么做的内置动作（折叠、放大）。 */
export interface OwnActions {
  toggle?: (() => void) | undefined;
  zoom?: (() => void) | undefined;
}

export interface ActionHandlers {
  onClick?: (event: MouseEvent) => void;
  onDoubleClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  /** 有 click / dblclick 动作时带 `tsp-act`（指针光标）。 */
  className?: string;
  title?: string;
}

function modifiers(event: MouseEvent | undefined): readonly string[] | undefined {
  if (!event) return undefined;
  const mods = [event.shiftKey && "shift", event.ctrlKey && "ctrl", event.altKey && "alt", event.metaKey && "meta"];
  const present = mods.filter((m): m is string => typeof m === "string");
  return present.length > 0 ? present : undefined;
}

/** 节点的文字：text 属性、spans、或者子孙文字（copy 动作没有 href 时复制它）。 */
function nodeText(node: DocNode, ctx: Pick<TspContext, "taskId" | "sf">): string {
  const { text, spans } = node.p;
  if (typeof text === "string") return text;
  if (Array.isArray(spans)) return spans.map((s: { t?: unknown }) => (typeof s.t === "string" ? s.t : "")).join("");
  return node.c
    .map((id) => peekTspNode(ctx.taskId, ctx.sf, id))
    .filter((child): child is DocNode => child !== null)
    .map((child) => nodeText(child, ctx))
    .filter((part) => part !== "")
    .join(" ");
}

/** 去掉 file:// 前缀和 `:12`、`#L3` 之类的位置后缀，得到可交给文件预览的路径。 */
function hrefToPath(href: string): string {
  let path = href;
  if (/^file:\/\//i.test(path)) {
    path = decodeURIComponent(path.replace(/^file:\/\//i, ""));
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  } else {
    try {
      path = decodeURIComponent(path);
    } catch {
      // 不是 %XX 编码，原样用。
    }
  }
  return path.replace(/#L\d+(?:-L?\d+)?$/, "").replace(/:\d+(?:[:-]\d+)?$/, "");
}

/** 打开一个链接：http(s)/mailto 交给系统浏览器，文件路径在右侧预览。 */
export function openHref(href: string, ctx: Pick<TspContext, "taskId">): void {
  if (/^(https?|mailto):/i.test(href)) {
    window.studio.openExternal(href).catch((error: unknown) => reportErrorNow(error));
    return;
  }
  openFilePreview(ctx.taskId, hrefToPath(href));
}

/**
 * 回答里的本地图片（`![alt](路径)`）：经主进程读（和右侧预览同一条路，只读任务目录里的文件、有大小上限），是图片就返回 data URL，
 * 不是图片、不存在、太大返回 null；在任务目录外时主进程拒绝（Promise 失败）。不在这里拼路径去加载，绕不过主进程的校验。
 */
export async function loadImageHref(href: string, ctx: Pick<TspContext, "taskId">): Promise<string | null> {
  const file = await window.studio.readPreviewFile({ kind: "task", taskId: ctx.taskId }, hrefToPath(href));
  return file.kind === "image" ? (file.dataUrl ?? null) : null;
}

export function copyText(text: string): void {
  const t = createT(currentLocale());
  navigator.clipboard.writeText(text).then(
    () => pushToast({ message: t("common.copied"), durationMs: 1500 }),
    (error: unknown) => reportErrorNow(error),
  );
}

/** omp 每轮用量行里的复制回答图标（点击 = omp 的 copy-answer，复制 markdown 原文）。 */
export const TURN_COPY_ROLE = "omp.turn.copy";

/**
 * 复制回答的纯文本（这条回答渲染出来的文字）：回答是 `from`（回答下方用量行里的按钮）所在的助手容器，正文节点按 answerNodeIds 取，
 * 和复制 markdown 是同一段。取 innerText 时容器挂着 data-copying：代码块头不算、画成图的代码块取源码（markdown.css）；同步摘掉，界面不重绘。
 * 用量行上的纯文本按钮和复制按钮右键菜单都走这里。
 */
export function copyAnswerPlainText(from: Element, ctx: Pick<TspContext, "taskId" | "sf">): void {
  const container = from.closest<HTMLElement>('[data-role="omp.assistant"]');
  const containerId = container?.dataset["id"];
  const surface = peekTspDocument(ctx.taskId)?.surfaces.get(ctx.sf);
  if (!container || containerId === undefined || !surface) return;
  container.dataset["copying"] = "";
  let text: string;
  try {
    text = answerNodeIds(surface, containerId)
      .map((id) => container.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)?.innerText.trim() ?? "")
      .filter((part) => part !== "")
      .join("\n\n");
  } finally {
    delete container.dataset["copying"];
  }
  if (text !== "") copyText(text);
}

/** 回答复制按钮的右键菜单：复制 Markdown（同点击）/ 复制纯文本（copyAnswerPlainText）。不在助手容器里时不拦右键。 */
export function showAnswerCopyMenu(
  event: MouseEvent<Element>,
  ctx: Pick<TspContext, "taskId" | "sf">,
  copyMarkdown: () => void,
): void {
  const button = event.currentTarget;
  if (!button.closest('[data-role="omp.assistant"]') || !peekTspDocument(ctx.taskId)?.surfaces.has(ctx.sf)) return;
  event.preventDefault();
  event.stopPropagation();
  const t = createT(currentLocale());
  showTspMenu({ x: event.clientX, y: event.clientY }, [
    { act: "copy-markdown", label: t("tsp.copyMarkdown"), run: copyMarkdown },
    { act: "copy-plain-text", label: t("tsp.copyPlainText"), run: () => copyAnswerPlainText(button, ctx) },
  ]);
}

/** 执行一个动作名。 */
export function runAction(act: string, node: DocNode, ctx: TspContext, own?: OwnActions, event?: MouseEvent): void {
  switch (act) {
    case "toggle":
      own?.toggle?.();
      return;
    case "zoom":
      own?.zoom?.();
      return;
    case "copy": {
      const text = typeof node.p.href === "string" ? node.p.href : nodeText(node, ctx);
      if (text !== "") copyText(text);
      return;
    }
    case "open":
      if (typeof node.p.href === "string") openHref(node.p.href, ctx);
      return;
    case "rewind": {
      // omp 在用户消息卡片上画的"回退"图标（它自己的回退选择器）：studio 接管，打开会话树面板并对准这条消息（docs/architecture/session-tree.md）。
      const document = peekTspDocument(ctx.taskId);
      const fromEnd = document === null ? null : userCardFromEnd(document, ctx.sf, node.id);
      openSessionTree(ctx.taskId, fromEnd ?? undefined);
      return;
    }
    case "select":
    case "activate":
      ctx.send({ ev: act, sf: ctx.sf, id: node.id, item: node.id });
      return;
    default: {
      // hud 里 `👥` 胶囊（omp.hud.seg）的点击 = 打开 omp 的 Agent Hub：studio 改开右栏的子代理面板（spec §4.28），不把动作发给 omp。
      if (isHubOpenAction(act)) {
        openAgentsPanel(ctx.taskId);
        return;
      }
      const mods = modifiers(event);
      ctx.send(
        mods ? { ev: "action", sf: ctx.sf, id: node.id, act, mods } : { ev: "action", sf: ctx.sf, id: node.id, act },
      );
    }
  }
}

function endedSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/**
 * 把节点的 `actions`（和 `title` 提示）变成 React 事件属性，直接展开到元素上。
 * 点击会 stopPropagation：嵌套的两个可点节点（模型行里的思考强度图标）只触发最里面那个。
 */
export function nodeActionHandlers(node: DocNode, ctx: TspContext, own?: OwnActions): ActionHandlers {
  const handlers: ActionHandlers = {};
  if (typeof node.p.title === "string") handlers.title = node.p.title;
  const actions = node.p.actions;
  if (!isRecord(actions)) return handlers;
  const { click, dblclick } = actions;
  if (typeof click === "string") {
    handlers.onClick = (event) => {
      if (endedSelection()) return;
      event.stopPropagation();
      runAction(click, node, ctx, own, event);
    };
  }
  if (typeof dblclick === "string") {
    handlers.onDoubleClick = (event) => {
      event.stopPropagation();
      runAction(dblclick, node, ctx, own, event);
    };
  }
  if (typeof click === "string" || typeof dblclick === "string") handlers.className = "tsp-act";
  if (node.p.role === TURN_COPY_ROLE && typeof click === "string") {
    handlers.onContextMenu = (event) => showAnswerCopyMenu(event, ctx, () => runAction(click, node, ctx, own));
  }
  const menu = Array.isArray(actions.menu) ? actions.menu.filter((a): a is string => typeof a === "string") : [];
  if (menu.length > 0) {
    handlers.onContextMenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      // 规范：menu 列出的动作后面接 Copy（没列 copy 时）。
      const items = menu.includes("copy") ? menu : [...menu, "copy"];
      showTspMenu(
        { x: event.clientX, y: event.clientY },
        items.map((act) => ({ act, run: () => runAction(act, node, ctx, own) })),
      );
    };
  }
  return handlers;
}

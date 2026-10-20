// 节点上的指针动作（规范 Elements `actions`）：click / dblclick / menu 里写的动作名怎么执行。
//   终端自己做：toggle（翻折叠）、copy（复制文字并提示）、open（打开 href）、zoom（放大图片）、select / activate（发同名事件）；
//   其它名字原样发 `action` 事件（{ev:"action", sf, id, act, mods?}）交给 omp。
import type { MouseEvent } from "react";
import { createT } from "../../../../shared/i18n/index.ts";
import type { DocNode } from "../../../../shared/tsp/document.ts";
import { currentLocale } from "../../store/settings-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { openFilePreview } from "../file-preview/index.ts";
import type { TspContext } from "./node-props.ts";
import { peekTspNode } from "./tsp-store.ts";
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
export function nodeText(node: DocNode, ctx: Pick<TspContext, "taskId" | "sf">): string {
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
export function hrefToPath(href: string): string {
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

export function copyText(text: string): void {
  const t = createT(currentLocale());
  navigator.clipboard.writeText(text).then(
    () => pushToast({ message: t("common.copied"), durationMs: 1500 }),
    (error: unknown) => reportErrorNow(error),
  );
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
    case "select":
    case "activate":
      ctx.send({ ev: act, sf: ctx.sf, id: node.id, item: node.id });
      return;
    default: {
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

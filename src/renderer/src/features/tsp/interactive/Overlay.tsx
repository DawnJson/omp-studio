// `overlay`：layer 里的浮层卡片（斜杠菜单、弹出的选择、对话框）。根铺满 layer 但放行指针；
// 卡片按 anchor 定位：center / top / bottom 用 CSS；{node} 贴着某个节点；{caret} 贴在输入框光标下方（放不下翻到上方）。
// overlay 不拿键盘：键盘仍归 omp（输入框把 ↑↓ 在 overlay 打开时发给 omp，见 keys.ts）。
import { useEffect, useLayoutEffect, useRef } from "react";
import type { TspOverlayProps } from "../../../../../shared/tsp/tsp.generated.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";
import { TspChildren } from "../TspChildren.tsx";
import { caretRect, registerCaretOverlay, useCaretVersion } from "./caret-registry.ts";
import { shouldSendOverlayEsc, type EscTarget } from "../../../../../shared/tsp/overlay-esc.ts";
import { plainText } from "./text-model.ts";

const ESC = "\x1b";
const EDGE = 8;
const GAP = 4;
/** 卡片左边比光标靠左这么多，行里的字和输入框里打的字对齐。 */
const CARET_INSET = 10;

type Anchor = NonNullable<TspOverlayProps["anchor"]>;

function anchorClass(anchor: Anchor | undefined): string {
  if (anchor === "top") return "at-top";
  if (anchor === "bottom") return "at-bottom";
  if (typeof anchor === "object" && anchor !== null) {
    if ("caret" in anchor) return "at-caret";
    if ("node" in anchor) return "at-node";
  }
  return "at-center";
}

function defaultSize(anchor: Anchor | undefined): "sm" | "md" {
  return typeof anchor === "object" && anchor !== null ? "sm" : "md";
}

export function Overlay(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p as unknown as TspOverlayProps & { role?: string };
  const anchor = p.anchor;
  const at = anchorClass(anchor);
  const size =
    p.size === "sm" || p.size === "md" || p.size === "lg" || p.size === "full" ? p.size : defaultSize(anchor);
  const head = p.head !== undefined && plainText(p.head).trim() !== "" ? p.head : undefined;
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const caretId = typeof anchor === "object" && anchor !== null && "caret" in anchor ? anchor.caret : null;
  const nodeId = typeof anchor === "object" && anchor !== null && "node" in anchor ? anchor.node : null;
  const side = typeof anchor === "object" && anchor !== null && "node" in anchor ? anchor.side : "below";
  const caretVersion = useCaretVersion();

  useEffect(() => (caretId === null ? undefined : registerCaretOverlay(ctx.sf, caretId)), [ctx.sf, caretId]);

  // 贴着锚点定位：每次渲染、窗口 / layer 尺寸变了都重新放。
  useLayoutEffect(() => {
    const el = card.current;
    const host = root.current;
    if (!el || !host || (caretId === null && nodeId === null)) return;
    const place = () => {
      const anchorRect =
        caretId !== null
          ? caretRect(ctx.sf, caretId)
          : (host.ownerDocument
              .querySelector<HTMLElement>(`[data-id="${CSS.escape(nodeId ?? "")}"]`)
              ?.getBoundingClientRect() ?? null);
      el.classList.toggle("lost", anchorRect === null);
      if (anchorRect === null) return;
      const hostRect = host.getBoundingClientRect();
      el.style.maxHeight = "";
      const width = el.offsetWidth;
      const naturalHeight = el.offsetHeight;
      const below = hostRect.bottom - anchorRect.bottom - GAP - EDGE;
      const above = anchorRect.top - hostRect.top - GAP - EDGE;
      const preferBelow = caretId !== null || side !== "above";
      const useBelow = preferBelow
        ? below >= naturalHeight || below >= above
        : !(above >= naturalHeight || above >= below);
      const room = Math.max(0, useBelow ? below : above);
      const height = Math.min(naturalHeight, room);
      el.style.maxHeight = `${room}px`;
      el.classList.toggle("above", !useBelow);
      const leftWanted = anchorRect.left - hostRect.left - (caretId !== null ? CARET_INSET : 0);
      const left = Math.max(EDGE, Math.min(leftWanted, hostRect.width - width - EDGE));
      const top = useBelow ? anchorRect.bottom - hostRect.top + GAP : anchorRect.top - hostRect.top - GAP - height;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(host);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // caretVersion 只是触发重渲染（光标动了）；effect 无依赖，每次渲染都重新放。
  void caretVersion;

  // Esc 关弹窗：弹窗没有关闭动作，关它就是把 Esc 键交给 omp。键盘焦点多半在 studio 的输入框（不在 tsp-view 里），所以在 window 的捕获阶段截；
  // 先于输入框的 Esc 处理，也先于 Composer 的"Esc 停止任务"（那个看 defaultPrevented）。锚在光标 / 节点上的补全菜单不算弹窗，输入框自己处理。
  const dismissable = caretId === null && nodeId === null;
  useEffect(() => {
    if (!dismissable) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const self = root.current;
      const view = self?.closest('[data-testid="tsp-view"]');
      if (!self || !view) return;
      const dismissables = view.querySelectorAll(".tspi-overlay:not(.at-caret):not(.at-node)");
      const target = event.target;
      let where: EscTarget = "other";
      if (!(target instanceof Element)) where = "body";
      else if (target === document.body) where = "body";
      else if (target.closest('[data-testid="composer-input"]') !== null) where = "composer";
      else if (view.contains(target))
        where = target.closest("textarea, input, [data-tspi-keys]") === null ? "view" : "self-routing";
      if (
        !shouldSendOverlayEsc({
          key: event.key,
          defaultPrevented: event.defaultPrevented,
          composing: event.isComposing || event.keyCode === 229,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          target: where,
          isTop: dismissables[dismissables.length - 1] === self,
          pickerOpen: view.querySelector(".tspi-picker") !== null,
        })
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      ctx.keys(ESC);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ctx, dismissable]);

  const roleName =
    typeof p.role === "string" && p.role.startsWith("omp.overlay.") ? p.role.slice("omp.overlay.".length) : null;

  return (
    <div
      ref={root}
      {...nodeDomProps(props, ["tspi-overlay", `sz-${size}`, at, p.modal ? "modal" : ""].filter(Boolean).join(" "), {
        pointer: false,
        noTitle: true,
      })}
    >
      {p.modal ? <div className="tspi-ov-dim" aria-hidden="true" /> : null}
      <div
        ref={card}
        className={head === undefined ? "tspi-ov-card nohead" : "tspi-ov-card"}
        role="dialog"
        aria-modal={p.modal ? true : undefined}
        aria-label={head === undefined ? undefined : plainText(head)}
      >
        {head !== undefined ? (
          <div className="tspi-ov-head">
            {roleName !== null ? (
              <span className="tspi-ov-ic" aria-hidden="true">
                <TspIcon name={roleName} size={14} />
              </span>
            ) : null}
            <span className="tspi-ov-title">
              <TspSpans text={head} />
            </span>
          </div>
        ) : null}
        <div className="tspi-ov-body">
          <TspChildren node={node} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

// 状态条：status 和 seg（规范 Bars, Toasts and Overlays；toast / overlay 在 interactive/）。
import { useLayoutEffect, useRef } from "react";
import type { TspText } from "../../../../../shared/tsp/tsp.generated.ts";
import { resolveIconName } from "../icon-names.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { asNumber } from "../props-util.ts";
import { TspSpans } from "../spans.tsx";
import { TspNode } from "../TspChildren.tsx";
import { peekTspNode } from "../tsp-store.ts";

export function Seg(props: NodeProps) {
  const { node } = props;
  const p = node.p;
  const text = typeof p.text === "string" ? p.text : undefined;
  const spans = (Array.isArray(p.spans) ? p.spans : text) as TspText | undefined;
  // role 是 omp.status.<图标> 时，没写 icon 就按它取图标。
  const roleIcon =
    typeof p.role === "string" && p.role.startsWith("omp.status.") ? p.role.slice("omp.status.".length) : undefined;
  const icon = typeof p.icon === "string" ? p.icon : roleIcon;
  const shrinks = typeof p.min === "object" && p.min !== null;
  return (
    <div
      {...nodeDomProps(props, "tsp-seg", {
        className: shrinks ? "shrinks" : undefined,
        style: { minWidth: shrinks ? 0 : undefined },
      })}
      data-priority={asNumber(p.priority) ?? 0}
    >
      {icon !== undefined && resolveIconName(icon) !== null && (
        <span className="tsp-seg-ic">
          <TspIcon name={icon} size={12} />
        </span>
      )}
      {node.c.length > 0 && (
        <span className="tsp-seg-k">
          {node.c.map((id) => (
            <TspNode key={id} id={id} ctx={props.ctx} />
          ))}
        </span>
      )}
      <span className="tsp-seg-t">
        <TspSpans text={spans} />
      </span>
    </div>
  );
}

/** 条的排版指纹：条宽，左右两组里每一项的 priority 和宽度（藏着的取文字）。只读，不改 DOM。指纹没变，藏哪些也不用变。 */
function layoutKey(row: HTMLElement): string {
  let key = String(row.clientWidth);
  for (const item of row.querySelectorAll<HTMLElement>(":scope > * > *")) {
    const size = item.classList.contains("tsp-drop") ? `-${item.textContent}` : String(item.offsetWidth);
    key += `|${item.dataset["priority"] ?? ""}:${size}`;
  }
  return key;
}

/** 条放不下时先藏 priority 最低的 seg（同级先藏靠里的），最后一个留着并截断。返回藏好以后的排版指纹。
 *  和上次量完的指纹一样（计时走字、文字变了宽度没变）就只读一次排版、什么都不改。
 *  要重新算时按要藏几个二分（藏得越多越放得下）：每次试探只写一次 class、读一次宽度，从当前藏的个数开始试；
 *  class 没变的 toggle 不触发重算样式。 */
function fit(row: HTMLElement, lastKey: string): string {
  const before = layoutKey(row);
  if (before === lastKey) return before;
  const segs = [...row.querySelectorAll<HTMLElement>(":scope .tsp-seg[data-priority]")];
  const order = segs
    .map((seg, index) => ({ seg, index, priority: Number(seg.dataset["priority"] ?? 0) }))
    .sort((a, b) => a.priority - b.priority || b.index - a.index);
  const dropFirst = (count: number): void => {
    order.forEach(({ seg }, rank) => seg.classList.toggle("tsp-drop", rank < count));
  };
  let lo = 0;
  let hi = Math.max(0, segs.length - 1);
  let probe = Math.min(hi, segs.filter((seg) => seg.classList.contains("tsp-drop")).length);
  while (lo < hi) {
    dropFirst(probe);
    if (row.scrollWidth > row.clientWidth + 0.5) lo = probe + 1;
    else hi = probe;
    probe = (lo + hi) >> 1;
  }
  dropFirst(lo);
  return layoutKey(row);
}

export function Status(props: NodeProps) {
  const { node, ctx } = props;
  const row = useRef<HTMLDivElement>(null);
  const left: string[] = [];
  const right: string[] = [];
  for (const id of node.c) {
    const child = peekTspNode(ctx.taskId, ctx.sf, id);
    (child?.k === "seg" && child.p.side === "right" ? right : left).push(id);
  }
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    let key = "";
    const run = (): void => {
      key = fit(el, key);
    };
    // 条和每一项的尺寸变了才重新量：ResizeObserver 在浏览器自己排版之后回调（第一次也是，不在挂载时强制排版），
    // 计时走字这类宽度没变的文字变化不回调，不再每一跳都读一次排版。
    const resize = new ResizeObserver(run);
    resize.observe(el);
    const watched = new WeakSet<Element>();
    const watchItems = (): void => {
      for (const item of el.querySelectorAll(":scope > * > *")) {
        if (watched.has(item)) continue;
        watched.add(item);
        resize.observe(item);
      }
    };
    watchItems();
    // 量不到尺寸的变化：项增删、priority 变了、藏着的项（display: none）文字变了（指纹里记的是它的文字）。
    const mutation = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;
        if (record.type === "attributes" || target?.parentElement === el) {
          watchItems();
          changed = true;
        } else if (target?.closest(".tsp-drop")) changed = true;
      }
      if (changed) run();
    });
    mutation.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-priority"],
    });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);
  return (
    <div
      {...nodeDomProps(props, "tsp-status", {
        className: props.node.p.transparent === true ? "transparent" : undefined,
      })}
      role="group"
    >
      <div className="tsp-st-row" ref={row}>
        <div className="tsp-st-l">
          {left.map((id) => (
            <TspNode key={id} id={id} ctx={ctx} />
          ))}
        </div>
        <div className="tsp-st-r">
          {right.map((id) => (
            <TspNode key={id} id={id} ctx={ctx} />
          ))}
        </div>
      </div>
    </div>
  );
}

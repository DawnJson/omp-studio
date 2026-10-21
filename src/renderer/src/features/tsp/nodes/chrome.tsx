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

/** 条放不下时先藏 priority 最低的 seg（同级先藏靠里的），最后一个留着并截断。 */
function fit(row: HTMLElement): void {
  const segs = [...row.querySelectorAll<HTMLElement>(":scope .tsp-seg[data-priority]")];
  for (const seg of segs) seg.classList.remove("tsp-drop");
  const order = segs
    .map((seg, index) => ({ seg, index, priority: Number(seg.dataset["priority"] ?? 0) }))
    .sort((a, b) => a.priority - b.priority || b.index - a.index);
  let kept = segs.length;
  for (const { seg } of order) {
    if (row.scrollWidth <= row.clientWidth + 0.5 || kept <= 1) break;
    seg.classList.add("tsp-drop");
    kept -= 1;
  }
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
    const run = (): void => fit(el);
    run();
    const resize = new ResizeObserver(run);
    resize.observe(el);
    // seg 里的文字变了不会重画 status，盯着内容变化重新量。
    const mutation = new MutationObserver(run);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  });
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

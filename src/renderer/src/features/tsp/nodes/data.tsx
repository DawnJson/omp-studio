// 数据类节点：kv、table、tree、badge、kbd、icon、image（规范 Data）。
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { markHeight, piWidth } from "../../../../../shared/ui/pixel-pi.ts";
import type { TspText, TspTableColumn, TspTreeNode } from "../../../../../shared/tsp/tsp.generated.ts";
import { isRecord } from "../../../../../shared/type-guards.ts";
import { useT } from "../../../i18n/use-t.ts";
import { ChevronRight } from "../../../icons.tsx";
import { PiMark } from "../../../ui/PiMark.tsx";
import { extentToCss, keycapLabel } from "../fmt.ts";
import { TspIcon } from "../icons.tsx";
import { nodeDomProps } from "../node-dom.ts";
import type { NodeProps } from "../node-props.ts";
import { asArray, asString } from "../props-util.ts";
import { plainText, TspSpans } from "../spans.tsx";
import { TspChildren } from "../TspChildren.tsx";
import { peekTspBlob, peekTspNode, useTspBlob } from "../tsp-store.ts";
import { openZoom } from "../zoom-store.ts";
import { MeterView } from "./motion.tsx";

// ───────── kv ─────────

export function Kv(props: NodeProps) {
  const items = asArray(props.node.p.items).filter(isRecord);
  const inline = props.node.p.layout === "inline";
  return (
    <div {...nodeDomProps(props, "tsp-kv", { className: inline ? "inline" : undefined })}>
      {items.map((item, index) => (
        <div key={index} className={index === 0 ? "tsp-kv-item first" : "tsp-kv-item"}>
          {inline && index > 0 && (
            <span className="tsp-kv-sep" aria-hidden="true">
              ·
            </span>
          )}
          <div className="tsp-kv-k">
            <TspSpans text={item.k as TspText | undefined} />
          </div>
          <div className="tsp-kv-v">
            <TspSpans text={item.v as TspText | undefined} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────── table ─────────

type Cell = TspText | { meter: Record<string, unknown> } | undefined;

function cellText(cell: Cell): string {
  if (cell === undefined || (typeof cell === "object" && !Array.isArray(cell) && "meter" in cell)) return "";
  return plainText(cell as TspText);
}

/** 按优先级藏列：估算每列自然宽度（字数 × 字宽 + 14px 内边距），装不下就先藏 priority 最低（同级藏最右）的。 */
function visibleColumns(
  cols: readonly TspTableColumn[],
  rows: readonly { cells: Readonly<Record<string, unknown>> }[],
  width: number,
  charWidth: number,
): Set<string> {
  const natural = (col: TspTableColumn): number => {
    let chars = col.head === undefined ? 0 : plainText(col.head).length;
    for (const row of rows) {
      const cell = row.cells[col.id];
      chars = Math.max(chars, cell === undefined ? 0 : cellText(cell as Cell).length || 8);
    }
    return Math.min(col.grow ? 24 : Number.POSITIVE_INFINITY, chars) * charWidth + 14;
  };
  const shown = [...cols];
  let total = shown.reduce((sum, col) => sum + natural(col), 0);
  while (shown.length > 1 && total > width) {
    let drop = 0;
    shown.forEach((col, i) => {
      const a = col.priority ?? 0;
      const b = shown[drop]!.priority ?? 0;
      if (a < b || (a === b && i > drop)) drop = i;
    });
    total -= natural(shown[drop]!);
    shown.splice(drop, 1);
  }
  return new Set(shown.map((col) => col.id));
}

export function Table(props: NodeProps) {
  const cols = asArray(props.node.p.cols).filter(isRecord) as unknown as TspTableColumn[];
  const rows = asArray(props.node.p.rows).filter(isRecord) as unknown as {
    id: string;
    cells: Record<string, unknown>;
  }[];
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Set<string> | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = (): void => {
      const cw = Number.parseFloat(getComputedStyle(el).getPropertyValue("--tsp-cw")) || 7.8;
      setShown(visibleColumns(cols, rows, el.clientWidth, cw));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cols, rows]);

  const visible = cols.filter((col) => shown === null || shown.has(col.id));
  const hasHead = visible.some((col) => col.head !== undefined && plainText(col.head) !== "");
  const template = visible.map((col) => ((col.grow ?? 0) > 0 ? `minmax(0, ${col.grow}fr)` : "auto")).join(" ");
  const align = (col: TspTableColumn): string =>
    col.align === "end" || col.align === "center" ? ` ta-${col.align}` : "";
  return (
    <div {...nodeDomProps(props, "tsp-table")} ref={root}>
      <div className="tsp-tbl" role="table" style={{ gridTemplateColumns: template }}>
        {hasHead &&
          visible.map((col) => (
            <div key={`h:${col.id}`} className={`tsp-tbl-h${align(col)}`} role="columnheader">
              <TspSpans text={col.head} />
            </div>
          ))}
        {rows.map((row, r) =>
          visible.map((col) => {
            const cell = row.cells[col.id] as Cell;
            const last = r === rows.length - 1 ? " last" : "";
            if (isRecord(cell) && isRecord(cell.meter)) {
              return (
                <div key={`${row.id}:${col.id}`} className={`tsp-tbl-c meter${last}`} role="cell">
                  <MeterView p={cell.meter} />
                </div>
              );
            }
            return (
              <div
                key={`${row.id}:${col.id}`}
                className={`tsp-tbl-c${align(col)}${last}${col.truncate === "start" ? " trunc-start" : ""}`}
                role="cell"
              >
                <TspSpans text={cell as TspText | undefined} />
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}

// ───────── tree ─────────

interface OpenEntry {
  prop: boolean;
  value: boolean;
}

function TreeItems({
  items,
  depth,
  open,
  toggle,
}: {
  items: readonly TspTreeNode[];
  depth: number;
  open: (item: TspTreeNode) => boolean;
  toggle: (item: TspTreeNode) => void;
}) {
  const t = useT();
  return (
    <>
      {items.map((item) => {
        const kids = item.children?.length ? item.children : null;
        const isOpen = kids !== null && open(item);
        return (
          <div
            key={item.id}
            className={isOpen || kids === null ? "tsp-tree-node" : "tsp-tree-node shut"}
            role="treeitem"
            aria-expanded={kids === null ? undefined : isOpen}
          >
            <div
              className={kids === null ? "tsp-tree-row leaf" : "tsp-tree-row"}
              style={{ "--d": depth } as CSSProperties}
            >
              <button
                type="button"
                className="tsp-tree-tw"
                tabIndex={kids === null ? -1 : 0}
                aria-label={isOpen ? t("common.close") : t("common.expand")}
                onClick={() => kids !== null && toggle(item)}
              >
                {kids !== null && <ChevronRight size={12} className={isOpen ? "open" : undefined} />}
              </button>
              <span className="tsp-tree-ic">
                <TspIcon name={item.icon} />
              </span>
              <div className="tsp-tree-lbl">
                <TspSpans text={item.label} />
              </div>
            </div>
            {isOpen && kids !== null && (
              <div className="tsp-tree-kids" role="group">
                <TreeItems items={kids} depth={depth + 1} open={open} toggle={toggle} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function Tree(props: NodeProps) {
  const { node, ctx } = props;
  const nodes = asArray(node.p.nodes).filter(isRecord) as unknown as TspTreeNode[];
  // 本地展开状态（规范：点箭头立刻生效，记在 item id 上，直到程序发来一个不同的 open 才被覆盖）。
  const [local, setLocal] = useState<Readonly<Record<string, OpenEntry>>>({});
  const open = (item: TspTreeNode): boolean => {
    const entry = local[item.id];
    const prop = item.open === true;
    return entry !== undefined && entry.prop === prop ? entry.value : prop;
  };
  const toggle = (item: TspTreeNode): void => {
    const next = !open(item);
    setLocal((prev) => ({ ...prev, [item.id]: { prop: item.open === true, value: next } }));
    ctx.send({ ev: "toggle", sf: ctx.sf, id: node.id, key: item.id, collapsed: !next });
  };
  return (
    <div {...nodeDomProps(props, "tsp-tree")} role="tree">
      <TreeItems items={nodes} depth={0} open={open} toggle={toggle} />
    </div>
  );
}

// ───────── badge / kbd / icon ─────────

export function Badge(props: NodeProps) {
  return <span {...nodeDomProps(props, "tsp-badge")}>{asString(props.node.p.text) ?? ""}</span>;
}

export function Kbd(props: NodeProps) {
  const keys = asArray(props.node.p.keys).filter((key): key is string => typeof key === "string");
  const spoken = typeof props.node.p.aria === "string" ? undefined : keys.join(" ");
  return (
    <span {...nodeDomProps(props, "tsp-kbd")} role={spoken ? "img" : undefined} aria-label={spoken}>
      {keys.map((key, index) => (
        <kbd key={index} className="tsp-key">
          {keycapLabel(key)}
        </kbd>
      ))}
    </span>
  );
}

export function Icon(props: NodeProps) {
  const label = typeof props.node.p.aria === "string";
  return (
    <span {...nodeDomProps(props, "tsp-icon")} aria-hidden={label ? undefined : true}>
      <TspIcon name={asString(props.node.p.name)} />
    </span>
  );
}

// ───────── image ─────────

function dataUrl(mime: string | null, data: string): string {
  return `data:${mime ?? "application/octet-stream"};base64,${data}`;
}

export function Image(props: NodeProps) {
  const t = useT();
  const { node, ctx } = props;
  const p = node.p;
  const blob = useTspBlob(ctx.taskId, asString(p.blob));
  const alt = asString(p.alt) ?? "";
  const w = typeof p.w === "number" && p.w > 0 ? p.w : undefined;
  const h = typeof p.h === "number" && p.h > 0 ? p.h : undefined;
  const maxH = extentToCss(isRecord(p.max) ? p.max.h : undefined);
  const src = useMemo(() => (blob ? dataUrl(blob.mime, blob.data) : null), [blob]);
  const missing = p.builtin !== "omp" && (src === null || !(blob?.mime ?? "").startsWith("image/"));

  // zoom：同一个父节点下的 blob 图一起翻。
  const zoom = (): void => {
    if (src === null) return;
    const parent = node.parent === null ? null : peekTspNode(ctx.taskId, ctx.sf, node.parent);
    const items: { src: string; alt: string; id: string }[] = [];
    for (const id of parent?.c ?? [node.id]) {
      const sibling = peekTspNode(ctx.taskId, ctx.sf, id);
      const siblingBlob = sibling?.k === "image" ? peekTspBlob(ctx.taskId, asString(sibling.p.blob)) : null;
      if (sibling && siblingBlob && (siblingBlob.mime ?? "").startsWith("image/")) {
        items.push({ src: dataUrl(siblingBlob.mime, siblingBlob.data), alt: asString(sibling.p.alt) ?? "", id });
      }
    }
    const index = items.findIndex((item) => item.id === node.id);
    openZoom(index >= 0 ? items : [{ src, alt }], Math.max(index, 0));
  };

  const dom = nodeDomProps(props, "tsp-image", {
    className: p.builtin === "omp" ? "builtin" : missing ? "missing" : "zoom",
    style: { overflow: "visible" },
    own: { zoom },
  });
  // 默认的点击是 zoom；节点自己有 click 动作时用它的。
  if (!dom.onClick && !missing && p.builtin !== "omp") dom.onClick = zoom;

  let picture;
  if (p.builtin === "omp") {
    picture = (
      <svg
        viewBox={`0 0 ${piWidth} ${markHeight}`}
        width={w === undefined ? 56 : Math.round(w / 2.25)}
        shapeRendering="crispEdges"
        role="img"
        aria-label={alt}
      >
        <PiMark />
      </svg>
    );
  } else if (missing) {
    picture = (
      <div
        className="tsp-img-card"
        role="img"
        aria-busy={blob === null}
        title={blob === null ? t("tsp.imageNotArrived") : t("tsp.imageUnavailable")}
        aria-label={alt}
      >
        <TspIcon name="image" />
        <span className="tsp-img-alt">
          {alt || (blob === null ? t("tsp.imageLoading") : t("tsp.imageUnavailable"))}
        </span>
      </div>
    );
  } else {
    picture = (
      <img
        className="tsp-img-frame"
        src={src ?? undefined}
        alt={alt}
        width={w}
        height={h}
        style={{ maxHeight: maxH }}
        draggable={false}
      />
    );
  }
  return (
    <div {...dom}>
      {picture}
      {node.c.length > 0 && (
        <div className="tsp-img-over">
          <TspChildren {...props} />
        </div>
      )}
    </div>
  );
}

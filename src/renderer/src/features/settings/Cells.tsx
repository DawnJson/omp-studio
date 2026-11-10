// 设置页的格子排法（spec §4.19，2026-11-09 仓库所有者定）：列宽至少 --cell-min（settings.css），能放几列放几列；
// 每格按"标签不折行 + 控件"的实际宽度占一列或几列；按原来的顺序逐行往前填（先填前面行的空位，宽的格子放不下就往后挪），行里不留空位。
// 只占一行、没填满的小组（Group）和相邻的小组并排（Groups 是整页共用列的网格，小组按占的列数排进去）。
import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { packCells } from "../../../../shared/ui/cell-packing.ts";

/** 列在哪个网格上算：在 Groups 里是整页的网格（格子是它的 subgrid），否则是格子自己。 */
function columnsOf(root: HTMLElement): { cols: number; colWidth: number; gap: number } {
  const style = getComputedStyle(root);
  const tracks = style.gridTemplateColumns
    .split(" ")
    .map((track) => Number.parseFloat(track))
    .filter(Number.isFinite);
  return { cols: tracks.length, colWidth: tracks[0] ?? 0, gap: Number.parseFloat(style.columnGap) || 0 };
}

/** 每格不折行时的宽：临时把各格排成 max-content 的一行量出来，再还原（同一帧里，不会画出来）。
 * data-measuring 期间标签和控件不换行、文本框按原宽算（settings.css）。 */
function naturalWidths(el: HTMLElement): number[] {
  const kids = [...el.children] as HTMLElement[];
  const template = el.style.gridTemplateColumns;
  const spans = kids.map((kid) => kid.style.gridColumn);
  el.dataset["measuring"] = "";
  el.style.gridTemplateColumns = `repeat(${kids.length}, max-content)`;
  for (const kid of kids) kid.style.gridColumn = "auto";
  const widths = kids.map((kid) => Math.ceil(kid.getBoundingClientRect().width));
  el.style.gridTemplateColumns = template;
  kids.forEach((kid, index) => (kid.style.gridColumn = spans[index] ?? ""));
  delete el.dataset["measuring"];
  return widths;
}

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key, index) => key === b[index]);

export function Cells({
  className,
  testId,
  children,
}: {
  className?: string | undefined;
  testId?: string | undefined;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const items = Children.toArray(children).filter(isValidElement) as ReactElement[];
  const byKey = new Map(items.map((item) => [String(item.key), item]));
  const natural = items.map((item) => String(item.key));
  // 排好的顺序（key）；新出现的项先接在后面，下一次排的时候放进去。
  const [order, setOrder] = useState<readonly string[]>([]);
  const keys = [...order.filter((key) => byKey.has(key)), ...natural.filter((key) => !order.includes(key))];
  const state = useRef({ keys, natural });
  state.current = { keys, natural };

  const pack = useRef(() => {
    const el = ref.current;
    if (el === null) return;
    const root = el.closest<HTMLElement>(".st-groups") ?? el;
    const { cols, colWidth, gap } = columnsOf(root);
    if (cols === 0) return;
    const { keys: rendered, natural: source } = state.current;
    const widths = naturalWidths(el);
    const widthOf = new Map(rendered.map((key, index) => [key, widths[index] ?? 0]));
    const packed = packCells(
      source.map((key) => widthOf.get(key) ?? 0),
      cols,
      colWidth,
      gap,
    );
    const next = packed.order.map((index) => source[index]!);
    if (!sameOrder(next, rendered)) {
      setOrder(next);
      return; // 重排后的这一次渲染再设跨列
    }
    const kids = [...el.children] as HTMLElement[];
    kids.forEach((kid, index) => {
      const span = packed.spans[packed.order[index]!] ?? 1;
      const value = span > 1 ? `span ${span}` : "";
      if (kid.style.gridColumn !== value) kid.style.gridColumn = value;
    });
    // 只占一行、没填满的小组：只占用到的列，后面的小组可以排在同一行。
    const group = el.parentElement;
    if (group?.classList.contains("st-group") && group.dataset["packable"] !== undefined) {
      const value = packed.rows === 1 && packed.used < cols ? `span ${packed.used}` : "";
      if (group.style.gridColumn !== value) group.style.gridColumn = value;
    }
  });

  // 每次渲染都重排：文字、选项、语言变了，格子的宽就跟着变。
  useLayoutEffect(() => pack.current());
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const root = el.closest<HTMLElement>(".st-groups") ?? el;
    let width = root.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = root.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      pack.current();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className === undefined ? "st-cells" : `st-cells ${className}`} data-testid={testId}>
      {keys.map((key) => byKey.get(key))}
    </div>
  );
}

/** 一页里连续的分组：共用一套列，只占一行的小组可以并排。 */
export function Groups({ className, children }: { className?: string | undefined; children: ReactNode }) {
  return <div className={className === undefined ? "st-groups" : `st-groups ${className}`}>{children}</div>;
}

/**
 * 一个分组（小标题 + 格子）。`packable`：组里只有小标题和一组 Cells，只占一行时可以和别的小组并排；
 * 带了别的内容（模型页的角色表）就总是整行。其余属性给高级页的锚点和测试用。
 */
export function Group({
  packable = true,
  children,
  ...rest
}: {
  packable?: boolean;
  children: ReactNode;
  id?: string | undefined;
  tabIndex?: number | undefined;
  className?: string | undefined;
  "data-prefix"?: string | undefined;
  "data-testid"?: string | undefined;
}) {
  const { className, ...attrs } = rest;
  return (
    <section
      {...attrs}
      className={className === undefined ? "st-group" : `st-group ${className}`}
      data-packable={packable ? "" : undefined}
    >
      {children}
    </section>
  );
}

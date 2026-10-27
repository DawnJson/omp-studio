// `list` / `item`（规范 elements-lists.md）。选中项由 omp 决定：单击发 `select`，双击发 `activate`，id 是 list、item 是 item 节点 id。
// 再点已选中的行也算 activate（和 picker 的规则一致），审批门的选项一下就能点；双击不会重复激活。
// 多选提问的选项（`omp.ask.check`）例外：单击永远是 `select`（omp 把它当勾选切换），双击不 activate（规则在 shared/tsp/ask-gate.ts）。
// 方向键、Enter 这些归 omp：list 自己可聚焦，按键用 keys.ts 编码写进伪终端。
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { askItemClick, askItemDoubleActivates, askItemMarker } from "../../../../../shared/tsp/ask-gate.ts";
import { Badge } from "../../../ui/controls.tsx";
import type { TspItemProps, TspListProps } from "../../../../../shared/tsp/tsp.generated.ts";
import { nodeActionHandlers } from "../actions.ts";
import { TspIcon } from "../icons.tsx";
import { encodeKey } from "../keys.ts";
import type { NodeProps, TspContext } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";
import { useTspSurface } from "../tsp-store.ts";
import { TspChildren, TspNode } from "../TspChildren.tsx";
import { nodeDomProps } from "../node-dom.ts";
import { VIRTUAL_MIN_ITEMS } from "./list-virtual.ts";
import { useVirtualList } from "./use-virtual-list.ts";
import { likeOf } from "./key-event.ts";
import { MarkedText } from "./MarkedText.tsx";
import { filterHits, plainText } from "./text-model.ts";

interface ListState {
  listId: string;
  selected: string | null;
  filter: string;
}

const ListContext = createContext<ListState | null>(null);

/** 同一个 item 600ms 内只激活一次（点已选中行 + 随后的 dblclick）。 */
const ACTIVATE_DEBOUNCE_MS = 600;

function maxHeight(max: TspListProps["max"]): string | undefined {
  if (typeof max === "number") return max > 0 ? `${max * 100}vh` : undefined;
  if (max && typeof max.lines === "number" && max.lines > 0) {
    return `calc(${max.lines} * (var(--lh-sm) + var(--space-1-5)))`;
  }
  return undefined;
}

export function List(props: NodeProps) {
  const { node, ctx } = props;
  const p = node.p as TspListProps;
  const selected = p.selected ?? null;
  const cap = maxHeight(p.max);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const virtual = p.virtual === true && node.c.length >= VIRTUAL_MIN_ITEMS;
  const win = useVirtualList(body, node.c.length, virtual);
  const surface = useTspSurface(ctx.taskId, ctx.sf);
  const reveal = surface?.reveal ?? null;

  // 没有别的输入控件拿着键盘时，list（审批门、提问的选项）接键盘。studio 输入框在打字（审批门到来时用户正在写拒绝理由）时不抢：
  // 审批门由输入框接管（Enter 拒绝并发理由，Ctrl+Enter 批准）。提问对话框自己的根节点另有焦点逻辑（AskGate.tsx），提问期间输入框不能发送。
  useEffect(() => {
    const active = document.activeElement;
    if (active !== null && active.closest("[data-composer-input]") !== null) return;
    if (active === null || active === document.body || !active.closest("[data-tspi-keys]"))
      root.current?.focus({ preventScroll: true });
  }, []);

  // 选中项变了 / 收到 reveal：list 自己带 max（自己滚动）或虚拟化时滚到可见（虚拟化的行可能还没画出来，按下标算位置）。
  const selectedIndex = virtual && selected !== null ? node.c.indexOf(selected) : -1;
  const scrollToIndex = win.scrollToIndex;
  useLayoutEffect(() => {
    if (selectedIndex >= 0) scrollToIndex(selectedIndex, "nearest");
    if (cap === undefined || selected === null) return;
    scrollItemIntoView(scroller.current, selected, "nearest");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cap, selected, selectedIndex]);
  const revealSeq = reveal?.seq;
  useLayoutEffect(() => {
    if (reveal === null || !node.c.includes(reveal.id)) return;
    if (virtual) scrollToIndex(node.c.indexOf(reveal.id), reveal.where);
    if (cap !== undefined) scrollItemIntoView(scroller.current, reveal.id, reveal.where);
    // 只在新的 reveal（seq 变了）时滚。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSeq]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const data = encodeKey(likeOf(e.nativeEvent));
    if (data === null) return;
    e.preventDefault();
    ctx.keys(data);
  };

  const filter = p.filter ?? "";
  const state = useMemo<ListState>(() => ({ listId: node.id, selected, filter }), [node.id, selected, filter]);
  const style = cap === undefined ? undefined : ({ "--tspi-list-max": cap } as React.CSSProperties);
  const empty = node.c.length === 0;

  const [from, to] = win.range;
  const visibleIds = virtual ? node.c.slice(from, to) : node.c;
  const spacers = virtual
    ? ({ paddingTop: from * win.rowHeight, paddingBottom: (node.c.length - to) * win.rowHeight } as React.CSSProperties)
    : undefined;

  return (
    <div
      ref={root}
      {...nodeDomProps(props, "tspi-list", { pointer: false })}
      role="listbox"
      tabIndex={0}
      data-tspi-keys=""
      onKeyDown={onKeyDown}
    >
      <div ref={scroller} className={cap === undefined ? "tspi-list-scroll" : "tspi-list-scroll max"} style={style}>
        <ListContext.Provider value={state}>
          {virtual ? (
            <div ref={body} className="tspi-vbody" style={spacers}>
              {visibleIds.map((id) => (
                <TspNode key={id} id={id} ctx={ctx} />
              ))}
            </div>
          ) : (
            <TspChildren node={node} ctx={ctx} />
          )}
        </ListContext.Provider>
      </div>
      {empty && p.empty !== undefined ? (
        <div className="tspi-list-empty">
          <TspSpans text={p.empty} />
        </div>
      ) : null}
    </div>
  );
}

function scrollItemIntoView(scroller: HTMLElement | null, id: string, where: "start" | "end" | "nearest"): void {
  const target = scroller?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  target?.scrollIntoView({ block: where, inline: "nearest" });
}

export function Item({ node, ctx }: NodeProps) {
  const p = node.p as unknown as TspItemProps & { tone?: string };
  const list = useContext(ListContext);
  const listId = list?.listId ?? node.id;
  const isSelected = list !== null && list.selected === node.id;
  const lastActivate = useRef(0);
  const own = nodeActionHandlers(node, ctx);
  const disabled = p.disabled === true;

  const select = (c: TspContext) => c.send({ ev: "select", sf: c.sf, id: listId, item: node.id });
  const activate = (c: TspContext) => {
    const now = Date.now();
    if (now - lastActivate.current < ACTIVATE_DEBOUNCE_MS) return;
    lastActivate.current = now;
    c.send({ ev: "activate", sf: c.sf, id: listId, item: node.id });
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (own.onClick) return own.onClick(e);
    if (askItemClick(node.p["role"], isSelected) === "activate") activate(ctx);
    else select(ctx);
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (own.onDoubleClick) return own.onDoubleClick(e);
    if (askItemDoubleActivates(node.p["role"])) activate(ctx);
  };

  const hits = list !== null && list.filter.trim() !== "" ? filterHits(plainText(p.label), list.filter) : undefined;
  const hasValue = p.value !== undefined && plainText(p.value) !== "";
  const marker = askItemMarker(node.p["role"]);
  const checked = marker === "check" ? p.icon === "check" : isSelected;

  return (
    <div
      className={[own.className, "tspi-item", isSelected ? "sel" : "", disabled ? "off" : ""].filter(Boolean).join(" ")}
      data-id={node.id}
      data-tone={p.tone}
      data-role={typeof node.p["role"] === "string" ? node.p["role"] : undefined}
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      title={own.title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={own.onContextMenu}
    >
      {marker !== null ? (
        // 非交互标记：点击落到行上（pointer-events: none），状态由 omp 的节点决定。
        <input
          type={marker === "check" ? "checkbox" : "radio"}
          className={`${marker === "check" ? "ui-check" : "ui-radio"} tspi-item-mark`}
          data-testid="tspi-item-mark"
          checked={checked}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
      ) : p.icon !== undefined ? (
        <span className="tspi-item-ic">
          <TspIcon name={p.icon} />
        </span>
      ) : null}
      <span className="tspi-item-label">
        <MarkedText text={p.label} hits={hits} />
      </span>
      {hasValue && marker !== null ? (
        <Badge tone="accent">
          <TspSpans text={p.value} />
        </Badge>
      ) : null}
      {p.detail !== undefined && plainText(p.detail) !== "" ? (
        <span className="tspi-item-detail">
          <TspSpans text={p.detail} />
        </span>
      ) : null}
      {hasValue && marker === null ? (
        <span className="tspi-item-value">
          <TspSpans text={p.value} />
        </span>
      ) : null}
      {p.hint !== undefined && p.hint.length > 0 ? (
        <span className="tspi-item-hint">
          {p.hint.map((k) => (
            <kbd key={k} className="tspi-kbd">
              {k}
            </kbd>
          ))}
        </span>
      ) : null}
    </div>
  );
}

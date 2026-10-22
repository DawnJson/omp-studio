// `picker`（规范 elements-lists.md#picker）：数据驱动的模态面板——搜索头、范围列、标签、事实列、虚拟滚动的行、
// 预览、策略条、动作栏。选中项、query、过滤和排序都在 omp：这边的指针操作发 select / activate / action，
// 键盘（含搜索框打字、输入法）写进伪终端，omp 回 `set p {query, order, selected, …}`。
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { cleanGlyphs } from "../span-tokens.ts";
import type {
  TspPickerAction,
  TspPickerColumn,
  TspPickerItem,
  TspPickerMark,
  TspPickerProps,
  TspPickerScope,
  TspTone,
} from "../../../../../shared/tsp/tsp.generated.ts";
import { useT } from "../../../i18n/use-t.ts";
import { Badge, Button, type Tone } from "../../../ui/controls.tsx";
import { TspIcon } from "../icons.tsx";
import type { NodeProps } from "../node-props.ts";
import { TspSpans } from "../spans.tsx";
import { TspChildren } from "../TspChildren.tsx";
import { MarkedPlain, MarkedText } from "./MarkedText.tsx";
import {
  buildEntries,
  compactNumber,
  emptyCatalog,
  markHue,
  markInitials,
  splitMonoLabel,
  updateCatalog,
  visibleColumns,
  visibleRange,
  type PickerCatalog,
  type PickerEntry,
} from "./picker-model.ts";
import { TerminalInput } from "./TerminalInput.tsx";
import { plainText, type HitRange } from "./text-model.ts";

const OVERSCAN = 6;
const SKELETON_ROWS = 8;

const isEscape = (a: TspPickerAction) => a.keys?.some((k) => k === "esc" || k === "escape") === true;

export function Picker({ node, ctx }: NodeProps) {
  const t = useT();
  const p = node.p as TspPickerProps;
  const layout = p.layout ?? "rows";
  const size = p.size ?? "lg";
  const noun = p.noun ?? "items";
  const state = p.state ?? "ready";
  const actions = p.actions ?? [];
  const closeAction = actions.find(isEscape)?.id ?? "close";
  const preview = p.preview ?? (size === "md" ? "none" : "side");

  const catalogRef = useRef<PickerCatalog>(emptyCatalog());
  const catalog = updateCatalog(catalogRef.current, p);
  const {
    entries,
    total: contentHeight,
    rows,
  } = useMemo(
    () => buildEntries(catalog.items, p.order, layout),
    // 目录就地改：用三个补丁数组的引用 + order 判断变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.items, p.itemsAdd, p.itemsDel, p.order, layout],
  );

  const send = (act: string, value?: string) =>
    ctx.send({ ev: "action", sf: ctx.sf, id: node.id, act, ...(value === undefined ? {} : { value }) });

  // 滚动窗口
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(360);
  const [mainWidth, setMainWidth] = useState(640);
  const main = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    const mainEl = main.current;
    if (!el || !mainEl) return;
    const measure = () => {
      setViewport(el.clientHeight);
      setMainWidth(mainEl.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(mainEl);
    return () => ro.disconnect();
  }, []);

  // 选中项变了、布局变了：滚到最少需要的距离让它可见。
  const selected = p.selected ?? null;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || selected === null) return;
    const entry = entries.find((e) => e.kind === "row" && e.item.id === selected);
    if (!entry) return;
    if (entry.top < el.scrollTop) el.scrollTop = entry.top;
    else if (entry.top + entry.height > el.scrollTop + el.clientHeight)
      el.scrollTop = entry.top + entry.height - el.clientHeight;
  }, [selected, layout, entries, viewport]);

  const columns = useMemo(() => visibleColumns(p.columns ?? [], mainWidth - 240), [p.columns, mainWidth]);
  const [from, to] = visibleRange(entries, scrollTop, viewport, OVERSCAN);

  // 吸顶的分组头：窗口顶上那一行所属的组。
  const sticky = useMemo(() => {
    let current: PickerEntry | null = null;
    for (const e of entries) {
      if (e.top > scrollTop) break;
      if (e.kind === "group") current = e;
    }
    return current;
  }, [entries, scrollTop]);

  const lastClicked = useRef<string | null>(null);
  const lastActivated = useRef({ id: "", at: 0 });
  const activate = (item: TspPickerItem) => {
    const now = Date.now();
    if (lastActivated.current.id === item.id && now - lastActivated.current.at < 600) return;
    lastActivated.current = { id: item.id, at: now };
    ctx.send({ ev: "activate", sf: ctx.sf, id: node.id, item: item.id });
  };
  // 点已选中的行、点上一次点过的行、双击：激活（禁用的行只选不激活）。
  const clickRow = (item: TspPickerItem) => {
    const wasSelected = selected === item.id;
    const again = lastClicked.current === item.id;
    lastClicked.current = item.id;
    if ((wasSelected || again) && item.disabled === undefined) activate(item);
    else if (!wasSelected) ctx.send({ ev: "select", sf: ctx.sf, id: node.id, item: item.id });
  };
  const dblClickRow = (item: TspPickerItem) => {
    if (item.disabled === undefined) activate(item);
  };

  const hasCurrent = (p.current?.length ?? 0) > 0;
  const current = new Set(p.current ?? []);
  const query = p.query ?? null;
  const cursor = Math.max(0, Math.min((query ?? "").length, p.cursor ?? (query ?? "").length));
  const countText =
    state === "loading"
      ? "…"
      : p.total !== undefined && p.total !== rows
        ? t("tspi.countOf", { shown: rows, total: p.total.toLocaleString() })
        : String(rows);
  const tabs = p.tabs ?? [];
  const scopes = p.scopes ?? [];
  const noQuery = (query ?? "").trim() === "";
  const emptyState = state === "ready" && rows === 0;
  const tabAction = actions.find((a) => a.keys?.includes("tab"));

  const classes = [
    "tspi-picker",
    `sz-${size}`,
    `lay-${layout}`,
    `pv-${preview}`,
    hasCurrent ? "has-cur" : "",
    state === "loading" ? "st-loading" : "",
    state === "error" ? "st-error" : "",
    p.title === undefined ? "no-title" : "",
    query === null ? "no-query" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-id={node.id}>
      <div className="tspi-pk-dim" aria-hidden="true" onClick={() => send(closeAction)} />
      <div
        className={`tspi-pk-sheet f-${p.focus ?? "list"}`}
        role="dialog"
        aria-modal="true"
        aria-label={p.title ?? noun}
        // 点面板里的按钮不要把焦点从搜索框抢走（键盘一直归 omp）。
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("input,textarea") === null) e.preventDefault();
        }}
      >
        <div className="tspi-pk-head">
          <span className="tspi-pk-ic">
            <TspIcon name={p.icon ?? "list"} size={16} />
          </span>
          {p.title !== undefined ? (
            <div className="tspi-pk-title" title={size === "md" ? plainText(p.subtitle) || undefined : undefined}>
              <span className="t">{p.title}</span>
              {p.subtitle !== undefined && size !== "md" ? (
                <span className="sub">
                  <TspSpans text={p.subtitle} />
                </span>
              ) : null}
            </div>
          ) : null}
          {query !== null ? (
            <div className="tspi-pk-search">
              {query === "" ? (
                <>
                  <span className="caret" />
                  <span className="ph">{cleanGlyphs(p.placeholder ?? t("tspi.searchPlaceholder", { noun }))}</span>
                </>
              ) : (
                <span className="q">
                  {query.slice(0, cursor)}
                  <span className="caret" />
                  {query.slice(cursor)}
                </span>
              )}
              <TerminalInput ctx={ctx} autoFocus label={p.placeholder ?? t("tspi.searchPlaceholder", { noun })} />
            </div>
          ) : (
            <div className="tspi-pk-search tspi-pk-nosearch">
              <TerminalInput ctx={ctx} autoFocus label={p.title ?? noun} />
            </div>
          )}
          <span className="tspi-pk-count">{countText}</span>
          {actions.some(isEscape) ? null : (
            <Button size="sm" variant="quiet" hint="Esc" onClick={() => send(closeAction)}>
              {t("tspi.close")}
            </Button>
          )}
        </div>

        <div className="tspi-pk-body">
          {scopes.length > 0 ? <Scopes scopes={scopes} active={p.scope} onPick={(id) => send("scope", id)} /> : null}
          <div className="tspi-pk-center">
            <div className="tspi-pk-main" ref={main}>
              {tabs.length > 0 ? (
                <div className="ui-tabs tspi-pk-tabs" role="tablist">
                  {tabs.map((tab) => (
                    <button
                      type="button"
                      key={tab.id}
                      role="tab"
                      aria-selected={tab.id === p.tab}
                      className="ui-tab"
                      onClick={() => send("tab", tab.id)}
                    >
                      <TspSpans text={tab.label} />
                      {tab.count !== undefined ? <span className="ui-count">{tab.count}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              {columns.some((c) => (c.head ?? "") !== "") && state === "ready" && !emptyState ? (
                <div className="tspi-pk-colhead">
                  <span className="grow" />
                  {columns.map((c) => (
                    <span key={c.id} className={`tspi-pk-fact f-${c.format ?? "text"}`}>
                      {c.head ?? ""}
                    </span>
                  ))}
                  {hasCurrent ? <span className="tspi-pk-cur" /> : null}
                </div>
              ) : null}

              {state === "ready" && !emptyState ? (
                <div className="tspi-pk-list">
                  {sticky?.kind === "group" ? (
                    <div className="tspi-pk-sticky tspi-pk-row grp">
                      <GroupLabel entry={sticky} />
                    </div>
                  ) : null}
                  <div
                    className="tspi-pk-scroll"
                    ref={scroller}
                    onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
                  >
                    <div className="tspi-pk-spacer" role="listbox" style={{ height: contentHeight }}>
                      {entries.slice(from, to).map((entry) =>
                        entry.kind === "group" ? (
                          <div
                            key={`g:${entry.group.group}`}
                            className="tspi-pk-row grp"
                            style={{ top: entry.top, height: entry.height }}
                          >
                            <GroupLabel entry={entry} />
                          </div>
                        ) : (
                          <Row
                            key={entry.item.id}
                            entry={entry}
                            layout={layout}
                            columns={columns}
                            selected={selected === entry.item.id}
                            current={current.has(entry.item.id)}
                            hasCurrent={hasCurrent}
                            hits={p.hits?.[entry.item.id] ?? entry.item.hits}
                            onClick={() => clickRow(entry.item)}
                            onDoubleClick={() => dblClickRow(entry.item)}
                          />
                        ),
                      )}
                    </div>
                  </div>
                  {p.confirm ? (
                    <div className="tspi-pk-confirm" role="alertdialog">
                      <span className="tspi-pk-ct">
                        <TspSpans text={p.confirm.text} />
                      </span>
                      <Button size="sm" variant="danger" onClick={() => send(p.confirm?.act ?? "confirm")}>
                        {p.confirm.label ?? t("tspi.delete")}
                      </Button>
                      <Button size="sm" onClick={() => send("cancel")}>
                        {t("tspi.keep")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {state === "loading" ? (
                <div className="tspi-pk-state loading">
                  {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    <div key={i} className="tspi-pk-sk" />
                  ))}
                </div>
              ) : null}
              {state === "error" ? (
                <div className="tspi-pk-state error">
                  <div className="tspi-pk-err" role="alert">
                    <TspSpans text={p.message} />
                  </div>
                  {actions.some((a) => a.id === "retry") ? (
                    <Button size="sm" onClick={() => send("retry")}>
                      {t("tspi.retry")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {emptyState ? (
                <div className="tspi-pk-state empty">
                  <div className="tspi-pk-empty">
                    {noQuery ? (
                      p.empty !== undefined ? (
                        <TspSpans text={p.empty} />
                      ) : (
                        t("tspi.noYet", { noun })
                      )
                    ) : (
                      t("tspi.noMatch", { noun })
                    )}
                  </div>
                  {noQuery && tabAction ? (
                    <Button size="sm" onClick={() => send(tabAction.id)}>
                      {tabAction.label}
                    </Button>
                  ) : null}
                  {!noQuery ? (
                    <Button size="sm" onClick={() => send("clear")}>
                      {t("tspi.clearSearch")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {preview !== "none" ? (
              <div className="tspi-pk-pv">
                {node.c.length === 0 ? (
                  <span className="tspi-pk-pv-empty">{t("tspi.nothingToPreview")}</span>
                ) : (
                  <div className="tspi-pk-pv-slot">
                    <TspChildren node={node} ctx={ctx} />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {p.strip ? (
          <div className="tspi-pk-strip" role="toolbar">
            {p.strip.label !== undefined ? (
              <span className="tspi-pk-strip-l">
                <TspSpans text={p.strip.label} />
              </span>
            ) : null}
            {p.strip.items.map((chip) => (
              <button
                type="button"
                key={chip.id}
                className={["ui-btn", "tspi-pk-schip", p.strip?.selected === chip.id ? "sel" : ""]
                  .filter(Boolean)
                  .join(" ")}
                data-size="sm"
                aria-pressed={chip.on === true}
                onClick={() => send("strip", chip.id)}
              >
                {chip.dot !== undefined ? <span className="dot" data-dot={chip.dot} /> : null}
                <TspSpans text={chip.label} />
              </button>
            ))}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="tspi-pk-bar" role="toolbar">
            {actions
              .filter((a) => a.end !== true && a.primary !== true)
              .map((a) => (
                <ActionButton key={a.id} action={a} onPick={send} />
              ))}
            <span className="tspi-pk-bar-fill" />
            {actions
              .filter((a) => a.end === true && a.primary !== true)
              .map((a) => (
                <ActionButton key={a.id} action={a} onPick={send} />
              ))}
            {actions
              .filter((a) => a.primary === true)
              .map((a) => (
                <ActionButton key={a.id} action={a} onPick={send} />
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionButton({ action, onPick }: { action: TspPickerAction; onPick(act: string): void }) {
  const off = action.disabled !== undefined;
  const hint = action.keys?.map((k) => (k.length === 1 ? k.toUpperCase() : k[0]?.toUpperCase() + k.slice(1))).join("+");
  const title = typeof action.disabled === "string" ? action.disabled : hint;
  return (
    <Button
      size="sm"
      variant={action.primary ? "primary" : action.danger ? "danger" : "secondary"}
      className={action.on ? "tspi-pk-on" : undefined}
      aria-pressed={action.on}
      aria-disabled={off || undefined}
      title={title}
      onClick={() => {
        if (!off) onPick(action.id);
      }}
    >
      {action.label}
    </Button>
  );
}

/** picker 的徽标 / 芯片色：只有 ui 的五种色有对应的样式，其余（pending、muted 等）用中性。 */
function isUiTone(tone: TspTone | undefined): tone is Tone {
  return tone === "neutral" || tone === "success" || tone === "accent" || tone === "warning" || tone === "error";
}

function GroupLabel({ entry }: { entry: Extract<PickerEntry, { kind: "group" }> }) {
  return (
    <>
      <span className="tspi-pk-gl">
        <TspSpans text={entry.group.label} />
      </span>
      {entry.group.count !== undefined ? (
        <span className="tspi-pk-gc">{entry.group.count.toLocaleString()}</span>
      ) : null}
    </>
  );
}

function Scopes({
  scopes,
  active,
  onPick,
}: {
  scopes: readonly TspPickerScope[];
  active: string | undefined;
  onPick(id: string): void;
}) {
  const out: React.ReactNode[] = [];
  let lastGroup: string | undefined;
  scopes.forEach((scope, i) => {
    if (scope.group !== lastGroup) {
      if (scope.group !== undefined)
        out.push(
          <div key={`h:${scope.group}:${i}`} className="tspi-pk-sgh">
            {scope.group}
          </div>,
        );
      else out.push(<div key={`s:${i}`} className="tspi-pk-ssep" />);
      lastGroup = scope.group;
    }
    const disabled = scope.disabled !== undefined;
    out.push(
      <div
        key={scope.id}
        role="tab"
        aria-selected={scope.id === active}
        className={["tspi-pk-scope", scope.id === active ? "on" : "", disabled ? "dis" : ""].filter(Boolean).join(" ")}
        title={typeof scope.disabled === "string" ? scope.disabled : undefined}
        onClick={() => onPick(scope.id)}
      >
        <Lead icon={scope.icon} mark={scope.mark} dot={scope.dot} />
        <span className="lbl">
          <TspSpans text={scope.label} />
        </span>
        {scope.count !== undefined ? <span className="meta">{scope.count.toLocaleString()}</span> : null}
        {disabled ? <span className="tspi-pk-lock">🔒</span> : null}
      </div>,
    );
  });
  return (
    <div className="tspi-pk-scopes" role="tablist">
      {out}
    </div>
  );
}

function Lead({
  icon,
  mark,
  dot,
}: {
  icon: string | undefined;
  mark: TspPickerMark | undefined;
  dot: TspTone | undefined;
}) {
  if (mark !== undefined) {
    const known = mark.icon !== undefined && !mark.icon.startsWith("provider:");
    if (known) return <TspIcon name={mark.icon} size={16} />;
    return (
      <span
        className="tspi-pk-mark"
        style={{ "--tspi-hue": markHue(mark.seed ?? mark.text) } as React.CSSProperties}
        aria-hidden="true"
      >
        {markInitials(mark.text)}
      </span>
    );
  }
  if (icon !== undefined) return <TspIcon name={icon} size={16} />;
  if (dot !== undefined) return <span className="tspi-pk-dot" data-tone={dot} />;
  return <span className="tspi-pk-lead-gap" />;
}

interface RowProps {
  entry: Extract<PickerEntry, { kind: "row" }>;
  layout: NonNullable<TspPickerProps["layout"]>;
  columns: readonly TspPickerColumn[];
  selected: boolean;
  current: boolean;
  hasCurrent: boolean;
  hits: readonly HitRange[] | undefined;
  onClick(): void;
  onDoubleClick(): void;
}

function Row({ entry, layout, columns, selected, current, hasCurrent, hits, onClick, onDoubleClick }: RowProps) {
  const { item } = entry;
  const off = item.disabled !== undefined;
  const label = plainText(item.label);
  const split =
    item.mono === true && typeof item.label === "string" && label.includes("/") ? splitMonoLabel(label) : null;
  const badges = item.badges ?? [];
  const lead =
    layout === "timeline" ? (
      <span className={`tspi-pk-node n-${item.node ?? "assistant"}`} />
    ) : (
      <Lead icon={item.icon} mark={item.mark} dot={item.dot} />
    );
  return (
    <div
      className={["tspi-pk-row", selected ? "sel" : "", current ? "cur" : "", off ? "off" : ""]
        .filter(Boolean)
        .join(" ")}
      role="option"
      aria-selected={selected}
      aria-disabled={off || undefined}
      data-v={item.id}
      data-tone={item.tone}
      data-node={item.node}
      title={typeof item.disabled === "string" ? item.disabled : item.title}
      style={{
        top: entry.top,
        height: entry.height,
        ...(layout === "tree" ? ({ "--tspi-depth": item.depth ?? 0 } as React.CSSProperties) : {}),
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {layout === "tree" ? (
        <span className="tspi-pk-chev" data-open={item.open === undefined ? "leaf" : String(item.open)} />
      ) : null}
      <span className="tspi-pk-lead">{lead}</span>
      <div className="tspi-pk-txt">
        <div className="tspi-pk-l1">
          <span className={item.mono ? "tspi-pk-label mono" : "tspi-pk-label"}>
            {split !== null ? (
              <>
                <span className="dir">
                  <MarkedPlain text={split.dir} hits={hits} />
                </span>
                <span className="name">
                  <MarkedPlain text={split.name} hits={hits} offset={split.dir.length} />
                </span>
              </>
            ) : (
              <MarkedText text={item.label} hits={hits} />
            )}
          </span>
          {badges.length > 0 || (item.chips?.length ?? 0) > 0 ? (
            <span className="tspi-pk-tags">
              {badges.slice(0, 3).map((b, i) => (
                <Badge key={i} tone={isUiTone(b.tone) ? b.tone : "neutral"} title={b.title}>
                  {b.text}
                </Badge>
              ))}
              {badges.length > 3 ? (
                <Badge
                  title={badges
                    .slice(3)
                    .map((b) => b.text)
                    .join(", ")}
                >
                  +{badges.length - 3}
                </Badge>
              ) : null}
              {(item.chips ?? []).map((c, i) => (
                <Badge key={`c${i}`} tone={c.on ? "accent" : "neutral"}>
                  {c.dot !== undefined ? <span className="dot" data-dot={c.dot} /> : null}
                  {c.text}
                </Badge>
              ))}
            </span>
          ) : null}
          {item.detail !== undefined && layout !== "cards" ? (
            <span className="tspi-pk-detail">
              <TspSpans text={item.detail} />
            </span>
          ) : null}
        </div>
        {item.detail !== undefined && layout === "cards" ? (
          <div className="tspi-pk-l2 tspi-pk-detail">
            <TspSpans text={item.detail} />
          </div>
        ) : null}
      </div>
      {columns.length > 0 ? (
        <div className="tspi-pk-facts">
          {columns.map((c) => (
            <Fact key={c.id} column={c} value={item.facts?.[c.id]} />
          ))}
        </div>
      ) : null}
      {hasCurrent ? <span className="tspi-pk-cur">{current ? "✓" : null}</span> : null}
    </div>
  );
}

function Fact({
  column,
  value,
}: {
  column: TspPickerColumn;
  value: NonNullable<TspPickerItem["facts"]>[string] | undefined;
}) {
  const format = column.format ?? "text";
  let content: React.ReactNode = null;
  if (typeof value === "number") {
    content =
      format === "bar" ? (
        <span className="tspi-pk-meter">
          <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
        </span>
      ) : (
        compactNumber(value)
      );
  } else if (value !== undefined) {
    content = <TspSpans text={value} />;
  }
  return <span className={`tspi-pk-fact f-${format}`}>{content}</span>;
}

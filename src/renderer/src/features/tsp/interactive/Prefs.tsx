// `prefs`（规范 elements-work.md#prefs）：omp `/settings` 发来的设置面板。所有设置、焦点、搜索都在 omp，
// 这边把指针操作发回去：翻页 `action page`、关闭 `action close`、开关 / 分段 / 菜单项 / 步进 / 芯片 / 重置 `change`、
// 点弹出按钮或文本框 `activate`、点操作按钮 `action`、点空白行 `select`。键盘（含搜索框、编辑中的文本、输入法）写进伪终端。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  TspPrefsControl,
  TspPrefsProps,
  TspPrefsRow,
  TspPrefsSection,
} from "../../../../../shared/tsp/tsp.generated.ts";
import type { TFunction } from "../../../../../shared/i18n/index.ts";
import { useT } from "../../../i18n/use-t.ts";
import { Check, ChevronDown } from "../../../icons.tsx";
import { Badge, Button, Switch } from "../../../ui/controls.tsx";
import { TspIcon } from "../icons.tsx";
import type { NodeProps, TspContext } from "../node-props.ts";
import { useTspNode, useTspSurface } from "../tsp-store.ts";
import { TspNode } from "../TspChildren.tsx";
import { MarkedPlain } from "./MarkedText.tsx";
import {
  isSegmented,
  moveOrdered,
  nextNumber,
  numberLabel,
  orderedOptions,
  toggleMulti,
  wordHits,
} from "./prefs-model.ts";
import { TerminalInput } from "./TerminalInput.tsx";

type Slot = "status" | "editor" | "extra";

const RAIL_BELOW_PX = 760;

export function Prefs({ node, ctx }: NodeProps) {
  const t = useT();
  const p = node.p as unknown as TspPrefsProps;
  const surface = useTspSurface(ctx.taskId, ctx.sf);
  const root = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState(false);
  const query = (p.query ?? "").trim();
  const searching = query !== "";
  const editing = p.editing ?? null;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setRail(el.clientWidth < RAIL_BELOW_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const send = (ev: "action" | "activate" | "select" | "change", fields: Record<string, unknown>) =>
    ctx.send({ ev, sf: ctx.sf, id: node.id, ...fields } as Parameters<TspContext["send"]>[0]);
  const action = (act: string, value?: string) => send("action", { act, ...(value === undefined ? {} : { value }) });

  // focus 行 / 区块滚进视野：区块到顶，行到最近的边。
  useLayoutEffect(() => {
    if (p.focus === undefined || p.focus === null) return;
    const el = root.current?.querySelector<HTMLElement>(
      `[data-row="${CSS.escape(p.focus)}"],[data-sec="${CSS.escape(p.focus)}"]`,
    );
    el?.scrollIntoView({ block: el.dataset["sec"] !== undefined ? "start" : "nearest" });
  }, [p.focus, p.page, query]);

  // 菜单打开时点菜单外面 = 关掉。
  const editingRow = editing?.row ?? null;
  useEffect(() => {
    if (editingRow === null) return;
    const row = p.sections.flatMap((s) => s.rows).find((r) => r.id === editingRow);
    if (row?.control.k !== "choice") return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".tspi-pf-menu,.tspi-pf-pick") === null) action("close", editingRow);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRow, node.id]);

  const pageIndex = Math.max(
    0,
    p.pages.findIndex((pg) => pg.id === p.page),
  );
  const page = p.pages[pageIndex];
  const eyebrow = `${String(pageIndex + 1).padStart(2, "0")} · ${page?.label ?? ""}`;
  const sections = p.sections.filter((s) => s.rows.length > 0 || s.id === "status-line");

  // 把页面分组到各自的 nav 分组下。
  const groups: { name: string | undefined; pages: TspPrefsProps["pages"][number][] }[] = [];
  for (const pg of p.pages) {
    const last = groups[groups.length - 1];
    if (last && last.name === pg.group) last.pages.push(pg);
    else groups.push({ name: pg.group, pages: [pg] });
  }

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 键盘一直归 omp：点按钮不抢搜索框的焦点；焦点在页面外的输入框里时先发 focus。
    if ((e.target as HTMLElement).closest("input,textarea") === null) e.preventDefault();
    if (surface !== null && surface.focus !== null && surface.focus !== node.id) {
      ctx.send({ ev: "focus", sf: ctx.sf, id: node.id });
    }
  };

  const phText = t("tspi.searchSettings");

  let lastSearchPage: string | undefined;

  return (
    <div className="tspi-prefs" data-id={node.id} ref={root}>
      <div className={rail ? "tspi-pf rail" : "tspi-pf"} aria-label={p.title} onMouseDown={onMouseDown}>
        <nav className="tspi-pf-nav">
          <div className="tspi-pf-brand">
            <span className="tspi-pf-mark" aria-hidden="true" />
            <span className="tspi-pf-brand-t">{p.title}</span>
          </div>
          <div className="tspi-pf-search">
            <span className="tspi-pf-search-ic">
              <TspIcon name="search" size={14} />
            </span>
            {p.cursor !== undefined ? (
              <span className="q">
                {(p.query ?? "").slice(0, p.cursor)}
                <span className="tspi-pf-caret" />
                {(p.query ?? "").slice(p.cursor)}
              </span>
            ) : (
              <span className={query === "" ? "q ph" : "q"}>{query === "" ? phText : query}</span>
            )}
            <TerminalInput ctx={ctx} autoFocus label={phText} />
          </div>
          <div className="tspi-pf-groups">
            {groups.map((g, gi) => (
              <div className="tspi-pf-group" key={`${g.name ?? ""}:${gi}`}>
                {g.name !== undefined ? <div className="tspi-pf-nav-head">{g.name}</div> : null}
                {g.pages.map((pg) => {
                  const off = pg.disabled !== undefined;
                  return (
                    <button
                      type="button"
                      key={pg.id}
                      className={["tspi-pf-nav-row", pg.id === p.page && !searching ? "on" : "", off ? "off" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      data-v={pg.id}
                      title={pg.disabled}
                      onClick={() => {
                        if (!off) action("page", pg.id);
                      }}
                    >
                      <TspIcon name={pg.icon ?? "sliders"} size={16} />
                      <span className="lbl">{pg.label}</span>
                      {pg.changed !== undefined && pg.changed > 0 ? (
                        <Badge tone="accent" title={t("tspi.changedCount", { count: pg.changed })}>
                          {pg.changed}
                        </Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </nav>

        <div className="tspi-pf-scroll">
          <div className="tspi-pf-doc" key={`${p.page}:${query}`}>
            <header className={searching ? "tspi-pf-head found" : "tspi-pf-head"}>
              {searching ? null : <div className="tspi-pf-eyebrow">{eyebrow}</div>}
              <h1 className="tspi-pf-title">{searching ? query : (page?.label ?? p.title)}</h1>
              {!searching && p.lead !== undefined ? <p className="tspi-pf-lead">{p.lead}</p> : null}
            </header>

            {sections.length === 0 ? (
              <div className="tspi-pf-none">
                {searching ? t("tspi.noSettingsMatch", { query }) : t("tspi.nothingToSet")}
              </div>
            ) : null}

            {sections.map((section) => {
              const pageHead =
                searching && section.page !== undefined && section.page !== lastSearchPage
                  ? p.pages.find((pg) => pg.id === section.page)
                  : undefined;
              if (searching) lastSearchPage = section.page;
              return (
                <div key={section.id}>
                  {pageHead !== undefined ? (
                    <h2
                      className={pageHead.disabled !== undefined ? "tspi-pf-part-h off" : "tspi-pf-part-h"}
                      title={pageHead.disabled}
                    >
                      {pageHead.label}
                    </h2>
                  ) : null}
                  <Section section={section} p={p} query={query} send={send} action={action} t={t} />
                  {section.id === "status-line" ? <Slots node={node} ctx={ctx} slot="status" /> : null}
                </div>
              );
            })}
            <div className="tspi-pf-extra">
              <Slots node={node} ctx={ctx} slot="extra" />
            </div>
          </div>
        </div>
        <div className="tspi-pf-top">
          <Button size="sm" hint="Esc" onClick={() => action("close")}>
            {t("tspi.close")}
          </Button>
        </div>
        <div className="tspi-pf-editor on">
          <Slots node={node} ctx={ctx} slot="editor" />
        </div>
      </div>
    </div>
  );
}

type SendFn = (ev: "action" | "activate" | "select" | "change", fields: Record<string, unknown>) => void;

interface SectionProps {
  section: TspPrefsSection;
  p: TspPrefsProps;
  query: string;
  send: SendFn;
  action(act: string, value?: string): void;
  t: TFunction;
}

function Section({ section, p, query, send, action, t }: SectionProps) {
  return (
    <section className={p.focus === section.id ? "tspi-pf-sec focus" : "tspi-pf-sec"} data-sec={section.id}>
      {section.title !== undefined ? <h2 className="tspi-pf-sec-t">{section.title}</h2> : null}
      <div className="tspi-pf-rows">
        {section.rows.map((row) => (
          <Row key={row.id} row={row} p={p} query={query} send={send} action={action} t={t} />
        ))}
      </div>
    </section>
  );
}

function Row({ row, p, query, send, action, t }: Omit<SectionProps, "section"> & { row: TspPrefsRow }) {
  const off = row.disabled !== undefined;
  const editing = p.editing?.row === row.id ? p.editing : null;
  const control = row.control;
  const resettable = row.changed === true && !off && control.k !== "action" && control.k !== "keys";
  const mark = (text: string) => (query === "" ? text : <MarkedPlain text={text} hits={wordHits(text, query)} />);
  const className = [
    "tspi-pf-row",
    row.changed ? "changed" : "",
    row.warning !== undefined ? "warn" : "",
    off ? "off" : "",
    editing ? "editing" : "",
    control.k === "multi" ? "stack" : "",
    control.k === "keys" ? "tspi-pf-key" : "",
    p.focus === row.id ? "focus" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const change = (value: boolean | number | string | readonly string[] | null) =>
    send("change", { item: row.id, value });

  return (
    <div
      className={className}
      data-row={row.id}
      onClick={(e) => {
        if (off) return;
        if ((e.target as HTMLElement).closest("button,.tspi-pf-in,.tspi-pf-menu,.tspi-pf-chip,.tspi-pf-oi") === null) {
          send("select", { item: row.id });
        }
      }}
    >
      <span
        className="tspi-pf-dot"
        title={
          row.changed
            ? row.defaultLabel !== undefined
              ? t("tspi.changedFromDefaultTo", { value: row.defaultLabel })
              : t("tspi.changedFromDefault")
            : undefined
        }
      />
      <div className="tspi-pf-lbl">
        <div className="t">
          {row.warning !== undefined ? <span className="tspi-pf-warn">⚠</span> : null}
          {mark(row.label)}
        </div>
        {row.hint !== undefined ? <div className="h">{mark(row.hint)}</div> : null}
        {row.warning !== undefined ? <div className="tspi-pf-warntext">{row.warning}</div> : null}
        {off ? <div className="tspi-pf-why">{row.disabled}</div> : null}
      </div>
      <div className="tspi-pf-ctl">
        {resettable ? (
          <Button size="sm" variant="quiet" onClick={() => change(null)}>
            {t("tspi.reset")}
          </Button>
        ) : null}
        <Control
          row={row}
          control={control}
          off={off}
          editing={editing}
          change={change}
          activate={() => send("activate", { item: row.id })}
          close={() => action("close", row.id)}
          hover={(value) => send("select", { item: `${row.id}=${value}` })}
          act={(act) => action(act, row.id)}
          t={t}
        />
      </div>
    </div>
  );
}

interface ControlProps {
  row: TspPrefsRow;
  control: TspPrefsControl;
  off: boolean;
  editing: NonNullable<TspPrefsProps["editing"]> | null;
  change(value: boolean | number | string | readonly string[] | null): void;
  activate(): void;
  close(): void;
  hover(value: string): void;
  act(act: string): void;
  t: TFunction;
}

function Control({ row, control, off, editing, change, activate, close, hover, act, t }: ControlProps) {
  switch (control.k) {
    case "switch":
      return <Switch checked={control.on} disabled={off} label={row.label} onChange={change} />;
    case "choice": {
      if (isSegmented(control)) {
        return (
          <div className="ui-seg" data-size="sm" role="radiogroup">
            {control.options.map((o) => (
              <button
                type="button"
                key={o.value}
                role="radio"
                aria-checked={o.value === control.value}
                title={o.detail}
                disabled={off}
                onClick={() => change(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        );
      }
      const current = control.options.find((o) => o.value === control.value);
      const open = editing !== null;
      const highlighted = editing?.option ?? control.value;
      return (
        <div className="tspi-pf-pop">
          <button
            type="button"
            className={control.mono ? "ui-field ui-select ui-mono tspi-pf-pick" : "ui-field ui-select tspi-pf-pick"}
            data-size="sm"
            aria-haspopup="listbox"
            aria-expanded={open}
            disabled={off}
            onClick={() => (open ? close() : activate())}
          >
            <span>{current?.label ?? control.value}</span>
            <ChevronDown />
          </button>
          {open ? (
            <div className="ui-menu tspi-pf-menu" role="listbox">
              {control.options.map((o) => (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={o.value === control.value}
                  className="ui-menu-item"
                  data-active={o.value === highlighted ? "" : undefined}
                  onMouseEnter={() => hover(o.value)}
                  onClick={() => change(o.value)}
                >
                  {o.value === control.value ? <Check /> : <span />}
                  <span className="ui-menu-text">
                    <span className={control.mono ? "tspi-pf-mono" : undefined}>{o.label}</span>
                    {o.detail !== undefined ? <span className="ui-menu-note">{o.detail}</span> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    case "number": {
      const down = nextNumber(control, -1);
      const up = nextNumber(control, 1);
      return (
        <div className="tspi-pf-step">
          <Button
            size="sm"
            aria-label={t("tspi.decrease")}
            disabled={off || down === null}
            onClick={() => down !== null && change(down)}
          >
            −
          </Button>
          <span className="v">{numberLabel(control)}</span>
          <Button
            size="sm"
            aria-label={t("tspi.increase")}
            disabled={off || up === null}
            onClick={() => up !== null && change(up)}
          >
            +
          </Button>
        </div>
      );
    }
    case "text": {
      const draft = editing === null ? control.value : (editing.draft ?? control.value);
      const shown = control.secret === true ? "•".repeat([...draft].length) : draft;
      const caret = editing?.cursor;
      const classes = [
        "ui-field",
        "tspi-pf-in",
        control.mono ? "ui-mono" : "",
        editing ? "editing" : "",
        control.secret ? "secret" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <div className={classes} data-size="sm" role="textbox" aria-readonly onClick={() => !off && activate()}>
          {editing !== null && caret !== undefined ? (
            <span className="v">
              {shown.slice(0, caret)}
              <span className="tspi-pf-caret" />
              {shown.slice(caret)}
            </span>
          ) : draft === "" ? (
            <span className="ph">{control.placeholder ?? t("tspi.notSet")}</span>
          ) : (
            <span className="v">{shown}</span>
          )}
        </div>
      );
    }
    case "keys":
      return (
        <div className="tspi-pf-chords">
          {control.keys.map((chord, i) => (
            <span key={i} className="tspi-pf-chord">
              {chord.map((k) => (
                <kbd key={k} className="tspi-kbd">
                  {k}
                </kbd>
              ))}
            </span>
          ))}
        </div>
      );
    case "multi":
      return control.ordered === true ? (
        <OrderedList control={control} off={off} change={change} highlighted={editing?.option} />
      ) : (
        <div className="tspi-pf-chips">
          {control.options.map((o) => (
            <button
              type="button"
              key={o.value}
              className={["ui-btn", "tspi-pf-chip", editing?.option === o.value ? "sel" : ""].filter(Boolean).join(" ")}
              data-size="sm"
              aria-pressed={control.values.includes(o.value)}
              title={o.detail}
              disabled={off}
              onClick={() => change(toggleMulti(control, o.value))}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    case "action":
      return (
        <Button size="sm" disabled={off} onClick={() => act(control.act)}>
          {control.label}
        </Button>
      );
  }
}

function OrderedList({
  control,
  off,
  change,
  highlighted,
}: {
  control: Extract<TspPrefsControl, { k: "multi" }>;
  off: boolean;
  change: ControlProps["change"];
  highlighted: string | undefined;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const items = orderedOptions(control.options, control.values);
  return (
    <div className="tspi-pf-order">
      {items.map((o) => {
        const position = control.values.indexOf(o.value);
        const on = position >= 0;
        return (
          <div
            key={o.value}
            className={[
              "tspi-pf-oi",
              on ? "on" : "",
              highlighted === o.value ? "sel" : "",
              drag === o.value ? "drag" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={!off}
            onDragStart={() => setDrag(o.value)}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (drag === null) return;
              const box = e.currentTarget.getBoundingClientRect();
              change(moveOrdered(control.values, drag, o.value, e.clientY > box.top + box.height / 2));
              setDrag(null);
            }}
          >
            <span className="tspi-pf-grip" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="n">{on ? position + 1 : ""}</span>
            <span className="lbl">{o.label}</span>
            <Switch
              checked={on}
              disabled={off}
              label={o.label}
              onChange={() => change(toggleMulti(control, o.value))}
            />
          </div>
        );
      })}
    </div>
  );
}

/** prefs 的子节点按 role 分到三处：status 预览、editor 卡片（含任何 picker）、其余。 */
function Slots({ node, ctx, slot }: { node: NodeProps["node"]; ctx: TspContext; slot: Slot }) {
  return (
    <>
      {node.c.map((id) => (
        <SlotChild key={id} ctx={ctx} id={id} slot={slot} />
      ))}
    </>
  );
}

function slotOf(role: unknown, kind: string): Slot {
  if (role === "omp.prefs.preview.status") return "status";
  if (role === "omp.prefs.editor" || kind === "picker") return "editor";
  return "extra";
}

function SlotChild({ ctx, id, slot }: { ctx: TspContext; id: string; slot: Slot }) {
  const child = useTspNode(ctx.taskId, ctx.sf, id);
  if (child === null || slotOf(child.p["role"], child.k) !== slot) return null;
  return <TspNode id={id} ctx={ctx} />;
}

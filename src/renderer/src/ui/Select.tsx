// 下拉（替换原生 <select>）：触发器是 .ui-field.ui-select，展开的列表是选择菜单（.ui-menu，当前项只靠第一列的 ✓）。
// 键盘 ↑↓/Home/End 移动、Enter/空格选择、Esc 关闭、首字母跳转；焦点一直在触发器上（combobox + aria-activedescendant）。
// 给了 search 时列表上方有搜索框，打开后焦点在搜索框里（↑↓、Enter、Esc 照旧，空格和 Home/End 留给输入）。
// 选项带 group 时按组排（同组的要挨着），组标题可以点开 / 收起，打开时只展开当前值所在的组；有搜索词时只看匹配、组都展开。
// 列表 portal 到 body、fixed 定位（设置行在带 contain 的卡片和滚动容器里，不 portal 会被裁掉）；下方放不下就向上展开；
// 滚动或窗口变化时关闭，免得列表和触发器错位。
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/use-t.ts";
import { Check, ChevronDown, ChevronRight, Search } from "../icons.tsx";
import { TextField, type ControlSize, type Option } from "./controls.tsx";
import { OverlayScrollbar } from "./OverlayScrollbar.tsx";
import { usePresence } from "./presence.ts";
import { Reveal } from "./Reveal.tsx";

export interface SelectOption<T extends string> extends Option<T> {
  /** 第二行小字说明。 */
  note?: string | undefined;
  /** 触发器里显示的文字（默认同 label）：列表里用短名，选中后触发器写全。 */
  display?: string | undefined;
  /** 所在的组（模型下拉按 provider）。没有组的排在最前、不折叠。 */
  group?: string | undefined;
}

/** 选项和它在可移动列表里的位置；收起的组里的选项是 null（还要画出来放收起动画，但不能移动到、不能选）。 */
type Placed<T extends string> = { option: SelectOption<T>; at: number | null };
type Row<T extends string> =
  { kind: "option"; placed: Placed<T> } | { kind: "group"; group: string; open: boolean; members: Placed<T>[] };

/** 按搜索词和展开的组排出列表：rows 是画出来的样子（组标题 + 选项），visible 是能移动、能选的选项。 */
function layout<T extends string>(options: readonly SelectOption<T>[], query: string, openGroups: ReadonlySet<string>) {
  const needle = query.trim().toLowerCase();
  const matches = (option: SelectOption<T>) =>
    needle === "" || option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
  const rows: Row<T>[] = [];
  const visible: SelectOption<T>[] = [];
  const place = (option: SelectOption<T>, shown: boolean): Placed<T> => {
    if (!shown) return { option, at: null };
    visible.push(option);
    return { option, at: visible.length - 1 };
  };
  for (const option of options) {
    if (option.group === undefined && matches(option)) rows.push({ kind: "option", placed: place(option, true) });
  }
  const groups = [...new Set(options.flatMap((option) => (option.group === undefined ? [] : [option.group])))];
  for (const group of groups) {
    const members = options.filter((option) => option.group === group && matches(option));
    if (members.length === 0) continue;
    const open = needle !== "" || openGroups.has(group);
    rows.push({ kind: "group", group, open, members: members.map((option) => place(option, open)) });
  }
  return { rows, visible };
}

const maxListHeight = 320;
const typeaheadResetMs = 600;

export function Select<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  width,
  mono = false,
  disabled = false,
  placeholder = "",
  search,
  label,
  labelledBy,
  testId,
}: {
  value: T;
  options: readonly SelectOption<T>[];
  onChange(next: T): void;
  size?: ControlSize | undefined;
  /** CSS 宽度（默认 200px）。 */
  width?: number | string | undefined;
  mono?: boolean | undefined;
  disabled?: boolean | undefined;
  /** 当前值不在选项里时触发器显示的文字。 */
  placeholder?: string | undefined;
  /** 给了就在列表上方放搜索框，这是它的占位文字。 */
  search?: string | undefined;
  label?: string | undefined;
  labelledBy?: string | undefined;
  testId?: string | undefined;
}) {
  const t = useT();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const current = options.find((option) => option.value === value);
  const { rows, visible } = layout(options, query, openGroups);

  const close = useCallback(() => setOpen(false), []);
  const show = () => {
    const groups = new Set(current?.group === undefined ? [] : [current.group]);
    setQuery("");
    setOpenGroups(groups);
    setActive(
      Math.max(
        0,
        layout(options, "", groups).visible.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };

  // 打开时按触发器位置定位：下方放不下（且上方更宽松）就向上展开；右缘不超出窗口。有搜索框时按列表最高算，打字时不换方向。
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const need = search === undefined ? Math.min(maxListHeight, options.length * 32 + 8) : maxListHeight + 48;
    const below = window.innerHeight - rect.bottom;
    const up = below < need + 8 && rect.top > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - (popup.current?.offsetWidth ?? rect.width) - 8));
    setPlace(
      up
        ? { bottom: window.innerHeight - rect.top + 4, left, width: rect.width }
        : { top: rect.bottom + 4, left, width: rect.width },
    );
  }, [open, options.length, search]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (trigger.current?.contains(event.target) || popup.current?.contains(event.target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (option: SelectOption<T> | undefined) => {
    if (option && option.value !== value) onChange(option.value);
    close();
    trigger.current?.focus();
  };

  const toggleGroup = (group: string) => {
    const activeValue = visible[active]?.value;
    const next = new Set(openGroups);
    if (!next.delete(group)) next.add(group);
    setOpenGroups(next);
    // 高亮的选项还在就跟着它走，被收起了就落到这个组的标题位置附近。
    const after = layout(options, query, next).visible;
    const kept = after.findIndex((option) => option.value === activeValue);
    setActive(kept >= 0 ? kept : Math.min(active, Math.max(0, after.length - 1)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const last = visible.length - 1;
    const typing = search !== undefined;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => Math.min(last, index + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      case "Home":
      case "End":
        if (typing) return;
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : last);
        return;
      case " ":
        if (typing) return;
        event.preventDefault();
        pick(visible[active]);
        return;
      case "Enter":
        event.preventDefault();
        pick(visible[active]);
        return;
      case "Escape":
        // 只关列表，不让 Esc 继续冒泡去退出设置页 / 关对话框。
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.current?.focus();
        return;
      case "Tab":
        close();
        return;
    }
    // 首字母跳转（没有搜索框时）：连续输入在 600 ms 内拼成前缀。
    if (!typing && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = event.timeStamp;
      typed.current = {
        text: (now - typed.current.at > typeaheadResetMs ? "" : typed.current.text) + event.key.toLowerCase(),
        at: now,
      };
      const start = typed.current.text.length === 1 ? active + 1 : active;
      const ordered = [...visible.keys()].map((index) => (index + start) % visible.length);
      const hit = ordered.find((index) => visible[index]?.label.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) setActive(hit);
    }
  };

  const activeId = open && visible.length > 0 ? `${id}-${active}` : undefined;
  const renderOption = ({ option, at }: Placed<T>) => (
    <div
      key={option.value}
      id={at === null ? undefined : `${id}-${at}`}
      role="option"
      aria-selected={option.value === value}
      data-index={at ?? undefined}
      data-active={(at !== null && at === active) || undefined}
      className="ui-menu-item"
      title={option.label}
      // 在 pointerdown 上选：先于触发器失焦，选择不会因为失焦丢掉。
      onPointerDown={(event) => {
        event.preventDefault();
        pick(option);
      }}
      onPointerMove={() => at !== null && setActive(at)}
    >
      {option.value === value ? <Check /> : <span />}
      {option.note === undefined ? (
        <span className="ui-menu-label-text">{option.label}</span>
      ) : (
        <span className="ui-menu-text">
          {option.label}
          <span className="ui-menu-note">{option.note}</span>
        </span>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className={mono ? "ui-field ui-select ui-mono" : "ui-field ui-select"}
        data-size={size === "sm" ? "sm" : undefined}
        style={
          width === undefined
            ? undefined
            : ({ "--field-w": typeof width === "number" ? `${width}px` : width } as Record<string, string>)
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-activedescendant={search === undefined ? activeId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <span className={current === undefined ? "ui-placeholder" : undefined}>
          {current?.display ?? current?.label ?? placeholder}
        </span>
        <ChevronDown size={14} />
      </button>
      {presence.mounted &&
        createPortal(
          <div
            ref={popup}
            className={mono ? "ui-menu ui-mono" : "ui-menu"}
            data-floating=""
            data-search={search === undefined ? undefined : ""}
            style={{ top: place.top, bottom: place.bottom, left: place.left, minWidth: place.width }}
            {...presence.exitProps}
          >
            {search !== undefined && (
              <TextField
                ref={searchRef}
                size="sm"
                width="100%"
                className="ui-select-search"
                role="combobox"
                aria-expanded="true"
                aria-controls={id}
                aria-activedescendant={activeId}
                aria-label={search}
                placeholder={search}
                leading={<Search size={14} />}
                value={query}
                onChange={(next) => {
                  setQuery(next);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                testId={testId === undefined ? undefined : `${testId}-search`}
              />
            )}
            <div
              ref={list}
              id={id}
              role="listbox"
              aria-label={label}
              aria-labelledby={labelledBy}
              className="ui-select-list"
              style={{ maxHeight: maxListHeight }}
              data-testid={testId === undefined ? undefined : `${testId}-list`}
            >
              {rows.map((row) =>
                row.kind === "option" ? (
                  renderOption(row.placed)
                ) : (
                  <div key={`g:${row.group}`} role="group" aria-label={row.group}>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="ui-select-group"
                      aria-expanded={row.open}
                      data-testid={testId === undefined ? undefined : `${testId}-group`}
                      data-group={row.group}
                      // 不抢焦点：焦点留在搜索框 / 触发器上，键盘接着用。
                      onPointerDown={(event) => {
                        event.preventDefault();
                        toggleGroup(row.group);
                      }}
                    >
                      <ChevronRight size={12} />
                      <span className="ui-menu-label-text">{row.group}</span>
                      <span className="ui-count">{row.members.length}</span>
                    </button>
                    <Reveal open={row.open}>{row.members.map(renderOption)}</Reveal>
                  </div>
                ),
              )}
              {rows.length === 0 && <p className="ui-menu-hint ui-select-empty">{t("common.noMatches")}</p>}
            </div>
            <OverlayScrollbar target={list} />
          </div>,
          document.body,
        )}
    </>
  );
}

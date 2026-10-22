// 下拉（替换原生 <select>）：触发器是 .ui-field.ui-select，展开的列表是选择菜单（.ui-menu，当前项只靠第一列的 ✓）。
// 键盘 ↑↓/Home/End 移动、Enter/空格选择、Esc 关闭、首字母跳转；焦点一直在触发器上（combobox + aria-activedescendant）。
// 列表 portal 到 body、fixed 定位（设置行在带 contain 的卡片和滚动容器里，不 portal 会被裁掉）；下方放不下就向上展开；
// 滚动或窗口变化时关闭，免得列表和触发器错位。
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "../icons.tsx";
import type { ControlSize, Option } from "./controls.tsx";
import { OverlayScrollbar } from "./OverlayScrollbar.tsx";
import { usePresence } from "./presence.ts";

export interface SelectOption<T extends string> extends Option<T> {
  /** 第二行小字说明。 */
  note?: string | undefined;
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
  label?: string | undefined;
  labelledBy?: string | undefined;
  testId?: string | undefined;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const presence = usePresence(open);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number; width: number }>({
    left: 0,
    width: 0,
  });

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options.find((option) => option.value === value);

  const close = useCallback(() => setOpen(false), []);
  const show = () => {
    setActive(selectedIndex);
    setOpen(true);
  };

  // 打开时按触发器位置定位：下方放不下（且上方更宽松）就向上展开；右缘不超出窗口。
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const need = Math.min(maxListHeight, options.length * 32 + 8);
    const below = window.innerHeight - rect.bottom;
    const up = below < need + 8 && rect.top > below;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - (popup.current?.offsetWidth ?? rect.width) - 8));
    setPlace(
      up
        ? { bottom: window.innerHeight - rect.top + 4, left, width: rect.width }
        : { top: rect.bottom + 4, left, width: rect.width },
    );
  }, [open, options.length]);

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

  const pick = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close();
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        show();
      }
      return;
    }
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
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        event.preventDefault();
        setActive(last);
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        pick(active);
        return;
      case "Escape":
        // 只关列表，不让 Esc 继续冒泡去退出设置页 / 关对话框。
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      case "Tab":
        close();
        return;
    }
    // 首字母跳转：连续输入在 600 ms 内拼成前缀。
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      typed.current = {
        text: (now - typed.current.at > typeaheadResetMs ? "" : typed.current.text) + event.key.toLowerCase(),
        at: now,
      };
      const start = typed.current.text.length === 1 ? active + 1 : active;
      const ordered = [...options.keys()].map((index) => (index + start) % options.length);
      const hit = ordered.find((index) => options[index]?.label.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) setActive(hit);
    }
  };

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
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <span className={current === undefined ? "ui-placeholder" : undefined}>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} />
      </button>
      {presence.mounted &&
        createPortal(
          <div
            ref={popup}
            className={mono ? "ui-menu ui-mono" : "ui-menu"}
            data-floating=""
            style={{ top: place.top, bottom: place.bottom, left: place.left, minWidth: place.width }}
            {...presence.exitProps}
          >
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
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  data-index={index}
                  data-active={index === active || undefined}
                  className="ui-menu-item"
                  title={option.label}
                  // 在 pointerdown 上选：先于触发器失焦，选择不会因为失焦丢掉。
                  onPointerDown={(event) => {
                    event.preventDefault();
                    pick(index);
                  }}
                  onPointerMove={() => setActive(index)}
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
              ))}
            </div>
            <OverlayScrollbar target={list} />
          </div>,
          document.body,
        )}
    </>
  );
}

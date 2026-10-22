// 菜单（spec §4.23 Menu）：一种样式、一种键盘行为。项高 32，第一列 16px：动作菜单放图标，选择菜单放 ✓（当前项只靠 ✓，
// 灰底只表示悬停 / 键盘焦点）；破坏性项红字、放最后、前面一条分隔线；不可用项灰字、原因写在第二行小字。
// Menu：按锚点 fixed 弹出（右键菜单、⋯ 菜单），贴边时翻到锚点另一侧；Esc / 点外面关闭，焦点回到打开它的元素。
// MenuList：嵌在 Popover 里的同一种菜单（审批模式等），外框由浮层给。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "../icons.tsx";
import { usePresence } from "./presence.ts";

export interface MenuAction {
  id: string;
  label: string;
  /** 动作菜单第一列的 16px 图标。 */
  icon?: ReactNode | undefined;
  /** 第二行小字说明。 */
  note?: string | undefined;
  /** 右侧的快捷键提示，如 "F2"。 */
  shortcut?: string | undefined;
  /** 给了就是选择项（menuitemradio）：选中的第一列画 ✓。同一个菜单里不和图标混用。 */
  checked?: boolean | undefined;
  tone?: "danger" | undefined;
  /** 有值表示这一项现在不能用（灰显、不执行），值写在第二行。 */
  disabledReason?: string | undefined;
  testId?: string | undefined;
  onSelect(): void;
}

export type MenuEntry = MenuAction | { kind: "separator"; id: string } | { kind: "label"; id: string; label: string };

export interface MenuAnchor {
  x: number;
  y: number;
  /** 关闭后接收焦点的元素（打开前的 activeElement）。 */
  returnFocus: HTMLElement | null;
}

/** 在按钮下沿左对齐弹出（⋯ 按钮、胶囊）。 */
export function anchorBelow(button: HTMLElement): MenuAnchor {
  const rect = button.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + 4, returnFocus: button };
}

const edge = 8;

function isAction(entry: MenuEntry): entry is MenuAction {
  return !("kind" in entry);
}

function MenuItems({
  items,
  onPicked,
}: {
  items: readonly MenuEntry[];
  /** 选中一项后（执行前）调用：关菜单、还焦点。 */
  onPicked(): void;
}) {
  const selection = items.some((entry) => isAction(entry) && entry.checked !== undefined);
  return (
    <>
      {items.map((entry) => {
        if (!isAction(entry)) {
          return entry.kind === "separator" ? (
            <div key={entry.id} className="ui-menu-sep" role="separator" />
          ) : (
            <div key={entry.id} className="ui-menu-label" role="presentation">
              {entry.label}
            </div>
          );
        }
        const disabled = entry.disabledReason !== undefined;
        const note = entry.disabledReason ?? entry.note;
        return (
          <button
            key={entry.id}
            type="button"
            role={selection ? "menuitemradio" : "menuitem"}
            aria-checked={selection ? entry.checked === true : undefined}
            aria-disabled={disabled || undefined}
            className="ui-menu-item"
            data-tone={entry.tone}
            data-testid={entry.testId}
            onClick={() => {
              if (disabled) return;
              // 菜单项可能要弹重命名输入框或抢焦点，所以先关菜单、把焦点还回去，再执行。
              onPicked();
              entry.onSelect();
            }}
          >
            {selection ? entry.checked === true ? <Check /> : <span /> : (entry.icon ?? <span />)}
            {note === undefined ? (
              <span className="ui-menu-label-text">{entry.label}</span>
            ) : (
              <span className="ui-menu-text">
                {entry.label}
                <span className="ui-menu-note">{note}</span>
              </span>
            )}
            {entry.shortcut !== undefined && <span className="ui-menu-hint">{entry.shortcut}</span>}
          </button>
        );
      })}
    </>
  );
}

/** 方向键 / Home / End 在菜单项间移动（跳过不可用项也停留，原因要能读到）；Tab 不离开菜单。 */
function moveFocus(event: KeyboardEvent, root: HTMLElement | null): boolean {
  const buttons = [...(root?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const at = buttons.indexOf(document.activeElement as HTMLElement);
  const to =
    event.key === "ArrowDown"
      ? at + 1
      : event.key === "ArrowUp"
        ? at - 1
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : null;
  if (to === null) return false;
  event.preventDefault();
  buttons[(to + buttons.length) % buttons.length]?.focus();
  return true;
}

export function Menu({
  anchor,
  items,
  label,
  onClose,
  testId,
}: {
  anchor: MenuAnchor;
  items: readonly MenuEntry[];
  label: string;
  onClose(): void;
  testId?: string | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  const [open, setOpen] = useState(true);
  const presence = usePresence(open);
  const requestClose = () => setOpen(false);
  // 退出动画还没放完时父级又用新锚点打开了菜单：把这个实例重新打开，不然动画结束后会把新菜单一起关掉。
  const [seenAnchor, setSeenAnchor] = useState(anchor);
  if (seenAnchor !== anchor) {
    setSeenAnchor(anchor);
    setOpen(true);
  }

  // 贴边时翻到锚点另一侧，保证整个菜单在窗口内。
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(edge, Math.min(anchor.x, window.innerWidth - box.width - edge)),
      top: Math.max(edge, Math.min(anchor.y, window.innerHeight - box.height - edge)),
    });
  }, [anchor.x, anchor.y]);

  // 退出动画中被重新打开（同一个实例换了锚点）也要把焦点放进菜单，不然 Esc 和方向键落在原来的元素上。
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) requestClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  // 退出动画放完（卸载）才通知父级真正关掉。
  const mounted = presence.mounted;
  useEffect(() => {
    if (!mounted) onClose();
  }, [mounted, onClose]);

  const picked = () => {
    requestClose();
    anchor.returnFocus?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (moveFocus(event, ref.current)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      picked();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  if (!presence.mounted) return null;
  return createPortal(
    <div
      ref={ref}
      className="ui-menu"
      data-floating=""
      role="menu"
      aria-label={label}
      style={position}
      onKeyDown={onKeyDown}
      data-testid={testId}
      {...presence.exitProps}
    >
      <MenuItems items={items} onPicked={picked} />
    </div>,
    document.body,
  );
}

/** 嵌在 Popover 里的菜单：键盘同 Menu；选中后调用 onPicked（一般是关浮层）。 */
export function MenuList({
  items,
  label,
  onPicked,
  testId,
}: {
  items: readonly MenuEntry[];
  label: string;
  onPicked(): void;
  testId?: string | undefined;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="ui-menu"
      data-inline=""
      role="menu"
      aria-label={label}
      onKeyDown={(event) => moveFocus(event, ref.current)}
      data-testid={testId}
    >
      <MenuItems items={items} onPicked={onPicked} />
    </div>
  );
}

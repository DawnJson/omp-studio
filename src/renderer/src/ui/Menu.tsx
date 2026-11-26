// 菜单（spec §4.23 Menu）：一种样式、一种键盘行为。项高 32，第一列 16px：动作菜单放图标，选择菜单放 ✓（当前项只靠 ✓，
// 灰底只表示悬停 / 键盘焦点）；破坏性项红字、放最后、前面一条分隔线；不可用项灰字、原因写在第二行小字。
// Menu：按锚点 fixed 弹出（右键菜单、⋯ 菜单），贴边时翻到锚点另一侧；Esc / 点外面关闭，焦点回到打开它的元素。
// MenuList：嵌在 Popover 里的同一种菜单（审批模式等），外框由浮层给。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check } from "../icons.tsx";
import { floatingChanged } from "./floating.ts";
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
  /** 给了就是选择项：选中的第一列画 ✓。一个菜单里多项可选是单选（menuitemradio），只有一项是开关（menuitemcheckbox）。同一个菜单里不和图标混用。 */
  checked?: boolean | undefined;
  tone?: "danger" | undefined;
  /** 有值表示这一项现在不能用（灰显、不执行），值写在第二行。 */
  disabledReason?: string | undefined;
  /** 灰显、不执行，但不写第二行；原因放 title。 */
  disabled?: boolean | undefined;
  /** 悬停提示（全局 TooltipLayer 读 title）。 */
  title?: string | undefined;
  testId?: string | undefined;
  onSelect(): void;
}

/** 色板一行（如任务颜色）：左边一个标签，右边一排可选的色块，当前的带外圈；选一个就执行并关菜单。 */
export interface MenuSwatches {
  kind: "swatches";
  id: string;
  label: string;
  /** color 是 CSS 颜色（多用 var(--…)）；null = "无颜色"那一格。 */
  options: readonly { id: string; label: string; color: string | null; checked: boolean; testId?: string }[];
  onPick(id: string): void;
}

export type MenuEntry =
  MenuAction | MenuSwatches | { kind: "separator"; id: string } | { kind: "label"; id: string; label: string };

export interface MenuAnchor {
  x: number;
  y: number;
  /** 关闭后接收焦点的元素（打开前的 activeElement）。 */
  returnFocus: HTMLElement | null;
  /** "end"：x 是菜单的右缘（触发器在窗口右侧时向左展开）。默认 x 是左缘。 */
  align?: "start" | "end";
  /** 下方放不下时菜单底边贴到这里（触发器上沿）；没有就贴到 y（右键位置）。 */
  flipY?: number;
}

const edge = 8;
const gap = 4;

/** 在按钮下沿左对齐弹出（⋯ 按钮、胶囊）；下方放不下翻到按钮上方。 */
export function anchorBelow(button: HTMLElement): MenuAnchor {
  const rect = button.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom + gap, flipY: rect.top - gap, returnFocus: button };
}

/** 在按钮下沿右对齐弹出：给窗口右侧的触发器（工具栏右端、卡片右上角的 ⋯）。 */
export function anchorBelowEnd(button: HTMLElement): MenuAnchor {
  const rect = button.getBoundingClientRect();
  return { x: rect.right, y: rect.bottom + gap, flipY: rect.top - gap, align: "end", returnFocus: button };
}

/**
 * 菜单盒子在窗口里的位置：四周至少留 edge；下方放不下翻到锚点上方。按钮弹出的菜单（有 flipY）上下都放不下时
 * 放在剩得多的那一侧、限高自己滚，不夹回窗口里盖住按钮（盖住了就点不到按钮关它）。
 */
function place(
  anchor: MenuAnchor,
  width: number,
  height: number,
): { left: number; top: number; maxHeight: number | undefined } {
  const left = Math.max(
    edge,
    Math.min(anchor.align === "end" ? anchor.x - width : anchor.x, window.innerWidth - width - edge),
  );
  const below = window.innerHeight - edge - anchor.y;
  if (height <= below || anchor.flipY === undefined) {
    const top = height <= below ? anchor.y : (anchor.flipY ?? anchor.y) - height;
    return { left, top: Math.max(edge, Math.min(top, window.innerHeight - height - edge)), maxHeight: undefined };
  }
  const above = anchor.flipY - edge;
  if (height <= above) return { left, top: anchor.flipY - height, maxHeight: undefined };
  return above > below ? { left, top: edge, maxHeight: above } : { left, top: anchor.y, maxHeight: below };
}

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
  const checkable = items.filter((entry) => isAction(entry) && entry.checked !== undefined).length;
  // 一组里选一个是单选（menuitemradio）；只有一项可勾的是开关（menuitemcheckbox，如"在独立 worktree 里开始"）。
  const selection = checkable === 0 ? null : checkable === 1 ? "menuitemcheckbox" : "menuitemradio";
  return (
    <>
      {items.map((entry) => {
        if (!isAction(entry)) {
          if (entry.kind === "swatches") {
            return (
              <div key={entry.id} className="ui-menu-swatches" role="group" aria-label={entry.label}>
                <span className="ui-menu-swatches-label">{entry.label}</span>
                {entry.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={option.checked}
                    aria-label={option.label}
                    title={option.label}
                    className="ui-menu-swatch"
                    data-none={option.color === null || undefined}
                    style={option.color === null ? undefined : { background: option.color }}
                    data-testid={option.testId}
                    onClick={() => {
                      onPicked();
                      entry.onPick(option.id);
                    }}
                  />
                ))}
              </div>
            );
          }
          return entry.kind === "separator" ? (
            <div key={entry.id} className="ui-menu-sep" role="separator" />
          ) : (
            <div key={entry.id} className="ui-menu-label" role="presentation">
              {entry.label}
            </div>
          );
        }
        const disabled = entry.disabled === true || entry.disabledReason !== undefined;
        const note = entry.disabledReason ?? entry.note;
        return (
          <button
            key={entry.id}
            type="button"
            role={selection ?? "menuitem"}
            aria-checked={selection !== null ? entry.checked === true : undefined}
            aria-disabled={disabled || undefined}
            className="ui-menu-item"
            data-tone={entry.tone}
            data-testid={entry.testId}
            title={entry.title}
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
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number | undefined }>({
    left: anchor.x,
    top: anchor.y,
    maxHeight: undefined,
  });
  const [open, setOpen] = useState(true);
  const presence = usePresence(open);
  const requestClose = () => setOpen(false);
  // 退出动画还没放完时父级又用新锚点打开了菜单：把这个实例重新打开，不然动画结束后会把新菜单一起关掉。
  const [seenAnchor, setSeenAnchor] = useState(anchor);
  if (seenAnchor !== anchor) {
    setSeenAnchor(anchor);
    setOpen(true);
  }

  // 贴边时翻到锚点另一侧，四周至少留 edge；内容或窗口尺寸变了（字体、异步项）重新夹紧。
  // 量的是内容的整高（scrollHeight 加边框），不是限高后的盒子，限过一次高下次还能放回不限高。
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const next = place(anchor, node.offsetWidth, node.scrollHeight + node.offsetHeight - node.clientHeight);
      setPosition((prev) =>
        prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next,
      );
      floatingChanged();
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      floatingChanged();
    };
  }, [anchor, presence.mounted]);

  // 退出动画中被重新打开（同一个实例换了锚点）也要把焦点放进菜单，不然 Esc 和方向键落在原来的元素上。
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    if (!open) return;
    // 打开它的按钮（带 aria-haspopup 的 ⋯、胶囊）再点一下 = 关：按下时菜单已经在关，这次点击不能再传到按钮上，
    // 不然按钮的 onClick 用新锚点把菜单又打开。右键菜单的锚点（行本身）不带 aria-haspopup，点它照常。
    const trigger = anchor.returnFocus?.hasAttribute("aria-haspopup") ? anchor.returnFocus : null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      requestClose();
      if (event.button !== 0 || trigger === null || !trigger.contains(target)) return;
      const swallow = (click: MouseEvent) => {
        if (!trigger.contains(click.target as Node)) return;
        click.stopPropagation();
        click.preventDefault();
      };
      // 点击紧跟在 pointerup 后同步派发；之后就拿掉，拖出按钮再松开（没有点击）时不吞掉下一次点击。
      const stop = () => setTimeout(() => window.removeEventListener("click", swallow, true));
      window.addEventListener("click", swallow, true);
      window.addEventListener("pointerup", stop, { capture: true, once: true });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, anchor]);

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

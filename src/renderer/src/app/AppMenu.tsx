// 菜单共用的零件：菜单项和键盘处理（侧栏底部的语言/主题菜单在用，features/sidebar/PreferenceMenus.tsx）。
// 键盘：↑↓/Home/End 移动，Enter/Space 执行，Esc 关闭，关闭后焦点回到打开前的元素（spec §5.3）。
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { CheckIcon } from "./icons.tsx";

/** 菜单项。给了 checked 就是单选项（menuitemradio），左边打勾。 */
export function MenuItem(props: { children: ReactNode; shortcut?: string; checked?: boolean; onSelect(): void }) {
  const role = props.checked === undefined ? "menuitem" : "menuitemradio";
  return (
    <button
      type="button"
      role={role}
      aria-checked={props.checked}
      className="menu-item"
      tabIndex={-1}
      onClick={props.onSelect}
    >
      <span className="menu-item-check">{props.checked ? <CheckIcon /> : null}</span>
      <span className="menu-item-label">{props.children}</span>
      {props.shortcut ? <kbd className="kbd">{props.shortcut}</kbd> : null}
    </button>
  );
}

/** 菜单键盘：↑↓/Home/End 在菜单项之间移动（首尾循环），Esc/Tab 关闭。 */
export function onMenuKeyDown(
  event: KeyboardEvent<HTMLElement>,
  menu: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const move = (next: number) => {
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  if (event.key === "ArrowDown") move(index + 1);
  else if (event.key === "ArrowUp") move(index - 1);
  else if (event.key === "Home") move(0);
  else if (event.key === "End") move(items.length - 1);
  else if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }
}

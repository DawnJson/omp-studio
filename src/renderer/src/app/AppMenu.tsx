// 顶栏"关于"按钮（和 Alt 键）打开的菜单：帮助与反馈、关于。键盘：↑↓/Home/End 移动，Enter/Space 执行，Esc 关闭，
// 关闭后焦点回到打开前的元素（spec §5.3）。切换侧栏是顶栏上单独的按钮；新任务、命令面板、设置各有自己的入口和快捷键。
// 语言和主题在侧栏底部设置按钮右边（features/sidebar/PreferenceMenus.tsx）。
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { usePresence } from "../ui/presence.ts";
import { useT } from "../i18n/use-t.ts";
import { CheckIcon } from "./icons.tsx";

export interface AppMenuActions {
  openHelp(): void;
  openAbout(): void;
}

interface AppMenuProps {
  open: boolean;
  actions: AppMenuActions;
  onClose(): void;
}

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

export function AppMenu({ open, actions, onClose }: AppMenuProps) {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open);
  // 菜单左缘对齐顶栏上的"关于"按钮（按钮位置随侧栏宽度变）。
  const [left, setLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = document.querySelector<HTMLElement>('[data-testid="topbar-menu"]');
    setLeft(trigger === null ? null : Math.round(trigger.getBoundingClientRect().left));
  }, [open]);

  // 焦点在 open 变化时立即处理，不等退出动画放完。
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    onClose();
    action();
  };

  if (!presence.mounted) return null;

  return (
    <>
      <div className="menu-backdrop" data-closing={presence.closing ? "fade" : undefined} onPointerDown={onClose} />
      <div
        ref={menuRef}
        className="menu"
        style={left === null ? undefined : { left }}
        {...presence.exitProps}
        role="menu"
        aria-label={t("window.about")}
        data-testid="app-menu"
        onKeyDown={(event) => onMenuKeyDown(event, menuRef, onClose)}
      >
        <MenuItem onSelect={choose(actions.openHelp)}>{t("menu.helpFeedback")}</MenuItem>
        <MenuItem onSelect={choose(actions.openAbout)}>{t("menu.about")}</MenuItem>
      </div>
    </>
  );
}

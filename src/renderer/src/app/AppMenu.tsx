// 应用菜单（≡ 按钮和 Alt 键打开）：替代系统菜单栏。键盘：↑↓/Home/End 移动，Enter/Space 执行，Esc 关闭，
// 关闭后焦点回到打开前的元素（spec §5.3）。语言和主题在菜单里直接平铺成单选项。
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { LocalePreference, ThemePreference } from "../../../shared/ipc.ts";
import { useT } from "../i18n/use-t.ts";
import { useSettings } from "../store/index.ts";
import { CheckIcon } from "./icons.tsx";

export interface AppMenuActions {
  newTask(): void;
  openPalette(): void;
  openSettings(): void;
  openHelp(): void;
  openAbout(): void;
  quit(): void;
}

interface AppMenuProps {
  actions: AppMenuActions;
  onClose(): void;
}

const localeOptions: { value: LocalePreference; label: string | null }[] = [
  { value: "system", label: null },
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

function Item(props: { children: ReactNode; shortcut?: string; checked?: boolean; onSelect(): void }) {
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

export function AppMenu({ actions, onClose }: AppMenuProps) {
  const t = useT();
  const settings = useSettings();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const choose = (action: () => void) => () => {
    onClose();
    action();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
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
      onClose();
    }
  };

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: "system", label: t("menu.themeSystem") },
    { value: "light", label: t("menu.themeLight") },
    { value: "dark", label: t("menu.themeDark") },
  ];

  return (
    <>
      <div className="menu-backdrop" onPointerDown={onClose} />
      <div
        ref={menuRef}
        className="menu"
        role="menu"
        aria-label={t("window.menu")}
        data-testid="app-menu"
        onKeyDown={onKeyDown}
      >
        <Item shortcut="Ctrl N" onSelect={choose(actions.newTask)}>
          {t("menu.newTask")}
        </Item>
        <Item shortcut="Ctrl K" onSelect={choose(actions.openPalette)}>
          {t("menu.commandPalette")}
        </Item>
        <Item shortcut="Ctrl ," onSelect={choose(actions.openSettings)}>
          {t("menu.settings")}
        </Item>
        <div className="menu-separator" role="separator" />
        <div className="menu-heading" role="presentation">
          {t("menu.language")}
        </div>
        {localeOptions.map((option) => (
          <Item
            key={option.value}
            checked={settings?.locale === option.value}
            onSelect={choose(() => void window.studio.setLocale(option.value))}
          >
            {option.label ?? t("menu.languageSystem")}
          </Item>
        ))}
        <div className="menu-separator" role="separator" />
        <div className="menu-heading" role="presentation">
          {t("menu.theme")}
        </div>
        {themeOptions.map((option) => (
          <Item
            key={option.value}
            checked={settings?.theme === option.value}
            onSelect={choose(() => void window.studio.setTheme(option.value))}
          >
            {option.label}
          </Item>
        ))}
        <div className="menu-separator" role="separator" />
        <Item onSelect={choose(actions.openHelp)}>{t("menu.helpFeedback")}</Item>
        <Item onSelect={choose(actions.openAbout)}>{t("menu.about")}</Item>
        <div className="menu-separator" role="separator" />
        <Item onSelect={choose(actions.quit)}>{t("menu.quit")}</Item>
      </div>
    </>
  );
}

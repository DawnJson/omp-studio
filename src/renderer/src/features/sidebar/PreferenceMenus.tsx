// 侧栏底部设置按钮右边的语言、主题两个图标按钮：点开在按钮上方弹出单选菜单，选了立即生效（和设置页同一份设置）。
// 键盘同应用菜单：打开后焦点在当前选中项，↑↓/Home/End 移动，Enter/Space 选，Esc/Tab 关闭并把焦点还给按钮。
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { LocalePreference, ThemePreference } from "../../../../shared/ipc.ts";
import { MenuItem, onMenuKeyDown } from "../../app/AppMenu.tsx";
import { useT } from "../../i18n/use-t.ts";
import { useSettings } from "../../store/index.ts";
import { LanguageIcon, ThemeIcon } from "./icons.tsx";
import { usePresence } from "../../ui/presence.ts";
import { useHeld } from "../composer/use-held.ts";

interface Option<T> {
  value: T;
  label: string;
}

function PreferenceMenu<T extends string>(props: {
  label: string;
  icon: ReactNode;
  testId: string;
  current: T | undefined;
  options: Option<T>[];
  onPick(value: T): void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;
  const presence = usePresence(open);

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    const checked = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? items?.[0])?.focus();
  }, [open]);

  const close = () => {
    setAnchor(null);
    triggerRef.current?.focus();
  };

  // 菜单贴着按钮上沿、右边与按钮对齐，往左展开（按钮在侧栏右下角）。关闭后动画期间沿用关闭前的位置。
  const shownAnchor = useHeld(anchor);
  const style: CSSProperties | undefined = shownAnchor
    ? { bottom: window.innerHeight - shownAnchor.top + 4, right: window.innerWidth - shownAnchor.right }
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="sb-icon-btn"
        data-testid={props.testId}
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setAnchor(triggerRef.current?.getBoundingClientRect() ?? null))}
      >
        {props.icon}
      </button>
      {presence.mounted && (
        <>
          <div
            className="menu-backdrop"
            data-closing={presence.closing ? "fade" : undefined}
            onPointerDown={() => setAnchor(null)}
          />
          <div
            ref={menuRef}
            className="menu sb-pref-menu"
            role="menu"
            aria-label={props.label}
            data-testid={`${props.testId}-menu`}
            style={style}
            onKeyDown={(event) => onMenuKeyDown(event, menuRef, close)}
            {...presence.exitProps}
          >
            {props.options.map((option) => (
              <MenuItem
                key={option.value}
                checked={props.current === option.value}
                onSelect={() => {
                  close();
                  props.onPick(option.value);
                }}
              >
                {option.label}
              </MenuItem>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function PreferenceMenus() {
  const t = useT();
  const settings = useSettings();
  return (
    <>
      <PreferenceMenu<LocalePreference>
        label={t("menu.language")}
        icon={<LanguageIcon />}
        testId="sidebar-language"
        current={settings?.locale}
        options={[
          { value: "system", label: t("menu.languageSystem") },
          { value: "zh-CN", label: "简体中文" },
          { value: "en", label: "English" },
        ]}
        onPick={(value) => void window.studio.setLocale(value)}
      />
      <PreferenceMenu<ThemePreference>
        label={t("menu.theme")}
        icon={<ThemeIcon />}
        testId="sidebar-theme"
        current={settings?.theme}
        options={[
          { value: "system", label: t("menu.themeSystem") },
          { value: "light", label: t("menu.themeLight") },
          { value: "dark", label: t("menu.themeDark") },
        ]}
        onPick={(value) => void window.studio.setTheme(value)}
      />
    </>
  );
}

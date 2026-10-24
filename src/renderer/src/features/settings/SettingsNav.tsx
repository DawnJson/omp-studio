// 设置导航（spec §4.19，direction-3.2 §4 第 1 条）：进设置时占侧栏的位置（App.tsx 在侧栏位置渲染 SettingsNav），
// 顶上 `‹ 返回任务  Esc`、搜索全部设置、9 节；窗口窄到侧栏变抽屉、或侧栏被收起时，导航变成内容顶上的一个下拉 + 搜索框
// （SettingsCompactNav，由 SettingsView 渲染）。当前节和搜索词在 ui-store（SettingsView 读同一份）。
import type { KeyboardEvent } from "react";
import { useT } from "../../i18n/use-t.ts";
import { ChevronLeft, Close, Search } from "../../icons.tsx";
import {
  setSettingsPage,
  setSettingsQuery,
  showView,
  useAppInfo,
  useSettingsPage,
  useSettingsQuery,
  type SettingsPage,
} from "../../store/index.ts";
import { Button, IconButton, TextField } from "../../ui/controls.tsx";
import { Select } from "../../ui/Select.tsx";

// 只有一列分节，不分"omp-studio 的 / omp 的"（omp 的设置和终端共用一份，omp-settings.md），按要做的事排。
export const settingsPages: readonly SettingsPage[] = [
  "general",
  "models",
  "providers",
  "extensions",
  "tools",
  "context",
  "agents",
  "advanced",
  "about",
];

// 同一时刻只挂一个搜索框（侧栏里的，或内容顶上的）：Ctrl+F 聚焦它。
let searchInput: HTMLInputElement | null = null;

export function focusSettingsSearch(): void {
  searchInput?.focus();
  searchInput?.select();
}

/** Ctrl+F 聚焦搜索；Esc 回到进入设置前的视图（搜索框里有内容时它先自己清掉，已 preventDefault）。导航和内容共用。 */
export function onSettingsKeyDown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    focusSettingsSearch();
  } else if (event.key === "Escape" && !event.defaultPrevented) showView("conversation");
}

function SearchBox({ width }: { width: number | string }) {
  const t = useT();
  const query = useSettingsQuery();
  return (
    <TextField
      size="sm"
      width={width}
      type="search"
      ref={(node) => {
        if (node !== null) searchInput = node;
        else searchInput = null;
      }}
      value={query}
      placeholder={t("settings.search.placeholder")}
      aria-label={t("settings.search.hint")}
      leading={<Search size={14} />}
      trailing={
        query === "" ? undefined : (
          <IconButton
            label={t("settings.search.clear")}
            onClick={() => {
              setSettingsQuery("");
              searchInput?.focus();
            }}
          >
            <Close size={12} />
          </IconButton>
        )
      }
      onChange={setSettingsQuery}
      onKeyDown={(event) => {
        // 有内容时 Esc 先清搜索，不退出设置页。
        if (event.key === "Escape" && query !== "") {
          event.preventDefault();
          setSettingsQuery("");
        }
      }}
      testId="settings-search"
    />
  );
}

/** 侧栏位置的设置导航。 */
export function SettingsNav() {
  const t = useT();
  const page = useSettingsPage();
  const query = useSettingsQuery();
  const info = useAppInfo();
  const searching = query.trim() !== "";
  return (
    <nav className="snav" aria-label={t("settings.sections")} data-testid="settings-nav" onKeyDown={onSettingsKeyDown}>
      <Button
        variant="quiet"
        size="sm"
        className="snav-back"
        icon={<ChevronLeft size={14} />}
        hint="Esc"
        onClick={() => showView("conversation")}
        testId="settings-back"
      >
        {t("settings.back")}
      </Button>
      <SearchBox width="100%" />
      {settingsPages.map((item) => {
        const label = t(`settings.${item}`);
        return (
          <button
            key={item}
            type="button"
            className="snav-item"
            aria-current={!searching && page === item ? "page" : undefined}
            onClick={() => setSettingsPage(item)}
            data-testid={`settings-nav-${item}`}
          >
            {label}
          </button>
        );
      })}
      {info !== null && (
        <div className="snav-foot" data-testid="settings-nav-version">
          {info.version}
        </div>
      )}
    </nav>
  );
}

/** 侧栏变抽屉（或被收起）时内容顶上的导航：节下拉 + 搜索框。 */
export function SettingsCompactNav() {
  const t = useT();
  const page = useSettingsPage();
  const query = useSettingsQuery();
  const searching = query.trim() !== "";
  return (
    <div className="snav-compact" data-testid="settings-nav-compact" onKeyDown={onSettingsKeyDown}>
      <Select<SettingsPage>
        size="sm"
        value={searching ? ("" as SettingsPage) : page}
        placeholder={t("settings.search")}
        options={settingsPages.map((item) => ({ value: item, label: t(`settings.${item}`) }))}
        label={t("settings.sections")}
        onChange={setSettingsPage}
        testId="settings-nav-select"
      />
      <SearchBox width={220} />
    </div>
  );
}

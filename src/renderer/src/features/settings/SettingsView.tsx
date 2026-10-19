// 设置页（spec §4.19）：占据主区；左侧分节列表（顶部是搜索框，下面是 omp-studio 自己的几组和 omp 的全部设置按它的 tab 分组），
// 搜索按 key、描述、中英文标签过滤 omp 的全部设置。Esc 回到进入前的视图和焦点（顶栏的后退按钮也能回去，所以页内没有"返回"）；
// 命令面板可以直接定位到某一节（ui-store 的 settingsSection）。导出名和 props 是 App.tsx 的约定。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Close, Search } from "../../icons.tsx";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { clearSettingsSection, showView, useSettingsSection } from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { configGroups, groupConfigItems, type ConfigGroup } from "../../../../shared/ui/config-groups.ts";
import { groupTitle } from "./config-meta.ts";
import { useConfigLoad } from "./config-store.ts";
import { AboutSection } from "./AboutSection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { OmpConfigPane, useOmpConfigLoader } from "./OmpConfigPane.tsx";
import { OmpSection } from "./OmpSection.tsx";
import { UsageSection } from "./UsageSection.tsx";
import "./motion-preference.ts";
import "./settings.css";
import "./config.css";

// 设置页只有一列分节，不按"omp-studio 的 / omp 的"分：omp 的设置和终端共用一份（omp-settings.md），按要做的事排。
// omp 的"模型与推理"并进"模型与账号"，同一页先账号和模型、再模型相关的 omp 设置。
type PageSection = "general" | "models" | "usage" | "omp" | "about";
type NavItem = { kind: "page"; id: PageSection } | { kind: "cfg"; group: ConfigGroup };
const MERGED_INTO_MODELS: ConfigGroup = "models";
const navOrder: readonly NavItem[] = [
  { kind: "page", id: "general" },
  { kind: "page", id: "models" },
  ...configGroups.filter((group) => group !== MERGED_INTO_MODELS).map((group) => ({ kind: "cfg" as const, group })),
  { kind: "page", id: "usage" },
  { kind: "page", id: "omp" },
  { kind: "page", id: "about" },
];

export function SettingsView() {
  const t = useT();
  const locale = useLocale();
  const load = useConfigLoad();
  const requested = useSettingsSection();
  const [section, setSection] = useState<string>("general");
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useOmpConfigLoader();

  // 进入时记住焦点元素，离开时还回去；焦点先放到页面上，Esc 才能立刻生效。
  useEffect(() => {
    const trigger = document.activeElement;
    root.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  // 换节、开始搜索时内容回到顶部。
  const queryEmpty = query === "";
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [section, queryEmpty]);

  // 从命令面板等处直接定位到某一节：切过去、清掉搜索、把焦点放到节标题。
  useEffect(() => {
    if (requested === null) return;
    setQuery("");
    setSection(
      requested === "shortcuts" ? "general" : requested === `cfg:${MERGED_INTO_MODELS}` ? "models" : requested,
    );
    clearSettingsSection();
    requestAnimationFrame(() => {
      if (requested === "shortcuts") document.getElementById("settings-shortcuts")?.scrollIntoView({ block: "start" });
      (requested === "shortcuts" ? document.getElementById("settings-shortcuts") : title.current)?.focus();
    });
  }, [requested]);

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
    } else if (event.key === "Escape" && !event.defaultPrevented) showView("conversation");
  };

  const searching = query.trim() !== "";
  // 读到 omp 设置之前按全部分组显示，读到后去掉没有项的分组（导航不跳动）。
  const groups = useMemo(
    () => (load.kind === "ready" ? new Set(groupConfigItems(load.snapshot.items).keys()) : new Set(configGroups)),
    [load],
  );
  const nav = navOrder.filter((item) => item.kind === "page" || groups.has(item.group));
  const cfgGroup = section.startsWith("cfg:") ? (section.slice(4) as ConfigGroup) : null;
  const heading = searching
    ? t("settings.search")
    : cfgGroup !== null
      ? groupTitle(locale, cfgGroup)
      : t(`settings.${section as PageSection}`);
  const choose = (next: string) => {
    setQuery("");
    setSection(next);
  };

  return (
    <div ref={root} className="settings" tabIndex={-1} onKeyDown={onKeyDown} data-testid="settings">
      <nav className="settings-nav" aria-label={t("settings.sections")}>
        <div className="cfg-search">
          <Search size={14} className="icon cfg-search-icon" />
          <input
            ref={search}
            type="search"
            className="cfg-search-input"
            value={query}
            placeholder={t("settings.search")}
            aria-label={t("settings.search.hint")}
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // 有内容时 Esc 先清搜索，不退出设置页。
              if (event.key === "Escape" && query !== "") {
                event.preventDefault();
                setQuery("");
              }
            }}
            data-testid="settings-search"
          />
          {query !== "" && (
            <button
              type="button"
              className="cfg-search-clear"
              aria-label={t("settings.search.clear")}
              onClick={() => {
                setQuery("");
                search.current?.focus();
              }}
            >
              <Close size={12} className="icon" />
            </button>
          )}
        </div>
        {nav.map((item) => {
          const id = item.kind === "page" ? item.id : `cfg:${item.group}`;
          const label = item.kind === "page" ? t(`settings.${item.id}`) : groupTitle(locale, item.group);
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-current={!searching && section === id ? "page" : undefined}
              onClick={() => choose(id)}
              data-testid={item.kind === "page" ? `settings-nav-${item.id}` : `settings-nav-cfg-${item.group}`}
            >
              {label}
            </button>
          );
        })}
      </nav>
      <div className="settings-scroll-host">
        <div ref={scroller} className="settings-scroll">
          <div className="settings-content">
            <h2 ref={title} tabIndex={-1} className="settings-title">
              {heading}
            </h2>
            {/* 换节时 key 变，新节整体淡入上移（样式在 motion.css 末尾） */}
            <div key={searching ? "search" : section} className="settings-section">
              {searching || cfgGroup !== null ? (
                <OmpConfigPane group={cfgGroup} query={query} />
              ) : (
                <>
                  {section === "general" && <GeneralSection />}
                  {section === "models" && (
                    <>
                      <ModelsSection />
                      {groups.has(MERGED_INTO_MODELS) && (
                        <>
                          <h3 className="settings-group-title">{groupTitle(locale, MERGED_INTO_MODELS)}</h3>
                          <OmpConfigPane group={MERGED_INTO_MODELS} query="" omit={["defaultThinkingLevel"]} />
                        </>
                      )}
                    </>
                  )}
                  {section === "usage" && <UsageSection />}
                  {section === "omp" && <OmpSection />}
                  {section === "about" && <AboutSection />}
                </>
              )}
            </div>
          </div>
        </div>
        <OverlayScrollbar target={scroller} />
      </div>
    </div>
  );
}

// 设置页（spec §4.19）：占据主区；左侧一列平铺的分节（顶部是搜索框），右侧是当前节；
// 搜索按 key、描述、中英文标签过滤 omp 的全部设置。Esc 回到进入前的视图和焦点（顶栏的后退按钮也能回去，所以页内没有"返回"）；
// 命令面板可以直接定位到某一节（ui-store 的 settingsSection）。导出名和 props 是 App.tsx 的约定。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Close, Search } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { clearSettingsSection, showView, useSettingsSection, type SettingsSection } from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { AboutSection } from "./AboutSection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import { McpCard } from "./McpCard.tsx";
import { MemoryCard } from "./MemoryCard.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { OmpConfigPane, useOmpConfigLoader } from "./OmpConfigPane.tsx";
import { PluginsSection } from "./PluginsSection.tsx";
import { ProvidersSection } from "./ProvidersSection.tsx";
import { SshCard } from "./SshCard.tsx";
import { ToolsCard } from "./ToolsCard.tsx";
import "./motion-preference.ts";
import "./settings.css";
import "./config.css";

// 只有一列分节，不分"omp-studio 的 / omp 的"（omp 的设置和终端共用一份，omp-settings.md），按要做的事排。
// 每节只放常用的 omp 设置（有人话标签的）和管理卡片；其余几百个 omp 键全在"高级"，搜索覆盖全部。
type Page = Exclude<SettingsSection, "shortcuts">;
const pages: readonly Page[] = [
  "general",
  "models",
  "providers",
  "tools",
  "context",
  "agents",
  "integrations",
  "plugins",
  "advanced",
  "about",
];

function PageContent({ page }: { page: Page }) {
  switch (page) {
    case "general":
      return <GeneralSection />;
    case "models":
      return <ModelsSection />;
    case "providers":
      return <ProvidersSection />;
    case "tools":
      return (
        <>
          <OmpConfigPane view={{ kind: "common", group: "tools" }} />
          <ToolsCard />
        </>
      );
    case "context":
      return (
        <>
          <OmpConfigPane view={{ kind: "common", group: "context" }} />
          <MemoryCard />
        </>
      );
    case "agents":
      return <OmpConfigPane view={{ kind: "common", group: "agents" }} />;
    case "integrations":
      return (
        <>
          <McpCard />
          <SshCard />
        </>
      );
    case "plugins":
      return <PluginsSection />;
    case "advanced":
      return <OmpConfigPane view={{ kind: "advanced" }} />;
    case "about":
      return <AboutSection />;
  }
}

export function SettingsView() {
  const t = useT();
  const requested = useSettingsSection();
  const [section, setSection] = useState<Page>("general");
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
    setSection(requested === "shortcuts" ? "general" : requested);
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
  const heading = searching ? t("settings.search") : t(`settings.${section}`);
  const choose = (next: Page) => {
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
        {pages.map((page) => {
          const label = t(`settings.${page}`);
          return (
            <button
              key={page}
              type="button"
              title={label}
              aria-current={!searching && section === page ? "page" : undefined}
              onClick={() => choose(page)}
              data-testid={`settings-nav-${page}`}
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
              {searching ? <OmpConfigPane view={{ kind: "search", query }} /> : <PageContent page={section} />}
            </div>
          </div>
        </div>
        <OverlayScrollbar target={scroller} />
      </div>
    </div>
  );
}

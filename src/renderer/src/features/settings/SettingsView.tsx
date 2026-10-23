// 设置页（spec §4.19）：主区里是当前节的内容；导航在侧栏位置（SettingsNav，App.tsx 渲染），侧栏不可见时（窄窗口的抽屉、
// 被收起）内容顶上是节下拉 + 搜索框（SettingsCompactNav）。搜索按 key、描述、中英文标签过滤 omp 的全部设置。
// Esc 回到进入前的视图和焦点（顶栏的后退按钮也能回去）；命令面板可以直接定位到某一节（ui-store 的 settingsSection）。
// 导出名和 props 是 App.tsx 的约定。
import { useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import {
  clearSettingsSection,
  useSettingsPage,
  useSettingsQuery,
  useSettingsSection,
  type SettingsPage,
} from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { AboutSection } from "./AboutSection.tsx";
import { GeneralSection } from "./GeneralSection.tsx";
import { IntegrationsSection } from "./IntegrationsSection.tsx";
import { MemoryCard } from "./MemoryCard.tsx";
import { ModelsSection } from "./ModelsSection.tsx";
import { OmpConfigPane, useOmpConfigLoader } from "./OmpConfigPane.tsx";
import { PageHeadSlot } from "./PageHeadActions.tsx";
import { PluginsSection } from "./PluginsSection.tsx";
import { ProvidersSection } from "./ProvidersSection.tsx";
import { onSettingsKeyDown, SettingsCompactNav } from "./SettingsNav.tsx";
import { ToolsCard } from "./ToolsCard.tsx";
import "./motion-preference.ts";
import "./settings.css";
import "./config.css";

function PageContent({ page }: { page: SettingsPage }) {
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
    case "extensions":
      return (
        <>
          <IntegrationsSection />
          <PluginsSection />
        </>
      );
    case "advanced":
      return <OmpConfigPane view={{ kind: "advanced" }} />;
    case "about":
      return <AboutSection />;
  }
}

export function SettingsView({ compactNav }: { compactNav: boolean }) {
  const t = useT();
  const requested = useSettingsSection();
  const section = useSettingsPage();
  const query = useSettingsQuery();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
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

  // 从命令面板等处直接定位到某一节（ui-store 已切到那一节、清掉搜索）：把焦点放到节标题；快捷键卡片滚到眼前。
  useEffect(() => {
    if (requested === null) return;
    clearSettingsSection();
    requestAnimationFrame(() => {
      const target = requested === "shortcuts" ? document.getElementById("settings-shortcuts") : title.current;
      if (requested === "shortcuts") target?.scrollIntoView({ block: "start" });
      target?.focus();
    });
  }, [requested]);

  const searching = query.trim() !== "";
  const heading = searching ? t("settings.search") : t(`settings.${section}`);
  return (
    <div ref={root} className="settings" tabIndex={-1} onKeyDown={onSettingsKeyDown} data-testid="settings">
      <div className="settings-scroll-host">
        <div ref={scroller} className="settings-scroll">
          <div className="settings-content">
            {compactNav && <SettingsCompactNav />}
            <div className="st-page-head">
              <h1 ref={title} tabIndex={-1} className="settings-title">
                {heading}
              </h1>
              <div ref={setSlot} className="st-page-end" />
            </div>
            <PageHeadSlot value={slot}>
              {/* 换节时 key 变，新节整体淡入上移（样式在 motion.css 末尾） */}
              <div key={searching ? "search" : section} className="settings-section">
                {searching ? <OmpConfigPane view={{ kind: "search", query }} /> : <PageContent page={section} />}
              </div>
            </PageHeadSlot>
          </div>
        </div>
        <OverlayScrollbar target={scroller} />
      </div>
    </div>
  );
}

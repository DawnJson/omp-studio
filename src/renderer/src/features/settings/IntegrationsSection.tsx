// 设置 → 集成与插件：页头右侧一个"范围"下拉（MCP、SSH、Skills、插件共用），前面的图标跟着选中的范围（全局 / 项目），下面是各分组。
import { useEffect } from "react";
import { Folder, Globe } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { useProjects } from "../sidebar/projects-store.ts";
import { McpCard } from "./McpCard.tsx";
import { PageHeadActions } from "./PageHeadActions.tsx";
import { PluginsSection } from "./PluginsSection.tsx";
import { scopeProject, setCardScope, useCardScope } from "./integrations-store.ts";
import { ScopePicker } from "./ScopePicker.tsx";
import { SkillsCard } from "./SkillsCard.tsx";
import { SshCard } from "./SshCard.tsx";

export function IntegrationsSection() {
  const t = useT();
  const scope = useCardScope("integrations");
  // 选中的项目被移除了：回到用户范围，不假装还看着它。
  const projects = useProjects();
  const known = scope === "user" || projects.some((project) => project.id === scope);
  useEffect(() => {
    if (!known) setCardScope("integrations", "user");
  }, [known]);
  return (
    <>
      <PageHeadActions>
        <span className="ig-scope-icon" title={t("integrations.field.scope")} aria-hidden>
          {scope === "user" ? <Globe size={14} /> : <Folder size={14} />}
        </span>
        <ScopePicker
          value={scope}
          includeUser
          size="sm"
          label={t("integrations.field.scope")}
          onChange={(next) => setCardScope("integrations", next)}
          testId="integrations-scope-picker"
        />
      </PageHeadActions>
      <McpCard scope={scope} />
      <SshCard scope={scope} />
      <SkillsCard scope={scope} />
      <PluginsSection projectId={scopeProject(scope)} />
    </>
  );
}

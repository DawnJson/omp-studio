// 设置 → 集成与插件：页头右侧一个"范围"下拉（MCP、SSH、Skills、插件共用），下面是各分组。
import { useEffect, useId } from "react";
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
  const labelId = useId();
  // 选中的项目被移除了：回到用户范围，不假装还看着它。
  const projects = useProjects();
  const known = scope === "user" || projects.some((project) => project.id === scope);
  useEffect(() => {
    if (!known) setCardScope("integrations", "user");
  }, [known]);
  return (
    <>
      <PageHeadActions>
        <span id={labelId} className="ig-scope-label">
          {t("integrations.field.scope")}
        </span>
        <ScopePicker
          value={scope}
          includeUser
          size="sm"
          labelledBy={labelId}
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

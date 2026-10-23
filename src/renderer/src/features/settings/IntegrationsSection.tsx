// 设置 → 集成与插件的集成部分：页头右侧一个"范围"下拉（MCP、SSH、Skills 共用），下面是三个分组。
import { useId } from "react";
import { useT } from "../../i18n/use-t.ts";
import { McpCard } from "./McpCard.tsx";
import { PageHeadActions } from "./PageHeadActions.tsx";
import { setCardScope, useCardScope } from "./integrations-store.ts";
import { ScopePicker } from "./ScopePicker.tsx";
import { SkillsCard } from "./SkillsCard.tsx";
import { SshCard } from "./SshCard.tsx";

export function IntegrationsSection() {
  const t = useT();
  const scope = useCardScope("integrations");
  const labelId = useId();
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
          width={168}
          labelledBy={labelId}
          onChange={(next) => setCardScope("integrations", next)}
          testId="integrations-scope-picker"
        />
      </PageHeadActions>
      <McpCard scope={scope} />
      <SshCard scope={scope} />
      <SkillsCard scope={scope} />
    </>
  );
}

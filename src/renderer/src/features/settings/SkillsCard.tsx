// 设置 → 集成与插件 → Skills：omp 当前能用的 skill，只读（omp 没有启用 / 禁用 / 删除 skill 的命令，也不给文件路径）。
// 数据来自 rpc-ui 的 get_available_commands（source = skill，见 shared/omp-output/skills.ts）；范围由页头的下拉选。
import { useEffect } from "react";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Restart } from "../../icons.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, IconButton, ListRow, Notice, SectionHead } from "../../ui/controls.tsx";
import { skillsResource } from "./integrations-data.ts";
import type { ScopeKey } from "./integrations-store.ts";
import "./integrations.css";

export function SkillsCard({ scope }: { scope: ScopeKey }) {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = skillsResource.useLoad(scope);

  useEffect(() => {
    if (ready) void skillsResource.load(scope);
  }, [ready, scope]);

  const skills = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;

  return (
    <div className="st-section" data-testid="skills-card">
      <SectionHead
        title={t("integrations.skills.title")}
        count={skills?.length}
        actions={
          <IconButton
            label={t("integrations.refresh")}
            disabled={!ready}
            onClick={() => void skillsResource.load(scope)}
            testId="skills-refresh"
          >
            <Restart />
          </IconButton>
        }
      />
      {load.kind === "error" && (
        <Notice tone="error" testId="skills-load-failed">
          <span className="ig-raw">{t("integrations.loadFailed", { message: errorDetail(load.error) })}</span>
        </Notice>
      )}
      {!ready && <p className="ig-note">{t("settings.cfg.notReady")}</p>}
      {ready && skills === null && load.kind !== "error" && <p className="ig-note">{t("integrations.loading")}</p>}
      {skills?.length === 0 && (
        <p className="ig-note" title={t("integrations.skills.empty.tip")} data-testid="skills-empty">
          {t("integrations.skills.empty")}
        </p>
      )}
      {skills !== null && skills.length > 0 && (
        <div className="ui-cards">
          {skills.map((skill) => (
            <ListRow
              key={skill.name}
              testId={`skill-row-${skill.name}`}
              icon={skill.name.slice(0, 2)}
              title={skill.name}
              badges={
                scope === "user" ? undefined : (
                  <Badge>
                    {skill.scope === "user" ? t("integrations.scope.user") : t("integrations.scope.project")}
                  </Badge>
                )
              }
              meta={
                skill.description !== undefined && (
                  <span className="ig-clamp" title={skill.description}>
                    {skill.description}
                  </span>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 添加 skill 的对话框：选一个带 SKILL.md 的文件夹（主进程弹系统对话框、校验 frontmatter；路径留在主进程，这里只看到文件夹名和解析出的名字 / 说明），
// 再选装到哪里：`.agents/skills`（各家 agent 共用）或 omp 自己的 `skills/`（只有 omp）；项目范围的视图里还可以选装到项目。
import { useState } from "react";
import type { SkillCandidate, SkillScope, SkillTarget } from "../../../../shared/omp-output/skills.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Button, FormField, Notice, Segmented, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { InfoTip } from "../../ui/InfoTip.tsx";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import { useAsyncAction } from "./use-async-action.ts";
import "./integrations.css";

export function SkillForm({
  scopeKey,
  onDone,
}: {
  scopeKey: ScopeKey;
  /** 成功时带 skill 名；取消、关掉时 null。 */
  onDone(added: string | null): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<SkillCandidate | null>(null);
  const [scope, setScope] = useState<SkillScope>("user");
  const [target, setTarget] = useState<SkillTarget>("shared");
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAsyncAction((caught) => setError(errorDetail(caught)));

  const targets: Option<SkillTarget>[] = [
    { value: "shared", label: t("integrations.skills.target.shared") },
    { value: "omp", label: t("integrations.skills.target.omp") },
  ];
  const scopes: Option<SkillScope>[] = [
    { value: "user", label: t("integrations.scope.user") },
    { value: "project", label: t("integrations.scope.project") },
  ];
  // 用户范围的视图里没有项目目录：只能装到用户范围。
  const effectiveScope: SkillScope = scopeKey === "user" ? "user" : scope;

  const pick = () =>
    run(async () => {
      setError(null);
      try {
        const candidate = await window.studio.pickSkillFolder();
        if (candidate !== null) setPicked(candidate);
      } catch (caught) {
        setPicked(null);
        throw caught;
      }
    });

  const submit = () => {
    if (picked === null) return;
    return run(async () => {
      setError(null);
      const added = await window.studio.addSkill(picked.token, target, effectiveScope, scopeProject(scopeKey));
      onDone(added.name);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={() => onDone(null)}
      title={t("integrations.skills.form.title")}
      testId="skill-form"
      footer={
        <>
          <Button onClick={() => setOpen(false)} testId="skill-cancel">
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={picked === null}
            loading={busy && picked !== null}
            onClick={() => void submit()}
            testId="skill-save"
          >
            {t("integrations.add")}
          </Button>
        </>
      }
    >
      <div className="ig-form">
        <FormField label={t("integrations.skills.folder")}>
          <div className="ig-pick">
            <Button disabled={busy} onClick={() => void pick()} testId="skill-pick">
              {picked === null ? t("integrations.skills.pick") : t("integrations.skills.pickAgain")}
            </Button>
            {picked !== null && (
              <div className="ig-picked" data-testid="skill-picked">
                <span className="ig-raw ig-picked-folder" data-testid="skill-picked-folder">
                  {picked.folderName}
                </span>
                <span className="ig-raw ig-picked-name" data-testid="skill-picked-name">
                  {picked.name}
                </span>
                <span className="ig-raw ig-clamp" title={picked.description} data-testid="skill-picked-description">
                  {picked.description}
                </span>
              </div>
            )}
          </div>
        </FormField>
        {scopeKey !== "user" && (
          <FormField label={t("integrations.field.scope")}>
            <Segmented<SkillScope>
              value={scope}
              options={scopes}
              label={t("integrations.field.scope")}
              onChange={setScope}
              testId="skill-scope"
            />
          </FormField>
        )}
        <FormField
          label={
            <>
              {t("integrations.skills.target")}
              <InfoTip>
                {t(
                  effectiveScope === "user"
                    ? "integrations.skills.target.tip.user"
                    : "integrations.skills.target.tip.project",
                )}
              </InfoTip>
            </>
          }
        >
          <Segmented<SkillTarget>
            value={target}
            options={targets}
            label={t("integrations.skills.target")}
            onChange={setTarget}
            testId="skill-target"
          />
        </FormField>
        {error !== null && (
          <Notice tone="error" testId="skill-form-error">
            <span className="ig-raw">{error}</span>
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

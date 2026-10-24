// 设置 → 集成与插件 → Skills（spec §4.19）：`omp skill list --json` 的结果（主进程 src/main/integrations/skills.ts），范围由页头的下拉选。
// 停用 / 启用经 `omp config set disabledExtensions`（只加减 `skill:<name>`）；删除 = 把 skill 文件夹移进回收站；添加 = 复制一个带 SKILL.md 的文件夹。
// 被停用的 skill 不在 omp 的列表里，主进程按配置补成"已停用"行（只有名字）。
import { useEffect, useState } from "react";
import type { SkillEntry } from "../../../../shared/omp-output/skills.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Plus, Restart } from "../../icons.tsx";
import { useOmpStatus } from "../../store/index.ts";
import { Badge, Button, IconButton, ListRow, Notice, SectionHead, Switch } from "../../ui/controls.tsx";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { useDialogSlot } from "../../ui/presence.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import { skillsResource } from "./integrations-data.ts";
import { scopeProject, type ScopeKey } from "./integrations-store.ts";
import { requestReload } from "./plugins-store.ts";
import { RowMenu } from "./RowMenu.tsx";
import { SkillForm } from "./SkillForm.tsx";
import "./integrations.css";

function SkillRow({
  skill,
  busy,
  showScope,
  onToggle,
  onRemove,
}: {
  skill: SkillEntry;
  busy: boolean;
  /** 只在选了某个项目（用户级和项目级一起显示）时标范围；用户范围下每行都一样，没有信息。 */
  showScope: boolean;
  onToggle(enabled: boolean): void;
  onRemove(): void;
}) {
  const t = useT();
  const sourceTip = skill.provider === undefined ? undefined : `${skill.provider}:${skill.scope}`;
  return (
    <ListRow
      testId={`skill-row-${skill.name}`}
      icon={skill.name.slice(0, 2)}
      title={skill.name}
      badges={
        <>
          {skill.disabled && <Badge testId={`skill-disabled-${skill.name}`}>{t("integrations.skills.disabled")}</Badge>}
          {skill.plugin && (
            <Badge title={sourceTip} testId={`skill-plugin-${skill.name}`}>
              {t("integrations.skills.plugin")}
            </Badge>
          )}
          {showScope && !skill.disabled && (
            <Badge title={sourceTip}>
              {skill.scope === "user" ? t("integrations.scope.user") : t("integrations.scope.project")}
            </Badge>
          )}
        </>
      }
      meta={
        skill.description !== undefined && (
          <span className="ig-clamp" title={skill.description}>
            {skill.description}
          </span>
        )
      }
      actions={
        <>
          <span title={skill.toggleable ? undefined : t("integrations.skills.toggle.project")}>
            <Switch
              checked={!skill.disabled}
              disabled={busy || !skill.toggleable}
              label={skill.name}
              onChange={onToggle}
              testId={`skill-enabled-${skill.name}`}
            />
          </span>
          <RowMenu
            label={t("integrations.more")}
            disabled={busy || !skill.removable}
            testId={`skill-more-${skill.name}`}
            items={[
              {
                id: "remove",
                label: t("integrations.remove"),
                tone: "danger",
                testId: `skill-remove-${skill.name}`,
                onSelect: onRemove,
              },
            ]}
          />
        </>
      }
    />
  );
}

export function SkillsCard({ scope }: { scope: ScopeKey }) {
  const t = useT();
  const ready = useOmpStatus()?.state === "ready";
  const load = skillsResource.useLoad(scope);
  const { slot: adding, open: openAdding, closed: addingClosed, reset: resetAdding } = useDialogSlot();
  const { slot: removing, open: openRemoving, closed: removingClosed } = useDialogSlot<SkillEntry>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (ready) void skillsResource.load(scope);
  }, [ready, scope]);
  // 换范围：关掉添加对话框、清掉上一个范围的失败提示。
  useEffect(() => {
    resetAdding();
    setFailure(null);
  }, [scope, resetAdding]);

  const skills = load.kind === "ready" ? load.data : "previous" in load ? load.previous : null;

  /** 一次写操作：成功就刷新列表、提示运行中的任务需要重新加载；失败把原因显示在卡片里。 */
  const write = async (job: () => Promise<void>, message?: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await job();
      requestReload();
      if (message !== undefined) pushToast({ message });
      await skillsResource.load(scope);
    } catch (error) {
      setFailure(errorDetail(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-section" data-testid="skills-card">
      <SectionHead
        title={t("integrations.skills.title")}
        count={skills?.length}
        actions={
          <>
            <IconButton
              label={t("integrations.refresh")}
              disabled={!ready}
              onClick={() => void skillsResource.load(scope)}
              testId="skills-refresh"
            >
              <Restart />
            </IconButton>
            <Button
              size="sm"
              icon={<Plus size={14} />}
              disabled={!ready || busy}
              onClick={() => openAdding(true)}
              testId="skills-add"
            >
              {t("integrations.skills.add")}
            </Button>
          </>
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
            <SkillRow
              key={`${skill.scope}:${skill.name}`}
              skill={skill}
              busy={busy}
              showScope={scope !== "user"}
              onToggle={(enabled) => void write(() => window.studio.setSkillEnabled(skill.name, enabled))}
              onRemove={() => openRemoving(skill)}
            />
          ))}
        </div>
      )}
      {failure !== null && (
        <Notice tone="error" testId="skills-failure">
          <span className="ig-raw">{failure}</span>
        </Notice>
      )}
      {adding !== null && (
        <SkillForm
          key={adding.key}
          scopeKey={scope}
          onDone={(added) => {
            addingClosed(adding.key);
            if (added === null) return;
            requestReload();
            pushToast({ message: t("integrations.skills.added", { name: added }) });
            void skillsResource.load(scope);
          }}
        />
      )}
      {removing !== null && (
        <ConfirmDialog
          key={removing.key}
          danger
          title={t("integrations.skills.remove.title", { name: removing.value.name })}
          body={
            <>
              <span className="ig-raw">{t("integrations.skills.remove.body")}</span>
              <span className="ig-raw ig-card-note" data-testid="skill-remove-folder">
                {removing.value.folder}
              </span>
              {removing.value.shared && (
                <span className="ig-card-note" data-testid="skill-remove-shared">
                  {t("integrations.skills.remove.shared")}
                </span>
              )}
            </>
          }
          confirmLabel={t("integrations.remove")}
          cancelLabel={t("common.cancel")}
          testId="skill-remove-confirm-dialog"
          onConfirm={() => {
            const skill = removing.value;
            removingClosed(removing.key);
            void write(
              () => window.studio.removeSkill(skill.name, skill.scope, scopeProject(scope)),
              t("integrations.skills.removed", { name: skill.name }),
            );
          }}
          onCancel={() => removingClosed(removing.key)}
        />
      )}
    </div>
  );
}

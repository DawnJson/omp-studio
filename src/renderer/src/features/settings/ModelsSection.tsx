// 设置 → 模型角色：默认思考强度、omp 的全部角色（对话模型一组、特定能力一组），以及 omp "模型与推理"组的常用项（重试与备用模型）。
// 每个角色一格：主模型 + 思考强度一行，下面每个备用模型（出错时依次换用，retry.fallbackChains 里以角色为 key 的那条）各一行，最后"添加备用…"。
// 值就是 omp 自己的 modelRoles / retry.fallbackChains / defaultThinkingLevel（设计原则 7），和 omp 设置是同一份；
// 改了就写全局（和模型选择对话框里给角色"应用"一样）。候选按角色能用的模型类别筛（role-options.ts）。
// 自定义角色（omp：modelRoles 里内置角色以外的名字，只用对话模型）可以添加、删除；omp 只认有模型的角色，所以添加时名字和模型一起填。
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import type { ModelKey } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { joinRoleValue, splitRoleValue } from "../../../../shared/ui/role-value.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Plus } from "../../icons.tsx";
import { Button, FormField, IconButton, Notice, TextField, type Option } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { describeError, reportError } from "../../ui/errors.ts";
import { InfoTip } from "../../ui/InfoTip.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import {
  chatRoles,
  customRoleNamePattern,
  isBuiltinRole,
  kindRoles,
  roleHintKey,
  roleKinds,
  roleLabel,
} from "../composer/model-groups.ts";
import { useModelSources } from "./accounts-store.ts";
import {
  ensureOmpConfigLoaded,
  saveOmpConfigOrThrow,
  saveOmpDefaultThinking,
  saveOmpModelRole,
  useOmpConfigValue,
} from "./config-store.ts";
import { ChainLevel, levelText } from "./ChainLevel.tsx";
import { CommonConfig } from "./ConfigSection.tsx";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";
import {
  candidatesOfKinds,
  chainKinds,
  isChainRecord,
  isStringRecord,
  levelsOfSelector,
  sourcesReady,
  withCurrent,
  type ModelSources,
} from "./role-options.ts";

const thinkingLevels = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const unset = "";
// 这几项在角色表里已经有了，omp 的同一项不再重复一行（搜索里照旧有）。
const shownAbove = ["defaultThinkingLevel", "modelRoles", "retry.fallbackChains"];

interface RoleTableProps {
  roles: readonly string[];
  sources: ModelSources;
  /** modelRoles；undefined = omp 设置还没读到。 */
  values: Record<string, string> | undefined;
  chains: Record<string, string[]>;
  /** 没设置时 omp 怎么办："未指定"（对话角色）或"由 omp 自动选择"。 */
  unsetLabel(role: string): string;
  /** 放在角色前面、和角色共用列宽的行（默认思考强度）。 */
  lead?: ReactNode;
}

/** 一组角色：每个角色一格（主模型 + 思考强度，每个备用模型各一行，"添加备用…"在最后）。 */
function RoleTable({ roles, sources, values, chains, unsetLabel, lead }: RoleTableProps) {
  return (
    <div className="st-roles">
      {lead}
      {roles.map((role) => (
        <RoleRow
          key={role}
          role={role}
          sources={sources}
          current={values?.[role] ?? null}
          disabled={values === undefined}
          chain={chains[role] ?? []}
          chains={chains}
          unsetLabel={unsetLabel(role)}
        />
      ))}
    </div>
  );
}

function RoleRow({
  role,
  sources,
  current,
  disabled,
  chain,
  chains,
  unsetLabel,
}: {
  role: string;
  sources: ModelSources;
  current: string | null;
  disabled: boolean;
  chain: readonly string[];
  chains: Record<string, string[]>;
  unsetLabel: string;
}) {
  const t = useT();
  const labelId = useId();
  const kinds = roleKinds(role);
  const candidates = candidatesOfKinds(kinds, sources);
  const ready = sourcesReady(kinds, sources);
  const fallbackCandidates = candidatesOfKinds(chainKinds(role, sources), sources);
  const nameOf = (selector: string) =>
    fallbackCandidates.find((candidate) => candidate.value === selector)?.label ?? selector;

  // 值是 `provider/model[:档位]`：下拉选的是前半（模型），档位单独一个下拉；两个一起写回。
  const { selector, level } = current === null ? { selector: null, level: null } : splitRoleValue(current);
  const keyOf = (value: string): ModelKey | null => {
    const picked = candidates.find((candidate) => candidate.value === value);
    if (picked !== undefined) return picked.key;
    const slash = value.indexOf("/");
    return slash > 0 ? { provider: value.slice(0, slash), modelId: value.slice(slash + 1) } : null;
  };
  const levelsOf = (value: string | null) => levelsOfSelector(value, sources);

  const write = (value: string, next: string | null) => {
    const key = keyOf(value);
    if (key === null) return;
    saveOmpModelRole(role, key, next).catch((error: unknown) => reportError(t, error));
  };
  const saveModel = (value: string) => {
    if (value === unset) {
      saveOmpModelRole(role, null).catch((error: unknown) => reportError(t, error));
      return;
    }
    if (candidates.find((candidate) => candidate.value === value) === undefined) return;
    // 只换模型：档位新模型也支持就保留，否则去掉（omp 会自己钳，但不留一个新模型没有的档位）。
    write(value, level !== null && (levelsOf(value) as string[]).includes(level) ? level : null);
  };
  const saveChain = (next: readonly string[]) => {
    const all = { ...chains };
    if (next.length === 0) delete all[role];
    else all[role] = [...next];
    saveOmpConfigOrThrow("retry.fallbackChains", all).catch((error: unknown) => reportError(t, error));
  };
  // 删自定义角色：modelRoles 里这一项和它的备用链一起删（角色没了，留着备用链 omp 也用不上）。
  const removeRole = async () => {
    try {
      await saveOmpModelRole(role, null);
      if (role in chains) {
        const all = { ...chains };
        delete all[role];
        await saveOmpConfigOrThrow("retry.fallbackChains", all);
      }
    } catch (error) {
      reportError(t, error);
    }
  };

  const modelOptions: SelectOption<string>[] = [
    { value: unset, label: unsetLabel },
    ...withCurrent(
      candidates.map((candidate) => ({ ...candidate, display: candidate.value })),
      selector,
    ),
  ];
  const levels = levelsOf(selector);
  const thinkingOptions: SelectOption<string>[] = [
    {
      value: unset,
      label:
        levels.length === 0 && level === null ? t("settings.roles.thinkingNone") : t("settings.roles.thinkingDefault"),
    },
    ...levels.map((entry) => ({ value: entry, label: levelText(t, entry) })),
  ];
  // 配置里的档位这个模型不支持（或模型不在目录里）：原样留着显示，别悄悄显示成别的。
  if (level !== null && !levels.includes(level as ThinkingLevel))
    thinkingOptions.push({ value: level, label: levelText(t, level) });
  const chainSelectors = chain.map((entry) => splitRoleValue(entry).selector);
  // 可加 / 可换成的备用：不含主模型和已经在链里的（换模型时自己的当前值照样列出）。
  const fallbackOptions = (own: string | null): SelectOption<string>[] =>
    withCurrent(
      fallbackCandidates
        .filter(
          (candidate) =>
            candidate.value === own || (candidate.value !== selector && !chainSelectors.includes(candidate.value)),
        )
        .map((candidate) => ({ ...candidate, display: candidate.value })),
      own,
    );
  const addOptions = fallbackOptions(null);
  // 换备用模型：档位新模型也支持就保留，否则去掉（和主模型一样）。
  const changeFallback = (index: number, entry: string, next: string) => {
    const kept = splitRoleValue(entry).level;
    const levelOk = kept !== null && (levelsOf(next) as string[]).includes(kept);
    saveChain(chain.map((value, at) => (at === index ? joinRoleValue(next, levelOk ? kept : null) : value)));
  };
  // 一格是外层网格的四列（subgrid）：角色名 | 模型 | 思考强度 | 删除。主模型一行，每个备用模型各一行（和主模型同宽对齐），
  // 最后一行"添加备用…"放在模型那一列。
  return (
    <div className="st-roles-row" data-testid={`setting-role-row-${role}`}>
      <span className="ui-row-label st-role-label">
        <span id={labelId} className="ui-info-lead">
          {roleLabel(role)}
        </span>
        <InfoTip>{t("model.roleUse", { hint: t(roleHintKey(role)) })}</InfoTip>
      </span>
      <span className="st-role-model">
        <Select
          size="sm"
          width="100%"
          value={selector ?? unset}
          options={modelOptions}
          labelledBy={labelId}
          disabled={disabled || !ready}
          onChange={saveModel}
          search={t("settings.roles.searchModel")}
          testId={role === "default" ? "setting-default-model" : `setting-role-${role}`}
        />
      </span>
      <span className="st-role-level">
        <Select
          size="sm"
          value={level ?? unset}
          options={thinkingOptions}
          label={t("settings.roles.thinking", { role: roleLabel(role) })}
          disabled={disabled || !ready || selector === null || keyOf(selector) === null || thinkingOptions.length === 1}
          onChange={(value) => selector !== null && write(selector, value === unset ? null : value)}
          testId={`setting-role-${role}-thinking`}
        />
      </span>
      {!isBuiltinRole(role) && (
        <span className="st-role-act">
          <IconButton
            label={t("settings.roles.remove", { role: roleLabel(role) })}
            disabled={disabled}
            onClick={() => void removeRole()}
            testId={`setting-role-${role}-remove`}
          >
            <Close size={12} />
          </IconButton>
        </span>
      )}
      {chain.map((entry, index) => {
        const own = splitRoleValue(entry).selector;
        const name = nameOf(own);
        return (
          <Fragment key={`${index}:${entry}`}>
            <span className="st-role-model">
              <Select
                size="sm"
                width="100%"
                value={own}
                options={fallbackOptions(own)}
                label={t("settings.roles.fallback", { index: index + 1, role: roleLabel(role) })}
                disabled={disabled || !ready}
                onChange={(next) => changeFallback(index, entry, next)}
                search={t("settings.roles.searchModel")}
                testId={`setting-chain-${role}-${index}`}
              />
            </span>
            <span className="st-role-level">
              <ChainLevel
                entry={entry}
                sources={sources}
                name={name}
                disabled={disabled || sources.chat === null}
                testId={`setting-chain-${role}-thinking-${index}`}
                onChange={(next) => saveChain(chain.map((value, at) => (at === index ? next : value)))}
              />
            </span>
            <span className="st-role-act">
              <IconButton
                label={t("settings.roles.removeFallback", { name })}
                disabled={disabled}
                onClick={() => saveChain(chain.filter((_, at) => at !== index))}
                testId={`setting-chain-${role}-remove-${index}`}
              >
                <Close size={12} />
              </IconButton>
            </span>
          </Fragment>
        );
      })}
      <span className="st-role-model st-role-add">
        <Select
          size="sm"
          width="100%"
          value={unset}
          options={addOptions}
          placeholder={t("settings.roles.addFallback")}
          labelledBy={labelId}
          disabled={disabled || !ready || addOptions.length === 0}
          onChange={(value) => saveChain([...chain, value])}
          search={t("settings.roles.searchModel")}
          testId={`setting-chain-${role}-add`}
        />
      </span>
    </div>
  );
}

/** 添加自定义角色：名字 + 对话模型，保存即写进 omp 的 modelRoles（omp 只认有模型的角色）。 */
function AddRoleDialog({
  taken,
  sources,
  onClose,
}: {
  /** 已有的角色名（内置的和配置里的）。 */
  taken: readonly string[];
  sources: ModelSources;
  onClose(): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const [model, setModel] = useState(unset);
  const [saving, setSaving] = useState(false);
  const candidates = candidatesOfKinds(["chat"], sources);
  const trimmed = name.trim();
  const nameError =
    trimmed === ""
      ? null
      : !customRoleNamePattern.test(trimmed)
        ? t("settings.roles.nameInvalid")
        : taken.some((role) => role.toLowerCase() === trimmed.toLowerCase())
          ? t("settings.roles.nameTaken")
          : null;
  const picked = candidates.find((candidate) => candidate.value === model);
  const canSave = trimmed !== "" && nameError === null && picked !== undefined && !saving;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await saveOmpModelRole(trimmed, picked.key);
      setOpen(false);
    } catch (error) {
      reportError(t, error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      title={t("settings.roles.addTitle")}
      testId="setting-role-add-dialog"
      footer={
        <>
          <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            loading={saving}
            onClick={() => void save()}
            testId="setting-role-add-save"
          >
            {t("settings.roles.addSave")}
          </Button>
        </>
      }
    >
      <form
        className="st-role-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField label={t("settings.roles.name")} error={nameError ?? undefined}>
          <TextField
            width="100%"
            mono
            data-autofocus=""
            value={name}
            disabled={saving}
            aria-label={t("settings.roles.name")}
            onChange={setName}
            testId="setting-role-add-name"
          />
        </FormField>
        <FormField label={t("settings.roles.model")}>
          <Select
            width="100%"
            value={model}
            options={candidates.map((candidate) => ({ ...candidate, display: candidate.value }))}
            placeholder={t("settings.roles.pickModel")}
            label={t("settings.roles.model")}
            disabled={saving || sources.chat === null}
            onChange={setModel}
            search={t("settings.roles.searchModel")}
            testId="setting-role-add-model"
          />
        </FormField>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ModelsSection() {
  const t = useT();
  const thinkingLabelId = useId();
  const rolesValue = useOmpConfigValue("modelRoles");
  const chainsValue = useOmpConfigValue("retry.fallbackChains");
  const thinking = useOmpConfigValue("defaultThinkingLevel");
  const { runnerError, ...sources } = useModelSources();
  const common = useCommonConfigItems("models", shownAbove);
  useEffect(ensureOmpConfigLoaded, []);
  const [adding, setAdding] = useState(false);

  // undefined = omp 设置还没读到（下拉先禁用）；读到了但不是"角色 → 字符串"就按空表显示。
  const values = rolesValue === undefined ? undefined : isStringRecord(rolesValue) ? rolesValue : {};
  const chains = isChainRecord(chainsValue) ? chainsValue : {};
  // 配置里另有的角色（自定义的）跟在对话角色后面，它们只能选对话模型。
  const custom = Object.keys(values ?? {}).filter((role) => !isBuiltinRole(role));

  const thinkingOptions: Option<string>[] = thinkingLevels.map((level) => ({
    value: level,
    label: t(`thinking.${level}`),
  }));
  // 比如 auto：omp 支持但这里没有对应文案，原样显示。
  if (typeof thinking === "string" && !thinkingOptions.some((option) => option.value === thinking))
    thinkingOptions.push({ value: thinking, label: thinking });

  const thinkingRow = (
    <div className="st-roles-row">
      <span className="ui-row-label st-role-label">
        <span id={thinkingLabelId} className="ui-info-lead">
          {t("settings.defaultThinking")}
        </span>
        <InfoTip>{t("settings.defaultThinkingHint")}</InfoTip>
      </span>
      <span className="st-role-model">
        <Select
          size="sm"
          value={typeof thinking === "string" ? thinking : ""}
          options={thinkingOptions}
          labelledBy={thinkingLabelId}
          disabled={thinking === undefined}
          onChange={(value) =>
            saveOmpDefaultThinking(value as ThinkingLevel).catch((error: unknown) => reportError(t, error))
          }
          testId="setting-default-thinking"
        />
      </span>
    </div>
  );
  const chatLead = (
    <>
      <RoleTable
        roles={[...chatRoles, ...custom]}
        sources={sources}
        values={values}
        chains={chains}
        unsetLabel={(role) => (role === "default" ? t("settings.ompPicksModel") : t("model.roleUnset"))}
        lead={thinkingRow}
      />
      <div className="st-roles-foot">
        <Button
          size="sm"
          variant="quiet"
          icon={<Plus size={14} />}
          disabled={values === undefined}
          onClick={() => setAdding(true)}
          testId="setting-role-add"
        >
          {t("settings.roles.add")}
        </Button>
      </div>
      {adding && (
        <AddRoleDialog
          taken={[...chatRoles, ...kindRoles, ...custom]}
          sources={sources}
          onClose={() => setAdding(false)}
        />
      )}
    </>
  );
  const kindLead = (
    <>
      {runnerError !== null && (
        <Notice tone="error" testId="setting-runners-error">
          {t("settings.roles.runnersFailed", { message: describeError(t, runnerError) })}
        </Notice>
      )}
      <RoleTable
        roles={kindRoles}
        sources={sources}
        values={values}
        chains={chains}
        unsetLabel={() => t("settings.ompPicksModel")}
      />
    </>
  );
  return <CommonConfig items={common} leads={{ defaults: chatLead, kinds: kindLead }} />;
}

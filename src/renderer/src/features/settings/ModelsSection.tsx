// 设置 → 模型：默认思考强度、omp 的全部角色（对话模型一组、特定能力一组），以及 omp "模型与推理"组的常用项（重试与备用模型）。
// 每个角色一行：主模型（下拉）+ 备用模型（出错时依次换用，retry.fallbackChains 里以角色为 key 的那条）。
// 值就是 omp 自己的 modelRoles / retry.fallbackChains / defaultThinkingLevel（设计原则 7），和 omp 设置是同一份；
// 改了就写全局（和模型选择对话框里给角色"应用"一样）。候选按角色能用的模型类别筛（role-options.ts）。
import { useEffect, useId, type ReactNode } from "react";
import type { ModelKey } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { splitRoleValue } from "../../../../shared/ui/role-value.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { Notice, type Option } from "../../ui/controls.tsx";
import { describeError, reportError } from "../../ui/errors.ts";
import { InfoTip } from "../../ui/InfoTip.tsx";
import { Select, type SelectOption } from "../../ui/Select.tsx";
import { chatRoles, kindRoles, roleHintKey, roleKinds, roleLabel } from "../composer/model-groups.ts";
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

/** 一组角色：角色 | 主模型 | 备用模型（标签 + "添加备用…"），每个角色一行。 */
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
  const addOptions = fallbackCandidates.filter(
    (candidate) => candidate.value !== selector && !chainSelectors.includes(candidate.value),
  );
  return (
    <div className="st-roles-row" data-testid={`setting-role-row-${role}`}>
      <span className="ui-row-label">
        <span id={labelId}>{roleLabel(role)}</span>
        <InfoTip>{t("model.roleUse", { hint: t(roleHintKey(role)) })}</InfoTip>
      </span>
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
      <Select
        size="sm"
        width={104}
        value={level ?? unset}
        options={thinkingOptions}
        label={t("settings.roles.thinking", { role: roleLabel(role) })}
        disabled={disabled || !ready || selector === null || keyOf(selector) === null || thinkingOptions.length === 1}
        onChange={(value) => selector !== null && write(selector, value === unset ? null : value)}
        testId={`setting-role-${role}-thinking`}
      />
      <span className="st-roles-wide st-chain-line">
        <Select
          size="sm"
          width={136}
          value={unset}
          options={addOptions}
          placeholder={t("settings.roles.addFallback")}
          labelledBy={labelId}
          disabled={disabled || !ready || addOptions.length === 0}
          onChange={(value) => saveChain([...chain, value])}
          search={t("settings.roles.searchModel")}
          testId={`setting-chain-${role}-add`}
        />
        <span className="st-chain" data-testid={`setting-chain-${role}`}>
          {chain.map((entry, index) => {
            const name = nameOf(splitRoleValue(entry).selector);
            return (
              <span key={`${index}:${entry}`} className="st-chain-item">
                <span className="st-tag" title={entry}>
                  <span className="st-tag-text">{name}</span>
                  <button
                    type="button"
                    className="st-tag-remove"
                    aria-label={t("settings.roles.removeFallback", { name })}
                    disabled={disabled}
                    onClick={() => saveChain(chain.filter((_, at) => at !== index))}
                  >
                    <Close size={10} />
                  </button>
                </span>
                <ChainLevel
                  entry={entry}
                  sources={sources}
                  name={name}
                  disabled={disabled || sources.chat === null}
                  testId={`setting-chain-${role}-thinking-${index}`}
                  onChange={(next) => saveChain(chain.map((value, at) => (at === index ? next : value)))}
                />
              </span>
            );
          })}
        </span>
      </span>
    </div>
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

  // undefined = omp 设置还没读到（下拉先禁用）；读到了但不是"角色 → 字符串"就按空表显示。
  const values = rolesValue === undefined ? undefined : isStringRecord(rolesValue) ? rolesValue : {};
  const chains = isChainRecord(chainsValue) ? chainsValue : {};
  // 配置里另有的角色（自定义的）跟在对话角色后面，它们只能选对话模型。
  const custom = Object.keys(values ?? {}).filter(
    (role) => !(chatRoles as readonly string[]).includes(role) && !(kindRoles as readonly string[]).includes(role),
  );

  const thinkingOptions: Option<string>[] = thinkingLevels.map((level) => ({
    value: level,
    label: t(`thinking.${level}`),
  }));
  // 比如 auto：omp 支持但这里没有对应文案，原样显示。
  if (typeof thinking === "string" && !thinkingOptions.some((option) => option.value === thinking))
    thinkingOptions.push({ value: thinking, label: thinking });

  const thinkingRow = (
    <div className="st-roles-row">
      <span className="ui-row-label">
        <span id={thinkingLabelId}>{t("settings.defaultThinking")}</span>
        <InfoTip>{t("settings.defaultThinkingHint")}</InfoTip>
      </span>
      <span className="st-roles-wide">
        <Select
          size="sm"
          width="100%"
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
    <RoleTable
      roles={[...chatRoles, ...custom]}
      sources={sources}
      values={values}
      chains={chains}
      unsetLabel={(role) => (role === "default" ? t("settings.ompPicksModel") : t("model.roleUnset"))}
      lead={thinkingRow}
    />
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

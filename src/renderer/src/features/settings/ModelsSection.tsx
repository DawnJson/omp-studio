// 设置 → 模型：默认思考强度、omp 的全部角色（对话模型一组、特定能力一组），以及 omp "模型与推理"组的常用项（重试与备用模型）。
// 每个角色一行：主模型（下拉）+ 备用模型（出错时依次换用，retry.fallbackChains 里以角色为 key 的那条）。
// 值就是 omp 自己的 modelRoles / retry.fallbackChains / defaultThinkingLevel（设计原则 7），和 omp 设置是同一份；
// 改了就写全局（和模型选择对话框里给角色"应用"一样）。候选按角色能用的模型类别筛（role-options.ts）。
import { useEffect, useId, type ReactNode } from "react";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { Notice, type Option } from "../../ui/controls.tsx";
import { describeError, reportError } from "../../ui/errors.ts";
import { InfoTip } from "../../ui/InfoTip.tsx";
import { Select } from "../../ui/Select.tsx";
import { chatRoles, kindRoles, roleHintKey, roleKinds, roleLabel } from "../composer/model-groups.ts";
import { useModelSources } from "./accounts-store.ts";
import {
  ensureOmpConfigLoaded,
  saveOmpConfigOrThrow,
  saveOmpDefaultThinking,
  saveOmpModelRole,
  useOmpConfigValue,
} from "./config-store.ts";
import { CommonConfig } from "./ConfigSection.tsx";
import { useCommonConfigItems } from "./OmpConfigPane.tsx";
import {
  candidatesOfKinds,
  chainKinds,
  isChainRecord,
  isStringRecord,
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

  const saveModel = (value: string) => {
    const picked = candidates.find((candidate) => candidate.value === value);
    if (value !== unset && picked === undefined) return;
    saveOmpModelRole(role, picked?.key ?? null).catch((error: unknown) => reportError(t, error));
  };
  const saveChain = (next: readonly string[]) => {
    const all = { ...chains };
    if (next.length === 0) delete all[role];
    else all[role] = [...next];
    saveOmpConfigOrThrow("retry.fallbackChains", all).catch((error: unknown) => reportError(t, error));
  };

  const modelOptions: Option<string>[] = [{ value: unset, label: unsetLabel }, ...withCurrent(candidates, current)];
  const addOptions = fallbackCandidates.filter(
    (candidate) => candidate.value !== current && !chain.includes(candidate.value),
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
        value={current ?? unset}
        options={modelOptions}
        labelledBy={labelId}
        disabled={disabled || !ready}
        onChange={saveModel}
        testId={role === "default" ? "setting-default-model" : `setting-role-${role}`}
      />
      <Select
        size="sm"
        width={136}
        value={unset}
        options={addOptions}
        placeholder={t("settings.roles.addFallback")}
        labelledBy={labelId}
        disabled={disabled || !ready || addOptions.length === 0}
        onChange={(value) => saveChain([...chain, value])}
        testId={`setting-chain-${role}-add`}
      />
      <span className="st-chain" data-testid={`setting-chain-${role}`}>
        {chain.map((selector, index) => (
          <span key={`${index}:${selector}`} className="st-tag" title={selector}>
            <span className="st-tag-text">{nameOf(selector)}</span>
            <button
              type="button"
              className="st-tag-remove"
              aria-label={t("settings.roles.removeFallback", { name: nameOf(selector) })}
              disabled={disabled}
              onClick={() => saveChain(chain.filter((_, at) => at !== index))}
            >
              <Close size={10} />
            </button>
          </span>
        ))}
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

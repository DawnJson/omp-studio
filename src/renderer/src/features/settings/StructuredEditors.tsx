// 常用的两个对象设置不让用户手写 JSON，在设置行"编辑…"对话框里编辑（ConfigControls 的 StructuredControl）：
//   modelRoles          角色 → 模型选择器（每个角色一行，选模型用下拉）
//   retry.fallbackChains 角色/模型 → 有序的回退模型列表（可增删、上下移）
// 选择器是 omp 的 "provider/model-id"，可以带 ":high" 之类的思考后缀、写 "@role" 别名；列表里没有的值照样保留并显示原文。
// 候选和设置 → 模型的角色表是同一份：按角色（或备用链的 key）能用的模型类别筛（role-options.ts）。
import { useState } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { OmpConfigItem } from "../../../../shared/ipc.ts";
import { ChevronDown, ChevronRight, Close, Plus } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { Button, IconButton, TextField } from "../../ui/controls.tsx";
import { Select } from "../../ui/Select.tsx";
import { roleKinds } from "../composer/model-groups.ts";
import { useModelSources } from "./accounts-store.ts";
import type { ControlProps } from "./ConfigControls.tsx";
import { candidatesOfKinds, chainKinds, isChainRecord, isStringRecord, withCurrent } from "./role-options.ts";

const suggestedRoles = ["default", "smol", "slow", "plan"];

function AddKey({
  taken,
  label,
  onAdd,
  suggestions = [],
}: {
  taken: readonly string[];
  label: string;
  onAdd(key: string): void;
  suggestions?: readonly string[];
}) {
  const t = useT();
  const [text, setText] = useState("");
  const add = (key: string) => {
    const trimmed = key.trim();
    if (trimmed === "" || taken.includes(trimmed)) return;
    onAdd(trimmed);
    setText("");
  };
  const free = suggestions.filter((name) => !taken.includes(name));
  return (
    <div className="se-add">
      <TextField
        value={text}
        width={200}
        placeholder={label}
        aria-label={label}
        onChange={setText}
        onKeyDown={(event) => event.key === "Enter" && add(text)}
      />
      <Button disabled={text.trim() === "" || taken.includes(text.trim())} onClick={() => add(text)}>
        {t("settings.cfg.add")}
      </Button>
      {free.map((name) => (
        <Button key={name} variant="quiet" size="sm" icon={<Plus size={12} />} onClick={() => add(name)}>
          {name}
        </Button>
      ))}
    </div>
  );
}

export function canEditStructured(item: { key: string; value: unknown; hasValue: boolean }): boolean {
  if (item.key === "modelRoles") return !item.hasValue || isStringRecord(item.value);
  if (item.key === "retry.fallbackChains") return !item.hasValue || isChainRecord(item.value);
  return false;
}

/** 设置行上"编辑…"旁边的等宽摘要：角色名 / 回退链个数。 */
export function structuredSummary(item: OmpConfigItem, t: TFunction): string {
  if (item.key === "modelRoles") return isStringRecord(item.value) ? Object.keys(item.value).join(" · ") : "";
  const count = isChainRecord(item.value) ? Object.keys(item.value).length : 0;
  return t("settings.cfg.chainCount", { count });
}

export function RolesEditor({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const sources = useModelSources();
  const optionsOf = (role: string) => candidatesOfKinds(roleKinds(role), sources);
  const roles = isStringRecord(item.value) ? item.value : {};
  const names = Object.keys(roles);
  return (
    <div className="se" data-testid="roles-editor">
      {names.map((role) => (
        <div key={role} className="se-row">
          <span className="se-name" title={role}>
            {role}
          </span>
          <Select
            value={roles[role] ?? ""}
            options={withCurrent(optionsOf(role), roles[role] ?? null)}
            labelledBy={labelId}
            width="100%"
            onChange={(next) => onSave({ ...roles, [role]: next })}
            placeholder={t("settings.cfg.pickModel")}
          />
          <IconButton
            label={t("settings.cfg.remove")}
            onClick={() => onSave(Object.fromEntries(Object.entries(roles).filter(([name]) => name !== role)))}
          >
            <Close size={12} />
          </IconButton>
        </div>
      ))}
      <AddKey
        taken={names}
        label={t("settings.cfg.roleName")}
        suggestions={suggestedRoles}
        onAdd={(role) =>
          onSave({
            ...roles,
            // 能用对话模型的角色先指到默认模型（和 omp 没设置时一样），只能用特定能力模型的角色指到第一个候选。
            [role]:
              (roleKinds(role).includes("chat") ? roles["default"] : undefined) ?? optionsOf(role)[0]?.value ?? "",
          })
        }
      />
    </div>
  );
}

export function ChainsEditor({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const sources = useModelSources();
  const optionsOf = (key: string) => candidatesOfKinds(chainKinds(key, sources), sources);
  const chains = isChainRecord(item.value) ? item.value : {};
  const keys = Object.keys(chains);
  const set = (key: string, chain: string[]) => onSave({ ...chains, [key]: chain });
  return (
    <div className="se" data-testid="chains-editor">
      {keys.map((key) => {
        const chain = chains[key] ?? [];
        return (
          <div key={key} className="se-chain">
            <div className="se-row">
              <span className="se-name" title={key}>
                {key}
              </span>
              <IconButton
                label={t("settings.cfg.removeChain")}
                onClick={() => onSave(Object.fromEntries(Object.entries(chains).filter(([name]) => name !== key)))}
              >
                <Close size={12} />
              </IconButton>
            </div>
            {chain.length === 0 && <div className="se-empty">{t("settings.cfg.noFallbacks")}</div>}
            {chain.map((entry, index) => (
              <div key={`${index}:${entry}`} className="se-row se-entry">
                <span className="se-index">{index + 1}</span>
                <Select
                  value={entry}
                  options={withCurrent(optionsOf(key), entry)}
                  labelledBy={labelId}
                  width="100%"
                  onChange={(next) =>
                    set(
                      key,
                      chain.map((value, at) => (at === index ? next : value)),
                    )
                  }
                />
                <IconButton
                  label={t("settings.cfg.moveUp")}
                  disabled={index === 0}
                  onClick={() =>
                    set(
                      key,
                      chain.map((value, at) =>
                        at === index - 1 ? entry : at === index ? (chain[index - 1] ?? value) : value,
                      ),
                    )
                  }
                >
                  <ChevronRight size={14} className="se-up" />
                </IconButton>
                <IconButton
                  label={t("settings.cfg.moveDown")}
                  disabled={index === chain.length - 1}
                  onClick={() =>
                    set(
                      key,
                      chain.map((value, at) =>
                        at === index + 1 ? entry : at === index ? (chain[index + 1] ?? value) : value,
                      ),
                    )
                  }
                >
                  <ChevronDown size={14} />
                </IconButton>
                <IconButton
                  label={t("settings.cfg.remove")}
                  onClick={() =>
                    set(
                      key,
                      chain.filter((_, at) => at !== index),
                    )
                  }
                >
                  <Close size={12} />
                </IconButton>
              </div>
            ))}
            <div className="se-row se-entry">
              <span className="se-index" />
              <Select
                value=""
                options={optionsOf(key)}
                labelledBy={labelId}
                width="100%"
                placeholder={t("settings.cfg.addFallback")}
                onChange={(next) => set(key, [...chain, next])}
              />
            </div>
          </div>
        );
      })}
      <AddKey
        taken={keys}
        label={t("settings.cfg.chainKey")}
        suggestions={suggestedRoles}
        onAdd={(key) => set(key, [])}
      />
    </div>
  );
}

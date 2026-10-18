// 常用的两个对象设置不让用户手写 JSON：
//   modelRoles          角色 → 模型选择器（每个角色一行，选模型用下拉）
//   retry.fallbackChains 角色/模型 → 有序的回退模型列表（可增删、上下移）
// 选择器是 omp 的 "provider/model-id"，可以带 ":high" 之类的思考后缀、写 "@role" 别名；列表里没有的值照样保留并显示原文。
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Close, Plus } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import type { ControlProps } from "./ConfigControls.tsx";
import { Button, type Option } from "./controls.tsx";
import { Dropdown } from "./Dropdown.tsx";

let selectors: Promise<Option<string>[]> | null = null;

/** 能选的模型（来自服务进程的 get_available_models），整个页面共用一次请求；失败时下次再试。 */
function loadSelectors(): Promise<Option<string>[]> {
  selectors ??= window.studio.listModels().then(
    (models) =>
      models.map((model) => ({
        value: `${model.key.provider}/${model.key.modelId}`,
        label: `${model.key.provider}/${model.key.modelId}`,
      })),
    (error: unknown) => {
      selectors = null;
      throw error;
    },
  );
  return selectors;
}

function useSelectors(): Option<string>[] {
  const [options, setOptions] = useState<Option<string>[]>([]);
  useEffect(() => {
    let live = true;
    loadSelectors().then(
      (loaded) => live && setOptions(loaded),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return options;
}

/** 当前值不在模型列表里（带后缀、别名、已退出登录的 provider）时，把它作为一个选项保留。 */
function withCurrent(options: readonly Option<string>[], current: string): Option<string>[] {
  return options.some((option) => option.value === current)
    ? [...options]
    : [{ value: current, label: current }, ...options];
}

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
      <input
        className="st-input se-add-input"
        value={text}
        spellCheck={false}
        placeholder={label}
        aria-label={label}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => event.key === "Enter" && add(text)}
      />
      <Button disabled={text.trim() === "" || taken.includes(text.trim())} onClick={() => add(text)}>
        {t("settings.cfg.add")}
      </Button>
      {free.map((name) => (
        <button key={name} type="button" className="se-chip" onClick={() => add(name)}>
          <Plus size={12} className="icon" />
          {name}
        </button>
      ))}
    </div>
  );
}

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="se-icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isChainRecord(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"))
  );
}

export function canEditStructured(item: { key: string; value: unknown; hasValue: boolean }): boolean {
  if (item.key === "modelRoles") return !item.hasValue || isStringRecord(item.value);
  if (item.key === "retry.fallbackChains") return !item.hasValue || isChainRecord(item.value);
  return false;
}

export function RolesEditor({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const options = useSelectors();
  const roles = isStringRecord(item.value) ? item.value : {};
  const names = Object.keys(roles);
  return (
    <div className="se" data-testid="roles-editor">
      {names.map((role) => (
        <div key={role} className="se-row">
          <span className="se-name" title={role}>
            {role}
          </span>
          <Dropdown
            value={roles[role] ?? ""}
            options={withCurrent(options, roles[role] ?? "")}
            labelledBy={labelId}
            onChange={(next) => onSave({ ...roles, [role]: next })}
            placeholder={t("settings.cfg.pickModel")}
          />
          <IconButton
            label={t("settings.cfg.remove")}
            onClick={() => onSave(Object.fromEntries(Object.entries(roles).filter(([name]) => name !== role)))}
          >
            <Close size={12} className="icon" />
          </IconButton>
        </div>
      ))}
      <AddKey
        taken={names}
        label={t("settings.cfg.roleName")}
        suggestions={suggestedRoles}
        onAdd={(role) => onSave({ ...roles, [role]: roles["default"] ?? options[0]?.value ?? "" })}
      />
    </div>
  );
}

export function ChainsEditor({ item, labelId, onSave }: ControlProps) {
  const t = useT();
  const options = useSelectors();
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
              <span className="se-spacer" />
              <IconButton
                label={t("settings.cfg.removeChain")}
                onClick={() => onSave(Object.fromEntries(Object.entries(chains).filter(([name]) => name !== key)))}
              >
                <Close size={12} className="icon" />
              </IconButton>
            </div>
            {chain.length === 0 && <div className="se-empty">{t("settings.cfg.noFallbacks")}</div>}
            {chain.map((entry, index) => (
              <div key={`${index}:${entry}`} className="se-row se-entry">
                <span className="se-index">{index + 1}</span>
                <Dropdown
                  value={entry}
                  options={withCurrent(options, entry)}
                  labelledBy={labelId}
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
                  <ChevronRight size={14} className="icon se-up" />
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
                  <ChevronDown size={14} className="icon" />
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
                  <Close size={12} className="icon" />
                </IconButton>
              </div>
            ))}
            <div className="se-row se-entry">
              <span className="se-index" />
              <Dropdown
                value=""
                options={options}
                labelledBy={labelId}
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

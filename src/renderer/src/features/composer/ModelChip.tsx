// 模型 + 思考强度合并成一颗胶囊（spec 4.14）。弹层：搜索 → 模型列表（按 provider 分组，最近用过的 3 个置顶）→ 思考强度分段条。
import { reportError } from "../../ui/errors.ts";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ModelKey, ModelOption } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronDown } from "../../icons.tsx";
import { onStudioCommand } from "../palette/index.ts";
import { showView } from "../../store/index.ts";
import { Popover } from "./Popover.tsx";

const recentKey = "omp-studio.recentModels";
const thinkingLabel: Partial<Record<ThinkingLevel, MessageKey>> = {
  off: "thinking.off",
  minimal: "thinking.minimal",
  low: "thinking.low",
  medium: "thinking.medium",
  high: "thinking.high",
  xhigh: "thinking.xhigh",
  max: "thinking.max",
};

const sameKey = (a: ModelKey, b: ModelKey) => a.provider === b.provider && a.modelId === b.modelId;

function readRecent(): ModelKey[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed as ModelKey[]).slice(0, 3) : [];
  } catch {
    return [];
  }
}

/** 模型胶囊的数据和动作：任务里是 setTask*，草稿（还没有任务）里改的是"新任务默认值"。 */
export interface ModelChipProps {
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
  thinkingLevels: readonly ThinkingLevel[];
  running: boolean;
  /** 没有具体模型时显示什么（缺省"未连接模型"）。 */
  emptyLabel?: string;
  loadModels(): Promise<ModelOption[]>;
  setModel(key: ModelKey): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
}

export function ModelChip(task: ModelChipProps) {
  const { running } = task;
  const t = useT();
  const report = (error: unknown) => reportError(t, error);
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const levels = task.thinkingLevels.filter((level) => thinkingLabel[level] !== undefined);
  const supportsThinking = task.model?.reasoning === true && levels.length > 0;
  const levelText = task.thinkingLevel && thinkingLabel[task.thinkingLevel] ? t(thinkingLabel[task.thinkingLevel] as MessageKey) : null;
  const name = task.model?.name ?? task.emptyLabel ?? t("composer.noModel");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    task.loadModels().then(setModels, report);
    searchRef.current?.focus();
  }, [open]);

  // 命令面板 / Alt M / Alt T。
  useEffect(() => onStudioCommand((command) => {
    if (command === "model") setOpen(true);
    if (command === "thinking") cycleThinking();
  }));
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        cycleThinking();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function cycleThinking(): void {
    if (!supportsThinking || !task.thinkingLevel) return;
    const next = levels[(levels.indexOf(task.thinkingLevel) + 1) % levels.length];
    if (next) task.setThinking(next).catch(report);
  }

  const rows = useMemo(() => {
    const filtered = (models ?? []).filter((model) => `${model.name} ${model.key.provider} ${model.key.modelId}`.toLowerCase().includes(query.trim().toLowerCase()));
    const recent = query === "" ? readRecent().flatMap((key) => filtered.filter((model) => sameKey(model.key, key))) : [];
    const rest = filtered.filter((model) => !recent.includes(model)).sort((a, b) => a.key.provider.localeCompare(b.key.provider) || a.name.localeCompare(b.name));
    return { recent, rest, flat: [...recent, ...rest] };
  }, [models, query]);

  const pick = (model: ModelOption) => {
    const recent = [model.key, ...readRecent().filter((key) => !sameKey(key, model.key))].slice(0, 3);
    localStorage.setItem(recentKey, JSON.stringify(recent));
    task.setModel(model.key).catch(report);
    setOpen(false);
  };

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.min(Math.max(index + (event.key === "ArrowDown" ? 1 : -1), 0), Math.max(rows.flat.length - 1, 0)));
    } else if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
      const model = rows.flat[active];
      if (model) pick(model);
    }
  };

  const onSegmentKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = task.thinkingLevel ? levels.indexOf(task.thinkingLevel) : 0;
    const next = levels[(index + (event.key === "ArrowRight" ? 1 : -1) + levels.length) % levels.length];
    if (next) task.setThinking(next).catch(report);
  };

  const renderRow = (model: ModelOption, index: number, group: string) => (
    <button
      key={`${group}:${model.key.provider}/${model.key.modelId}`}
      type="button"
      role="option"
      aria-selected={task.model ? sameKey(task.model.key, model.key) : false}
      className="pop-item"
      data-active={index === active || undefined}
      onMouseEnter={() => setActive(index)}
      onClick={() => pick(model)}
    >
      <span className="pop-item-text">{model.name}</span>
      <span className="pop-item-meta">{model.key.provider}</span>
      {task.model && sameKey(task.model.key, model.key) && <Check size={14} />}
    </button>
  );

  return (
    <div className="pop-anchor">
      <button type="button" className="chip" data-testid="model-chip" aria-haspopup="dialog" aria-expanded={open} aria-label={t("composer.modelChip")} onClick={() => setOpen((value) => !value)}>
        <span className="chip-text">{name}{(supportsThinking || !task.model) && levelText ? ` · ${levelText}` : ""}</span>
        <ChevronDown size={12} />
      </button>
      <Popover open={open} onClose={close} width={360} label={t("composer.modelChip")}>
        <input ref={searchRef} className="pop-search" value={query} placeholder={t("model.search")} aria-label={t("model.search")} onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }} onKeyDown={onSearchKey} />
        <div className="pop-list" role="listbox">
          {models !== null && rows.flat.length === 0 && <p className="pop-note">{t("model.empty")}</p>}
          {rows.recent.length > 0 && <p className="pop-group">{t("model.recent")}</p>}
          {rows.recent.map((model, index) => renderRow(model, index, "recent"))}
          {rows.rest.map((model, index) => renderRow(model, rows.recent.length + index, "all"))}
        </div>
        <div className="pop-divider" />
        <div className="pop-section">
          <p className="pop-grouprow">
            <span>{t("model.thinking")}</span>
            {!supportsThinking ? <span className="pop-grouphint">{t("model.thinking.unsupported")}</span> : running ? <span className="pop-grouphint">{t("composer.nextRequest")}</span> : null}
          </p>
          {supportsThinking && (
            <div className="segments" role="radiogroup" aria-label={t("model.thinking")} onKeyDown={onSegmentKey}>
              {levels.map((level) => (
                <button key={level} type="button" role="radio" aria-checked={task.thinkingLevel === level} tabIndex={task.thinkingLevel === level ? 0 : -1} className="segment" data-checked={task.thinkingLevel === level || undefined} onClick={() => task.setThinking(level).catch(report)}>
                  {t(thinkingLabel[level] as MessageKey)}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pop-divider" />
        <button type="button" className="pop-item" onClick={() => {
          setOpen(false);
          showView("settings");
        }}>
          <span className="pop-item-text">{t("model.addProvider")}</span>
        </button>
      </Popover>
    </div>
  );
}

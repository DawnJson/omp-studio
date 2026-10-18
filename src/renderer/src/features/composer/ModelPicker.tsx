// 模型选择对话框（模态）：左栏搜索 + 按 provider 分组的模型列表，右栏是高亮模型的参数，思考强度在右栏底部。
// 键盘：搜索框里 ↑↓ 移动高亮、Enter 选用；Tab 在对话框内循环；Esc 关闭，焦点回到打开前的元素。
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ModelKey, ModelOption } from "../../../../shared/ipc.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, Close } from "../../icons.tsx";
import { reportError } from "../../ui/errors.ts";
import { showView } from "../../store/index.ts";
import { groupModels, sameModel } from "./model-groups.ts";
import { formatCount } from "./usage-format.ts";

const recentKey = "omp-studio.recentModels";
export const thinkingLabel: Partial<Record<ThinkingLevel, MessageKey>> = {
  off: "thinking.off",
  minimal: "thinking.minimal",
  low: "thinking.low",
  medium: "thinking.medium",
  high: "thinking.high",
  xhigh: "thinking.xhigh",
  max: "thinking.max",
};

function readRecent(): ModelKey[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed as ModelKey[]).slice(0, 3) : [];
  } catch {
    return [];
  }
}

export interface ModelPickerProps {
  /** 正在生效的模型；列表里它带勾，右栏的思考强度也是针对它。 */
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
  thinkingLevels: readonly ThinkingLevel[];
  running: boolean;
  loadModels(): Promise<ModelOption[]>;
  setModel(key: ModelKey): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  onClose(): void;
}

const focusableSelector = "button:not(:disabled), input:not(:disabled)";

export function ModelPicker(props: ModelPickerProps) {
  const { model, thinkingLevel, running, onClose } = props;
  const t = useT();
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [query, setQuery] = useState("");
  // 高亮的模型；null = 跟着正在生效的模型走。
  const [highlight, setHighlight] = useState<ModelKey | null>(null);
  const report = useCallback((error: unknown) => reportError(t, error), [t]);

  const levels = props.thinkingLevels.filter((level) => thinkingLabel[level] !== undefined);

  // 只在打开的那一刻拉一次列表；props 每次渲染都是新对象，不能放进依赖。
  useEffect(() => {
    let current = true;
    props.loadModels().then(
      (list) => current && setModels(list),
      (error: unknown) => {
        if (current) setModels([]);
        report(error);
      },
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 焦点：打开时进搜索框，关闭后回到打开前的元素。
  useEffect(() => {
    const opener = document.activeElement;
    searchRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const rows = useMemo(() => groupModels(models ?? [], query, readRecent()), [models, query]);
  const focusKey = highlight ?? model?.key ?? null;
  const shown = (focusKey && rows.flat.find((candidate) => sameModel(candidate.key, focusKey))) || rows.flat[0] || null;
  const shownIsCurrent = shown !== null && model !== null && sameModel(shown.key, model.key);

  useEffect(() => {
    dialogRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [shown?.key.provider, shown?.key.modelId]);

  const pick = (option: ModelOption) => {
    const recent = [option.key, ...readRecent().filter((key) => !sameModel(key, option.key))].slice(0, 3);
    localStorage.setItem(recentKey, JSON.stringify(recent));
    setHighlight(option.key);
    props.setModel(option.key).catch(report);
  };

  const move = (delta: number) => {
    if (rows.flat.length === 0) return;
    const index = shown ? rows.flat.indexOf(shown) : -1;
    const next = rows.flat[Math.min(Math.max(index + delta, 0), rows.flat.length - 1)];
    if (next) setHighlight(next.key);
  };

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
      if (shown) pick(shown);
    }
  };

  const onDialogKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // 消耗掉 Esc：输入框的"Esc 停止任务"在 window 上监听，不能被它连带触发。
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    // tabIndex -1 的（列表里的模型行、没选中的思考强度）不在 Tab 顺序里，不算首尾。
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])].filter(
      (element) => element.tabIndex >= 0,
    );
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onSegmentKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = thinkingLevel ? levels.indexOf(thinkingLevel) : 0;
    const next = levels[(index + (event.key === "ArrowRight" ? 1 : -1) + levels.length) % levels.length];
    if (next) props.setThinking(next).catch(report);
  };

  const yesNo = (value: boolean) => t(value ? "model.supported" : "model.unsupported");
  const costRows = shown
    ? (["input", "output", "cacheRead", "cacheWrite"] as const).map((field) => [field, shown.cost[field]] as const)
    : [];
  const free = shown !== null && costRows.every(([, value]) => value === 0);
  const supportsThinking = model?.reasoning === true && levels.length > 0;

  const renderRow = (option: ModelOption, group: string) => {
    const isHighlighted = shown !== null && sameModel(shown.key, option.key);
    const isCurrent = model !== null && sameModel(model.key, option.key);
    return (
      <button
        key={`${group}:${option.key.provider}/${option.key.modelId}`}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={isHighlighted}
        className="pop-item"
        data-testid="model-option"
        data-highlighted={isHighlighted}
        data-current={isCurrent || undefined}
        onClick={() => pick(option)}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="pop-item-text">{option.name}</span>
        {isCurrent && <Check size={14} />}
      </button>
    );
  };

  return createPortal(
    <div className="scrim" onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="model-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="model-picker"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKey}
      >
        <header className="mp-head">
          <h2 id={titleId} className="mp-title">
            {t("model.title")}
          </h2>
          <button type="button" className="tool-btn" aria-label={t("model.close")} onClick={onClose}>
            <Close size={14} />
          </button>
        </header>
        <div className="mp-body">
          <div className="mp-left">
            <input
              ref={searchRef}
              className="pop-search"
              data-testid="model-search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              value={query}
              placeholder={t("model.search")}
              aria-label={t("model.search")}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlight(null);
              }}
              onKeyDown={onSearchKey}
            />
            <div id={listId} className="mp-list" role="listbox" tabIndex={-1} aria-label={t("model.list")}>
              {models !== null && rows.flat.length === 0 && <p className="pop-note">{t("model.empty")}</p>}
              {rows.recent.length > 0 && <p className="pop-group">{t("model.recent")}</p>}
              {rows.recent.map((option) => renderRow(option, "recent"))}
              {rows.groups.map((group) => (
                <div key={group.provider} role="group" aria-label={group.provider}>
                  <p className="pop-group">{group.provider}</p>
                  {group.models.map((option) => renderRow(option, group.provider))}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="pop-item mp-add"
              onClick={() => {
                onClose();
                showView("settings");
              }}
            >
              <span className="pop-item-text">{t("model.addProvider")}</span>
            </button>
          </div>
          <section className="mp-right" aria-label={t("model.details")} data-testid="model-details">
            {shown === null ? (
              <p className="pop-note">{t("model.noSelection")}</p>
            ) : (
              <>
                <h3 className="mp-name">{shown.name}</h3>
                <p className="mp-id">
                  {shown.key.provider}/{shown.key.modelId}
                </p>
                <dl className="mp-params">
                  <dt>{t("model.contextWindow")}</dt>
                  <dd>{shown.contextWindow === null ? t("model.unknown") : formatCount(shown.contextWindow)}</dd>
                  <dt>{t("model.maxOutput")}</dt>
                  <dd>{shown.maxTokens === null ? t("model.unknown") : formatCount(shown.maxTokens)}</dd>
                  <dt>{t("model.imageInput")}</dt>
                  <dd>{yesNo(shown.acceptsImages)}</dd>
                  <dt>{t("model.reasoning")}</dt>
                  <dd>{yesNo(shown.reasoning)}</dd>
                  <dt>{t("model.cost")}</dt>
                  <dd>
                    {free ? (
                      t("model.free")
                    ) : (
                      <span className="mp-cost">
                        {costRows
                          .filter(([, value]) => value > 0)
                          .map(([field, value]) => (
                            <span key={field}>
                              {t(`model.cost.${field}`)} ${Number(value.toFixed(3))}
                            </span>
                          ))}
                      </span>
                    )}
                  </dd>
                </dl>
              </>
            )}
            <div className="mp-thinking">
              <p className="pop-grouprow">
                <span>{t("model.thinking")}</span>
                {!shownIsCurrent ? (
                  <span className="pop-grouphint">{t("model.thinking.pending")}</span>
                ) : !supportsThinking ? (
                  <span className="pop-grouphint">{t("model.thinking.unsupported")}</span>
                ) : running ? (
                  <span className="pop-grouphint">{t("composer.nextRequest")}</span>
                ) : null}
              </p>
              {shownIsCurrent && supportsThinking && (
                <div className="segments" role="radiogroup" aria-label={t("model.thinking")} onKeyDown={onSegmentKey}>
                  {levels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={thinkingLevel === level}
                      tabIndex={thinkingLevel === level ? 0 : -1}
                      className="segment"
                      data-checked={thinkingLevel === level || undefined}
                      onClick={() => props.setThinking(level).catch(report)}
                    >
                      {t(thinkingLabel[level] as MessageKey)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

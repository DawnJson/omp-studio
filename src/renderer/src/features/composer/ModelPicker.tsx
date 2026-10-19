// 模型选择对话框（模态）：左栏搜索 + 按 provider 分组的模型树（组默认折叠，搜索时有匹配的组自动展开），
// 右栏是高亮模型的参数（ModelDetails），思考强度在右栏底部。
// 键盘：搜索框里 ↑↓ 在"最近 + 组头 + 展开的模型"之间移动，Enter 选用模型 / 展开或折叠组，组头上 →/← 展开 / 折叠；
// Tab 在对话框内循环；Esc 关闭，焦点回到打开前的元素。
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { usePresence, type ExitProps } from "../../ui/presence.ts";
import type { ModelInsights, ModelKey, ModelOption, ProjectId } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, ChevronRight, Close } from "../../icons.tsx";
import { reportError } from "../../ui/errors.ts";
import { showView } from "../../store/index.ts";
import { ModelDetails } from "./ModelDetails.tsx";
import { groupModels, modelItemId, modelRowMeta, sameModel, treeItems, type TreeItem } from "./model-groups.ts";
import { SpeedToggle, type SpeedControls } from "./SpeedToggle.tsx";
import { ThinkingSegments } from "./ThinkingSegments.tsx";

const recentKey = "omp-studio.recentModels";

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
  /** 读压缩设置用哪个项目的配置；草稿里没有项目时为 null（只看全局）。 */
  projectId: ProjectId | null;
  loadModels(): Promise<ModelOption[]>;
  setModel(key: ModelKey): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  /** 速度开关（fast / slow，只对正在生效的模型）；没有任务的草稿里不传。 */
  speed?: SpeedControls;
  onClose(): void;
}

const focusableSelector = "button:not(:disabled), input:not(:disabled)";

/** 对话框本体：open 变 false 后留着放完退出动画，由外层 ModelPicker 卸载。 */
function ModelPickerBody(props: ModelPickerProps & { open: boolean; closing: boolean; exitProps: ExitProps }) {
  const { model, thinkingLevel, running, onClose, open, closing, exitProps } = props;
  const t = useT();
  useTitleBarDim(open);
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [insights, setInsights] = useState<ModelInsights | null>(null);
  const [query, setQuery] = useState("");
  // 方向键所在的项（模型或组头）；null = 跟着正在生效的模型走。
  const [cursor, setCursor] = useState<string | null>(null);
  // 右栏显示的模型；光标停在组头上时保持上一次的模型。null = 正在生效的模型。
  const [detail, setDetail] = useState<ModelKey | null>(null);
  // 展开的组。搜索时另记一份"手动折叠的组"，换搜索词就清空。
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback((error: unknown) => reportError(t, error), [t]);

  // 只在打开的那一刻拉一次列表（和速度、智能分、压缩设置）；props 每次渲染都是新对象，不能放进依赖。
  useEffect(() => {
    let current = true;
    props.loadModels().then(
      (list) => {
        if (!current) return;
        setModels(list);
        window.studio
          .getModelInsights(
            props.projectId,
            list.map((option) => option.key),
          )
          .then(
            (value) => current && setInsights(value),
            (error: unknown) => {
              if (current) setInsights({ perf: {}, intelligence: {}, compaction: null });
              report(error);
            },
          );
      },
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

  // 焦点：打开时进搜索框；open 变 false（退出动画开始）就还给打开前的元素，不等卸载。
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    openerRef.current = document.activeElement;
    searchRef.current?.focus();
  }, []);
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }, [open]);

  const searching = query.trim() !== "";
  const rows = useMemo(() => groupModels(models ?? [], query, readRecent()), [models, query]);
  const items = useMemo(
    () =>
      treeItems(
        rows,
        (provider) => (searching ? !searchCollapsed.has(provider) : expanded.has(provider)),
        model?.key ?? null,
      ),
    [rows, searching, searchCollapsed, expanded, model],
  );
  const recentCount = rows.recent.length;
  // 同一 provider 下名字相同的模型（omp 会同时列出别名 id 和带日期的 id）：行里改显示 id，免得两行看起来一模一样。
  const ambiguous = useMemo(() => {
    const seen = new Map<string, number>();
    for (const option of models ?? []) {
      const key = `${option.key.provider}\0${option.name}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
  }, [models]);
  const detailKey = detail ?? model?.key ?? null;
  const shown =
    (detailKey && rows.flat.find((candidate) => sameModel(candidate.key, detailKey))) || rows.flat[0] || null;
  const shownIsCurrent = shown !== null && model !== null && sameModel(shown.key, model.key);
  const cursorId = cursor ?? (shown ? modelItemId(shown.key) : null);
  const cursorItem = items.find((item) => item.id === cursorId) ?? null;

  useEffect(() => {
    dialogRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursorId]);

  const pick = (option: ModelOption) => {
    const recent = [option.key, ...readRecent().filter((key) => !sameModel(key, option.key))].slice(0, 3);
    localStorage.setItem(recentKey, JSON.stringify(recent));
    setCursor(modelItemId(option.key));
    setDetail(option.key);
    props.setModel(option.key).catch(report);
  };

  const setGroupOpen = (provider: string, open: boolean) => {
    const update = (set: ReadonlySet<string>, add: boolean) => {
      const next = new Set(set);
      if (add) next.add(provider);
      else next.delete(provider);
      return next;
    };
    // 展开：模型行自己放进入动画；折叠：留一份幽灵行淡出（动画没跑起来时兜底计时器清掉）。
    setLeaving((set) => update(set, !open));
    if (!open) setTimeout(() => setLeaving((set) => (set.has(provider) ? update(set, false) : set)), 400);
    if (searching) setSearchCollapsed((set) => update(set, !open));
    else setExpanded((set) => update(set, open));
  };

  const focusItem = (item: TreeItem) => {
    setCursor(item.id);
    if (item.kind === "model") setDetail(item.option.key);
  };

  const move = (delta: number) => {
    if (items.length === 0) return;
    const index = cursorItem ? items.indexOf(cursorItem) : -1;
    const next = items[Math.min(Math.max(index + delta, 0), items.length - 1)];
    if (next) focusItem(next);
  };

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && cursorItem?.kind === "group") {
      event.preventDefault();
      setGroupOpen(cursorItem.provider, event.key === "ArrowRight");
    } else if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
      if (cursorItem?.kind === "group") setGroupOpen(cursorItem.provider, !cursorItem.expanded);
      else if (shown) pick(shown);
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
    // tabIndex -1 的（列表里的行、没选中的思考强度）不在 Tab 顺序里，不算首尾。
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])].filter(
      (element) => element.tabIndex >= 0,
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const supportsThinking = model?.reasoning === true && props.thinkingLevels.length > 0;

  const renderItem = (item: TreeItem) => {
    const isHighlighted = item.id === cursorId;
    if (item.kind === "group") {
      return (
        <button
          key={item.id}
          type="button"
          role="treeitem"
          tabIndex={-1}
          aria-level={1}
          aria-expanded={item.expanded}
          aria-selected={isHighlighted}
          className="pop-item mp-group"
          data-testid="model-group"
          data-highlighted={isHighlighted}
          onClick={() => {
            setCursor(item.id);
            setGroupOpen(item.provider, !item.expanded);
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <ChevronRight size={12} className="mp-group-chevron" />
          <span className="pop-item-text">{item.provider}</span>
          {item.hasCurrent && <Check size={14} />}
          <span className="pop-item-meta">{t("model.groupCount", { count: item.count })}</span>
        </button>
      );
    }
    const option = item.option;
    const isCurrent = model !== null && sameModel(model.key, option.key);
    const meta = modelRowMeta(option);
    return (
      <button
        key={item.id}
        type="button"
        role="treeitem"
        tabIndex={-1}
        aria-level={rows.recent.includes(option) ? 1 : 2}
        aria-selected={isHighlighted}
        className="pop-item mp-model"
        data-testid="model-option"
        data-highlighted={isHighlighted}
        data-current={isCurrent || undefined}
        onClick={() => pick(option)}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="pop-item-text" title={`${option.key.provider}/${option.key.modelId}`}>
          {ambiguous.has(`${option.key.provider}\0${option.name}`) ? option.key.modelId : option.name}
        </span>
        {meta !== "" && (
          <span className="pop-item-meta" title={`${t("model.contextWindow")} / ${t("model.cost")}`}>
            {meta}
          </span>
        )}
        {isCurrent && <Check size={14} />}
      </button>
    );
  };

  // 刚折叠的组：它的模型行留着淡出一下（只读幽灵行，不进键盘树）。
  const ghostRows = (provider: string) =>
    (rows.groups.find((group) => group.provider === provider)?.models ?? []).map((option, index) => (
      <div
        key={`ghost:${modelItemId(option.key)}`}
        className="pop-item mp-ghost"
        aria-hidden="true"
        data-closing="fade"
        onAnimationEnd={index === 0 ? () => setLeaving(new Set()) : undefined}
      >
        <span className="pop-item-text">
          {ambiguous.has(`${option.key.provider}\0${option.name}`) ? option.key.modelId : option.name}
        </span>
      </div>
    ));
  return createPortal(
    <div className="scrim" data-closing={closing ? "fade" : undefined} onPointerDown={onClose}>
      <div
        ref={dialogRef}
        className="model-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="model-picker"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onDialogKey}
        {...exitProps}
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
              aria-haspopup="tree"
              aria-expanded="true"
              aria-controls={listId}
              value={query}
              placeholder={t("model.search")}
              aria-label={t("model.search")}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(null);
                setDetail(null);
                setSearchCollapsed(new Set());
                setLeaving(new Set());
              }}
              onKeyDown={onSearchKey}
            />
            <div id={listId} className="mp-list" role="tree" tabIndex={-1} aria-label={t("model.list")}>
              {models !== null && rows.flat.length === 0 && <p className="pop-note">{t("model.empty")}</p>}
              {recentCount > 0 && <p className="pop-group">{t("model.recent")}</p>}
              {items.slice(0, recentCount).map(renderItem)}
              {recentCount > 0 && rows.groups.length > 0 && <p className="pop-group">{t("model.providers")}</p>}
              {items
                .slice(recentCount)
                .flatMap((item) => [
                  renderItem(item),
                  ...(item.kind === "group" && !item.expanded && leaving.has(item.provider)
                    ? ghostRows(item.provider)
                    : []),
                ])}
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
              <ModelDetails option={shown} isCurrent={shownIsCurrent} insights={insights} />
            )}
            {props.speed && shownIsCurrent && <SpeedToggle speed={props.speed} />}
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
                <ThinkingSegments
                  levels={props.thinkingLevels}
                  level={thinkingLevel}
                  onPick={(level) => void props.setThinking(level).catch(report)}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** open 变 false 后先放退出动画再卸载；每次打开都是全新的对话框状态。 */
export function ModelPicker(props: ModelPickerProps & { open: boolean }) {
  const presence = usePresence(props.open);
  if (!presence.mounted) return null;
  return <ModelPickerBody {...props} closing={presence.closing} exitProps={presence.exitProps} />;
}

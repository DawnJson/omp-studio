// 模型选择对话框（ui/Dialog，照 Tern 里 omp 的 /models）：顶上是搜索框（没有标题和 ×，Esc、点遮罩、"关闭"关）；左栏是范围：角色 / 全部模型 / 各提供商；
// 右边一张表（模型 | Int | t/s | Ctx | $/M，列名照 omp 原文）+ 参数行 + 三行控件（思考强度 / Prewalk / 预设）；页脚"关闭"+ 主按钮。
// 全部模型：没有搜索词时"常用"在前，其余按提供商分组；有搜索词时是"匹配"。角色范围（或搜索框以 @ 开头）列角色。
// 两种用法（仓库所有者 2026-10-22 定）：点行（或 ↑↓）只是选中，参数行和思考强度跟着选中的模型走，点"用于此任务"（Enter、双击行同）
// 才切模型、设思考强度并关闭，只管这一个任务（草稿里是即将建的任务）；点一个角色则转到给它选模型：表里定位到它现在的模型，
// 换一个点"应用"写进全局 omp 配置（modelRoles），不动正在运行的会话。
// Tab 循环、Esc 关闭、焦点回到打开前的元素由 Dialog 负责。
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePresence } from "../../ui/presence.ts";
import type { ModelInsights, ModelKey, ModelOption, ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { clampThinkingLevel, thinkingLevelOptions } from "../../../../shared/ui/new-task-default.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Plus, Search, Check, ChevronRight } from "../../icons.tsx";
import { Badge, Button, IconButton, TextField } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { Reveal } from "../../ui/Reveal.tsx";
import { reportError } from "../../ui/errors.ts";
import { showView } from "../../store/index.ts";
import { ModelDetails } from "./ModelDetails.tsx";
import { RoleIcon } from "./RoleIcon.tsx";
import { keepRoleLevel } from "../../../../shared/ui/role-value.ts";
import { saveOmpModelRole } from "../settings/config-store.ts";
import {
  filterRoles,
  groupModels,
  modelContextCell,
  modelItemId,
  modelPriceCell,
  pinnedKeys,
  providerCounts,
  roleHintKey,
  roleItemId,
  roleLabel,
  roleView,
  sameModel,
} from "./model-groups.ts";
import { SpeedToggle, type SpeedControls } from "./SpeedToggle.tsx";
import { PresetSection } from "../session-toggles/PresetSection.tsx";
import { PrewalkSection } from "../session-toggles/PrewalkSection.tsx";
import { ThinkingSegments } from "./ThinkingSegments.tsx";
import type { ModelPickerRequest } from "./slash-args.ts";

const recentKey = "omp-studio.recentModels";
/** 数据缺失（没有价格、没测过速度……）的单元格。 */
const missing = "–";
const loading = "…";

function readRecent(): ModelKey[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed as ModelKey[]).slice(0, 3) : [];
  } catch {
    return [];
  }
}

export interface ModelPickerProps {
  /** 正在生效的模型；表里它带勾，打开时选中的是它。 */
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
  /** 正在生效的模型的档位（任务里是 omp 报的，含 off）。 */
  thinkingLevels: readonly ThinkingLevel[];
  running: boolean;
  /** 读压缩设置用哪个项目的配置；草稿里没有项目时为 null（只看全局）。 */
  projectId: ProjectId | null;
  loadModels(): Promise<ModelOption[]>;
  setModel(key: ModelKey): Promise<void>;
  setThinking(level: ThinkingLevel): Promise<void>;
  /** 速度开关（fast / slow，只对正在生效的模型）；没有任务的草稿里不传。 */
  speed?: SpeedControls;
  /** 给了任务 id（任务里；草稿没有）才显示 Prewalk 和"预设"两节：都是对这个任务发的命令（`/prewalk`、`/modelpreset`）。 */
  taskId?: TaskId;
  onClose(): void;
  /** `/model sonnet`、`/model @task` 带来的搜索词和范围（只在打开那一刻用）。 */
  request?: ModelPickerRequest | null;
}

/** 表里的一行：模型，或角色范围 / @ 搜索时的角色（带它绑定的模型）。 */
type Item =
  | { kind: "model"; id: string; option: ModelOption }
  | { kind: "role"; id: string; role: string; option: ModelOption | null };

/** 左栏的范围：角色表、全部模型、某个提供商的模型。 */
type Scope = { kind: "roles" } | { kind: "all" } | { kind: "provider"; provider: string };

const sameScope = (a: Scope, b: Scope) =>
  a.kind === b.kind && (a.kind !== "provider" || (b.kind === "provider" && a.provider === b.provider));

/** 对话框本体：每次打开都是全新的状态；退出动画由 Dialog 放，外层 ModelPicker 等它放完再卸载。 */
function ModelPickerBody(props: ModelPickerProps & { open: boolean }) {
  const { model, thinkingLevel, running, onClose, open } = props;
  const t = useT();
  const listId = useId();
  const tableRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLElement>(null);

  // 对话框打开以后只长不缩：见过的最大高度写进 min-height（取布局高度，不受弹出动画的缩放影响；同 CSS 的上限取小），
  // 换到模型少的提供商、打字过滤时不跟着变矮；窗口变矮时上限跟着变小，min-height 不会把对话框撑出窗口。
  useEffect(() => {
    const dialog = sideRef.current?.closest<HTMLElement>(".mp-dialog");
    if (!dialog) return;
    let tallest = 0;
    const observer = new ResizeObserver(() => {
      const height = dialog.offsetHeight;
      if (height <= tallest) return;
      tallest = height;
      dialog.style.minHeight = `min(${height}px, 84vh, var(--content-w))`;
    });
    observer.observe(dialog);
    return () => observer.disconnect();
  }, []);

  const searchRef = useRef<HTMLInputElement>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [insights, setInsights] = useState<ModelInsights | null>(null);
  const [query, setQuery] = useState(props.request?.query ?? "");
  const [scope, setScope] = useState<Scope>(props.request?.scope === "roles" ? { kind: "roles" } : { kind: "all" });
  // 选中的行（点击、↑↓）：参数行和思考强度跟着它走，"用于此任务"才真的切换；null = 正在生效的模型。
  const [selection, setSelection] = useState<string | null>(null);
  // 双击的第一下点在哪一行：点角色会换掉整张表，第二下落在原位的模型行上时不能当成双击它（否则直接把那个模型写给角色）。
  const firstClick = useRef<string | null>(null);
  // 分段条上点过的档位；null = 没动过（切模型时交给 omp 钳到新模型的档位）。
  const [pickedLevel, setPickedLevel] = useState<ThinkingLevel | null>(null);
  // 给谁选模型：null = 用于此任务；某个角色 = 给它指定模型，写进全局 omp 配置。
  const [roles, setRoles] = useState<Record<string, string> | null>(null);
  const [roleTab, setRoleTab] = useState<string | null>(null);
  // "常用"在打开时定下来：选了模型之后当前模型会变，但行不跟着往上跳。
  const [pinned, setPinned] = useState<ModelKey[] | null>(null);
  const report = useCallback((error: unknown) => reportError(t, error), [t]);
  const reloadRoles = () => window.studio.getModelRoles(props.projectId).then(setRoles, () => setRoles({}));

  // 只在打开的那一刻拉一次列表（和实测速度、压缩设置、角色表）；props 每次渲染都是新对象，不能放进依赖。
  useEffect(() => {
    void reloadRoles();
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
              if (current) setInsights({ perf: {}, compaction: null });
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

  const searching = query.trim() !== "";
  const view = useMemo(() => roleView(roles ?? {}, models ?? []), [roles, models]);
  const providers = useMemo(() => providerCounts(models ?? []), [models]);
  const roleMode = roleTab !== null;
  // 表里打勾的模型：给角色选时是这个角色现在的模型。
  const activeModel = roleTab !== null ? (view.modelOf[roleTab] ?? null) : model;
  const scopeProvider = scope.kind === "provider" ? scope.provider : null;

  useEffect(() => {
    if (pinned === null && models !== null && roles !== null) {
      setPinned(
        pinnedKeys(
          model?.key ?? null,
          view.tabs.map((role) => view.modelOf[role]),
          readRecent(),
        ),
      );
    }
  }, [pinned, models, roles, model, view]);

  // 角色范围里搜索框过滤的是角色（和输入 @ 一样）。
  const roleQuery = scope.kind === "roles" && !query.trimStart().startsWith("@") ? `@${query}` : query;
  const roleMatches = useMemo(() => filterRoles(view.tabs, roleQuery), [view.tabs, roleQuery]);
  const rows = useMemo(
    () => groupModels(models ?? [], query, pinned ?? [], scopeProvider),
    [models, query, pinned, scopeProvider],
  );
  // 全部模型（含给角色选）、没有搜索词时按提供商折叠：打开时只展开正在生效的模型（给角色选时是它现在的模型）所在的那个，
  // 换角色时再展开新模型所在的；收起的提供商里的行不画，方向键也跳过。
  const collapsible = scope.kind === "all" && !searching && roleMatches === null;
  const [openProviders, setOpenProviders] = useState<ReadonlySet<string>>(new Set());
  const activeProvider = activeModel?.key.provider ?? null;
  useEffect(() => {
    if (activeProvider !== null) {
      setOpenProviders((open) => (open.has(activeProvider) ? open : new Set([...open, activeProvider])));
    }
  }, [activeProvider]);
  const toggleProvider = (provider: string) => {
    const next = new Set(openProviders);
    if (!next.delete(provider)) next.add(provider);
    setOpenProviders(next);
  };
  const shownRows = useMemo(
    () =>
      collapsible
        ? [...rows.pinned, ...rows.rest.filter((option) => openProviders.has(option.key.provider))]
        : rows.flat,
    [collapsible, rows, openProviders],
  );
  const items = useMemo<Item[]>(
    () =>
      roleMatches !== null
        ? roleMatches.map((role) => ({
            kind: "role",
            id: roleItemId(role),
            role,
            option: view.modelOf[role] ?? null,
          }))
        : shownRows.map((option) => ({ kind: "model", id: modelItemId(option.key), option })),
    [roleMatches, shownRows, view],
  );
  const currentId =
    roleMatches !== null
      ? roleTab === null
        ? null
        : roleItemId(roleTab)
      : activeModel
        ? modelItemId(activeModel.key)
        : null;
  const selectedItem = items.find((item) => item.id === (selection ?? currentId)) ?? items[0] ?? null;
  const selectedId = selectedItem?.id ?? null;
  const shown = selectedItem === null ? null : selectedItem.option;
  const shownIsCurrent = shown !== null && activeModel !== null && sameModel(shown.key, activeModel.key);

  useEffect(() => {
    tableRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // 模型能用的档位：正在生效的模型用 omp 报的；别的模型按模型目录，omp 报的里有 off（任务里）时也给 off。
  const levelsOf = (option: ModelOption): readonly ThinkingLevel[] => {
    if (model !== null && sameModel(option.key, model.key)) return props.thinkingLevels;
    const efforts = thinkingLevelOptions(option, []);
    return efforts.length > 0 && props.thinkingLevels.includes("off") ? ["off", ...efforts] : efforts;
  };
  // 分段条上亮哪一档：点过的，没点过是现在的；这个模型没有那一档时照 omp 的规则钳到最近的。
  const levelIn = (levels: readonly ThinkingLevel[]): ThinkingLevel | null => {
    const wanted = pickedLevel ?? thinkingLevel;
    if (wanted === null || levels.length === 0) return null;
    return levels.includes(wanted) ? wanted : clampThinkingLevel(wanted, levels);
  };
  const shownLevels = shown === null ? [] : levelsOf(shown);
  const shownLevel = levelIn(shownLevels);

  const selectRole = (role: string | null) => {
    setRoleTab(role);
    setSelection(null);
  };

  const selectScope = (next: Scope) => {
    setScope(next);
    setSelection(null);
  };

  // 点角色（或在角色行上 Enter）：转到给它选模型，搜索词清空，从角色范围回到全部模型，表里定位到它现在的模型。
  const applyRole = (role: string) => {
    selectRole(role);
    setQuery("");
    if (scope.kind === "roles") setScope({ kind: "all" });
    searchRef.current?.focus();
  };

  // 用于此任务：先关对话框，切模型、设思考强度在后台按顺序做（omp 的往返不挡界面，失败弹 toast）；给角色选时是写全局 modelRoles。
  const apply = (item: Item | null) => {
    if (item === null) return;
    if (item.kind === "role") {
      applyRole(item.role);
      return;
    }
    const option = item.option;
    onClose();
    localStorage.setItem(
      recentKey,
      JSON.stringify([option.key, ...readRecent().filter((key) => !sameModel(key, option.key))].slice(0, 3)),
    );
    if (roleTab !== null) {
      // 档位以写入时的全局值为准（打开时读的角色表可能还没到，项目里的值也可能盖着全局的）。
      window.studio
        .getModelRoles(null)
        .then((global) => saveOmpModelRole(roleTab, option.key, keepRoleLevel(global[roleTab] ?? null, option)))
        .catch(report);
      return;
    }
    const switching = activeModel === null || !sameModel(option.key, activeModel.key);
    const level = pickedLevel === null ? null : levelIn(levelsOf(option));
    let done = switching ? props.setModel(option.key) : Promise.resolve();
    if (level !== null && (switching || level !== thinkingLevel)) done = done.then(() => props.setThinking(level));
    done.catch(report);
  };

  const move = (delta: number) => {
    if (items.length === 0) return;
    const index = selectedItem ? items.indexOf(selectedItem) : -1;
    const next = items[Math.min(Math.max(index + delta, 0), items.length - 1)];
    if (next) setSelection(next.id);
  };

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
      apply(selectedItem);
    }
  };

  const roleHint = (role: string) => t(roleHintKey(role));

  const atRoles = roleMatches !== null;
  const primaryLabel = atRoles ? t("model.pickRole") : roleMode ? t("model.applyRole") : t("model.use");

  const total = atRoles
    ? view.tabs.length
    : scopeProvider === null
      ? (models?.length ?? 0)
      : (providers.find((entry) => entry.provider === scopeProvider)?.count ?? 0);
  const matched = atRoles ? (roleMatches?.length ?? 0) : rows.flat.length;

  const numbers = (option: ModelOption | null) => {
    const fullKey = option === null ? null : `${option.key.provider}/${option.key.modelId}`;
    const measured = fullKey === null ? undefined : insights?.perf[fullKey]?.tokensPerSecond;
    const tps = measured ?? option?.catalogTps ?? null;
    const cell = (value: string | null) => value ?? missing;
    return {
      intelligence: option === null || option.intelligence === null ? missing : String(Math.round(option.intelligence)),
      speed: option === null ? missing : tps !== null ? String(Math.round(tps)) : insights === null ? loading : missing,
      context: option === null ? missing : cell(modelContextCell(option)),
      price: option === null ? missing : cell(modelPriceCell(option)),
    };
  };

  const renderItem = (item: Item): ReactNode => {
    const isSelected = item.id === selectedId;
    const isCurrent =
      item.kind === "role"
        ? item.role === roleTab
        : activeModel !== null && sameModel(activeModel.key, item.option.key);
    const option = item.option;
    const cells = numbers(option);
    return (
      <div
        key={item.id}
        id={`${listId}${item.id}`}
        role="option"
        aria-selected={isSelected}
        className="mp-row"
        data-testid={item.kind === "role" ? "model-role-option" : "model-option"}
        data-role={item.kind === "role" ? item.role : undefined}
        data-current={isCurrent || undefined}
        title={
          item.kind === "role"
            ? `${roleLabel(item.role)}：${roleHint(item.role)}`
            : `${item.option.name}\n${item.option.key.provider}/${item.option.key.modelId}`
        }
        onClick={(event) => {
          if (event.detail <= 1) firstClick.current = item.id;
          if (item.kind === "role") applyRole(item.role);
          else if (firstClick.current === item.id) setSelection(item.id);
        }}
        onDoubleClick={() => item.kind === "model" && firstClick.current === item.id && apply(item)}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="mp-cell-model">
          {item.kind === "role" ? (
            <>
              <span className="mp-role-icon" aria-hidden="true">
                <RoleIcon role={item.role} />
              </span>
              <span className="mp-id-name">@{item.role}</span>
              {/* 指到列表外的值（别名、带后缀、没登录的 provider）照原文显示，不说成"未指定" */}
              <span className="mp-id-dim">
                {option === null
                  ? (roles?.[item.role] ?? t("model.roleUnset"))
                  : `${option.key.provider}/${option.key.modelId}`}
              </span>
            </>
          ) : (
            <>
              <span className="mp-id">
                <span className="mp-id-dim">{item.option.key.provider}/</span>
                <span className="mp-id-name">{item.option.key.modelId}</span>
              </span>
              {(view.badges.get(modelItemId(item.option.key)) ?? []).map((role) => (
                <span
                  key={role}
                  className="mp-role-badge"
                  data-testid="model-role-badge"
                  data-role={role}
                  role="img"
                  aria-label={`@${role}`}
                  title={`@${role}：${roleHint(role)}`}
                >
                  <RoleIcon role={role} size={12} />
                </span>
              ))}
            </>
          )}
        </span>
        <span className="mp-num" data-testid="model-intelligence">
          {cells.intelligence}
        </span>
        <span className="mp-num" data-testid="model-speed">
          {cells.speed}
        </span>
        <span className="mp-num">{cells.context}</span>
        <span className="mp-num">{cells.price}</span>
        <span className="mp-tick">{isCurrent && <Check size={14} />}</span>
      </div>
    );
  };

  const renderGroup = (key: string, label: string, list: readonly Item[]) => (
    <div role="group" aria-label={label} key={key}>
      <p className="mp-group" aria-hidden="true">
        {label} <span className="mp-group-count">{list.length}</span>
      </p>
      {list.map(renderItem)}
    </div>
  );

  // 没有搜索词：常用在前，其余按提供商分组（rows.rest 已按提供商排好）；全部模型里组标题可以点开 / 收起。
  const providerGroups = () => {
    const groups = new Map<string, Item[]>();
    for (const option of rows.rest) {
      const item: Item = { kind: "model", id: modelItemId(option.key), option };
      groups.set(option.key.provider, [...(groups.get(option.key.provider) ?? []), item]);
    }
    return [...groups].map(([provider, list]) => {
      if (!collapsible) return renderGroup(`p:${provider}`, provider, list);
      const expanded = openProviders.has(provider);
      return (
        <div role="group" aria-label={provider} key={`p:${provider}`}>
          <button
            type="button"
            className="mp-group mp-group-toggle"
            aria-expanded={expanded}
            data-testid="model-provider-group"
            data-provider={provider}
            // 不抢焦点：焦点留在搜索框里，方向键接着用。
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleProvider(provider)}
          >
            <ChevronRight size={12} />
            {provider} <span className="mp-group-count">{list.length}</span>
          </button>
          <Reveal open={expanded}>{list.map(renderItem)}</Reveal>
        </div>
      );
    });
  };

  const pinnedCount = atRoles || searching ? 0 : rows.pinned.length;
  const groups = atRoles
    ? [
        <div role="group" aria-label={t("model.rolesGroup")} key="roles">
          {items.map(renderItem)}
        </div>,
      ]
    : searching
      ? [renderGroup("matches", t("model.matches"), items)]
      : [
          ...(pinnedCount > 0 ? [renderGroup("pinned", t("model.pinned"), items.slice(0, pinnedCount))] : []),
          ...providerGroups(),
        ];

  const scopeButton = (entry: Scope, label: string, count: number, testId: string, dot = false) => (
    <button
      key={entry.kind === "provider" ? `p:${entry.provider}` : entry.kind}
      type="button"
      className="mp-scope"
      aria-current={sameScope(entry, scope) ? "true" : undefined}
      title={label}
      onClick={() => selectScope(entry)}
      data-testid={testId}
    >
      <span className="mp-scope-label">{label}</span>
      {dot && <span className="mp-scope-dot" aria-hidden="true" />}
      <span className="mp-scope-count">{count}</span>
    </button>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      className="mp-dialog"
      testId="model-picker"
      title={t("model.title")}
      head={
        <div className="mp-head">
          <TextField
            ref={searchRef}
            width="100%"
            testId="model-search"
            data-autofocus=""
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={selectedId === null ? undefined : `${listId}${selectedId}`}
            aria-label={t("model.search")}
            placeholder={t("model.search")}
            leading={<Search size={14} />}
            value={query}
            onChange={(next) => {
              setQuery(next);
              setSelection(null);
            }}
            onKeyDown={onSearchKey}
          />
          {roleTab !== null && (
            <span className="mp-target" data-testid="model-role-target" title={roleHint(roleTab)}>
              <Badge tone="accent">
                <RoleIcon role={roleTab} size={12} />
                {t("model.roleTarget", { role: roleLabel(roleTab) })}
              </Badge>
              <IconButton label={t("model.roleTargetClear")} testId="model-role-clear" onClick={() => selectRole(null)}>
                <Close size={12} />
              </IconButton>
            </span>
          )}
          {searching && (
            <span className="mp-count" data-testid="model-count">
              {`${matched} / ${total}`}
            </span>
          )}
        </div>
      }
      footStart={
        <Button
          variant="quiet"
          icon={<Plus size={14} />}
          testId="model-add-provider"
          onClick={() => {
            onClose();
            showView("settings", { section: "providers" });
          }}
        >
          {t("model.addProvider")}
        </Button>
      }
      footer={
        <>
          <Button testId="model-close" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            variant="primary"
            testId="model-use"
            disabled={selectedItem === null}
            onClick={() => apply(selectedItem)}
          >
            {primaryLabel}
          </Button>
        </>
      }
    >
      <nav ref={sideRef} className="mp-side" aria-label={t("model.scopes")}>
        {scopeButton({ kind: "roles" }, t("model.rolesGroup"), view.tabs.length, "model-scope-roles")}
        {scopeButton({ kind: "all" }, t("model.all"), models?.length ?? 0, "model-scope-all")}
        {providers.length > 0 && (
          <p className="mp-scopes-head" aria-hidden="true">
            {t("model.providers")}
          </p>
        )}
        {providers.map((entry) =>
          scopeButton(
            { kind: "provider", provider: entry.provider },
            entry.provider,
            entry.count,
            "model-scope-provider",
            activeModel?.key.provider === entry.provider,
          ),
        )}
      </nav>
      <div className="mp-main">
        <div ref={tableRef} className="mp-table">
          <div className="mp-cols" aria-hidden="true">
            <span />
            <span className="mp-num">{t("model.colIntelligence")}</span>
            <span className="mp-num">{t("model.colSpeed")}</span>
            <span className="mp-num">{t("model.colContext")}</span>
            <span className="mp-num">{t("model.colPrice")}</span>
            <span className="mp-tick" />
          </div>
          <div id={listId} className="mp-list" role="listbox" aria-label={t("model.list")}>
            {models !== null && items.length === 0 && (
              <p className="mp-empty">{atRoles ? t("model.noRoles") : t("model.empty")}</p>
            )}
            {groups}
          </div>
        </div>
        <div className="mp-foot">
          {shown !== null && <ModelDetails option={shown} insights={insights} />}
          {roleMode || atRoles ? (
            roleMode &&
            !atRoles && (
              <div className="mp-hints">
                <p className="mp-hint" data-testid="model-role-saved">
                  {t("model.roleSaved")}
                </p>
              </div>
            )
          ) : (
            <>
              {shown !== null && (
                <div className="mp-ctl">
                  <span className="mp-ctl-label">{t("model.thinking")}</span>
                  <div className="mp-ctl-body">
                    {shownLevels.length === 0 ? (
                      <span className="mp-hint">{t("model.thinking.unsupported")}</span>
                    ) : (
                      <>
                        <ThinkingSegments levels={shownLevels} level={shownLevel} onPick={setPickedLevel} />
                        {running && <span className="mp-hint">{t("composer.nextRequest")}</span>}
                      </>
                    )}
                    {props.speed && shownIsCurrent && <SpeedToggle speed={props.speed} />}
                  </div>
                </div>
              )}
              {props.taskId !== undefined && (
                <PrewalkSection taskId={props.taskId} model={model} smol={view.modelOf["smol"] ?? null} />
              )}
              {props.taskId !== undefined && <PresetSection taskId={props.taskId} onApplied={onClose} />}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** open 变 false 后等 Dialog 放完退出动画再卸载；每次打开都是全新的对话框状态。 */
export function ModelPicker(props: ModelPickerProps & { open: boolean }) {
  const presence = usePresence(props.open);
  if (!presence.mounted) return null;
  return <ModelPickerBody {...props} />;
}

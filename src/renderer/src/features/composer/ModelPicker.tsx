// 模型选择对话框（ui/Dialog，lg）：标题 + 角色标签页（ui/Tabs）+ 搜索框 + 一张表（模型 | 智能 | 速度 | 上下文 | 价格）+ 参数行 + 三行控件（思考强度 / Prewalk / 预设）；
// 页脚：添加提供商…（左）+ 关闭 + 用于此任务（主）。没有搜索词时"常用"在前、"全部"在后，有搜索词时是"匹配"；搜索框以 @ 开头时列角色。
// 键盘：搜索框里 ↑↓ 在行之间移动，Enter 选用模型（@ 角色行上是切到这个角色），鼠标悬停也会高亮；Tab 循环、Esc 关闭、焦点回到打开前的元素由 Dialog 负责。
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { usePresence } from "../../ui/presence.ts";
import type { ModelInsights, ModelKey, ModelOption, ProjectId, TaskId } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { Check, Search } from "../../icons.tsx";
import { Button, TextField, Tabs, tabPanelProps } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { showView } from "../../store/index.ts";
import { ModelDetails } from "./ModelDetails.tsx";
import { saveOmpModelRole } from "../settings/config-store.ts";
import {
  builtinRoles,
  filterRoles,
  groupModels,
  modelContextCell,
  modelItemId,
  modelPriceCell,
  pinnedKeys,
  roleItemId,
  roleView,
  sameModel,
} from "./model-groups.ts";
import { SpeedToggle, type SpeedControls } from "./SpeedToggle.tsx";
import { PresetSection } from "../session-toggles/PresetSection.tsx";
import { PrewalkSection } from "../session-toggles/PrewalkSection.tsx";
import { ThinkingSegments } from "./ThinkingSegments.tsx";

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
  /** 正在生效的模型；表里它高亮并带勾，底部的思考强度也是针对它。 */
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
  /** 给了任务 id（任务里；草稿没有）才显示 Prewalk 和"预设"两节：都是对这个任务发的命令（`/prewalk`、`/modelpreset`）。 */
  taskId?: TaskId;
  onClose(): void;
}

/** 表里的一行：模型，或 @ 搜索时的角色（带它绑定的模型）。 */
type Item =
  | { kind: "model"; id: string; option: ModelOption }
  | { kind: "role"; id: string; role: string; option: ModelOption | null };

const roleLabel = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** 对话框本体：每次打开都是全新的状态；退出动画由 Dialog 放，外层 ModelPicker 等它放完再卸载。 */
function ModelPickerBody(props: ModelPickerProps & { open: boolean }) {
  const { model, thinkingLevel, running, onClose, open } = props;
  const t = useT();
  const listId = useId();
  const tableRef = useRef<HTMLDivElement>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const [models, setModels] = useState<ModelOption[] | null>(null);
  const [insights, setInsights] = useState<ModelInsights | null>(null);
  const [query, setQuery] = useState("");
  // 方向键 / 鼠标所在的行；null = 跟着正在生效的模型走。
  const [cursor, setCursor] = useState<string | null>(null);
  // 角色标签：default = 切换本任务（草稿里是新任务默认）的模型；其它角色 = 给那个角色指定模型，写进 omp 配置。
  const [roles, setRoles] = useState<Record<string, string> | null>(null);
  const [roleTab, setRoleTab] = useState("default");
  // "常用"在打开时定下来：选了模型之后当前模型会变，但行不跟着往上跳。
  const [pinned, setPinned] = useState<ModelKey[] | null>(null);
  const report = useCallback((error: unknown) => reportError(t, error), [t]);
  const reloadRoles = () => window.studio.getModelRoles(props.projectId).then(setRoles, () => setRoles({}));

  // 只在打开的那一刻拉一次列表（和速度、智能分、压缩设置、角色表）；props 每次渲染都是新对象，不能放进依赖。
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

  const searching = query.trim() !== "";
  const view = useMemo(() => roleView(roles ?? {}, models ?? []), [roles, models]);
  const roleMode = roleTab !== "default";
  // 表里高亮、打勾、底部"当前"指的模型：角色模式下是这个角色现在的模型。
  const activeModel = roleMode ? (view.modelOf[roleTab] ?? null) : model;

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

  const roleMatches = useMemo(() => filterRoles(view.tabs, query), [view.tabs, query]);
  const rows = useMemo(() => groupModels(models ?? [], query, pinned ?? []), [models, query, pinned]);
  const items = useMemo<Item[]>(
    () =>
      roleMatches !== null
        ? roleMatches.map((role) => ({
            kind: "role",
            id: roleItemId(role),
            role,
            option: view.modelOf[role] ?? null,
          }))
        : rows.flat.map((option) => ({ kind: "model", id: modelItemId(option.key), option })),
    [roleMatches, rows, view],
  );
  const currentId = roleMatches !== null ? roleItemId(roleTab) : activeModel ? modelItemId(activeModel.key) : null;
  const cursorItem = items.find((item) => item.id === (cursor ?? currentId)) ?? items[0] ?? null;
  const cursorId = cursorItem?.id ?? null;
  const shown = cursorItem === null ? null : cursorItem.option;
  const shownIsCurrent = shown !== null && activeModel !== null && sameModel(shown.key, activeModel.key);

  useEffect(() => {
    tableRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursorId]);

  const pick = (option: ModelOption): Promise<void> => {
    const recent = [option.key, ...readRecent().filter((key) => !sameModel(key, option.key))].slice(0, 3);
    localStorage.setItem(recentKey, JSON.stringify(recent));
    setCursor(modelItemId(option.key));
    const done = roleMode ? saveOmpModelRole(props.projectId, roleTab, option.key) : props.setModel(option.key);
    return done.then(reloadRoles).catch(report);
  };

  const selectRole = (role: string) => {
    setRoleTab(role);
    setCursor(null);
  };

  // @ 列表里的角色：切到这个角色（之后表里选模型 = 给它指定模型），搜索词清空。
  const applyRole = (role: string) => {
    selectRole(role);
    setQuery("");
    searchRef.current?.focus();
  };

  const activate = (item: Item) => {
    if (item.kind === "role") applyRole(item.role);
    else void pick(item.option);
  };

  const move = (delta: number) => {
    if (items.length === 0) return;
    const index = cursorItem ? items.indexOf(cursorItem) : -1;
    const next = items[Math.min(Math.max(index + delta, 0), items.length - 1)];
    if (next) setCursor(next.id);
  };

  const onSearchKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !(event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault();
      if (cursorItem) activate(cursorItem);
    }
  };

  const supportsThinking = model?.reasoning === true && props.thinkingLevels.length > 0;
  const roleHint = (role: string) =>
    t(`model.role.hint.${(builtinRoles as readonly string[]).includes(role) ? role : "custom"}` as MessageKey);

  // 主按钮：@ 列表里 = 应用角色（切到它）；否则 = 选用高亮的模型并关闭（已经是当前模型就只关闭）。
  const atRoles = roleMatches !== null;
  const primaryLabel = atRoles || roleMode ? t("model.useRole") : t("model.use");
  const onPrimary = () => {
    if (cursorItem === null) return;
    if (cursorItem.kind === "role") {
      applyRole(cursorItem.role);
    } else if (shownIsCurrent) {
      onClose();
    } else {
      void pick(cursorItem.option).then(onClose);
    }
  };

  const total = atRoles ? view.tabs.length : (models?.length ?? 0);
  const matched = atRoles ? (roleMatches?.length ?? 0) : rows.flat.length;

  const numbers = (option: ModelOption | null) => {
    const fullKey = option === null ? null : `${option.key.provider}/${option.key.modelId}`;
    const score = fullKey === null ? undefined : insights?.intelligence[fullKey];
    const tps = fullKey === null ? undefined : insights?.perf[fullKey]?.tokensPerSecond;
    const cell = (value: string | null) => value ?? missing;
    return {
      intelligence:
        option === null
          ? missing
          : insights === null
            ? loading
            : score === undefined
              ? missing
              : String(Math.round(score)),
      speed:
        option === null
          ? missing
          : insights === null
            ? loading
            : tps === undefined || tps === null
              ? missing
              : String(Math.round(tps)),
      context: option === null ? missing : cell(modelContextCell(option)),
      price: option === null ? missing : cell(modelPriceCell(option)),
    };
  };

  const renderItem = (item: Item): ReactNode => {
    const isHighlighted = item.id === cursorId;
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
        aria-selected={isCurrent}
        className="mp-row"
        data-testid={item.kind === "role" ? "model-role-option" : "model-option"}
        data-highlighted={isHighlighted}
        data-current={isCurrent || undefined}
        title={
          item.kind === "role"
            ? `${roleLabel(item.role)}：${roleHint(item.role)}`
            : `${item.option.name}\n${item.option.key.provider}/${item.option.key.modelId}`
        }
        onClick={() => activate(item)}
        onMouseMove={() => {
          if (!isHighlighted) setCursor(item.id);
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <span className="mp-cell-model">
          {item.kind === "role" ? (
            <>
              <span className="mp-id-name">@{item.role}</span>
              <span className="mp-id-dim">
                {option === null ? t("model.roleUnset") : `${option.key.provider}/${option.key.modelId}`}
              </span>
            </>
          ) : (
            <>
              <span className="mp-id">
                <span className="mp-id-dim">{item.option.key.provider}/</span>
                <span className="mp-id-name">{item.option.key.modelId}</span>
              </span>
              {(view.badges.get(modelItemId(item.option.key)) ?? []).map((role) => (
                <span key={role} className="mp-role-badge" data-testid="model-role-badge" data-role={role}>
                  {role}
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

  const renderGroup = (label: string, list: readonly Item[]) => (
    <div role="group" aria-label={label} key={label}>
      <p className="mp-group" aria-hidden="true">
        {label} <span className="mp-group-count">{list.length}</span>
      </p>
      {list.map(renderItem)}
    </div>
  );

  const pinnedCount = atRoles || searching ? 0 : rows.pinned.length;
  const groups = atRoles
    ? [renderGroup(t("model.rolesGroup"), items)]
    : searching
      ? [renderGroup(t("model.matches"), items)]
      : [
          ...(pinnedCount > 0 ? [renderGroup(t("model.pinned"), items.slice(0, pinnedCount))] : []),
          ...(items.length > pinnedCount ? [renderGroup(t("model.all"), items.slice(pinnedCount))] : []),
        ];

  const tabs = view.tabs.map((role) => ({
    id: role,
    label: roleLabel(role),
    title: t("model.roleCurrent", {
      role: roleLabel(role),
      model: view.modelOf[role]?.name ?? roles?.[role] ?? t("model.roleUnset"),
    }),
  }));
  const tabsId = `${listId}-roles`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      className="mp-dialog"
      testId="model-picker"
      title={roleMode ? t("model.roleTitle", { role: roleLabel(roleTab) }) : t("model.title")}
      tabs={
        <div className="mp-tabs">
          <Tabs
            tabs={tabs}
            value={roleTab}
            onChange={selectRole}
            label={t("model.roles")}
            idBase={tabsId}
            testId="model-role-tab"
          />
        </div>
      }
      footStart={
        <Button
          variant="quiet"
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
            {t("model.close")}
          </Button>
          <Button variant="primary" testId="model-use" disabled={cursorItem === null} onClick={onPrimary}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <div className="mp-search-row">
        <TextField
          ref={searchRef}
          width="100%"
          testId="model-search"
          data-autofocus=""
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={cursorId === null ? undefined : `${listId}${cursorId}`}
          aria-label={t("model.search")}
          placeholder={t("model.search")}
          leading={<Search size={14} />}
          value={query}
          onChange={(next) => {
            setQuery(next);
            setCursor(null);
          }}
          onKeyDown={onSearchKey}
        />
        <span className="mp-count" data-testid="model-count">
          {searching ? `${matched} / ${total}` : total}
        </span>
      </div>
      <div ref={tableRef} className="mp-table" {...tabPanelProps(tabsId, roleTab)}>
        <div className="mp-cols" aria-hidden="true">
          <span>{t("model.colModel")}</span>
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
        {shown === null ? (
          <p className="mp-params mp-params-empty">{t("model.noSelection")}</p>
        ) : (
          <ModelDetails
            option={shown}
            isCurrent={shownIsCurrent}
            roles={view.badges.get(modelItemId(shown.key)) ?? []}
            insights={insights}
          />
        )}
        {roleMode ? (
          <div className="mp-hints">
            <p className="mp-hint" data-testid="model-role-use">
              {t("model.roleUse", { hint: roleHint(roleTab) })}
            </p>
            <p className="mp-hint" data-testid="model-role-saved">
              {t("model.roleSaved")}
            </p>
          </div>
        ) : (
          <>
            <div className="mp-ctl">
              <span className="mp-ctl-label">{t("model.thinking")}</span>
              <div className="mp-ctl-body">
                {!shownIsCurrent ? (
                  <span className="mp-hint">{t("model.thinking.pending")}</span>
                ) : !supportsThinking ? (
                  <span className="mp-hint">{t("model.thinking.unsupported")}</span>
                ) : (
                  <>
                    <ThinkingSegments
                      levels={props.thinkingLevels}
                      level={thinkingLevel}
                      onPick={(level) => void props.setThinking(level).catch(report)}
                    />
                    {running && <span className="mp-hint">{t("composer.nextRequest")}</span>}
                  </>
                )}
                {props.speed && shownIsCurrent && <SpeedToggle speed={props.speed} />}
              </div>
            </div>
            {props.taskId !== undefined && (
              <PrewalkSection taskId={props.taskId} model={model} smol={view.modelOf["smol"] ?? null} />
            )}
            {props.taskId !== undefined && <PresetSection taskId={props.taskId} onApplied={onClose} />}
          </>
        )}
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

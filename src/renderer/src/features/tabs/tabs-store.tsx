// 顶栏任务标签的动作（spec §4.6）：选中任务就进标签栏，关标签 = 关这个任务的 omp 进程（TaskPool.closeTask），
// 任务还在跑或在等你时先确认。标签列表和当前标签存在外壳状态（window-state.json），重启后恢复。
// 开着标签的任务主进程不回收进程；所以标签 ⇔ 有进程（重启后恢复的标签点到时才起进程）。
import { useEffect, useState } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { getTaskColors, getTaskTabs, setTaskColors, setTaskTabs, useShellValue } from "../../app/shell-store.ts";
import { useT } from "../../i18n/use-t.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { getSelectedTaskId, getTask, selectTask, useSelectedTaskId, useTasksState } from "../../store/index.ts";
import { ConfirmDialog } from "../../ui/Dialog.tsx";
import { reportError } from "../../ui/errors.ts";
import { startDraft } from "../empty/index.ts";
import { cycleTab, keepExisting, moveTab, withoutTabs, withTab } from "./task-tabs.ts";

/** 外壳状态读回来、任务表也到了，恢复过上次的标签之后才开始写：之前的选中（启动时的草稿）不能覆盖存着的标签。 */
let restored = false;

function save(tabs: readonly TaskId[], active: TaskId | null): void {
  setTaskTabs([...tabs], active);
}

/**
 * 挂在顶栏标签栏里：启动时恢复上次的标签并选中上次的当前标签；之后选中的任务进标签栏、当前标签跟着存；
 * 任务被删、归档（从任务表消失）后标签跟着去掉。
 */
export function useTaskTabsSync(): void {
  const t = useT();
  const selected = useSelectedTaskId();
  const shellLoaded = useShellValue("loaded");
  const tasks = useTasksState();
  const [ready, setReady] = useState(restored);

  useEffect(() => {
    if (restored || !shellLoaded || !tasks.loaded) return;
    restored = true;
    const { openTabs, activeTab } = getTaskTabs();
    const exists = (id: TaskId) => tasks.byId[id] !== undefined;
    const tabs = keepExisting(openTabs, exists);
    const current = getSelectedTaskId();
    if (current === null && activeTab !== null && exists(activeTab)) {
      save(tabs, activeTab);
      selectTask(activeTab).catch((error: unknown) => reportError(t, error));
    } else save(current === null ? tabs : withTab(tabs, current), current);
    setReady(true);
  }, [shellLoaded, tasks, t]);

  useEffect(() => {
    if (!ready) return;
    const { openTabs } = getTaskTabs();
    save(selected === null ? openTabs : withTab(openTabs, selected), selected);
  }, [ready, selected]);

  useEffect(() => {
    if (!ready || !tasks.loaded) return;
    const exists = (id: TaskId) => tasks.byId[id] !== undefined;
    const { openTabs, activeTab } = getTaskTabs();
    const tabs = keepExisting(openTabs, exists);
    if (tabs !== openTabs) save(tabs, activeTab);
    // 任务删掉、归档后颜色也丢掉。
    const colors = getTaskColors();
    const ids = Object.keys(colors) as TaskId[];
    const kept = keepExisting(ids, exists);
    if (kept !== ids) setTaskColors(Object.fromEntries(kept.map((id) => [id, colors[id]!])));
  }, [ready, tasks]);
}

function isBusy(id: TaskId): boolean {
  const status = getTask(id)?.status;
  return status === "running" || status === "needs_you";
}

function doClose(t: TFunction, ids: readonly TaskId[]): void {
  const { openTabs, activeTab } = getTaskTabs();
  const current = getSelectedTaskId();
  const { tabs, next } = withoutTabs(openTabs, ids, current);
  const wasCurrent = current !== null && ids.includes(current);
  save(tabs, wasCurrent ? next : activeTab);
  if (wasCurrent) {
    if (next !== null) selectTask(next).catch((error: unknown) => reportError(t, error));
    else startDraft(getTask(current)?.projectId ?? null);
  }
  for (const id of ids) window.studio.closeTask(id).catch((error: unknown) => reportError(t, error));
}

const closeRequest = createStore<readonly TaskId[] | null>(null);

/** 关一个或几个标签：其中有在跑或在等你的任务时先弹确认（关进程会停掉它们），否则直接关。 */
export function closeTaskTabs(t: TFunction, ids: readonly TaskId[]): void {
  if (ids.length === 0) return;
  if (ids.some(isBusy)) closeRequest.set(ids);
  else doClose(t, ids);
}

export function closeTaskTab(t: TFunction, id: TaskId): void {
  closeTaskTabs(t, [id]);
}

/** 右键菜单的"关闭其他 / 关闭右侧 / 全部关闭"：按 id 在标签列表里的位置算要关哪些。 */
export function tabsToClose(scope: "others" | "right" | "all", id: TaskId): TaskId[] {
  const { openTabs } = getTaskTabs();
  const at = openTabs.indexOf(id);
  if (scope === "all") return [...openTabs];
  if (scope === "others") return openTabs.filter((tab) => tab !== id);
  return at === -1 ? [] : openTabs.slice(at + 1);
}

/** Ctrl Tab / Ctrl Shift Tab：切到右边 / 左边的标签（首尾相接）。 */
export function cycleTaskTab(t: TFunction, step: 1 | -1): void {
  const next = cycleTab(getTaskTabs().openTabs, getSelectedTaskId(), step);
  if (next !== null) selectTask(next).catch((error: unknown) => reportError(t, error));
}

/** 拖动标签换位置：挪到第 to 个（按挪走它之后的列表算）。 */
export function moveTaskTab(id: TaskId, to: number): void {
  const { openTabs, activeTab } = getTaskTabs();
  const next = moveTab(openTabs, id, to);
  if (next !== openTabs) save(next, activeTab);
}

/** 任务颜色：1…limits.taskColorCount，null = 去掉颜色。 */
export function setTaskColor(id: TaskId, color: number | null): void {
  const { [id]: _old, ...rest } = getTaskColors();
  setTaskColors(color === null ? rest : { ...rest, [id]: color });
}

/** 关标签的确认框（挂在 App 里）：只关一个写它的标题，关几个写其中有几个还在运行。 */
export function CloseTabHost() {
  const t = useT();
  const ids = useStoreValue(closeRequest, (state) => state);
  if (ids === null) return null;
  const busy = ids.filter(isBusy);
  const only = ids.length === 1 ? getTask(ids[0]!) : null;
  const close = () => closeRequest.set(null);
  return (
    <ConfirmDialog
      key={ids.join()}
      danger
      testId="close-tab-dialog"
      title={t("tabs.closeRunningTitle")}
      body={
        ids.length === 1
          ? t("tabs.closeRunningBody", { title: (only && taskTitle(only)) || t("task.untitled") })
          : t("tabs.closeManyRunningBody", { count: busy.length })
      }
      confirmLabel={t("tabs.closeRunningConfirm")}
      onCancel={close}
      onConfirm={() => {
        close();
        doClose(t, ids);
      }}
    />
  );
}

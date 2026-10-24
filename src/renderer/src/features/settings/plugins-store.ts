// "插件"页的渲染进程状态：已装插件 + 市场（一份快照）、各市场的可装列表、各 npm 插件的设置值、诊断结果。
// 主进程是权威：任何改动都经 runPluginAction，成功后重读快照；失败原样（omp 的话）经 reportError 弹出，不吞。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { ProjectId, TaskState } from "../../../../shared/ipc.ts";
import type {
  DiscoverEntry,
  DoctorCheck,
  PluginAction,
  PluginConfig,
  PluginsSnapshot,
} from "../../../../shared/omp-output/plugins.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/toast-store.ts";

interface Slot<T> {
  data: T | null;
  busy: boolean;
  error: unknown;
}

interface PluginsState {
  snapshot: Slot<PluginsSnapshot>;
  /** 正在执行的动作的 key（同一时间只有一个，主进程也是串行）；null = 空闲。 */
  working: string | null;
  /** 有改动还没在运行中的任务里重新加载。 */
  reloadPending: boolean;
  reloading: boolean;
  projectId: ProjectId | null;
  discover: Readonly<Record<string, Slot<DiscoverEntry[]>>>;
  configs: Readonly<Record<string, Slot<PluginConfig>>>;
  doctor: Slot<DoctorCheck[]>;
}

const empty = { data: null, busy: false, error: null } as const;
const store = createStore<PluginsState>({
  snapshot: empty,
  working: null,
  reloadPending: false,
  reloading: false,
  projectId: null,
  discover: {},
  configs: {},
  doctor: empty,
});

function patch(next: Partial<PluginsState>): void {
  store.set({ ...store.get(), ...next });
}

function patchSlot<K extends "discover" | "configs">(group: K, key: string, next: Partial<Slot<unknown>>): void {
  const state = store.get();
  const current = (state[group][key] ?? empty) as Slot<unknown>;
  patch({ [group]: { ...state[group], [key]: { ...current, ...next } } } as Partial<PluginsState>);
}

export function loadPlugins(): Promise<void> {
  const state = store.get();
  patch({ snapshot: { ...state.snapshot, busy: true, error: null } });
  return window.studio.listPlugins(store.get().projectId).then(
    (data) => patch({ snapshot: { data, busy: false, error: null } }),
    (error: unknown) => patch({ snapshot: { ...store.get().snapshot, busy: false, error } }),
  );
}

export async function loadDiscover(marketplace: string): Promise<void> {
  patchSlot("discover", marketplace, { busy: true, error: null });
  try {
    patchSlot("discover", marketplace, { data: await window.studio.discoverPlugins(marketplace), busy: false });
  } catch (error) {
    patchSlot("discover", marketplace, { busy: false, error });
  }
}

export async function loadPluginConfig(plugin: string): Promise<void> {
  patchSlot("configs", plugin, { busy: true, error: null });
  try {
    patchSlot("configs", plugin, { data: await window.studio.getPluginConfig(plugin), busy: false });
  } catch (error) {
    patchSlot("configs", plugin, { busy: false, error });
  }
}

/** 这些动作改变运行中任务能看到的东西（技能、命令、工具、MCP）；市场增删、更新目录、诊断不会。 */
function changesRunningTasks(action: PluginAction): boolean {
  return !(
    action.kind === "marketplaceAdd" ||
    action.kind === "marketplaceRemove" ||
    action.kind === "marketplaceUpdate" ||
    action.kind === "doctor"
  );
}

/** 执行一个动作；返回是否成功。omp 的结果句作为 toast，失败经 reportError。 */
export async function runAction(t: TFunction, action: PluginAction, key: string): Promise<boolean> {
  if (store.get().working !== null) return false;
  patch({ working: key });
  try {
    const result = await window.studio.runPluginAction(action, store.get().projectId);
    if (action.kind === "doctor") patch({ doctor: { data: result.checks, busy: false, error: null } });
    else if (result.text !== "") pushToast({ level: "info", message: result.text });
    if (changesRunningTasks(action)) patch({ reloadPending: true });
    if (action.kind === "marketplaceRemove" || action.kind === "marketplaceUpdate") {
      patch({ discover: {} });
    }
    if (action.kind === "configSet" || action.kind === "configDelete") void loadPluginConfig(action.id);
    if (action.kind !== "doctor") await loadPlugins();
    return true;
  } catch (error) {
    reportError(t, error);
    return false;
  } finally {
    patch({ working: null });
  }
}

/** 页面当前看的范围：null = 只看用户范围；项目 id = 同时看到该项目范围的安装，并可装到该项目。调用方随后重读。 */
export function setPluginProject(projectId: ProjectId | null): void {
  if (store.get().projectId !== projectId) patch({ projectId });
}

export function dismissReload(): void {
  patch({ reloadPending: false });
}

/**
 * 在空闲的任务里 `/reload-plugins`（会话级命令，每个任务自己的 omp 进程）。正在跑一轮、等你回答、还在启动的任务不碰，
 * 提示有几个没处理；一个失败不影响其他，失败原因汇总成一条错误。
 */
export async function reloadRunningTasks(t: TFunction, tasks: readonly TaskState[]): Promise<void> {
  const idle = tasks.filter((task) => task.status === "idle");
  const busy = tasks.filter(
    (task) => task.status === "running" || task.status === "needs_you" || task.status === "starting",
  );
  patch({ reloading: true });
  try {
    const failures: unknown[] = [];
    let done = 0;
    for (const task of idle) {
      try {
        await window.studio.runTaskCommand(task.id, { kind: "reloadPlugins" });
        done += 1;
      } catch (error) {
        failures.push(error);
      }
    }
    if (done > 0) pushToast({ level: "info", message: t("plugins.reload.done", { count: done }) });
    else if (busy.length === 0 && failures.length === 0)
      pushToast({ level: "info", message: t("plugins.reload.none") });
    if (busy.length > 0) pushToast({ level: "warning", message: t("plugins.reload.busy", { count: busy.length }) });
    if (failures.length > 0) reportError(t, failures[0], (message) => t("plugins.reload.failed", { message }));
    if (busy.length === 0 && failures.length === 0) patch({ reloadPending: false });
  } finally {
    patch({ reloading: false });
  }
}

export function usePluginsState(): PluginsState {
  return useStoreValue(store, (state) => state);
}

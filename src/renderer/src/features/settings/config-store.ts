// omp 设置的渲染进程镜像：快照（schema + 当前值）加每一项的保存状态。
// 在模块里保存，切换分组、关掉再打开设置页都不重新读；打开设置页时静默刷新一次（终端里可能改过）。
// 写入走 omp config（主进程）：成功后才更新这里的值；失败时值不变，错误显示在那一项上，用户的草稿留在输入框里。
import type { ModelKey, OmpConfigItem, OmpConfigSnapshot, OmpConfigWriteResult } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

interface RowState {
  phase: "idle" | "saving" | "saved" | "error";
  /** 字符串 = 本地校验的提示；其他 = 请求失败的原始错误，显示时走 describeError。 */
  error?: unknown;
  /** 写进去了但生效值来自别处（环境变量名 / project / overlay / runtime）。 */
  overriddenBy?: string;
  fallbackEnv?: string;
}

type ConfigLoad =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; snapshot: OmpConfigSnapshot }
  | { kind: "error"; error: unknown };

interface ConfigState {
  load: ConfigLoad;
  rows: Readonly<Record<string, RowState>>;
}

const store = createStore<ConfigState>({ load: { kind: "idle" }, rows: {} });
const savedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const emptyRow: RowState = { phase: "idle" };
let loading: Promise<void> | null = null;

/** 读（或重读）快照。已经有快照时静默刷新，不把界面换成加载态。 */
export function loadOmpConfig(): Promise<void> {
  loading ??= (async () => {
    const hadSnapshot = store.get().load.kind === "ready";
    if (!hadSnapshot) store.set({ ...store.get(), load: { kind: "loading" } });
    try {
      const snapshot = await window.studio.getOmpConfig();
      store.set({ ...store.get(), load: { kind: "ready", snapshot } });
    } catch (error) {
      // 静默刷新失败不盖掉已有的内容。
      if (!hadSnapshot) store.set({ ...store.get(), load: { kind: "error", error } });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function setRow(key: string, row: RowState): void {
  const state = store.get();
  store.set({ ...state, rows: { ...state.rows, [key]: row } });
}

function applyResult(result: OmpConfigWriteResult): void {
  const state = store.get();
  if (state.load.kind !== "ready") return;
  const snapshot = state.load.snapshot;
  const items = snapshot.items.map((item): OmpConfigItem =>
    item.key === result.key ? { ...item, value: result.value, hasValue: result.hasValue } : item,
  );
  const row: RowState = {
    phase: "saved",
    ...(result.overriddenBy && { overriddenBy: result.overriddenBy }),
    ...(result.fallbackEnv && { fallbackEnv: result.fallbackEnv }),
  };
  store.set({ load: { kind: "ready", snapshot: { ...snapshot, items } }, rows: { ...state.rows, [result.key]: row } });
  clearTimeout(savedTimers.get(result.key));
  // "已保存"只亮一会儿；被覆盖的提示要一直留着，所以只有普通的保存成功才淡出。
  if (!row.overriddenBy && !row.fallbackEnv) {
    savedTimers.set(
      result.key,
      setTimeout(() => {
        if (store.get().rows[result.key]?.phase === "saved") setRow(result.key, emptyRow);
      }, 1600),
    );
  }
}

async function write(key: string, job: () => Promise<OmpConfigWriteResult>): Promise<void> {
  setRow(key, { phase: "saving" });
  try {
    applyResult(await job());
  } catch (error) {
    setRow(key, { phase: "error", error });
  }
}

export function saveOmpConfig(key: string, value: unknown): Promise<void> {
  return write(key, () => window.studio.setOmpConfig(key, JSON.stringify(value)));
}

export function resetOmpConfig(key: string): Promise<void> {
  return write(key, () => window.studio.resetOmpConfig(key));
}

/** 页面里的输入校验失败等本地错误，也显示在那一项上。 */
export function setLocalError(key: string, error: string | null): void {
  const current = store.get().rows[key];
  if (error === null) {
    if (current?.phase === "error") setRow(key, emptyRow);
  } else if (current?.error !== error) {
    setRow(key, { phase: "error", error });
  }
}

export function useConfigLoad(): ConfigLoad {
  return useStoreValue(store, (state) => state.load);
}

export function useRowState(key: string): RowState {
  return useStoreValue(store, (state) => state.rows[key] ?? emptyRow);
}

/** 快照里某一项的当前生效值（没设置过就是 omp 的默认值）；快照还没读到（或读失败）时为 undefined。 */
export function useOmpConfigValue(key: string): unknown {
  return useStoreValue(store, (state) => {
    if (state.load.kind !== "ready") return undefined;
    const item = state.load.snapshot.items.find((entry) => entry.key === key);
    return item?.hasValue ? item.value : item?.defaultValue;
  });
}

/** 还没读过快照才读；设置页打开时会自己静默刷新。 */
export function ensureOmpConfigLoaded(): void {
  if (store.get().load.kind === "idle") void loadOmpConfig();
}

function throwIfFailed(key: string): void {
  const row = store.get().rows[key];
  if (row?.phase === "error") throw row.error;
}

/** 写入并在失败时抛出（设置页的写入只把错误记在那一项上，输入框的胶囊需要直接报错）。 */
export async function saveOmpConfigOrThrow(key: string, value: unknown): Promise<void> {
  await saveOmpConfig(key, value);
  throwIfFailed(key);
}

/**
 * 给某个角色（default、smol、task…）指定模型（null = 去掉）；default 就是新任务的默认模型（omp 的 modelRoles.default）。
 * 一律写全局（omp-config/model-defaults.ts）；写完重读快照，设置页的 omp 分组跟着更新。
 */
export async function saveOmpModelRole(role: string, model: ModelKey | null): Promise<void> {
  await window.studio.setModelRole(role, model);
  await loadOmpConfig();
}

/** omp 的 defaultThinkingLevel；null = 删掉这一项，回到 omp 的默认值。omp 不接受 off/inherit。 */
export async function saveOmpDefaultThinking(level: ThinkingLevel | null): Promise<void> {
  if (level === null) await resetOmpConfig("defaultThinkingLevel");
  else await saveOmpConfig("defaultThinkingLevel", level);
  throwIfFailed("defaultThinkingLevel");
}

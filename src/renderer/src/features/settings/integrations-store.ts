// 设置页里 MCP / SSH / 工具 / 记忆 / 更新日志卡片的数据：一个"按键缓存的异步读取"，切页再回来先显示上次的结果、后台刷新。
// 读到的都是 omp 命令的原文解析结果（解析器在 src/shared/omp-output/）；失败原样保留，界面显示 omp 的话。
import type { ProjectId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export type Load<T> =
  | { kind: "idle" }
  | { kind: "loading"; previous: T | null }
  | { kind: "ready"; data: T }
  | { kind: "error"; error: unknown; previous: T | null };

const idle: Load<never> = { kind: "idle" };

/** 范围键：用户范围是 "user"，项目范围是 projectId。 */
export type ScopeKey = "user" | ProjectId;

export function scopeProject(key: ScopeKey): ProjectId | null {
  return key === "user" ? null : key;
}

export interface Resource<T> {
  useLoad(key: string): Load<T>;
  /** 读（或重读）。已有结果时先保留显示；同一个键同时只跑一次。 */
  load(key: string): Promise<void>;
}

export function createResource<T>(fetch: (key: string) => Promise<T>): Resource<T> {
  const store = createStore<Readonly<Record<string, Load<T>>>>({});
  const running = new Map<string, Promise<void>>();
  const set = (key: string, value: Load<T>) => store.set({ ...store.get(), [key]: value });
  const previousOf = (key: string): T | null => {
    const current = store.get()[key];
    if (current?.kind === "ready") return current.data;
    return current?.kind === "loading" || current?.kind === "error" ? current.previous : null;
  };
  return {
    useLoad: (key) => useStoreValue(store, (state) => state[key] ?? idle),
    load(key) {
      const existing = running.get(key);
      if (existing) return existing;
      set(key, { kind: "loading", previous: previousOf(key) });
      const job = fetch(key)
        .then(
          (data) => set(key, { kind: "ready", data }),
          (error: unknown) => set(key, { kind: "error", error, previous: previousOf(key) }),
        )
        .finally(() => running.delete(key));
      running.set(key, job);
      return job;
    },
  };
}

/** 卡片里选中的范围（每张卡片各记各的）：null = 用户范围。 */
interface Scopes {
  mcp: ScopeKey;
  ssh: ScopeKey;
  memory: ScopeKey | null;
}

const scopes = createStore<Scopes>({ mcp: "user", ssh: "user", memory: null });

export function setCardScope(card: keyof Scopes, key: ScopeKey): void {
  scopes.set({ ...scopes.get(), [card]: key });
}

export function useCardScope<K extends keyof Scopes>(card: K): Scopes[K] {
  return useStoreValue(scopes, (state) => state[card]);
}

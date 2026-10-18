// 应用里唯一的 ApiKeyStore 实例：userData/api-keys.json + 系统 safeStorage。
// 给 omp 子进程注入环境变量的入口是 getApiKeyEnv（变量名见 omp environment-variables.md）。
import { app, safeStorage } from "electron";
import path from "node:path";
import { ApiKeyStore } from "./api-key-store.ts";

let store: ApiKeyStore | null = null;

export function apiKeyStore(): ApiKeyStore {
  store ??= new ApiKeyStore(path.join(app.getPath("userData"), "api-keys.json"), safeStorage);
  return store;
}

/** 给 omp 子进程的环境变量。没有存过 key 时返回空对象。 */
export async function getApiKeyEnv(): Promise<Record<string, string>> {
  return apiKeyStore().env();
}

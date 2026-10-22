// 启动时的 omp 默认（goal 自动推进、关首次运行引导）是后台任务；TSP 任务的 omp 进程要在它们完成后再起，
// 否则第一个任务读到的还是没关的引导。这里存那个 promise，和两个默认共用的“用户明确设过没有”判断。不 import electron。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

let pending: Promise<void> | null = null;

/** 登记启动默认的 promise（必须不 reject：各步自己吞错、只记 WARN）。 */
export function registerStartupDefaults(promise: Promise<void>): void {
  pending = promise;
}

/** 等启动默认做完，最多 `timeoutMs`；超时或没登记都直接返回，不阻塞任务启动。 */
export async function awaitStartupDefaults(timeoutMs: number): Promise<void> {
  const current = pending;
  if (!current) return;
  const { promise: timeout, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, timeoutMs);
  try {
    await Promise.race([current.catch(() => undefined), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * agent 目录的 config.yml 里是否有 `section.name` 这个键（嵌套 `section: { name }` 或平铺的键都算）。
 * 读不了、解析不了时按“设过”处理：宁可不改。
 */
export async function isConfigKeyExplicit(agentDir: string, key: string): Promise<boolean> {
  const dot = key.indexOf(".");
  const section = key.slice(0, dot);
  const name = key.slice(dot + 1);
  let text: string;
  try {
    text = await readFile(path.join(agentDir, "config.yml"), "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  let root: unknown;
  try {
    root = parse(text);
  } catch {
    return true;
  }
  if (root === null || root === undefined) return false;
  if (typeof root !== "object" || Array.isArray(root)) return true;
  const record = root as Record<string, unknown>;
  const parent = record[section];
  const nested =
    typeof parent === "object" && parent !== null && !Array.isArray(parent) ? (parent as Record<string, unknown>) : {};
  return key in record || name in nested;
}

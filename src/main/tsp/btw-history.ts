// 旁路提问的历史：omp 把每个话题存成会话旁边的 `<会话文件去掉 .jsonl>/btw-history/entry-<话题 id>.json`
// （omp 18.12.5 实测，形状同 rpc 的 BtwHistoryRecord；文档 slash-command-internals.md §11、rpc.md "Side questions"）。
// 只读：TSP 任务的话题 id、没有进程的任务的历史都靠它；解析在 shared/tsp/btw.ts（parseBtwEntry）。
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { btwLimits, type BtwHistoryRecord } from "../../shared/btw.ts";
import { BTW_ENTRY_MAX_BYTES, parseBtwEntry } from "../../shared/tsp/btw.ts";
import { log } from "../log/log.ts";

/** 会话文件 → 它的旁路提问目录；不是 `.jsonl` 为 null。 */
export function btwHistoryDir(sessionFile: string): string | null {
  return sessionFile.endsWith(".jsonl") ? path.join(sessionFile.slice(0, -".jsonl".length), "btw-history") : null;
}

/** 读会话的全部话题（最新的 btwLimits.records 个，从新到旧）；目录不存在（没问过）、读不了的文件跳过并记日志。 */
export async function readBtwHistory(sessionFile: string): Promise<BtwHistoryRecord[]> {
  const dir = btwHistoryDir(sessionFile);
  if (dir === null) return [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.startsWith("entry-") && name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: BtwHistoryRecord[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      if ((await stat(file)).size > BTW_ENTRY_MAX_BYTES) continue;
      const record = parseBtwEntry(await readFile(file, "utf8"));
      if (record) records.push(record);
      else log.warn("btw-history entry not recognised", { file });
    } catch (error) {
      // omp 在替换文件的瞬间读到半截 / 已删的文件：下一次读会拿到，不当错误。
      log.warn("btw-history entry unreadable", { file, message: String(error) });
    }
  }
  return records.sort((a, b) => b.createdAt - a.createdAt).slice(0, btwLimits.records);
}

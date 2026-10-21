// omp 的会话置顶（`/pin`）：`<agentDir>/session-pins.json`，内容是会话 id 的数组（omp 18.12.5 实测：`/pin` 切换，`[]` = 没有）。
// 只读：写入（切换）一律经 omp 的 `/pin`（runTaskCommand {kind:"pin"}），再读回来确认。文件不存在 = 没有置顶；
// 读不了（权限等）照常抛错；内容不是字符串数组时按"没有置顶"处理并记一条 WARN（格式不是 omp 的契约，升级后可能变，不能因此让历史列表打不开）。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { log } from "../log/log.ts";

export function sessionPinsPath(agentDir: string): string {
  return path.join(agentDir, "session-pins.json");
}

/** 文件文本 → 置顶的会话 id 集合；不是字符串数组时返回 null。 */
export function parseSessionPins(text: string): Set<string> | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  return new Set(value.filter((item): item is string => typeof item === "string" && item !== ""));
}

export async function readSessionPins(agentDir: string): Promise<Set<string>> {
  const file = sessionPinsPath(agentDir);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return new Set();
    throw error;
  }
  const pins = parseSessionPins(text);
  if (pins === null) {
    log.warn("session-pins.json is not an array of session ids; treating as no pins", { file });
    return new Set();
  }
  return pins;
}

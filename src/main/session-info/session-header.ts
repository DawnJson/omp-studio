// 会话文件头（`{"type":"session",...}`，在 256 字节标题槽之后）里会话信息对话框要的字段：版本、时间、cwd、标题、父会话、额外工作区目录。
// 格式依据 omp 18.12.x 的 session.md "File Format"；只读文件前缀。不是会话文件（头缺 id 或 cwd）时返回 null，界面就只显示任务自己的信息。
import { stat } from "node:fs/promises";
import type { SessionHeaderInfo } from "../../shared/ipc.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { readPrefix } from "../history/session-index.ts";

/** 标题槽 256 字节 + 头；头里带 additionalDirectories 也远不到这个长度。 */
const PREFIX_BYTES = 32 * 1024;

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** 文件前缀文本 → 头信息；找不到合法的 `session` 行返回 null。 */
export function parseSessionHeader(text: string): (SessionHeaderInfo & { id: string }) | null {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      return null;
    }
    if (!isRecord(entry)) return null;
    if (entry["type"] === "title") continue;
    if (entry["type"] !== "session") return null;
    const id = str(entry["id"]);
    const cwd = str(entry["cwd"]);
    if (id === null || cwd === null) return null;
    const dirs = entry["additionalDirectories"];
    return {
      id,
      version: typeof entry["version"] === "number" ? entry["version"] : null,
      timestamp: str(entry["timestamp"]),
      cwd,
      title: str(entry["title"]),
      parentSession: str(entry["parentSession"]),
      additionalDirectories: Array.isArray(dirs) ? dirs.filter((dir): dir is string => typeof dir === "string") : [],
    };
  }
  return null;
}

/** 读会话文件头；文件不存在（第一条回复之前还没落盘）或不是会话文件返回 null。 */
export async function readSessionHeader(file: string): Promise<(SessionHeaderInfo & { id: string }) | null> {
  const info = await stat(file).catch(() => null);
  if (info === null) return null;
  const { text, truncated } = await readPrefix(file, info.size, PREFIX_BYTES);
  // 前缀被截断时最后一行可能不完整：丢掉它（头在前面，不受影响）。
  return parseSessionHeader(truncated ? text.slice(0, text.lastIndexOf("\n")) : text);
}

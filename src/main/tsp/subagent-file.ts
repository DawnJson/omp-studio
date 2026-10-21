// TSP 任务里子代理的记录（只读 omp 的存档，不写 ~/.omp）：omp 把子代理的会话放在主会话文件旁边的同名目录里，
// `<sessions>/<slug>/<会话文件去掉 .jsonl>/<名字>.jsonl`（会话格式同主会话：每行 `{type:"message", message}`），最终输出在同目录的 `<名字>.md`
// （omp 18.12.5 实测，docs/architecture/subagents.md "TSP 任务里的子代理面板"）。名字来自渲染进程，不可信：字符集见
// `isAgentName`，拼出的路径还要确认落在会话目录之内。
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { TspSubagentRecord } from "../../shared/ipc.ts";
import type { AgentMessage } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { subagentLimits } from "../../shared/subagents.ts";
import { isAgentName } from "../../shared/tsp/agent-hub.ts";
import { isRecord } from "../../shared/type-guards.ts";

/** 详情里的完整记录：保留最近的 detailMessages 条，且序列化后不超过 detailBytes。 */
export function trimSubagentMessages<T>(messages: T[]): { messages: T[]; truncated: boolean } {
  let start = Math.max(0, messages.length - subagentLimits.detailMessages);
  let bytes = 0;
  for (let index = messages.length - 1; index >= start; index--) {
    bytes += JSON.stringify(messages[index]).length;
    if (bytes > subagentLimits.detailBytes) {
      start = index + 1;
      break;
    }
  }
  return start === 0 ? { messages, truncated: false } : { messages: messages.slice(start), truncated: true };
}

/** 最终输出 `.md` 读多少字节（再大的是异常文件，截断显示）。 */
const OUTPUT_MAX_BYTES = 512 * 1024;

export interface SubagentPaths {
  jsonl: string;
  md: string;
}

/** 子代理记录的两个文件路径；名字不合规、路径跑出会话目录时为 null。 */
export function subagentPaths(sessionFile: string, name: string): SubagentPaths | null {
  if (!isAgentName(name)) return null;
  const dir = sessionFile.replace(/\.jsonl$/i, "");
  if (dir === sessionFile) return null;
  const jsonl = path.join(dir, `${name}.jsonl`);
  const md = path.join(dir, `${name}.md`);
  const inside = (file: string) => path.dirname(file) === path.normalize(dir);
  return inside(jsonl) && inside(md) ? { jsonl, md } : null;
}

/** 会话文件内容 → 消息；坏行（含写到一半的最后一行）跳过。 */
export function parseSubagentMessages(text: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(entry) && entry["type"] === "message" && isRecord(entry["message"]))
      messages.push(entry["message"] as unknown as AgentMessage);
  }
  return messages;
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

/** 读文件末尾最多 `max` 字节；文件更大时丢掉开头那半行并标 truncated。 */
async function readTail(file: string, max: number): Promise<{ text: string; truncated: boolean }> {
  const size = (await stat(file)).size;
  if (size <= max) return { text: await readFile(file, "utf8"), truncated: false };
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(max);
    await handle.read(buffer, 0, max, size - max);
    const text = buffer.toString("utf8");
    return { text: text.slice(text.indexOf("\n") + 1), truncated: true };
  } finally {
    await handle.close();
  }
}

/** 读一个子代理的记录和最终输出；文件不存在、读失败都以 `unavailable` + 原因返回，不抛错（界面照常显示别的内容）。 */
export async function readSubagentRecord(sessionFile: string | null, name: string): Promise<TspSubagentRecord> {
  const empty: TspSubagentRecord = { messages: null, truncated: false, output: null, unavailable: null, error: null };
  if (sessionFile === null) return { ...empty, unavailable: "no_session" };
  const paths = subagentPaths(sessionFile, name);
  if (!paths) return { ...empty, unavailable: "error", error: `invalid subagent name: ${name}` };
  let record: TspSubagentRecord = { ...empty };
  try {
    const { text, truncated } = await readTail(paths.jsonl, subagentLimits.detailBytes);
    const trimmed = trimSubagentMessages(parseSubagentMessages(text));
    record = { ...record, messages: trimmed.messages, truncated: truncated || trimmed.truncated };
  } catch (error) {
    record = isMissing(error)
      ? { ...record, unavailable: "no_file" }
      : { ...record, unavailable: "error", error: error instanceof Error ? error.message : String(error) };
  }
  try {
    const { text } = await readTail(paths.md, OUTPUT_MAX_BYTES);
    record = { ...record, output: text };
  } catch (error) {
    if (!isMissing(error) && record.unavailable === null)
      record = { ...record, unavailable: "error", error: error instanceof Error ? error.message : String(error) };
  }
  return record;
}

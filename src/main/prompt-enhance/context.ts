// 提示词优化的可选轻量上下文（docs/architecture/prompt-enhance.md）：
// - 最近对话：只读当前任务会话文件的当前分支（从最后一个条目沿 parentId 往回找），最多取最近 2 轮用户/助手纯文字，
//   跳过工具调用、思考块和长代码块，硬截断字数，不写 ~/.omp，文件不存在或读失败静默跳过。
// - Git 改动文件：复用 git/status.ts 只列状态码 + 相对路径（不含 diff 正文），非 git 仓库或无改动静默跳过。
import type { GitFileChange } from "../../shared/git.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { findRepo } from "../git/repo.ts";
import { statusAt } from "../git/status.ts";
import { SessionReaderCache, type SessionEntryConsumer, type SessionFileEntry } from "../tsp/session-file-reader.ts";

const MAX_RECENT_TURNS = 2;
const MAX_USER_CHARS = 300;
const MAX_ASSISTANT_CHARS = 400;
const MAX_HISTORY_CHARS = 1_500;
const MAX_GIT_FILES = 30;
const MAX_GIT_CHARS = 1_000;

export interface EnhanceContext {
  history: string | null;
  gitFiles: string | null;
}

interface TurnMessage {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | null;
  text: string;
}

/** 去掉思考块、压缩长代码块和多余空行，截断到指定字符数。 */
function condenseMessage(raw: string, limit: number): string {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```[^\n]*\n[\s\S]*?```/g, (block) => (block.length > 160 ? "[code block]" : block))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit).trimEnd()}…`;
}

/** 从会话条目的 message.content 提取纯文本（忽略 thinking / toolCall / image 等非文本块）。 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string") parts.push(block["text"]);
  }
  return parts.join("\n");
}

/**
 * 增量消费会话文件，只保留链路定位和精简文字（不缓存工具结果和大块内容），避免大文件占内存。
 */
class RecentTurnsAccumulator implements SessionEntryConsumer {
  #items: TurnMessage[] = [];

  entry(raw: SessionFileEntry): void {
    const type = raw["type"];
    if (type === "session" || type === "title") return;
    const id = raw["id"];
    if (typeof id !== "string") return;
    const parentId = typeof raw["parentId"] === "string" ? raw["parentId"] : null;
    if (type !== "message" || !isRecord(raw["message"])) {
      this.#items.push({ id, parentId, role: null, text: "" });
      return;
    }
    const msg = raw["message"];
    const role = msg["role"];
    if (role === "user" && msg["attribution"] !== "agent") {
      const text = condenseMessage(extractTextContent(msg["content"]), MAX_USER_CHARS);
      this.#items.push({ id, parentId, role: text === "" ? null : "user", text });
    } else if (role === "assistant") {
      const text = condenseMessage(extractTextContent(msg["content"]), MAX_ASSISTANT_CHARS);
      this.#items.push({ id, parentId, role: text === "" ? null : "assistant", text });
    } else {
      this.#items.push({ id, parentId, role: null, text: "" });
    }
  }

  reset(): void {
    this.#items = [];
  }

  /** 按当前分支（从文件最后一个条目沿 parentId 往回走）格式化最近 N 轮对话。 */
  formatRecent(): string | null {
    const last = this.#items[this.#items.length - 1];
    if (last === undefined) return null;
    const byId = new Map<string, TurnMessage>();
    for (const item of this.#items) byId.set(item.id, item);

    // 沿 parentId 往回收集，最多取最近 MAX_RECENT_TURNS 轮（每见到一条 user 计一轮）。
    const picked: { role: "user" | "assistant"; text: string }[] = [];
    const seen = new Set<string>();
    let userTurns = 0;
    let cursor: TurnMessage | undefined = last;
    while (cursor !== undefined && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      if (cursor.role !== null && cursor.text !== "") {
        // 同一轮里连续多条 assistant 只留最新的一条（最终回复），免得中间工具过渡话把名额占满。
        const prev = picked[picked.length - 1];
        if (!(cursor.role === "assistant" && prev?.role === "assistant")) {
          picked.push({ role: cursor.role, text: cursor.text });
        }
        if (cursor.role === "user") {
          userTurns += 1;
          if (userTurns >= MAX_RECENT_TURNS) break;
        }
      }
      cursor = cursor.parentId !== null ? byId.get(cursor.parentId) : undefined;
    }
    if (picked.length === 0) return null;
    picked.reverse();

    const lines = picked.map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${item.text}`);
    let joined = lines.join("\n");
    if (joined.length > MAX_HISTORY_CHARS) joined = `${joined.slice(0, MAX_HISTORY_CHARS).trimEnd()}…`;
    return joined;
  }
}

const recentReaders = new SessionReaderCache(() => ({ turns: new RecentTurnsAccumulator() }));

/** 读会话文件的最近几轮纯文字；文件不存在、为空或读失败返回 null，不阻塞优化。 */
export async function readRecentTurns(sessionFile: string | null): Promise<string | null> {
  if (sessionFile === null) return null;
  try {
    const { turns } = await recentReaders.read(sessionFile);
    return turns.formatRecent();
  } catch {
    return null;
  }
}

function statusTag(file: GitFileChange): string {
  const kind = file.unstaged ?? file.staged;
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "untracked":
      return "?";
    case "conflicted":
      return "U";
    default:
      return "M";
  }
}

/** 格式化 git 改动文件路径列表（不含 diff 内容）。 */
export function formatChangedFiles(files: readonly GitFileChange[]): string | null {
  if (files.length === 0) return null;
  const lines: string[] = [];
  let chars = 0;
  const slice = files.slice(0, MAX_GIT_FILES);
  for (const file of slice) {
    const line = `${statusTag(file)} ${file.path}`;
    if (chars + line.length + 1 > MAX_GIT_CHARS && lines.length > 0) break;
    lines.push(line);
    chars += line.length + 1;
  }
  if (files.length > lines.length) lines.push(`... (+${files.length - lines.length} more)`);
  return lines.join("\n");
}

/** 读工作区的 git 改动文件路径列表；不在 git 仓库、无改动或读失败返回 null。 */
export async function readChangedFiles(cwd: string): Promise<string | null> {
  try {
    const repo = await findRepo(cwd);
    if (repo.kind !== "ok") return null;
    const status = await statusAt(repo.root);
    return formatChangedFiles(status.files);
  } catch {
    return null;
  }
}

/** 按开关并行采集优化上下文，永不抛错。 */
export async function buildEnhanceContext(input: {
  sessionFile: string | null;
  cwd: string;
  includeHistory: boolean;
  includeGit: boolean;
}): Promise<EnhanceContext> {
  const [history, gitFiles] = await Promise.all([
    input.includeHistory ? readRecentTurns(input.sessionFile) : Promise.resolve(null),
    input.includeGit ? readChangedFiles(input.cwd) : Promise.resolve(null),
  ]);
  return { history, gitFiles };
}

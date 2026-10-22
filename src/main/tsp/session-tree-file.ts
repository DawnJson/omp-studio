// TSP 任务的会话树：只读 omp 的会话文件（jsonl，每行一个条目，`id` / `parentId` 串成树；见 omp 的 session.md），不写它。
// 叶子（当前位置）= 文件里最后一个条目：omp 往文件里追加的每个条目都挂在当时的叶子下面，重新打开会话时叶子也是最后一个条目
// （实测 omp 18.12.5：/tree 里 `current` 就是文件的最后一个条目）。
// 例外：`/tree` 在进程内移动叶子，移动本身不写文件，下一个新条目出现之前文件看不出来；`LeafOverride` 就是给这段空档用的
// （studio 自己发起的回溯会记下来，见 TspRunner.rewindTo）。
import { readFile, stat } from "node:fs/promises";
import type { SessionTreeNode } from "../../shared/ipc.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { buildSessionTree, userEntryText } from "../tasks/session-tree.ts";

/** 会话文件超过这个大小就不读了（树面板打开时整份读进内存）。 */
const MAX_SESSION_FILE_BYTES = 256 * 1024 * 1024;

export interface SessionEntry {
  id: string;
  parentId: string | null;
  raw: Record<string, unknown>;
}

/** 文件里叶子被 `/tree` 移到了别处、但还没有新条目的那段空档：文件最后一个条目还是 `afterEntryId` 时，叶子算 `leafId`。 */
export interface LeafOverride {
  afterEntryId: string;
  leafId: string | null;
}

/**
 * 会话文件内容 → 条目（按文件顺序）。第一行 `title`、第二行 `session` 是文件头，没有 parentId、不是树的一部分，跳过。
 * 写到一半的最后一行跳过；中间的坏行说明文件坏了，抛错（不悄悄丢掉）。
 */
export function parseSessionEntries(text: string): SessionEntry[] {
  const lines = text.split("\n");
  const entries: SessionEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const isLast = lines.slice(index + 1).every((rest) => rest.trim() === "");
      if (isLast) continue;
      throw new Error(`session file line ${index + 1} is not valid JSON: ${String(error)}`, { cause: error });
    }
    if (!isRecord(parsed)) continue;
    const type = parsed["type"];
    if (type === "session" || type === "title") continue;
    const id = parsed["id"];
    if (typeof id !== "string") continue;
    const parentId = parsed["parentId"];
    entries.push({ id, parentId: typeof parentId === "string" ? parentId : null, raw: parsed });
  }
  return entries;
}

interface LinkedNode {
  entry: Record<string, unknown>;
  children: LinkedNode[];
}

/** 条目 → `{entry, children}` 嵌套（和 rpc 的 get_tree 同一形状，直接用 buildSessionTree）。没有父的和父不在文件里的当根。 */
function linkEntries(entries: readonly SessionEntry[]): LinkedNode[] {
  const nodes = new Map<string, LinkedNode>();
  for (const entry of entries) nodes.set(entry.id, { entry: entry.raw, children: [] });
  const roots: LinkedNode[] = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id) as LinkedNode;
    const parent = entry.parentId !== null && entry.parentId !== entry.id ? nodes.get(entry.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** 文件的叶子：最后一个条目（有 `override` 且文件还没往下长时用它）。没有条目为 null。 */
export function fileLeafId(entries: readonly SessionEntry[], override?: LeafOverride | null): string | null {
  const last = entries[entries.length - 1];
  if (last === undefined) return null;
  if (override && override.afterEntryId === last.id) return override.leafId;
  return last.id;
}

/** 条目 → 会话树面板的节点（先序展开的用户消息）。 */
export function buildTreeFromEntries(
  entries: readonly SessionEntry[],
  override?: LeafOverride | null,
): SessionTreeNode[] {
  return buildSessionTree(linkEntries(entries), fileLeafId(entries, override));
}

/** 会话文件内容 → 会话树面板的节点。 */
export function buildTreeFromSessionText(text: string, override?: LeafOverride | null): SessionTreeNode[] {
  return buildTreeFromEntries(parseSessionEntries(text), override);
}

/** 读会话文件的条目（只读）。文件不存在抛 ENOENT 原样的错（会话文件在第一条回复之后才落盘，调用方自己决定怎么当）。 */
export async function readSessionEntries(file: string): Promise<SessionEntry[]> {
  const { size } = await stat(file);
  if (size > MAX_SESSION_FILE_BYTES) throw new Error(`session file is too large to read (${size} bytes)`);
  return parseSessionEntries(await readFile(file, "utf8"));
}

/** 回溯目标：一条用户消息（完整文字、父条目）和回溯时文件最后一个条目（LeafOverride 的 afterEntryId）。 */
export interface RewindTarget {
  parentId: string | null;
  text: string;
  lastEntryId: string | null;
}

/** 条目 id → 回溯目标；不是用户消息（或不存在）为 null。文字不截断。 */
export function findUserEntry(entries: readonly SessionEntry[], entryId: string): RewindTarget | null {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (entry === undefined || userEntryText(entry.raw) === null) return null;
  return {
    parentId: entry.parentId,
    text: fullUserText(entry.raw),
    lastEntryId: entries[entries.length - 1]?.id ?? null,
  };
}

/** 用户消息的完整文字（文本块用换行连起来）；回溯后放进 studio 输入框的就是它。 */
function fullUserText(entry: Record<string, unknown>): string {
  const message = entry["message"];
  if (!isRecord(message)) return "";
  const content = message["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block: unknown) =>
      isRecord(block) && block["type"] === "text" && typeof block["text"] === "string" ? [block["text"]] : [],
    )
    .join("\n");
}

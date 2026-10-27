// TSP 任务的会话树：只读 omp 的会话文件（jsonl，每行一个条目，`id` / `parentId` 串成树；见 omp 的 session.md），不写它。
// 叶子（当前位置）= 文件里最后一个条目：omp 往文件里追加的每个条目都挂在当时的叶子下面，重新打开会话时叶子也是最后一个条目
// （实测 omp 18.12.5：/tree 里 `current` 就是文件的最后一个条目）。
// 例外：`/tree` 在进程内移动叶子，移动本身不写文件，下一个新条目出现之前文件看不出来；`LeafOverride` 就是给这段空档用的
// （studio 自己发起的回溯会记下来，见 TspRunner.rewindTo）。
import type { SessionTreeNode } from "../../shared/ipc.ts";
import { isRecord } from "../../shared/type-guards.ts";
import { buildSessionTree, userEntryText } from "../tasks/session-tree.ts";
import {
  feedSessionText,
  SessionReaderCache,
  type SessionEntryConsumer,
  type SessionFileEntry,
} from "./session-file-reader.ts";

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
 * 按文件顺序接收记录、给出树的条目。第一行 `title`、第二行 `session` 是文件头，没有 parentId、不是树的一部分，跳过。
 * 坏行后面还有内容说明文件坏了（`entries()` 抛错，不悄悄丢掉）；写到一半的最后一行跳过。
 * 树、回溯、标签只读用户消息、压缩点、分支摘要、标签条目的内容：其余条目（助手消息、工具结果，会话文件的大头）
 * 只留 type / id / parentId，缓存住的条目不占几十 MB。
 */
class SessionEntriesAccumulator implements SessionEntryConsumer {
  #entries: SessionEntry[] = [];
  /** 刚读到一行坏行：后面再有内容就是文件坏了。 */
  #pendingInvalid = false;
  #corrupt = false;

  entry(raw: SessionFileEntry): void {
    if (this.#pendingInvalid) this.#corrupt = true;
    const type = raw["type"];
    if (type === "session" || type === "title") return;
    const id = raw["id"];
    if (typeof id !== "string") return;
    const parentId = typeof raw["parentId"] === "string" ? raw["parentId"] : null;
    const kept =
      type === "compaction" || type === "branch_summary" || type === "label" || userEntryText(raw) !== null
        ? raw
        : { type, id, parentId };
    this.#entries.push({ id, parentId, raw: kept });
  }

  invalid(): void {
    if (this.#pendingInvalid) this.#corrupt = true;
    this.#pendingInvalid = true;
  }

  reset(): void {
    this.#entries = [];
    this.#pendingInvalid = false;
    this.#corrupt = false;
  }

  /** 到目前为止的条目（一份拷贝，之后的追加不影响它）。 */
  entries(): SessionEntry[] {
    if (this.#corrupt) throw new Error("session file has a line that is not valid JSON before its end");
    return this.#entries.slice();
  }
}

/** 会话文件内容 → 条目（按文件顺序），规则见 SessionEntriesAccumulator。 */
export function parseSessionEntries(text: string): SessionEntry[] {
  const accumulator = new SessionEntriesAccumulator();
  feedSessionText(text, [accumulator]);
  return accumulator.entries();
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

/** 树面板、回溯、标签反复读同一个会话文件：缓存增量读取器，只读新追加的完整行，分块读不长时间占住主进程。 */
const entryReaders = new SessionReaderCache(() => new SessionEntriesAccumulator());

/** 读会话文件的条目（只读）。文件还不存在（第一条回复之后才落盘）时为空。 */
export async function readSessionEntries(file: string): Promise<SessionEntry[]> {
  return (await entryReaders.read(file)).entries();
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

/** 条目 id 是不是面板里能打标签的节点：用户消息、压缩点、分支摘要（助手消息等面板不显示，标签也看不到）。 */
export function isLabellableEntry(entries: readonly SessionEntry[], entryId: string): boolean {
  const entry = entries.find((candidate) => candidate.id === entryId);
  if (entry === undefined) return false;
  const type = entry.raw["type"];
  return type === "compaction" || type === "branch_summary" || userEntryText(entry.raw) !== null;
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

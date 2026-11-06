// 会话文件的共用增量读取：一个文件一个读取器，读一遍、每行 JSON.parse 一次，同时喂给几个累加器：
// token 合计和按模型用量（history/session-usage.ts）、每轮脚注（session-extras.ts）、会话标题（SessionTitleTracker）。
// 任务 runner 和按模型用量的 IPC 查的是同一个文件时共用它，不各读各的。会话树条目不在这里（session-tree-file.ts 自己的有界缓存）：
// 树的累加器留着用户消息的整条内容（含图片），任务一直占着的读取器不能带着它。
// 用量要每一条带 id 的记录（沿 parentId 走分支），所以没有可以不解析就跳过的行。
import type { SessionModelUsage } from "../../shared/ipc.ts";
import { SessionUsageAccumulator } from "../history/session-usage.ts";
import { SessionExtrasAccumulator } from "./session-extras.ts";
import { SessionReaderCache, type SessionEntryConsumer, type SessionFileEntry } from "./session-file-reader.ts";

/**
 * omp 记下的会话标题。omp 每次定标题（自动生成、`/rename`）都在文件末尾追加一条 `title_change`（omp 18.16 实测），
 * 同时重写文件开头的标题槽；增量读只看追加的部分，所以以最后一条 `title_change` 为准，没有时用标题槽、再用会话头。
 * 任务标题以它为准，不信终端标题：ConPTY 把伪终端里任何进程改的控制台标题（cmd、PowerShell、npm）都转成 OSC 0（issue #8）。
 */
export class SessionTitleTracker implements SessionEntryConsumer {
  #changed: string | null = null;
  #slot: string | null = null;
  #header: string | null = null;

  entry(entry: SessionFileEntry): void {
    const title = entry["title"];
    if (typeof title !== "string") return;
    if (entry["type"] === "title_change") this.#changed = title;
    else if (entry["type"] === "title") this.#slot = title;
    else if (entry["type"] === "session") this.#header = title;
  }

  reset(): void {
    this.#changed = this.#slot = this.#header = null;
  }

  /** 原文（可能带图标字形）；还没有标题为 null。 */
  current(): string | null {
    return this.#changed ?? this.#slot ?? this.#header;
  }
}

/** 一个会话文件读到目前为止的累加器；同步取结果，不要跨 await 持有。 */
export interface SessionFileState {
  usage: SessionUsageAccumulator;
  extras: SessionExtrasAccumulator;
  title: SessionTitleTracker;
}

const sessionFiles = new SessionReaderCache<SessionFileState>(() => ({
  usage: new SessionUsageAccumulator(),
  extras: new SessionExtrasAccumulator(),
  title: new SessionTitleTracker(),
}));

/** 把 file 新追加的完整行读进累加器。文件不存在（第一条回复之后才落盘）时累加器为空；超过 MAX_SESSION_FILE_BYTES 抛错。 */
export function readSessionFile(file: string): Promise<SessionFileState> {
  return sessionFiles.read(file);
}

/** 任务的当前会话文件：占住它的读取器（不被别的文件挤出缓存），会话文件换了或任务移除时调返回的函数释放。 */
export function holdSessionFile(file: string): () => void {
  return sessionFiles.hold(file);
}

/** 按模型的用量浮层、会话信息用。没有会话文件是空表。 */
export async function readSessionUsage(file: string | null): Promise<SessionModelUsage> {
  if (file === null) return new SessionUsageAccumulator().summary();
  return (await readSessionFile(file)).usage.summary();
}

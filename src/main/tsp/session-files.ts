// 会话文件的共用增量读取：一个文件一个读取器，读一遍、每行 JSON.parse 一次，同时喂给两个累加器：
// token 合计和按模型用量（history/session-usage.ts）、每轮脚注（session-extras.ts）。任务 runner 和按模型用量的 IPC
// 查的是同一个文件时共用它，不各读各的。会话树条目不在这里（session-tree-file.ts 自己的有界缓存）：树的累加器留着用户消息的
// 整条内容（含图片），任务一直占着的读取器不能带着它。
// 两个累加器都要每一条带 id 的记录（用量沿 parentId 走分支），所以没有可以不解析就跳过的行。
import type { SessionModelUsage } from "../../shared/ipc.ts";
import { SessionUsageAccumulator } from "../history/session-usage.ts";
import { SessionExtrasAccumulator } from "./session-extras.ts";
import { SessionReaderCache } from "./session-file-reader.ts";

/** 一个会话文件读到目前为止的累加器；同步取结果，不要跨 await 持有。 */
export interface SessionFileState {
  usage: SessionUsageAccumulator;
  extras: SessionExtrasAccumulator;
}

const sessionFiles = new SessionReaderCache<SessionFileState>(() => ({
  usage: new SessionUsageAccumulator(),
  extras: new SessionExtrasAccumulator(),
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

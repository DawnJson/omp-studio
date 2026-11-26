// 任务的 omp 在同一个进程里因为回溯离开的会话文件（docs/architecture/session-tree.md「omp 19.2 的回溯换新会话文件」）。
// omp 19.2 起 Esc Esc、`/branch`、用户消息上的 Edit / Retry、回答上的 Fork 都把会话搬到一个新文件（头里 `parentSession` = 原文件路径），
// 原文件原样留着；toast 上的 Undo 再回到原文件，刚才的新文件留下。这些留下的文件是同一个任务的过去，不该在侧栏另成一行：
// 记进任务记录（`TaskRecord.leftSessionFiles`），会话列表不列它们（history/session-summaries.ts）。
// `/new`、`/resume` 换到的会话和原文件没有这层关系，不算。
import { readSessionHeader } from "../session-info/session-header.ts";
import { pathKey } from "./task-registry.ts";

/** 从 `from` 换到 `to` 是回溯（`to` 的父会话是 `from`）或撤销回溯（`from` 的父会话是 `to`）：omp 写的父会话是文件路径。 */
export async function isRewindSwitch(from: string, to: string): Promise<boolean> {
  const [fromHeader, toHeader] = await Promise.all([readSessionHeader(from), readSessionHeader(to)]);
  const parentIs = (parent: string | null | undefined, file: string) =>
    parent != null && pathKey(parent) === pathKey(file);
  return parentIs(toHeader?.parentSession, from) || parentIs(fromHeader?.parentSession, to);
}

/** 换到 `to` 之后留下的文件：`to` 本身不算（撤销回溯回到了它）；`left` 是这次留下的（不是回溯时为 null）。没变化时返回 null。 */
export function nextLeftSessionFiles(
  current: readonly string[] | undefined,
  to: string,
  left: string | null,
): readonly string[] | null {
  const base = current ?? [];
  const toKey = pathKey(to);
  let next = base.filter((file) => pathKey(file) !== toKey);
  if (left !== null && !next.some((file) => pathKey(file) === pathKey(left))) next = [...next, left];
  return next.length === base.length && next.every((file, i) => file === base[i]) ? null : next;
}

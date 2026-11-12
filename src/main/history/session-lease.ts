// 会话是不是正被别的 omp 进程占着：`omp session lease --json -- <id>`（omp://session.md「Persistence」：只观察、不占用、
// 不会让对方分叉），输出 `{"held":[...],"unknown":[...]}`。删除会话前用（TaskPool.deleteTask 的临时进程路径）：
// omp 18.18.6 实测，别的进程占着租约时另一个 omp 里的 `/delete` 照样说 `Session deleted`，文件却没删、还被截成半个，恢复不了
// （docs/architecture/session-history.md「删除会话」）。任务 `--resume` 已有会话文件前也用（TspRunner 的 session_in_use）：别的进程占着时
// omp 不报错，而是第一次写盘时把整段对话悄悄搬到新文件（omp://session.md）。
import { readSessionHeader } from "../session-info/session-header.ts";
import { requireSuccess, type RunOmp } from "../usage/usage-service.ts";

/** `omp session lease --json` 的输出里 `id` 在 `held` 里；格式不对抛错（宁可不删，也不在拿不准时删）。 */
export function parseSessionLease(stdout: string, sessionId: string): boolean {
  const parsed: unknown = JSON.parse(stdout);
  const held = (parsed as { held?: unknown } | null)?.held;
  if (!Array.isArray(held)) throw new Error("unexpected output from omp session lease");
  return held.includes(sessionId);
}

/** 会话文件对应的会话正被某个 omp 进程写着。读不出会话头（不是会话文件）时抛错。 */
export async function sessionLeaseHeld(run: RunOmp, sessionFile: string): Promise<boolean> {
  const header = await readSessionHeader(sessionFile);
  if (header === null) throw new Error("not an omp session file");
  const result = await run(["session", "lease", "--json", "--", header.id]);
  requireSuccess("omp session lease", result);
  return parseSessionLease(result.stdout, header.id);
}

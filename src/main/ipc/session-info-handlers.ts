// 会话信息对话框、请求记录、分享的 IPC。数据来源和取舍见 docs/architecture/session-history.md "会话信息"：
// 会话文件头 + 置顶文件 + 会话文件算的用量（和输入框同口径）都只读；请求记录读 stats.db（只读）；分享经 `omp share`（会上传，界面先确认）。参数一律是 unknown，先校验再用，路径由主进程按任务 id 查表。
import type { HandlerGroup, SessionHeaderInfo } from "../../shared/ipc.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { readSessionUsage } from "../history/session-usage.ts";
import { readyOmp } from "../omp-manager/index.ts";
import { listJson, runOmpConfig } from "../omp-config/config-service.ts";
import { readSessionHeader } from "../session-info/session-header.ts";
import { readSessionPins } from "../session-info/session-pins.ts";
import { readShareSettings, shareSession } from "../session-info/share.ts";
import { readSessionTrace } from "../session-info/session-stats.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { runOmpCommand, statsDbPath } from "../usage/usage-service.ts";
import { syncStatsDb } from "./usage-handlers.ts";
import { parseBoolean, parseTaskId } from "./validate.ts";

/** 上传和加密都在本机和网络上，大会话要几秒；给足时间，超时杀进程。 */
const SHARE_TIMEOUT_MS = 2 * 60 * 1000;

/** refresh 时先让 omp 同步 stats.db；同步失败照常抛（界面显示原因），不拿旧数据冒充新的。 */
async function maybeSync(refresh: boolean): Promise<void> {
  if (refresh) await syncStatsDb();
}

export const sessionInfoHandlers: HandlerGroup<
  "getTaskSessionInfo" | "getTaskSessionTrace" | "getShareSettings" | "shareTask"
> = {
  async getTaskSessionInfo(taskId) {
    const id = parseTaskId(taskId);
    const pool = await getTaskPool();
    const context = pool.taskGitContext(id);
    const sessionFile = pool.sessionFileOf(id);
    const parsed = sessionFile === null ? null : await readSessionHeader(sessionFile);
    const pins = await readSessionPins(resolveAgentDir());
    const { id: sessionId, ...header } = parsed ?? { id: null };
    return {
      sessionId,
      sessionFile,
      header: parsed === null ? null : (header as SessionHeaderInfo),
      pinned: sessionId !== null && pins.has(sessionId),
      projectPath: context.projectPath,
      worktree: context.worktree,
      usage: await readSessionUsage(sessionFile),
    };
  },

  async getTaskSessionTrace(taskId, refresh) {
    const id = parseTaskId(taskId);
    const doRefresh = parseBoolean(refresh, "refresh");
    const sessionFile = (await getTaskPool()).sessionFileOf(id);
    await maybeSync(doRefresh);
    if (sessionFile === null) return { hasDatabase: true, requests: [], truncated: false };
    return readSessionTrace(statsDbPath(), sessionFile);
  },

  async getShareSettings(taskId) {
    const id = parseTaskId(taskId);
    const { cwd } = (await getTaskPool()).taskGitContext(id);
    // 在任务目录下读：项目层配置可以改 share.*。
    return readShareSettings(await listJson(runOmpConfig(readyOmp().path, cwd)));
  },

  async shareTask(taskId, gist) {
    const id = parseTaskId(taskId);
    const useGist = parseBoolean(gist, "gist");
    const sessionFile = (await getTaskPool()).sessionFileOf(id);
    if (sessionFile === null) throw new Error("这个任务还没有会话文件，没有可分享的内容");
    const { cwd } = (await getTaskPool()).taskGitContext(id);
    return shareSession(runOmpCommand(readyOmp().path, cwd, SHARE_TIMEOUT_MS), sessionFile, useGist);
  },
};

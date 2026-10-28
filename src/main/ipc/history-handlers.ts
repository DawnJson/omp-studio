// 会话历史：只读 omp 的会话目录建索引（src/main/history），恢复会话交给任务池。参数一律是 unknown，先校验再用。
import { stat } from "node:fs/promises";
import { shell } from "electron";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { readSessionHead, resolveAgentDir, SessionIndex } from "../history/session-index.ts";
import { buildSessionSummaries } from "../history/session-summaries.ts";
import { readSessionUsage } from "../tsp/session-files.ts";
import { readSessionPins } from "../session-info/session-pins.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { parseProjectId, parseString, parseTaskId } from "./validate.ts";

const index = new SessionIndex();

async function findLiveSession(sessionId: unknown) {
  const id = parseString(sessionId, "sessionId", 200);
  const session = await index.findById(id);
  if (session === null) throw new Error("找不到这个会话，它的文件可能已被移动或删除");
  // 会话必须用自己的 cwd 启动（omp 拒绝跨项目切换）；目录没了就报错，不替用户迁移会话。
  const cwdInfo = await stat(session.cwd).catch(() => null);
  if (cwdInfo === null || !cwdInfo.isDirectory()) throw new Error(`会话的项目目录已不存在：${session.cwd}`);
  return session;
}

export const historyHandlers: HandlerGroup<
  | "listSessions"
  | "resumeSession"
  | "ensureSessionProject"
  | "revealProject"
  | "revealTaskSession"
  | "getTaskSessionRef"
  | "getSessionModelUsage"
  | "listSlashCommands"
> = {
  async listSlashCommands(taskId) {
    const pool = await getTaskPool();
    return taskId === null ? pool.listDraftSlashCommands() : pool.listSlashCommands(parseTaskId(taskId));
  },

  async listSessions(projectId) {
    const pool = await getTaskPool();
    const wanted = projectId === null ? null : parseProjectId(projectId);
    const { sessions } = await index.scan();
    const pins = await readSessionPins(resolveAgentDir());
    return buildSessionSummaries(sessions, pool.listProjects(), pool.listSessionLinks(), wanted, pins);
  },

  async resumeSession(sessionId) {
    const session = await findLiveSession(sessionId);
    const pool = await getTaskPool();
    const project = await pool.ensureProject(session.cwd);
    return pool.resume({
      sessionFile: session.file,
      cwd: session.cwd,
      projectId: project.id,
      title: session.title,
      modifiedAt: session.modifiedAt,
    });
  },

  async ensureSessionProject(sessionId) {
    const session = await findLiveSession(sessionId);
    return (await getTaskPool()).ensureProject(session.cwd);
  },

  async revealProject(projectId) {
    const id = parseProjectId(projectId);
    const project = (await getTaskPool()).listProjects().find((candidate) => candidate.id === id);
    if (project === undefined) throw new Error("项目不存在");
    // 打开文件夹本身（showItemInFolder 打开的是上一级并选中它）。openPath 返回错误文本，空串 = 成功。
    const error = await shell.openPath(project.path);
    if (error !== "") throw new Error(error);
  },

  async revealTaskSession(taskId) {
    const file = (await getTaskPool()).sessionFileOf(parseTaskId(taskId));
    if (file === null) throw new Error("这个任务还没有会话文件");
    await stat(file);
    shell.showItemInFolder(file);
  },

  async getTaskSessionRef(taskId) {
    const file = (await getTaskPool()).sessionFileOf(parseTaskId(taskId));
    if (file === null) return null;
    const info = await stat(file).catch(() => null);
    if (info === null) return null;
    const head = await readSessionHead(file, info.size);
    return head === null ? null : { sessionId: head.id, sessionFile: file };
  },

  async getSessionModelUsage(taskId) {
    return readSessionUsage((await getTaskPool()).sessionFileOf(parseTaskId(taskId)));
  },
};

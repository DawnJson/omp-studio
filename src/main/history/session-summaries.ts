// 把索引项和任务池的项目/任务对上，得到界面用的 SessionSummary。纯函数，不碰文件系统和 electron。
import type { Project, ProjectId, SessionSummary, TaskId } from "../../shared/ipc.ts";
import { pathKey, type IndexedSession } from "./session-index.ts";

export interface SessionLink {
  id: TaskId;
  sessionFile: string | null;
}

/**
 * projectId 为 null 时返回全部会话，否则只返回 cwd 等于该项目目录的会话。
 * 没有标题也没有任何用户消息的会话（刚启动就退出的空壳）不列出，和 omp 自己的会话选择器一致。
 */
export function buildSessionSummaries(
  sessions: readonly IndexedSession[],
  projects: readonly Project[],
  links: readonly SessionLink[],
  projectId: ProjectId | null,
): SessionSummary[] {
  const projectByCwd = new Map(projects.map((project) => [pathKey(project.path), project.id]));
  const taskByFile = new Map<string, TaskId>();
  for (const link of links) {
    if (link.sessionFile !== null) taskByFile.set(pathKey(link.sessionFile), link.id);
  }
  const wanted = projectId === null ? null : projects.find((project) => project.id === projectId);
  if (wanted === undefined) return [];
  const wantedKey = wanted === null ? null : pathKey(wanted.path);

  const result: SessionSummary[] = [];
  for (const session of sessions) {
    if (session.title === null && session.firstPrompt === null) continue;
    const cwdKey = pathKey(session.cwd);
    if (wantedKey !== null && cwdKey !== wantedKey) continue;
    result.push({
      id: session.id,
      title: session.title,
      firstPrompt: session.firstPrompt,
      cwd: session.cwd,
      projectId: projectByCwd.get(cwdKey) ?? null,
      modifiedAt: session.modifiedAt,
      taskId: taskByFile.get(pathKey(session.file)) ?? null,
    });
  }
  return result;
}

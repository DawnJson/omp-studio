// 把索引项和任务池的项目/任务对上，得到界面用的 SessionSummary。纯函数，不碰文件系统和 electron。
import type { Project, ProjectId, SessionSummary, TaskId } from "../../shared/ipc.ts";
import { pathKey } from "../tasks/task-registry.ts";
import type { IndexedSession } from "./session-index.ts";

export interface SessionLink {
  id: TaskId;
  sessionFile: string | null;
  archived: boolean;
}

/**
 * projectId 为 null 时返回全部会话，否则只返回 cwd 等于该项目目录的会话。
 * 没有标题也没有任何用户消息的会话（刚启动就退出的空壳）不列出，和 omp 自己的会话选择器一致。
 * `pins`：omp 的 session-pins.json 里的会话 id（只读，见 session-info/session-pins.ts）。
 * parentId：会话头的 parentSession 是 id 或文件路径（omp 两种都写），在全部索引里按 id、再按路径找，找不到为 null。
 */
export function buildSessionSummaries(
  sessions: readonly IndexedSession[],
  projects: readonly Project[],
  links: readonly SessionLink[],
  projectId: ProjectId | null,
  pins: ReadonlySet<string>,
): SessionSummary[] {
  const projectByCwd = new Map(projects.map((project) => [pathKey(project.path), project.id]));
  const linkByFile = new Map<string, SessionLink>();
  for (const link of links) {
    if (link.sessionFile !== null) linkByFile.set(pathKey(link.sessionFile), link);
  }
  const ids = new Set(sessions.map((session) => session.id));
  const idByFile = new Map(sessions.map((session) => [pathKey(session.file), session.id]));
  const parentOf = (parent: string | null): string | null =>
    parent === null ? null : ids.has(parent) ? parent : (idByFile.get(pathKey(parent)) ?? null);
  const wanted = projectId === null ? null : projects.find((project) => project.id === projectId);
  if (wanted === undefined) return [];
  const wantedKey = wanted === null ? null : pathKey(wanted.path);

  const result: SessionSummary[] = [];
  for (const session of sessions) {
    if (session.title === null && session.firstPrompt === null) continue;
    const cwdKey = pathKey(session.cwd);
    if (wantedKey !== null && cwdKey !== wantedKey) continue;
    const link = linkByFile.get(pathKey(session.file));
    const parentId = parentOf(session.parent);
    result.push({
      id: session.id,
      title: session.title,
      firstPrompt: session.firstPrompt,
      lastTurn: session.lastTurn,
      cwd: session.cwd,
      projectId: projectByCwd.get(cwdKey) ?? null,
      modifiedAt: session.modifiedAt,
      taskId: link !== undefined && !link.archived ? link.id : null,
      archived: link?.archived === true,
      parentId: parentId === session.id ? null : parentId,
      pinned: pins.has(session.id),
    });
  }
  return result;
}

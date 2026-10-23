// 输入历史的项目范围存储（渲染进程这一份是主进程 userData/input-history.json 的镜像）：用到某个项目时向主进程读一次，
// 发送时先改内存、再通知主进程落盘。ComposerInput 的 ↑ 翻看和 Ctrl+R 搜索浮层读同一份（条目合并规则见 input-history.ts）。
import { useEffect } from "react";
import { pushEntry } from "../../../../shared/input-history.ts";
import type { ProjectId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";

const projects = createStore<Readonly<Record<string, readonly string[]>>>({});
const none: readonly string[] = [];
/** 已经向主进程读过（或正在读）的项目。 */
const requested = new Set<string>();

function load(projectId: ProjectId): void {
  if (requested.has(projectId)) return;
  requested.add(projectId);
  window.studio.getInputHistory(projectId).then(
    (saved) => {
      // 读回来之前这个项目已经发过的（内存里有）接在后面，不丢。
      const local = projects.get()[projectId] ?? none;
      const merged = local.reduce<readonly string[]>((entries, text) => pushEntry(entries, text), saved);
      projects.set({ ...projects.get(), [projectId]: merged });
    },
    (error: unknown) => {
      requested.delete(projectId);
      reportErrorNow(error);
    },
  );
}

/** 这个项目发过的消息（从旧到新）；没有项目（还没读到）时是空数组（稳定引用）。第一次用到某个项目时去主进程读。 */
export function useProjectHistory(projectId: ProjectId | null): readonly string[] {
  useEffect(() => {
    if (projectId !== null) load(projectId);
  }, [projectId]);
  return useStoreValue(projects, (state) => (projectId === null ? none : (state[projectId] ?? none)));
}

/** 发送前调用：记进内存，并让主进程落盘（空的、太长的、和上一条相同的不记）。 */
export function recordHistory(projectId: ProjectId, text: string): void {
  const before = projects.get()[projectId] ?? none;
  const after = pushEntry(before, text);
  if (after.length === before.length && after.at(-1) === before.at(-1)) return;
  projects.set({ ...projects.get(), [projectId]: after });
  window.studio.recordInputHistory(projectId, text).catch(reportErrorNow);
}

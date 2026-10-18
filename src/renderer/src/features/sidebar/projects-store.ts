// 项目列表的渲染进程镜像。主进程没有项目变更事件，所以在这几个时机重新取：侧栏挂载、增删项目之后、
// 出现了列表里没有的 projectId 的任务（恢复历史会话时主进程会自动加入项目）。
import type { Project } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

interface ProjectsState {
  loaded: boolean;
  error: string | null;
  list: readonly Project[];
}

const projectsStore = createStore<ProjectsState>({ loaded: false, error: null, list: [] });

export async function refreshProjects(): Promise<void> {
  try {
    const list = await window.studio.listProjects();
    projectsStore.set({ loaded: true, error: null, list });
  } catch (error) {
    projectsStore.set({ ...projectsStore.get(), error: error instanceof Error ? error.message : String(error) });
  }
}

export function useProjectsState(): ProjectsState {
  return useStoreValue(projectsStore, (state) => state);
}

export function useProjects(): readonly Project[] {
  return useStoreValue(projectsStore, (state) => state.list);
}

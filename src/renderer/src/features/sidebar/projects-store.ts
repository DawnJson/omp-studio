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

/** 全部项目，含移出列表的（hidden）：侧栏、命令面板用它把那些文件夹里的任务和会话一起藏起来。 */
export function useProjectsState(): ProjectsState {
  return useStoreValue(projectsStore, (state) => state);
}

const shownCache = new WeakMap<readonly Project[], readonly Project[]>();

/** 列表里显示着的项目（不含移出列表的）：选项目、设置里的作用域都用它。 */
export function useProjects(): readonly Project[] {
  return useStoreValue(projectsStore, (state) => {
    let shown = shownCache.get(state.list);
    if (shown === undefined) {
      shown = state.list.filter((project) => !project.hidden);
      shownCache.set(state.list, shown);
    }
    return shown;
  });
}

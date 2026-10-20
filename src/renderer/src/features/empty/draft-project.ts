// 草稿"要在哪个项目开始新任务"：工具行项目菜单里选的、侧栏项目旁 ＋ 的，或打开 / 拖入文件夹后得到的项目。
// null = 默认文件夹（AppInfo.chatsDir）。
import { createStore, useStoreValue } from "../../store/create-store.ts";
import type { ProjectId } from "../../../../shared/ipc.ts";

const draftProject = createStore<ProjectId | null>(null);

export function pickDraftProject(projectId: ProjectId | null): void {
  draftProject.set(projectId);
}

export function useDraftProjectId(): ProjectId | null {
  return useStoreValue(draftProject, (state) => state);
}

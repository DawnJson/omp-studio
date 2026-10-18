// 空状态里"要在哪个项目开始新任务"：用户在项目菜单里选的，或把文件夹拖进窗口后得到的项目。
// null = 默认（最近有操作的任务所在项目）。
import { createStore, useStoreValue } from "../../store/create-store.ts";
import type { ProjectId } from "../../../../shared/ipc.ts";

const draftProject = createStore<ProjectId | null>(null);

export function pickDraftProject(projectId: ProjectId | null): void {
  draftProject.set(projectId);
}

export function useDraftProjectId(): ProjectId | null {
  return useStoreValue(draftProject, (state) => state);
}

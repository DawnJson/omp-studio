// 空状态的动作：开新任务草稿、选文件夹作为草稿项目。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Project } from "../../../../shared/ipc.ts";
import { clearSelection, showView } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { refreshProjects } from "../sidebar/projects-store.ts";
import { pickDraftProject } from "./draft-project.ts";

/** 新任务草稿：回到空状态（不创建任务，发出第一条消息时才创建）。projectId 为 null 时用默认项目。 */
export function startDraft(projectId: Project["id"] | null = null): void {
  clearSelection();
  showView("conversation");
  pickDraftProject(projectId);
}

/** 弹系统文件夹选择器加入项目，并把它设为草稿的项目。取消时什么也不做。 */
export async function openFolderAsDraft(t: TFunction): Promise<void> {
  try {
    const project = await window.studio.addProject();
    if (project === null) return;
    await refreshProjects();
    pickDraftProject(project.id);
  } catch (error) {
    reportError(t, error);
  }
}

// 空状态的动作：开新任务草稿。
import type { Project } from "../../../../shared/ipc.ts";
import { clearSelection, showView } from "../../store/index.ts";
import { pickDraftProject } from "./draft-project.ts";

/** 新任务草稿：回到空状态（不创建任务，发出第一条消息时才创建）。projectId 为 null 时是默认文件夹。 */
export function startDraft(projectId: Project["id"] | null = null): void {
  clearSelection();
  showView("conversation");
  pickDraftProject(projectId);
}

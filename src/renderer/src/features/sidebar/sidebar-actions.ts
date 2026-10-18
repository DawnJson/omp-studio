// 侧栏和命令面板共用的动作。数据都直接问主进程（listTasks / listProjects），不依赖组件里的 hook，
// 所以全局快捷键（Ctrl N、Ctrl J）也能直接调。失败一律用 toast 说出来，不吞掉。
import { reportError } from "../../ui/errors.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import { selectTask } from "../../store/index.ts";
import { startDraft } from "../empty/index.ts";
import { refreshProjects } from "./projects-store.ts";
import { nextWaitingTask, waitingTasks } from "../../../../shared/ui/sidebar-model.ts";

/** 弹系统文件夹选择器加入项目，并把它设为新任务草稿的项目（不创建任务）。取消时什么也不做。 */
export async function addProjectAsDraft(t: TFunction): Promise<void> {
  try {
    const project = await window.studio.addProject();
    if (project === null) return;
    await refreshProjects();
    startDraft(project.id);
  } catch (error) {
    reportError(t, error);
  }
}

/** Ctrl J：跳到等你确认的任务；已在其中一个时跳到下一个。没有等待的任务时什么也不做。 */
export async function jumpToWaitingTask(current: TaskId | null, t: TFunction): Promise<void> {
  try {
    const target = nextWaitingTask(waitingTasks(await window.studio.listTasks(), new Set()), current);
    if (target !== null) await selectTask(target.id);
  } catch (error) {
    reportError(t, error);
  }
}

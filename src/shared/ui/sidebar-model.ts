// 侧栏的纯数据整理：项目标签、按项目分组、任务排序、等待中的任务。不依赖 React 和 window，可直接单测。
import type { Project, ProjectId, TaskId, TaskState } from "../ipc.ts";
import { lastActivityAt } from "./task-time.ts";

export interface ProjectGroupModel {
  project: Project;
  /** 重名时带上级目录：`上级/名称`。 */
  label: string;
  /** 已按"最近操作"从新到旧排好；归档中的任务已剔除。 */
  tasks: TaskState[];
}

function parentName(projectPath: string): string {
  const parts = projectPath.split(/[\\/]+/).filter((part) => part !== "");
  return parts.length >= 2 ? (parts[parts.length - 2] as string) : "";
}

export function projectLabels(projects: readonly Project[]): Map<ProjectId, string> {
  const nameCount = new Map<string, number>();
  for (const project of projects) nameCount.set(project.name, (nameCount.get(project.name) ?? 0) + 1);
  return new Map(
    projects.map((project) => {
      const parent = (nameCount.get(project.name) ?? 0) > 1 ? parentName(project.path) : "";
      return [project.id, parent === "" ? project.name : `${parent}/${project.name}`];
    }),
  );
}

/** 按"最近活动"（lastActivityAt，与行尾显示的时间同一个字段）从新到旧。 */
export function byRecent(a: TaskState, b: TaskState): number {
  return lastActivityAt(b) - lastActivityAt(a) || b.createdAt - a.createdAt;
}

export function groupTasks(
  projects: readonly Project[],
  tasks: readonly TaskState[],
  hidden: ReadonlySet<TaskId>,
): ProjectGroupModel[] {
  const labels = projectLabels(projects);
  const byProject = new Map<ProjectId, TaskState[]>();
  for (const task of tasks) {
    if (hidden.has(task.id)) continue;
    const bucket = byProject.get(task.projectId);
    if (bucket) bucket.push(task);
    else byProject.set(task.projectId, [task]);
  }
  return projects.map((project) => ({
    project,
    label: labels.get(project.id) ?? project.name,
    tasks: (byProject.get(project.id) ?? []).sort(byRecent),
  }));
}

/** 等你确认的任务，等得最久的在前。 */
export function waitingTasks(tasks: readonly TaskState[], hidden: ReadonlySet<TaskId>): TaskState[] {
  return tasks
    .filter((task) => task.status === "needs_you" && !hidden.has(task.id))
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/** 点"等你确认"条依次跳转：当前选中的就是等待任务时跳到它的下一个（循环），否则跳到最早的。 */
export function nextWaitingTask(waiting: readonly TaskState[], current: TaskId | null): TaskState | null {
  if (waiting.length === 0) return null;
  const at = waiting.findIndex((task) => task.id === current);
  return waiting[at === -1 ? 0 : (at + 1) % waiting.length] ?? null;
}

/** 侧栏里按可见顺序排列的任务（用于 Ctrl 1…9 和命令面板的"最近任务"）。 */
export function visibleOrder(groups: readonly ProjectGroupModel[]): TaskState[] {
  return groups.flatMap((group) => group.tasks);
}

export type DotKind = "running" | "waiting" | "done" | "error" | "none";

/** 状态点的形状：形状是第二信号（色盲友好）。已读完成和空闲不画。 */
export function dotKind(task: TaskState): DotKind {
  if (task.status === "needs_you") return "waiting";
  if (task.status === "error" || (task.status === "idle" && task.lastTurn?.status === "error")) return "error";
  if (task.status === "running" || task.status === "starting") return "running";
  if (task.unread) return "done";
  return "none";
}

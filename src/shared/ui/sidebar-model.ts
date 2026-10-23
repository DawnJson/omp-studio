// 侧栏的纯数据整理：项目标签、任务和历史会话合并成文件夹/时间两种列表、等待中的任务。不依赖 React 和 window，可直接单测。
import type { Project, ProjectId, SessionSummary, TaskId, TaskState } from "../ipc.ts";
import { stripIconGlyphs } from "./clean-title.ts";
import { lastActivityAt } from "./task-time.ts";

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

/** 侧栏列表里的一行：studio 任务或还没挂在任务上的历史会话。 */
export type SidebarItem =
  | { kind: "task"; key: string; at: number; task: TaskState }
  | { kind: "session"; key: string; at: number; session: SessionSummary };

export interface SidebarFolder {
  /** 分组键：规范化后的路径（斜杠统一、去尾斜杠、小写），同一文件夹不同写法归一组。 */
  key: string;
  /** 悬停提示用的原始路径：项目的路径，纯历史文件夹取其中一条会话的 cwd。 */
  cwd: string;
  /** 文件夹名；重名时带上级目录 `上级/名称`。 */
  label: string;
  /** 这个文件夹是 studio 项目时给出；只在历史会话里出现的文件夹为 null。 */
  project: Project | null;
  /** 任务和会话混排，按最近活动从新到旧。 */
  items: SidebarItem[];
}

function folderKey(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? cwd;
}

/** 任务标题：去掉图标字形；空串表示还没有标题。 */
export function taskTitle(task: Pick<TaskState, "title">): string {
  return stripIconGlyphs(task.title);
}

/** 历史会话标题：会话标题，没有就用第一条消息；都没有时为 null。 */
export function sessionTitle(session: Pick<SessionSummary, "title" | "firstPrompt">): string | null {
  for (const raw of [session.title, session.firstPrompt]) {
    const clean = raw === null ? "" : stripIconGlyphs(raw);
    if (clean !== "") return clean;
  }
  return null;
}

/** omp 置顶（`/pin`）的历史会话排在最前，其余按最近活动；任务没有置顶信息，不受影响。 */
function pinRank(item: SidebarItem): number {
  return item.kind === "session" && item.session.pinned ? 0 : 1;
}

function byRecentItem(a: SidebarItem, b: SidebarItem): number {
  return pinRank(a) - pinRank(b) || b.at - a.at || (a.kind === b.kind ? 0 : a.kind === "task" ? -1 : 1);
}

export interface SidebarInput {
  projects: readonly Project[];
  tasks: readonly TaskState[];
  /** 历史会话；已挂在任务上的会话会被忽略（它们就是任务行）。 */
  sessions: readonly SessionSummary[];
  hidden: ReadonlySet<TaskId>;
  /** 标题搜索；空串不过滤。 */
  query: string;
  /** 默认文件夹（AppInfo.chatsDir）；文件夹排列里永远排第一。 */
  defaultCwd?: string | null;
}

function matches(needle: string, title: string | null): boolean {
  return needle === "" || (title ?? "").toLowerCase().includes(needle);
}

/** 时间排列：任务和会话一个平铺列表，按最近活动从新到旧。 */
export function buildTimeline(input: SidebarInput): SidebarItem[] {
  const needle = input.query.trim().toLowerCase();
  const known = new Set(input.projects.map((project) => project.id));
  const items: SidebarItem[] = [];
  for (const task of input.tasks) {
    if (input.hidden.has(task.id) || !known.has(task.projectId) || !matches(needle, taskTitle(task))) continue;
    items.push({ kind: "task", key: `task:${task.id}`, at: lastActivityAt(task), task });
  }
  for (const session of input.sessions) {
    if (session.taskId !== null || !matches(needle, sessionTitle(session))) continue;
    items.push({ kind: "session", key: `session:${session.id}`, at: session.modifiedAt, session });
  }
  return items.sort(byRecentItem);
}

/**
 * 文件夹排列：studio 项目和历史会话的 cwd 按文件夹键合并成一个列表。
 * 文件夹按其中最新的一行从新到旧；没有任何行的项目排在最后（保持项目顺序），搜索时不显示。
 * 默认文件夹（defaultCwd）永远第一个，不受最近活动影响；搜索时它没有匹配行就和别的文件夹一样不显示。
 */
export function buildFolders(input: SidebarInput): SidebarFolder[] {
  const needle = input.query.trim().toLowerCase();
  const folders = new Map<string, SidebarFolder>();
  const projectKey = new Map<ProjectId, string>();
  for (const project of input.projects) {
    const key = folderKey(project.path);
    projectKey.set(project.id, key);
    if (!folders.has(key)) folders.set(key, { key, cwd: project.path, label: project.name, project, items: [] });
  }
  for (const item of buildTimeline(input)) {
    if (item.kind === "task") {
      folders.get(projectKey.get(item.task.projectId) ?? "")?.items.push(item);
      continue;
    }
    const key = folderKey(item.session.cwd);
    const folder = folders.get(key);
    if (folder) folder.items.push(item);
    else
      folders.set(key, {
        key,
        cwd: item.session.cwd,
        label: folderName(item.session.cwd),
        project: null,
        items: [item],
      });
  }
  const list = [...folders.values()].filter((folder) => needle === "" || folder.items.length > 0);
  const nameCount = new Map<string, number>();
  for (const folder of list) nameCount.set(folder.label, (nameCount.get(folder.label) ?? 0) + 1);
  for (const folder of list) {
    const parent = (nameCount.get(folder.label) ?? 0) > 1 ? parentName(folder.cwd) : "";
    if (parent !== "") folder.label = `${parent}/${folder.label}`;
  }
  const newest = (folder: SidebarFolder) => folder.items.reduce((latest, item) => Math.max(latest, item.at), -1);
  const pinned = input.defaultCwd == null ? null : folderKey(input.defaultCwd);
  const rank = (folder: SidebarFolder) => (folder.key === pinned ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || newest(b) - newest(a));
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

export type DotKind = "running" | "waiting" | "done" | "error" | "interrupted" | "none";

/** 状态点的形状：形状是第二信号（色盲友好）。"完成"= 空闲且最后一轮正常结束，看过也一直在；从没跑过、被停止的不画。 */
export function dotKind(task: TaskState): DotKind {
  if (task.status === "needs_you") return "waiting";
  if (task.status === "error" || (task.status === "idle" && task.lastTurn?.status === "error")) return "error";
  if (task.status === "running" || task.status === "starting") return "running";
  if (task.status === "idle" && task.lastTurn?.status === "completed") return "done";
  return "none";
}

/**
 * 历史会话（还没挂在任务上）的状态点：没有进程，只看会话文件最后一条消息的状态（session-index 的口径，同 omp session-listing）。
 * 画"完成"、"失败"和"中断"（轮次中途断掉：停在工具调用 / 长度上限上，可以继续）；被用户停止、最后一条是用户消息、认不出的不画。
 */
export function sessionDotKind(session: Pick<SessionSummary, "lastTurn">): DotKind {
  switch (session.lastTurn) {
    case "completed":
      return "done";
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    default:
      return "none";
  }
}

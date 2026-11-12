// 侧栏的纯数据整理：项目标签、任务和历史会话合并成文件夹/时间两种列表、等待中的任务。不依赖 React 和 window，可直接单测。
import {
  limits,
  type HistoryOrder,
  type Project,
  type ProjectId,
  type SessionSummary,
  type TaskId,
  type TaskState,
} from "../ipc.ts";
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

/**
 * 侧栏列表里的一行：studio 任务或还没挂在任务上的历史会话。depth：分叉出来的会话缩进在原会话下面的层数（0 = 顶层）；
 * parent：缩进在哪一行下面（那一行的 key，顶层为 null）。
 */
export type SidebarItem =
  | { kind: "task"; key: string; at: number; depth: number; parent: string | null; pinned: boolean; task: TaskState }
  | {
      kind: "session";
      key: string;
      at: number;
      depth: number;
      parent: string | null;
      pinned: boolean;
      session: SessionSummary;
    };

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

export function folderKey(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** 两个目录在侧栏里是不是同一个文件夹（不分斜杠方向、大小写，忽略末尾斜杠）。 */
export function sameFolder(a: string, b: string): boolean {
  return folderKey(a) === folderKey(b);
}

function folderName(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? cwd;
}

/** 任务现在有 omp 进程：空闲、在跑或在等你（starting 还在起，stopped / error 没有）。任务菜单和命令面板的"关闭会话"按它显示。 */
export function hasProcess(task: Pick<TaskState, "status">): boolean {
  return task.status === "idle" || task.status === "running" || task.status === "needs_you";
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

/** omp 置顶（`/pin`，`session-pins.json`）的行排在最前，其余按最近活动：历史会话看自己，任务看挂在它上面的会话。 */
function pinRank(item: SidebarItem): number {
  return item.pinned ? 0 : 1;
}

function byRecentItem(a: SidebarItem, b: SidebarItem): number {
  return pinRank(a) - pinRank(b) || b.at - a.at || (a.kind === b.kind ? 0 : a.kind === "task" ? -1 : 1);
}

export interface SidebarInput {
  /** 全部项目，含移出列表的（hidden）：它们的任务和同一目录的历史会话都不列出。 */
  projects: readonly Project[];
  tasks: readonly TaskState[];
  /**
   * listSessions 的全部会话：挂在任务上的（taskId）不单列（它们就是任务行），只用来查任务的会话 id 和分叉关系；
   * 已归档的（archived）不列出。
   */
  sessions: readonly SessionSummary[];
  hidden: ReadonlySet<TaskId>;
  /** 标题搜索；空串不过滤。 */
  query: string;
  /** 默认文件夹（AppInfo.chatsDir）；文件夹排列里永远排第一。 */
  defaultCwd?: string | null;
  /** 用户拖出来的文件夹顺序（文件夹 key，ShellState.folderOrder）；不在里面的是新文件夹，排在默认文件夹后面。 */
  folderOrder?: readonly string[];
}

function matches(needle: string, title: string | null): boolean {
  return needle === "" || (title ?? "").toLowerCase().includes(needle);
}

/** 历史里单独列一行的会话：没挂在任务上、没归档。命令面板的会话列表也用它。 */
export function isListedSession(session: Pick<SessionSummary, "taskId" | "archived">): boolean {
  return session.taskId === null && !session.archived;
}

/** 两个列表共用：显示着的项目的任务 + 列出的历史会话（不在移出列表的文件夹里），按最近活动从新到旧，还没缩进。 */
function collectItems(input: SidebarInput): SidebarItem[] {
  const needle = input.query.trim().toLowerCase();
  const shown = new Set(input.projects.filter((project) => !project.hidden).map((project) => project.id));
  const hiddenFolders = new Set(input.projects.filter((project) => project.hidden).map((p) => folderKey(p.path)));
  const items: SidebarItem[] = [];
  const pinnedTasks = new Set(
    input.sessions.flatMap((session) => (session.taskId !== null && session.pinned ? [session.taskId] : [])),
  );
  for (const task of input.tasks) {
    if (input.hidden.has(task.id) || !shown.has(task.projectId) || !matches(needle, taskTitle(task))) continue;
    items.push({
      kind: "task",
      key: `task:${task.id}`,
      at: lastActivityAt(task),
      depth: 0,
      parent: null,
      pinned: pinnedTasks.has(task.id),
      task,
    });
  }
  for (const session of input.sessions) {
    if (!isListedSession(session) || hiddenFolders.has(folderKey(session.cwd))) continue;
    if (!matches(needle, sessionTitle(session))) continue;
    items.push({
      kind: "session",
      key: `session:${session.id}`,
      at: session.modifiedAt,
      depth: 0,
      parent: null,
      pinned: session.pinned,
      session,
    });
  }
  return items.sort(byRecentItem);
}

/** 缩进最多几层：再深的分叉和这一层对齐，侧栏不被挤窄。 */
const MAX_DEPTH = 3;

/**
 * 分叉的会话排在原会话后面、缩进一层（同一个列表里能找到原会话时；原会话被搜索过滤掉、在别的文件夹、没有会话文件时照常顶层）。
 * 任务的会话 id 和父会话从 `sessions` 里挂在它上面的那一条取。一组（原会话和它下面的分叉）按组里最新的一行排位，
 * 兄弟之间也按各自那一组最新的一行，新的在前：一直在用的分叉连同原会话排在前面，不被旧的原会话拖到后面。有环时环上的都按顶层画。
 */
function nestForks(items: readonly SidebarItem[], sessions: readonly SessionSummary[]): SidebarItem[] {
  const byTask = new Map<TaskId, SessionSummary>();
  for (const session of sessions) if (session.taskId !== null) byTask.set(session.taskId, session);
  const summaryOf = (item: SidebarItem) => (item.kind === "session" ? item.session : byTask.get(item.task.id));
  const bySession = new Map<string, SidebarItem>();
  for (const item of items) {
    const id = summaryOf(item)?.id;
    if (id !== undefined && !bySession.has(id)) bySession.set(id, item);
  }
  const parentOf = (item: SidebarItem): SidebarItem | undefined => {
    const parentId = summaryOf(item)?.parentId;
    const parent = parentId == null ? undefined : bySession.get(parentId);
    return parent === item ? undefined : parent;
  };
  const children = new Map<SidebarItem, SidebarItem[]>();
  for (const item of items) {
    const parent = parentOf(item);
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const latest = new Map<SidebarItem, number>();
  const latestOf = (item: SidebarItem): number => {
    const known = latest.get(item);
    if (known !== undefined) return known;
    latest.set(item, item.at); // 先记自己：有环时不无限递归
    const value = (children.get(item) ?? []).reduce((max, child) => Math.max(max, latestOf(child)), item.at);
    latest.set(item, value);
    return value;
  };
  // 置顶照旧在最前；同为置顶 / 非置顶时按组里最新的一行，一样新保持原来的顺序（sort 稳定）。
  const byLatest = (a: SidebarItem, b: SidebarItem) => pinRank(a) - pinRank(b) || latestOf(b) - latestOf(a);
  const out: SidebarItem[] = [];
  const placed = new Set<SidebarItem>();
  const place = (item: SidebarItem, depth: number, parent: string | null): void => {
    if (placed.has(item)) return;
    placed.add(item);
    out.push(item.depth === depth && item.parent === parent ? item : { ...item, depth, parent });
    for (const child of [...(children.get(item) ?? [])].sort(byLatest))
      place(child, Math.min(depth + 1, MAX_DEPTH), item.key);
  };
  for (const item of items.filter((item) => parentOf(item) === undefined).sort(byLatest)) place(item, 0, null);
  for (const item of items) place(item, 0, null);
  return out;
}

/**
 * "对话"：默认文件夹（defaultCwd，不属于任何项目的任务和会话）里的任务和会话平铺一列，按最近活动从新到旧，分叉缩进在原会话下面。
 * 没有默认文件夹时是空列表。"项目"里不列默认文件夹（2026-11-10 仓库所有者定：分段 [项目 | 对话 | 归档]）。
 */
export function buildChats(input: SidebarInput): SidebarItem[] {
  if (input.defaultCwd == null) return [];
  const fixed = folderKey(input.defaultCwd);
  const projectPath = new Map(input.projects.map((project) => [project.id, project.path]));
  const inChats = (item: SidebarItem) =>
    folderKey(item.kind === "task" ? (projectPath.get(item.task.projectId) ?? "") : item.session.cwd) === fixed;
  return nestForks(collectItems(input).filter(inChats), input.sessions);
}

/** "已归档"：归档了的会话（任务归档后它的会话，和归档的历史会话），按最近活动从新到旧；点开恢复。 */
export function buildArchived(input: Pick<SidebarInput, "sessions" | "query">): SidebarItem[] {
  const needle = input.query.trim().toLowerCase();
  return input.sessions
    .filter((session) => session.archived && matches(needle, sessionTitle(session)))
    .map((session): SidebarItem => ({
      kind: "session",
      key: `session:${session.id}`,
      at: session.modifiedAt,
      depth: 0,
      parent: null,
      pinned: session.pinned,
      session,
    }))
    .sort(byRecentItem);
}

/**
 * "项目"分段：studio 项目和历史会话的 cwd 按文件夹键合并成一个列表；移出列表的项目（hidden）和默认文件夹（defaultCwd，在"对话"里）不列。
 * 顺序由用户拖动决定（folderOrder），任务跑完、发消息都不挪文件夹（2026-11-10 仓库所有者定：学 Claude Code，列表不在眼前自己跳）：
 * folderOrder 里没有的新文件夹排在最前（按最新一行从新到旧，空项目在它们最后）；其余按 folderOrder。
 * 搜索时没有匹配行的文件夹不显示；没有行、但有归档会话的项目也不列
 * （里面的都归档了：归档一条还不是项目的目录里的会话会把目录加成项目，不能因此多出一个空文件夹）。
 * 分叉只在同一个文件夹里缩进。
 */
export function buildFolders(input: SidebarInput): SidebarFolder[] {
  const needle = input.query.trim().toLowerCase();
  const folders = new Map<string, SidebarFolder>();
  const projectKey = new Map<ProjectId, string>();
  for (const project of input.projects) {
    if (project.hidden) continue;
    const key = folderKey(project.path);
    projectKey.set(project.id, key);
    if (!folders.has(key)) folders.set(key, { key, cwd: project.path, label: project.name, project, items: [] });
  }
  for (const item of collectItems(input)) {
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
  for (const folder of folders.values()) folder.items = nestForks(folder.items, input.sessions);
  const fixed = input.defaultCwd == null ? null : folderKey(input.defaultCwd);
  const archivedFolders = new Set(
    input.sessions.filter((session) => session.archived).map((session) => folderKey(session.cwd)),
  );
  const list = [...folders.values()].filter(
    (folder) =>
      folder.key !== fixed && (folder.items.length > 0 || (needle === "" && !archivedFolders.has(folder.key))),
  );
  const nameCount = new Map<string, number>();
  for (const folder of list) nameCount.set(folder.label, (nameCount.get(folder.label) ?? 0) + 1);
  for (const folder of list) {
    const parent = (nameCount.get(folder.label) ?? 0) > 1 ? parentName(folder.cwd) : "";
    if (parent !== "") folder.label = `${parent}/${folder.label}`;
  }
  const newest = (folder: SidebarFolder) => folder.items.reduce((latest, item) => Math.max(latest, item.at), -1);
  const position = new Map((input.folderOrder ?? []).map((key, index) => [key, index]));
  const rank = (folder: SidebarFolder) => (position.has(folder.key) ? 1 : 0);
  return list.sort(
    (a, b) => rank(a) - rank(b) || (position.get(a.key) ?? 0) - (position.get(b.key) ?? 0) || newest(b) - newest(a),
  );
}

/**
 * 把显示着的文件夹里还没记下的（新文件夹）记进顺序：放在最前面，保持它们现在的显示顺序。没有新的返回 null。
 * 移出列表、删掉的目录也留在顺序里（再打开时回到原位），超过 limits.folderOrderMax 个时从末尾丢。
 */
export function adoptNewFolders(stored: readonly string[], shown: readonly SidebarFolder[]): string[] | null {
  const known = new Set(stored);
  const added = shown.map((folder) => folder.key).filter((key) => !known.has(key));
  return added.length === 0 ? null : [...added, ...stored].slice(0, limits.folderOrderMax);
}

/**
 * 把文件夹 key 移到显示列表里的第 to 个位置（0 起，按移走之后的列表算），返回新的存储顺序：显示着的按新顺序在前，
 * 没显示的（移出列表的项目、搜索时藏起来的）保持原来的相对顺序接在后面。
 */
export function moveFolder(
  stored: readonly string[],
  shown: readonly SidebarFolder[],
  key: string,
  to: number,
): string[] {
  const keys = shown.map((folder) => folder.key);
  if (!keys.includes(key)) return [...stored];
  const rest = keys.filter((candidate) => candidate !== key);
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, key);
  const visible = new Set(rest);
  return [...rest, ...stored.filter((candidate) => !visible.has(candidate))].slice(0, limits.folderOrderMax);
}

/** 选中的任务、正在跑或等你确认的任务：不能被"显示更多"或收起的分叉藏起来。 */
export function pinnedItem(item: SidebarItem, selectedTaskId: TaskId | null): boolean {
  return (
    item.kind === "task" &&
    (item.task.id === selectedTaskId || item.task.status === "running" || item.task.status === "needs_you")
  );
}

/** 一行下面的分叉：total = 全部后代行数，hidden = 因为收起没画出来的后代行数（展开着为 0）。 */
export interface ForkInfo {
  total: number;
  hidden: number;
}

/**
 * 收起分叉（issue #9，2026-11-09）：`collapsed` 里的行把它下面的整棵分叉藏起来；默认都展开。
 * 选中 / 在跑 / 等你确认的行（pinnedItem）照常显示，通往它的上级也显示（等于自动展开那一条路）；同一个收起行下面别的分叉照样藏着。
 * 返回要画的行（顺序不变）和每个有分叉的行的 ForkInfo；搜索时调用方传空集合。
 */
export function foldForks(
  items: readonly SidebarItem[],
  collapsed: ReadonlySet<string>,
  selectedTaskId: TaskId | null,
): { items: readonly SidebarItem[]; forks: ReadonlyMap<string, ForkInfo> } {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const ancestors = (item: SidebarItem): SidebarItem[] => {
    const chain: SidebarItem[] = [];
    for (let up = item.parent === null ? undefined : byKey.get(item.parent); up !== undefined && !chain.includes(up);) {
      chain.push(up);
      up = up.parent === null ? undefined : byKey.get(up.parent);
    }
    return chain;
  };
  const chains = new Map(items.map((item) => [item, ancestors(item)]));
  const keep = new Set<SidebarItem>();
  for (const item of items) {
    if (!pinnedItem(item, selectedTaskId)) continue;
    keep.add(item);
    for (const up of chains.get(item) ?? []) keep.add(up);
  }
  const forks = new Map<string, ForkInfo>();
  const shown: SidebarItem[] = [];
  for (const item of items) {
    const chain = chains.get(item) ?? [];
    for (const up of chain) {
      const info = forks.get(up.key) ?? { total: 0, hidden: 0 };
      info.total += 1;
      forks.set(up.key, info);
    }
    const folded = chain.filter((up) => collapsed.has(up.key));
    if (folded.length === 0 || keep.has(item)) {
      shown.push(item);
      continue;
    }
    for (const up of folded) {
      const info = forks.get(up.key);
      if (info !== undefined) info.hidden += 1;
    }
  }
  return { items: collapsed.size === 0 ? items : shown, forks };
}

/** 一个列表最后画哪些行：先去掉收起的分叉（foldForks），再取前 limit 行（"显示更多"只数看得见的行）；limit 之后有需要露出的行时，上限抬到它为止。 */
export function visibleItems(
  items: readonly SidebarItem[],
  limit: number,
  selectedTaskId: TaskId | null,
  collapsed: ReadonlySet<string>,
): { shown: readonly SidebarItem[]; remaining: number; forks: ReadonlyMap<string, ForkInfo> } {
  const folded = foldForks(items, collapsed, selectedTaskId);
  let last = -1;
  folded.items.forEach((item, index) => {
    if (pinnedItem(item, selectedTaskId)) last = index;
  });
  const shown = folded.items.slice(0, Math.max(limit, last + 1));
  return { shown, remaining: folded.items.length - shown.length, forks: folded.forks };
}

/** 等你确认的任务，等得最久的在前。移出列表的文件夹（Project.hidden）里的不算：侧栏不画它们，"下一个" / Ctrl J 不会选中看不到的任务。 */
export function waitingTasks(
  tasks: readonly TaskState[],
  projects: readonly Pick<Project, "id" | "hidden">[],
  hidden: ReadonlySet<TaskId>,
): TaskState[] {
  const shown = new Set(projects.filter((project) => !project.hidden).map((project) => project.id));
  return tasks
    .filter((task) => task.status === "needs_you" && shown.has(task.projectId) && !hidden.has(task.id))
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/**
 * 分段上的小圆点：哪几段里有跑完没看过的任务（dotKind 为 unread），不看搜索。分段的口径同 buildFolders / buildChats：
 * 默认文件夹里的在"对话"，其余在"项目"；移出列表的文件夹、正在撤销期的归档不算。归档的任务没有进程，不会是这种状态。
 */
export function unreadSegments(
  tasks: readonly TaskState[],
  projects: readonly Pick<Project, "id" | "path" | "hidden">[],
  hidden: ReadonlySet<TaskId>,
  defaultCwd: string | null,
): ReadonlySet<HistoryOrder> {
  const fixed = defaultCwd === null ? null : folderKey(defaultCwd);
  const byId = new Map(projects.filter((project) => !project.hidden).map((project) => [project.id, project.path]));
  const segments = new Set<HistoryOrder>();
  for (const task of tasks) {
    const path = byId.get(task.projectId);
    if (path === undefined || hidden.has(task.id) || dotKind(task) !== "unread") continue;
    segments.add(folderKey(path) === fixed ? "chats" : "folder");
  }
  return segments;
}

/** 点"等你确认"条依次跳转：当前选中的就是等待任务时跳到它的下一个（循环），否则跳到最早的。 */
export function nextWaitingTask(waiting: readonly TaskState[], current: TaskId | null): TaskState | null {
  if (waiting.length === 0) return null;
  const at = waiting.findIndex((task) => task.id === current);
  return waiting[at === -1 ? 0 : (at + 1) % waiting.length] ?? null;
}

export type DotKind = "running" | "waiting" | "error" | "interrupted" | "unread" | "none";

/**
 * 状态点的形状：形状是第二信号（色盲友好）。只画要留意的状态；从没跑过、被停止的、看过的正常结束都不画（槽位留着让标题对齐）。
 * 不在前台时正常结束、还没点开看过（主进程的 `unread`）画一个 accent 小圆点（2026-11-11 仓库所有者定；看过的照旧不画）。
 */
export function dotKind(task: TaskState): DotKind {
  if (task.status === "needs_you") return "waiting";
  if (task.status === "error" || (task.status === "idle" && task.lastTurn?.status === "error")) return "error";
  if (task.status === "running" || task.status === "starting") return "running";
  if (task.unread && task.lastTurn?.status === "completed") return "unread";
  return "none";
}

/**
 * 历史会话（还没挂在任务上）的状态点：没有进程，只看会话文件最后一条消息的状态（session-index 的口径，同 omp session-listing）。
 * 画"失败"和"中断"（轮次中途断掉：停在工具调用 / 长度上限上，可以继续）；正常答完、被用户停止、最后一条是用户消息、认不出的不画。
 */
export function sessionDotKind(session: Pick<SessionSummary, "lastTurn">): DotKind {
  switch (session.lastTurn) {
    case "error":
      return "error";
    case "interrupted":
      return "interrupted";
    default:
      return "none";
  }
}

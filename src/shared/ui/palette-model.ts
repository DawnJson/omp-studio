// 命令面板的结果整理：给定查询、任务、历史会话和命令，算出分组后的行。纯函数，可单测。
//   空查询：最近任务（5 个）→ 命令
//   "/" 开头：只有斜杠命令（作为消息发给当前任务）
//   其它：任务 → 会话 → 命令；全都没有时给"在新任务中提问"
import type { ProjectId, SessionSummary, TaskState } from "../ipc.ts";
import type { AvailableSlashCommand } from "../omp-wire/rpc-wire.generated.ts";
import { fuzzyMatch } from "./fuzzy.ts";

export interface CommandEntry {
  id: string;
  label: string;
  /** 右侧键帽文字。 */
  shortcut?: string;
  run(): void;
}

export type PaletteRow =
  | { kind: "task"; key: string; title: string; subtitle: string; indices: number[]; task: TaskState }
  | { kind: "session"; key: string; title: string; subtitle: string; indices: number[]; session: SessionSummary }
  | { kind: "command"; key: string; title: string; indices: number[]; command: CommandEntry }
  | { kind: "slash"; key: string; title: string; subtitle: string; indices: number[]; text: string; send: boolean };

export type SectionId = "recent" | "tasks" | "sessions" | "commands" | "slash";

export interface PaletteSection {
  id: SectionId;
  rows: PaletteRow[];
}

export interface PaletteInput {
  query: string;
  tasks: readonly TaskState[];
  sessions: readonly SessionSummary[];
  commands: readonly CommandEntry[];
  /** 项目 id → 显示名；会话没有项目时用 cwd 的最后一段。 */
  projectLabel(projectId: ProjectId): string;
  taskTitle(task: TaskState): string;
  sessionTitle(session: SessionSummary): string;
  /** 当前有任务选中：斜杠命令才有对象可发。 */
  hasCurrentTask: boolean;
  /** 当前任务的可用斜杠命令（get_available_commands）。 */
  slashCommands: readonly AvailableSlashCommand[];
}

export const recentLimit = 5;
const sectionLimit = 8;
const slashLimit = 30;

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

function ranked<T>(items: readonly T[], score: (item: T) => number | null, limit: number): T[] {
  return items
    .map((item, order) => ({ item, order, score: score(item) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function buildSections(input: PaletteInput): PaletteSection[] {
  const query = input.query.trim();
  const byRecent = [...input.tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  const commandRow = (command: CommandEntry, indices: number[] = []): PaletteRow => ({ kind: "command", key: `command:${command.id}`, title: command.label, indices, command });
  const taskRow = (task: TaskState, indices: number[] = []): PaletteRow => ({
    kind: "task",
    key: `task:${task.id}`,
    title: input.taskTitle(task),
    subtitle: input.projectLabel(task.projectId),
    indices,
    task,
  });

  if (query === "") {
    return [
      { id: "recent", rows: byRecent.slice(0, recentLimit).map((task) => taskRow(task)) },
      { id: "commands", rows: input.commands.map((command) => commandRow(command)) },
    ].filter((section): section is PaletteSection => section.rows.length > 0);
  }

  if (query.startsWith("/")) {
    if (!input.hasCurrentTask) return [];
    const [head = "", ...args] = query.slice(1).split(/\s+/);
    const hasArgs = args.length > 0;
    const matched = ranked(input.slashCommands, (command) => fuzzyMatch(head, command.name)?.score ?? null, slashLimit);
    const rows: PaletteRow[] = matched.map((command) => ({
      kind: "slash",
      key: `slash:${command.name}`,
      title: `/${command.name}`,
      subtitle: command.description ?? "",
      indices: (fuzzyMatch(head, command.name)?.indices ?? []).map((index) => index + 1),
      text: hasArgs ? query : `/${command.name}`,
      // 需要参数的命令先放进输入框让用户补全；不需要参数（或用户已经写了参数）的直接发送。
      send: hasArgs || command.input === undefined,
    }));
    // 列表里没有（还没载入或别名）时仍允许把输入原样当消息发出去。
    if (rows.length === 0) rows.push({ kind: "slash", key: "slash", title: query, subtitle: "", indices: [], text: query, send: true });
    return [{ id: "slash", rows }];
  }

  const tasks = ranked(byRecent, (task) => fuzzyMatch(query, `${input.taskTitle(task)} ${input.projectLabel(task.projectId)}`)?.score ?? null, sectionLimit).map((task) =>
    taskRow(task, fuzzyMatch(query, input.taskTitle(task))?.indices ?? []),
  );
  const sessions = ranked(input.sessions, (session) => fuzzyMatch(query, input.sessionTitle(session))?.score ?? null, sectionLimit).map<PaletteRow>((session) => ({
    kind: "session",
    key: `session:${session.id}`,
    title: input.sessionTitle(session),
    subtitle: session.projectId === null ? lastSegment(session.cwd) : input.projectLabel(session.projectId),
    indices: fuzzyMatch(query, input.sessionTitle(session))?.indices ?? [],
    session,
  }));
  const commands = ranked(input.commands, (command) => fuzzyMatch(query, command.label)?.score ?? null, input.commands.length).map((command) =>
    commandRow(command, fuzzyMatch(query, command.label)?.indices ?? []),
  );

  return [
    { id: "tasks" as const, rows: tasks },
    { id: "sessions" as const, rows: sessions },
    { id: "commands" as const, rows: commands },
  ].filter((section) => section.rows.length > 0);
}

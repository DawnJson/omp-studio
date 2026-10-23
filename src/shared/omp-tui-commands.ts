// omp 的 TUI 才有的内置斜杠命令：TSP 任务跑的是交互式 omp，这些命令能用；但 `get_available_commands`（rpc-ui 的列表，
// 只列有 `handle` 的内置命令）里没有它们。斜杠菜单要把它们合并进去，发送守卫也不能把它们当成"未知命令"拦下。
// 来源：omp 18.12.6 源码 `packages/coding-agent/src/slash-commands/builtin-*.ts` 里只有 `handleTui`、没有 `handle` 的条目
// （2026-10-23 整理）；omp 升级后新增或改名的 TUI 命令要重新对一遍这张表。名称、别名、参数提示、说明照 omp 原文。
// studio 自己接管的命令（`studio-slash-table.ts`）在合并时由 `withStudioSlash` 去重，不用在这里排除。
import type { AvailableSlashCommand } from "./omp-wire/rpc-wire.generated.ts";

/** 这张表对应的 omp 版本。 */
export const OMP_TUI_COMMANDS_VERSION = "18.12.6";

const tui = (name: string, description: string, hint?: string, aliases?: string[]): AvailableSlashCommand => ({
  name,
  source: "builtin",
  description,
  ...(aliases ? { aliases } : {}),
  ...(hint ? { input: { hint } } : {}),
});

/**
 * 会结束（或重启）任务的 omp 进程的命令：`/exit` `/quit`（别名 `/q`）退出应用，`/restart` 用同样的参数重起 omp 并恢复会话
 * （omp 18.12.6 `builtin-control.ts` / `builtin-lifecycle.ts`）。斜杠菜单里不列，免得误点；手敲仍然原样发给 omp（守卫认得它们）。
 */
export const MENU_HIDDEN_COMMANDS: ReadonlySet<string> = new Set(["exit", "quit", "q", "restart"]);

export const OMP_TUI_ONLY_COMMANDS: readonly AvailableSlashCommand[] = [
  tui("collab", "Share this session live via a relay", "[start|view|list|stop|status] [relayUrl]"),
  tui("join", "Join a shared collab session", "<link>"),
  tui("leave", "Leave the collab session"),
  tui("copy", "Pick text or code from the conversation to copy"),
  tui("open", "Open the last link from the conversation in your browser (or pick one with /copy)"),
  tui("live", "Start Codex-backed realtime voice mode"),
  tui("record", "Start or stop recording this screen to a replayable file (omp play)"),
  tui("pause", "Freeze all agents (main, subagents, advisor) until resumed"),
  tui("quit", "Quit the application", undefined, ["q"]),
  tui("exit", "Exit the application"),
  tui("restart", "Restart omp with the same launch flags, resuming this session"),
  tui("new", "Start a new session"),
  tui("clear", "Clear the conversation context in place, keeping the session"),
  tui("delete", "Delete the current session and start a new one"),
  tui("resume", "Resume a different session", "[session id|@claude|@codex]"),
  tui("btw", "Ask a side question, or browse this session's BTW history", "[question]"),
  tui("tan", "Run a full background agent on tangential work", "<work>"),
  tui("omfg", "Forge a TTSR rule from a complaint to stop a recurring behavior", "<complaint>"),
  tui("cleanse", "Detect and fix project diagnostics with weighted parallel subagents", "[request] [--all]"),
  tui("debug", "Open debug tools selector"),
  tui("settings", "Open settings menu"),
  tui("setup", "Open provider setup", undefined, ["providers"]),
  tui("plan", "Toggle plan mode (agent plans before executing)", "[prompt]"),
  tui("plan-review", "Re-open the plan review for the latest plan (plan mode only)"),
  tui("vibe", "Toggle vibe mode (direct persistent fast/good worker sessions; read-only toolset)", "[prompt]"),
  tui("goal", "Toggle goal mode (persistent autonomous objective for this session)", "[objective]"),
  tui("guided-goal", "Have the agent interview you in chat, then set up goal mode", "[rough objective]"),
  tui(
    "loop",
    "Toggle loop mode: the next prompt you send re-submits after every yield; bound it with a count/duration or --while/--until '<cmd>'",
    "[count|duration] [--while|--until '<cmd>'] [prompt]",
  ),
  tui("queue", "Queue a message for after the agent yields", "<message>"),
  tui("hotkeys", "Show all keyboard shortcuts"),
  tui("extensions", "Open Extension Control Center dashboard", undefined, ["status"]),
  tui("agents", "Open the agents hub (per-agent model, prewalk, and advisor)"),
  tui("git", "Open the git UI (split diff viewer, staging, commit composer)", "[revision]"),
  tui("hub", "Open the live Agent Hub"),
  tui("branch", "Rewind to a previous message, keeping the old path as a branch", undefined, ["rewind"]),
  tui("fork", "Create a new fork from a previous message"),
  tui("tree", "Navigate session tree (switch branches)"),
  tui("login", "Login with OAuth provider", "[provider|redirect URL]"),
  tui("logout", "Logout from OAuth provider", "[provider]"),
  tui("skills", "Search, install, and update skills from the skills.omp.sh registry"),
];

const namesOf = (command: AvailableSlashCommand): string[] => [command.name, ...(command.aliases ?? [])];

/**
 * TSP 任务的命令表 = omp 的 rpc-ui 列表 + TUI 才有的命令（名字或别名已经在 omp 列表里的不重复加）。
 * 列表还没载入（空数组）时原样返回空：调用方（发送守卫）把空表当"没载入"放行。
 */
export function mergeTuiCommands(omp: readonly AvailableSlashCommand[]): AvailableSlashCommand[] {
  if (omp.length === 0) return [];
  const taken = new Set(omp.flatMap((command) => namesOf(command).map((name) => name.toLowerCase())));
  return [
    ...omp,
    ...OMP_TUI_ONLY_COMMANDS.filter((command) => !namesOf(command).some((name) => taken.has(name.toLowerCase()))),
  ];
}

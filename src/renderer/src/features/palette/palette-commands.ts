// 命令面板的命令清单（spec §4.18）：每个有快捷键的动作都在这里有一条。只列当前能执行的命令。
import { reportError } from "../../ui/errors.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Locale, TaskState, TerminalKey, ThemePreference } from "../../../../shared/ipc.ts";
import { showView } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { archiveWithUndo } from "../sidebar/archive-store.ts";
import { startDraft } from "../empty/index.ts";
import { addProjectAsDraft, jumpToWaitingTask } from "../sidebar/sidebar-actions.ts";
import { toggleFilesPanel } from "../file-preview/index.ts";
import { toggleTerminal } from "../terminal/index.ts";
import { exportConversationReporting } from "../composer/export-html.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { toggleAgentsPanel } from "../agents/agents-store.ts";
import { openBtw } from "../btw/index.ts";
import { goalButtons } from "../goal/goal-model.ts";
import { runGoalOp } from "../goal/goal-actions.ts";
import type { CommandEntry } from "../../../../shared/ui/palette-model.ts";
import { emitStudioCommand } from "./studio-command.ts";
import { setUsageDialogOpen } from "../composer/usage-store.ts";
import { openSessionInfo, openShareDialog, retryTask, togglePin } from "../session-info/index.ts";
import { restartSession } from "../../app/restart-session.ts";

export interface CommandContext {
  t: TFunction;
  locale: Locale;
  theme: ThemePreference;
  current: TaskState | null;
  /** 终端命令的目标：当前任务，或对话页上的新任务草稿；没有（设置页上的草稿等）时为 null。 */
  terminalKey: TerminalKey | null;
  hasWaiting: boolean;
}

const themeCycle: ThemePreference[] = ["system", "light", "dark"];
const goalCommandKey = { pause: "goal.cmdPause", resume: "goal.cmdResume", drop: "goal.cmdDrop" } as const;

export function buildCommands({ t, locale, theme, current, terminalKey, hasWaiting }: CommandContext): CommandEntry[] {
  const guard = (promise: Promise<unknown>) => void promise.catch((error: unknown) => reportError(t, error));
  const entries: (CommandEntry | null)[] = [
    { id: "newTask", label: t("cmd.newTask"), shortcut: "Ctrl N", run: () => startDraft(null) },
    current && {
      id: "newTaskHere",
      label: t("cmd.newTaskHere"),
      shortcut: "Ctrl Shift N",
      run: () => startDraft(current.projectId),
    },
    {
      id: "openFolder",
      label: t("cmd.openFolder"),
      shortcut: "Ctrl Shift O",
      run: () => void addProjectAsDraft(t),
    },
    { id: "settings", label: t("cmd.settings"), shortcut: "Ctrl ,", run: () => showView("settings") },
    {
      id: "toggleSidebar",
      label: t("cmd.toggleSidebar"),
      shortcut: "Ctrl B",
      run: () => emitStudioCommand("toggleSidebar"),
    },
    {
      id: "theme",
      label: t("cmd.theme"),
      run: () =>
        guard(window.studio.setTheme(themeCycle[(themeCycle.indexOf(theme) + 1) % themeCycle.length] ?? "system")),
    },
    {
      id: "language",
      label: t("cmd.language"),
      run: () => guard(window.studio.setLocale(locale === "zh-CN" ? "en" : "zh-CN")),
    },
    current && { id: "model", label: t("cmd.model"), shortcut: "Alt M", run: () => emitStudioCommand("model") },
    current && {
      id: "thinking",
      label: t("cmd.thinking"),
      shortcut: "Alt T",
      run: () => emitStudioCommand("thinking"),
    },
    // 压缩：发 omp 的 `/compact`，等压缩分隔出现（TspRunner.compact）；失败（会话太小等）按 omp 的原文报错。
    current && { id: "compact", label: t("cmd.compact"), run: () => guard(window.studio.compactTask(current.id)) },
    // 重开会话：结束 omp 进程再 `--resume`，重新读 skill、MCP、插件和配置；任务忙时不列。
    current?.restartable && {
      id: "restartSession",
      label: t("task.restart"),
      shortcut: "Ctrl Shift R",
      run: () => void restartSession(t, current),
    },
    // 目标（`/goal`）：走 omp 的 `/goal pause|resume|drop`（docs/architecture/conversation.md「目标模式」）。
    ...(current
      ? goalButtons(current.goal).map((op) => ({
          id: `goal-${op}`,
          label: t(goalCommandKey[op]),
          run: () => void runGoalOp(current.id, op, t),
        }))
      : []),
    current && { id: "sessionTree", label: t("cmd.sessionTree"), run: () => openSessionTree(current.id) },
    // 子代理面板（右栏）。
    current && { id: "agents", label: t("agents.cmd"), run: () => toggleAgentsPanel(current.id) },
    current && {
      id: "exportHtml",
      label: t("cmd.exportHtml"),
      run: () => void exportConversationReporting(current.id, t),
    },
    current && { id: "btw", label: t("cmd.btw"), run: () => openBtw(current.id) },
    current?.status === "running" && {
      id: "stop",
      label: t("cmd.stop"),
      shortcut: "Esc",
      run: () => emitStudioCommand("stop"),
    },
    current && {
      id: "copyLast",
      label: t("cmd.copyLast"),
      shortcut: "Ctrl Shift C",
      run: () => emitStudioCommand("copyLast"),
    },
    current && {
      id: "toggleProcess",
      label: t("cmd.toggleProcess"),
      shortcut: "Ctrl O",
      run: () => emitStudioCommand("toggleProcess"),
    },
    current && {
      id: "review",
      label: t("review.open"),
      shortcut: "Ctrl Shift D",
      run: () => openReview(current.id),
    },
    terminalKey !== null && {
      id: "toggleFiles",
      label: t("preview.filesToggle"),
      shortcut: "Ctrl Shift E",
      run: () => toggleFilesPanel(terminalKey),
    },
    terminalKey !== null && {
      id: "toggleTerminal",
      label: t("cmd.toggleTerminal"),
      shortcut: "Ctrl `",
      run: () => toggleTerminal(terminalKey),
    },
    hasWaiting && {
      id: "jumpWaiting",
      label: t("cmd.jumpWaiting"),
      shortcut: "Ctrl J",
      run: () => void jumpToWaitingTask(current?.id ?? null, t),
    },
    // 用量：回到对话页，打开输入框旁的用量对话框（费用按钮打开的同一个）。
    {
      id: "usage",
      label: t("cmd.usage"),
      run: () => {
        showView("conversation");
        setUsageDialogOpen(true);
      },
    },
    // 插件、更新检查、快捷键清单在设置页里，直接定位到对应分节。
    { id: "plugins", label: t("cmd.plugins"), run: () => showView("settings", { section: "extensions" }) },
    // MCP / SSH / 可用工具 / 记忆 / omp 更新日志所在的设置分节。
    { id: "mcp", label: t("integrations.cmd.mcp"), run: () => showView("settings", { section: "extensions" }) },
    { id: "ssh", label: t("integrations.cmd.ssh"), run: () => showView("settings", { section: "extensions" }) },
    { id: "tools", label: t("integrations.cmd.tools"), run: () => showView("settings", { section: "tools" }) },
    { id: "memory", label: t("integrations.cmd.memory"), run: () => showView("settings", { section: "context" }) },
    { id: "changelog", label: t("integrations.cmd.changelog"), run: () => showView("settings", { section: "about" }) },
    { id: "checkUpdate", label: t("cmd.checkUpdate"), run: () => showView("settings", { section: "about" }) },
    { id: "about", label: t("window.about"), run: () => emitStudioCommand("about") },
    { id: "shortcuts", label: t("cmd.shortcuts"), run: () => showView("settings", { section: "shortcuts" }) },
    current && { id: "archive", label: t("cmd.archive"), run: () => archiveWithUndo(current.id, current.id, t) },
    // 会话信息、请求记录、置顶、分享、重试（session-info）：分享和置顶需要任务已有会话文件，没有时对话框里说明。
    current && { id: "sessionInfo", label: t("sessionInfo.cmd.info"), run: () => openSessionInfo(current.id, "info") },
    current && { id: "trace", label: t("sessionInfo.cmd.trace"), run: () => openSessionInfo(current.id, "trace") },
    current && { id: "share", label: t("sessionInfo.cmd.share"), run: () => openShareDialog(current.id) },
    current && { id: "pin", label: t("sessionInfo.cmd.pin"), run: () => void togglePin(t, current.id) },
    current?.status === "idle" && {
      id: "retry",
      label: t("sessionInfo.cmd.retry"),
      run: () => void retryTask(t, current.id),
    },
  ].map((entry) => entry || null);
  return entries.filter((entry): entry is CommandEntry => entry !== null);
}

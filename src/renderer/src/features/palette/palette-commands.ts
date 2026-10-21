// 命令面板的命令清单（spec §4.18）：每个有快捷键的动作都在这里有一条。只列当前能执行的命令。
import { reportError } from "../../ui/errors.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Locale, TaskState, TerminalKey, ThemePreference } from "../../../../shared/ipc.ts";
import { showView } from "../../store/index.ts";
import { openReview } from "../../store/review-store.ts";
import { archiveWithUndo } from "../sidebar/archive-store.ts";
import { startDraft } from "../empty/index.ts";
import { addProjectAsDraft, jumpToWaitingTask } from "../sidebar/sidebar-actions.ts";
import { toggleTerminal } from "../terminal/index.ts";
import { exportConversationReporting } from "../composer/export-html.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { openBtw } from "../btw/index.ts";
import { goalButtons } from "../goal/goal-model.ts";
import { runGoalOp } from "../goal/goal-actions.ts";
import type { CommandEntry } from "../../../../shared/ui/palette-model.ts";
import { emitStudioCommand } from "./studio-command.ts";

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
  const rpcTask = current !== null && current.engine !== "tsp" ? current : null;
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
    // 下面几条（压缩、目标、会话树、导出、旁路提问）靠 rpc，TSP 任务用不了；omp 自己的同名命令走斜杠命令（输入 / 选取）。
    rpcTask && { id: "compact", label: t("cmd.compact"), run: () => emitStudioCommand("compact") },
    ...(rpcTask
      ? goalButtons(rpcTask.goal).map((op) => ({
          id: `goal-${op}`,
          label: t(goalCommandKey[op]),
          run: () => void runGoalOp(rpcTask.id, op, t),
        }))
      : []),
    rpcTask && { id: "sessionTree", label: t("cmd.sessionTree"), run: () => openSessionTree(rpcTask.id) },
    rpcTask && {
      id: "exportHtml",
      label: t("cmd.exportHtml"),
      run: () => void exportConversationReporting(rpcTask.id, t),
    },
    rpcTask && { id: "btw", label: t("cmd.btw"), run: () => openBtw(rpcTask.id) },
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
    // 更新检查、用量、快捷键清单在设置页里，直接定位到对应分节。
    { id: "usage", label: t("cmd.usage"), run: () => showView("settings", { section: "usage" }) },
    { id: "checkUpdate", label: t("cmd.checkUpdate"), run: () => showView("settings", { section: "omp" }) },
    { id: "shortcuts", label: t("cmd.shortcuts"), run: () => showView("settings", { section: "shortcuts" }) },
    current && { id: "archive", label: t("cmd.archive"), run: () => archiveWithUndo(current.id, current.id, t) },
  ].map((entry) => entry || null);
  return entries.filter((entry): entry is CommandEntry => entry !== null);
}

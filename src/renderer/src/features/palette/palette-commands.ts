// 命令面板的命令清单（spec §4.18）：每个有快捷键的动作都在这里有一条。只列当前能执行的命令。
import { reportError } from "../../ui/errors.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Locale, TaskState, ThemePreference } from "../../../../shared/ipc.ts";
import { showView } from "../../store/index.ts";
import { archiveWithUndo } from "../sidebar/archive-store.ts";
import { startDraft } from "../empty/index.ts";
import { addProjectAsDraft, jumpToWaitingTask } from "../sidebar/sidebar-actions.ts";
import type { CommandEntry } from "../../../../shared/ui/palette-model.ts";
import { emitStudioCommand } from "./studio-command.ts";

export interface CommandContext {
  t: TFunction;
  locale: Locale;
  theme: ThemePreference;
  current: TaskState | null;
  hasWaiting: boolean;
}

const themeCycle: ThemePreference[] = ["system", "light", "dark"];

export function buildCommands({ t, locale, theme, current, hasWaiting }: CommandContext): CommandEntry[] {
  const guard = (promise: Promise<unknown>) => void promise.catch((error: unknown) => reportError(t, error));
  const entries: (CommandEntry | null)[] = [
    { id: "newTask", label: t("cmd.newTask"), shortcut: "Ctrl N", run: () => startDraft(null) },
    current && {
      id: "newTaskHere",
      label: t("cmd.newTaskHere"),
      shortcut: "Ctrl Shift N",
      run: () => startDraft(current.projectId),
    },
    { id: "openFolder", label: t("cmd.openFolder"), run: () => void addProjectAsDraft(t) },
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
    current && { id: "compact", label: t("cmd.compact"), run: () => emitStudioCommand("compact") },
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
    hasWaiting && {
      id: "jumpWaiting",
      label: t("cmd.jumpWaiting"),
      shortcut: "Ctrl J",
      run: () => void jumpToWaitingTask(current?.id ?? null, t),
    },
    // 更新检查、快捷键清单在设置页里，直接定位到对应分节（设置页没有用量分节，所以没有"查看用量"命令）。
    { id: "checkUpdate", label: t("cmd.checkUpdate"), run: () => showView("settings", { section: "omp" }) },
    { id: "shortcuts", label: t("cmd.shortcuts"), run: () => showView("settings", { section: "shortcuts" }) },
    current && { id: "archive", label: t("cmd.archive"), run: () => archiveWithUndo(current.id, current.id, t) },
  ].map((entry) => entry || null);
  return entries.filter((entry): entry is CommandEntry => entry !== null);
}

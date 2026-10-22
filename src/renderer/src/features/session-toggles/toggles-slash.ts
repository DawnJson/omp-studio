// 会话开关类斜杠命令在 studio-slash-table.ts 里的行：不带参数打开输入框上的"会话开关"菜单，带 on / off 等参数直接执行；
// /modelpreset、/prewalk 打开模型选择器（预设和 Prewalk 在那里）。TSP 和 rpc 任务一样由 studio 接管，不触发 omp 的终端界面。
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { runToggleSlash } from "./toggle-actions.ts";
import type { ToggleSlashName } from "./toggle-slash.ts";

function row(name: ToggleSlashName, descKey: StudioSlashCommand["descKey"]): StudioSlashCommand {
  return { name, descKey, run: (taskId, args, t) => runToggleSlash(taskId, name, args, t) };
}

export const toggleSlashCommands: readonly StudioSlashCommand[] = [
  row("skillful", "toggles.skillfulDesc"),
  row("extended-context", "toggles.extendedContextDesc"),
  row("computer", "toggles.computerDesc"),
  row("advisor", "toggles.advisorDesc"),
  row("browser", "toggles.browserDesc"),
  row("prewalk", "toggles.prewalkDesc"),
  row("modelpreset", "toggles.modelpresetDesc"),
];

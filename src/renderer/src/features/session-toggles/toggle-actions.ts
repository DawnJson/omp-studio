// 会话开关的动作：把封闭的 TaskCommand 交给主进程执行（主进程拼成 `/命令`，渲染进程不传自由文本），
// 以及斜杠命令（/skillful /computer on …）的入口。
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { TaskCommand } from "../../../../shared/omp-output/index.ts";
import { parseToggleToast, SAVED_TO_CONFIG } from "../../../../shared/omp-output/toggles.ts";
import { loadOmpConfig } from "../settings/config-store.ts";
import { pushToast } from "../dialogs/index.ts";
import { requestTogglesMenu } from "./toggle-bus.ts";
import { resolveToggleSlash, type ToggleSlashName } from "./toggle-slash.ts";
import { emitStudioCommand } from "../palette/studio-command.ts";

/**
 * 执行一条会话命令。omp 认得出的开关状态由主进程读 toast 后发布到 TaskState.sessionToggles（菜单自己更新）；
 * 认不出的回话（用法提示、模型不支持、预设的保存结果）原样弹给用户，不吞。
 * omp 写进配置的开关（SAVED_TO_CONFIG）执行后重读配置快照，菜单的默认值才和 omp 一致（重开会话后显示的就是它）。
 */
export async function runToggleCommand(taskId: TaskId, command: TaskCommand): Promise<void> {
  const { text } = await window.studio.runTaskCommand(taskId, command);
  const name = command.kind === "browserMode" ? "browser" : command.kind === "toggle" ? command.name : null;
  if (name !== null && SAVED_TO_CONFIG.has(name)) await loadOmpConfig();
  if (text.trim() !== "" && parseToggleToast(text) === null) pushToast({ level: "info", message: text });
}

/** 斜杠命令入口（studio-slash-table.ts）：不带参数 / status 打开菜单，带参数直接执行；参数不认识时抛出用法（草稿放回输入框）。 */
export async function runToggleSlash(taskId: TaskId, name: ToggleSlashName, args: string, t: TFunction): Promise<void> {
  const resolved = resolveToggleSlash(name, args);
  switch (resolved.kind) {
    case "menu":
      requestTogglesMenu({ taskId, confirmComputer: false });
      return;
    case "confirmComputer":
      requestTogglesMenu({ taskId, confirmComputer: true });
      return;
    case "models":
      emitStudioCommand("model");
      return;
    case "usage":
      throw new Error(t("toggles.slashUsage", { usage: resolved.usage }));
    case "run":
      await runToggleCommand(taskId, resolved.command);
      return;
  }
}

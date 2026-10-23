// 斜杠菜单的匹配（spec 4.14 SlashMenu）：草稿以 / 开头、还没出现空格时，按命令名和别名过滤，前缀匹配优先。纯函数。
import { MENU_HIDDEN_COMMANDS } from "../../../../shared/omp-tui-commands.ts";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

/** 草稿里正在输入的命令名（不含 /）；不是"正在输入命令名"时返回 null。菜单最多同时显示 8 行（CSS max-height），更多的在菜单里滚动，这里不截断。 */
export function slashQuery(text: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(text);
  return match ? (match[1] ?? "") : null;
}

export function matchSlash(commands: readonly AvailableSlashCommand[], query: string): AvailableSlashCommand[] {
  const q = query.toLowerCase();
  const names = (command: AvailableSlashCommand) =>
    [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase());
  // 会结束 omp 进程的命令不在菜单里（手敲照常发出）。
  const listed = commands.filter((command) => !MENU_HIDDEN_COMMANDS.has(command.name));
  const prefix = listed.filter((command) => names(command).some((name) => name.startsWith(q)));
  const contains = listed.filter(
    (command) => !prefix.includes(command) && names(command).some((name) => name.includes(q)),
  );
  return [...prefix, ...contains];
}

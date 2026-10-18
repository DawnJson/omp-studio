// 斜杠菜单的匹配（spec 4.14 SlashMenu）：草稿以 / 开头、还没出现空格时，按命令名和别名过滤，前缀匹配优先。纯函数。
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export const MAX_SLASH_ROWS = 8;

/** 草稿里正在输入的命令名（不含 /）；不是"正在输入命令名"时返回 null。 */
export function slashQuery(text: string): string | null {
  const match = /^\/([^\s/]*)$/.exec(text);
  return match ? (match[1] ?? "") : null;
}

export function matchSlash(commands: readonly AvailableSlashCommand[], query: string): AvailableSlashCommand[] {
  const q = query.toLowerCase();
  const names = (command: AvailableSlashCommand) => [command.name, ...(command.aliases ?? [])].map((name) => name.toLowerCase());
  const prefix = commands.filter((command) => names(command).some((name) => name.startsWith(q)));
  const contains = commands.filter((command) => !prefix.includes(command) && names(command).some((name) => name.includes(q)));
  return [...prefix, ...contains].slice(0, MAX_SLASH_ROWS);
}

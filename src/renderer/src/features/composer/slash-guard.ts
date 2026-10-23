// 斜杠命令发送前的判定（spec 4.14）：`/名称` 不在任务进程的命令表里时，omp 会把它当普通文字发给模型，所以先提示一次，
// 对同一段文字再发一次才放行。命令表 = omp 的 get_available_commands + TUI 才有的命令（shared/omp-tui-commands.ts）+ studio 接管的命令，
// 合并由调用方做；这里只看"两边都没有"。纯函数。
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

export type SlashGuard =
  /** 照常发送。 */
  | { kind: "send" }
  /** 先提示：命令表里没有这个命令。 */
  | { kind: "warn"; name: string };

/** 草稿开头的 `/名称`（后面是空白或结尾）；`/usr/bin` 这类路径不算。 */
export function leadingSlashName(text: string): string | null {
  const match = /^\/([^\s/]+)(?:\s|$)/.exec(text.trimStart());
  return match ? (match[1] ?? null) : null;
}

/**
 * 命令列表还没载入（空数组）时一律放行：不能因为拿不到列表就拦用户。
 * 名称和别名都按小写比较。
 */
export function decideSlashSend(text: string, commands: readonly AvailableSlashCommand[]): SlashGuard {
  const name = leadingSlashName(text);
  if (name === null || commands.length === 0) return { kind: "send" };
  const lower = name.toLowerCase();
  const known = commands.some((command) =>
    [command.name, ...(command.aliases ?? [])].some((candidate) => candidate.toLowerCase() === lower),
  );
  if (known) return { kind: "send" };
  return { kind: "warn", name };
}

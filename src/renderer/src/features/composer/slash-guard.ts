// 斜杠命令发送前的判定（spec 4.14）：`/名称` 不在 omp 的 get_available_commands 里时，omp 会把它当普通文字发给模型。
// 终端版 omp 才有的命令（TUI 内置）在 RPC 里不可用，直接发出去只会让模型困惑，所以先提示一次，第二次发送才放行。纯函数。
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";

/** 只在终端版 omp 里存在的命令（trial-tui 实测）；可能不全，不在这张表里的未知命令走通用提示。 */
const terminalOnly: Record<string, true> = {
  plan: true,
  tree: true,
  fork: true,
  copy: true,
  goal: true,
  btw: true,
  hotkeys: true,
  settings: true,
};

export type SlashGuard =
  /** 照常发送。 */
  | { kind: "send" }
  /** 先提示；`terminal` 为 true 是终端版独有的命令，否则只是列表里没有。 */
  | { kind: "warn"; name: string; terminal: boolean };

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
  return { kind: "warn", name, terminal: lower in terminalOnly };
}

// omp-studio 自己接管的斜杠命令的判定（纯函数；命令表在 studio-slash-table.ts）。
// omp 的 RPC 有对应命令（如 get_tree / fork / btw / goal / export_html），但 rpc-ui 的 get_available_commands
// 不列它们，或者 omp 的实现不适合桌面端（/export 把文件写进项目目录）。发送前先查命令表：命中就交给处理函数，
// 不发给模型；斜杠菜单和斜杠命令守卫也把它们当作已知命令。同名时 omp-studio 的优先，omp 列表里的同名项从菜单里去掉。
import type { TFunction, MessageKey } from "../../../../shared/i18n/index.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import type { AvailableSlashCommand } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { leadingSlashName } from "./slash-guard.ts";

export interface StudioSlashCommand {
  name: string;
  aliases?: readonly string[];
  /** 斜杠菜单里的说明。 */
  descKey: MessageKey;
  /** `args` 是命令名后面的文字（已去掉首尾空白，可能为空）。处理函数自己负责提示；抛错时草稿放回输入框。 */
  run(taskId: TaskId, args: string, t: TFunction): Promise<void> | void;
}

/** 草稿开头的 `/名称` 是 omp-studio 接管的命令时，返回它和参数；否则 null。 */
export function findStudioSlash(
  text: string,
  commands: readonly StudioSlashCommand[],
): { command: StudioSlashCommand; args: string } | null {
  const name = leadingSlashName(text);
  if (name === null) return null;
  const lower = name.toLowerCase();
  const command = commands.find((candidate) =>
    [candidate.name, ...(candidate.aliases ?? [])].some((alias) => alias.toLowerCase() === lower),
  );
  if (command === undefined) return null;
  return {
    command,
    args: text
      .trimStart()
      .slice(name.length + 1)
      .trim(),
  };
}

/** 斜杠菜单 / 守卫用的完整列表：omp-studio 接管的命令在前，omp 列表里同名（含别名）的去掉。 */
export function withStudioSlash(
  omp: readonly AvailableSlashCommand[],
  commands: readonly StudioSlashCommand[],
  t: TFunction,
): AvailableSlashCommand[] {
  if (commands.length === 0) return [...omp];
  const taken = new Set(commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
  const own: AvailableSlashCommand[] = commands.map((command) => ({
    name: command.name,
    source: "builtin",
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: t(command.descKey),
  }));
  return [
    ...own,
    ...omp.filter((command) => ![command.name, ...(command.aliases ?? [])].some((name) => taken.has(name))),
  ];
}

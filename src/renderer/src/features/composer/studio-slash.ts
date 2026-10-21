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
  /**
   * TSP 任务里怎么办（rpc 任务总是 studio 接管）：不写 = 不提供（omp 自己的同名命令照常）；
   * `"studio"` = 和 rpc 一样由 `run` 接管；`"omp"` = studio 没有对应功能，菜单里列出这条，发出去的文字原样交给 omp（它在过程区里画自己的界面）。
   */
  tsp?: "studio" | "omp";
  /** 草稿页（还没有任务）里也能用：没有任务时调它而不是 `run`。不写 = 草稿页不提供。 */
  draft?(args: string, t: TFunction): Promise<void> | void;
}

/** 命令在哪里：rpc 任务、TSP 任务、新任务草稿页。 */
export type SlashHost = "rpc" | "tsp" | "draft";

/** 这个宿主里由 studio 自己处理的命令（发送前拦截，菜单和守卫都按它列）。 */
export function handledCommands(commands: readonly StudioSlashCommand[], host: SlashHost): StudioSlashCommand[] {
  if (host === "rpc") return [...commands];
  if (host === "tsp") return commands.filter((command) => command.tsp === "studio");
  return commands.filter((command) => command.draft !== undefined);
}

/** TSP 任务里只在菜单列出、发出去交给 omp 的命令（`tsp: "omp"`）；别的宿主没有。 */
export function passthroughCommands(commands: readonly StudioSlashCommand[], host: SlashHost): StudioSlashCommand[] {
  return host === "tsp" ? commands.filter((command) => command.tsp === "omp") : [];
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

/**
 * 斜杠菜单 / 守卫用的完整列表：这个宿主里 studio 接管的命令在前（omp 列表里同名、含别名撞名的去掉），
 * 然后是 omp 的列表，最后是"交给 omp"的命令里 omp 列表没有的（rpc-ui 的列表不列终端版独有的命令）。
 */
export function withStudioSlash(
  omp: readonly AvailableSlashCommand[],
  commands: readonly StudioSlashCommand[],
  host: SlashHost,
  t: TFunction,
): AvailableSlashCommand[] {
  const handled = handledCommands(commands, host);
  const passthrough = passthroughCommands(commands, host);
  if (handled.length === 0 && passthrough.length === 0) return [...omp];
  const namesOf = (command: { name: string; aliases?: readonly string[] }) => [
    command.name,
    ...(command.aliases ?? []),
  ];
  const taken = new Set(handled.flatMap(namesOf));
  const entry = (command: StudioSlashCommand): AvailableSlashCommand => ({
    name: command.name,
    source: "builtin",
    ...(command.aliases ? { aliases: [...command.aliases] } : {}),
    description: t(command.descKey),
  });
  const kept = omp.filter((command) => !namesOf(command).some((name) => taken.has(name)));
  const known = new Set(kept.flatMap(namesOf));
  return [
    ...handled.map(entry),
    ...kept,
    ...passthrough.filter((command) => !namesOf(command).some((name) => known.has(name))).map(entry),
  ];
}

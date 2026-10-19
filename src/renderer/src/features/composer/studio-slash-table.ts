// omp-studio 接管的斜杠命令表（判定逻辑在 studio-slash.ts，纯函数）。
// 各功能在这里各加一行，import 自己的处理函数；不在别处注册。
import { exportConversation } from "./export-html.ts";
import { btwSlash } from "../btw/btw-slash.ts";
import { forkFromMessage } from "../conversation/fork-actions.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { goalSlash } from "../goal/goal-slash.ts";
import type { StudioSlashCommand } from "./studio-slash.ts";

export const studioSlashCommands: readonly StudioSlashCommand[] = [
  { name: "export", descKey: "slash.exportDesc", run: (taskId, _args, t) => exportConversation(taskId, t) },
  btwSlash,
  { name: "tree", descKey: "slash.treeDesc", run: (taskId) => openSessionTree(taskId) },
  { name: "fork", descKey: "slash.forkDesc", run: (taskId) => forkFromMessage(taskId, null) },
  goalSlash,
];

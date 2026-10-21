// omp-studio 接管的斜杠命令表（判定逻辑在 studio-slash.ts，纯函数）。
// 各功能在这里各加一行，import 自己的处理函数；不在别处注册。
// 桌面优先：能在 studio 自己的界面里做的事，输入同名命令就打开 studio 的界面，不去触发 omp 的终端弹窗。
// `tsp`：TSP 任务里怎么办（见 StudioSlashCommand）；不写 `tsp` 和 `draft` 的命令只有 rpc 任务有（靠 rpc 的数据或接口）。
import { pushToast } from "../dialogs/index.ts";
import { startDraft } from "../empty/index.ts";
import { openGitDialog } from "../git/git-dialog-store.ts";
import { exportConversation } from "./export-html.ts";
import { btwSlash } from "../btw/btw-slash.ts";
import { forkFromMessage } from "../conversation/fork-actions.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { goalSlash } from "../goal/goal-slash.ts";
import { emitStudioCommand } from "../palette/studio-command.ts";
import { archiveWithUndo } from "../sidebar/archive-store.ts";
import { getTask, setPaletteOpen, showView } from "../../store/index.ts";
import type { StudioSlashCommand } from "./studio-slash.ts";

const openSettings = () => showView("settings");
const openShortcuts = () => showView("settings", { section: "shortcuts" });
const openModelPicker = () => emitStudioCommand("model");
const openUsage = () => emitStudioCommand("usage");
const openPalette = () => setPaletteOpen(true);

export const studioSlashCommands: readonly StudioSlashCommand[] = [
  // 会话类：rpc 靠 export_html / get_tree / branch / btw / goal；TSP 里导出走 `omp --export`（对会话文件），其余 omp 在过程区里自己画界面。
  {
    name: "export",
    descKey: "slash.exportDesc",
    tsp: "studio",
    run: (taskId, _args, t) => exportConversation(taskId, t),
  },
  { ...btwSlash, tsp: "omp" },
  { name: "tree", descKey: "slash.treeDesc", tsp: "omp", run: (taskId) => openSessionTree(taskId) },
  { name: "fork", descKey: "slash.forkDesc", tsp: "omp", run: (taskId) => forkFromMessage(taskId, null) },
  { ...goalSlash, tsp: "omp" },
  // 导航与设置：直接开 studio 的界面。
  {
    name: "new",
    descKey: "slash.newDesc",
    tsp: "studio",
    run: (taskId) => startDraft(getTask(taskId)?.projectId ?? null),
  },
  { name: "resume", descKey: "slash.resumeDesc", tsp: "studio", run: openPalette, draft: openPalette },
  { name: "settings", descKey: "slash.settingsDesc", tsp: "studio", run: openSettings, draft: openSettings },
  { name: "hotkeys", descKey: "slash.hotkeysDesc", tsp: "studio", run: openShortcuts, draft: openShortcuts },
  {
    name: "git",
    descKey: "slash.gitDesc",
    tsp: "studio",
    run: (taskId) => openGitDialog({ kind: "commit", taskId }),
  },
  {
    name: "rename",
    descKey: "slash.renameDesc",
    tsp: "studio",
    run: (taskId, args) => (args === "" ? emitStudioCommand("rename") : window.studio.renameTask(taskId, args)),
  },
  // 归档：和侧栏、命令面板同一个动作（8 秒内可撤销）。
  {
    name: "delete",
    descKey: "slash.deleteDesc",
    tsp: "studio",
    run: (taskId, _args, t) => archiveWithUndo(taskId, taskId, t),
  },
  // 模型、思考强度、用量、上下文：开输入框工具行上对应的 studio 弹层。
  {
    name: "model",
    aliases: ["switch"],
    descKey: "slash.modelDesc",
    tsp: "studio",
    run: openModelPicker,
    draft: openModelPicker,
  },
  { name: "effort", descKey: "slash.effortDesc", tsp: "studio", run: openModelPicker, draft: openModelPicker },
  { name: "usage", descKey: "slash.usageDesc", tsp: "studio", run: openUsage, draft: openUsage },
  {
    name: "context",
    descKey: "slash.contextDesc",
    tsp: "studio",
    run: (taskId, _args, t) => {
      if (getTask(taskId)?.contextUsage === null) pushToast({ level: "info", message: t("slash.contextEmpty") });
      else emitStudioCommand("context");
    },
  },
  {
    name: "compact",
    descKey: "slash.compactDesc",
    run: (_taskId, args, t) => {
      // rpc compact 不带附加说明；不能悄悄丢掉用户写的话。
      if (args !== "") throw new Error(t("slash.compactArgs"));
      emitStudioCommand("compact");
    },
  },
  {
    name: "todo",
    descKey: "slash.todoDesc",
    run: (taskId, _args, t) => {
      const phases = getTask(taskId)?.todoPhases ?? [];
      if (phases.every((phase) => phase.tasks.length === 0))
        pushToast({ level: "info", message: t("slash.todoEmpty") });
      else emitStudioCommand("todo");
    },
  },
];

// omp-studio 接管的斜杠命令表（判定逻辑在 studio-slash.ts，纯函数）。
// 各功能在这里各加一行，import 自己的处理函数；不在别处注册。
// 桌面优先：能在 studio 自己的界面里做的事，输入同名命令就打开 studio 的界面，不去触发 omp 的终端弹窗。
// 不写 `draft` 的命令只在任务的输入框里有；写了 `draft` 的在新任务草稿页也有（见 StudioSlashCommand）。
import { pushToast } from "../dialogs/index.ts";
import { startDraft } from "../empty/index.ts";
import { openGitDialog } from "../git/git-dialog-store.ts";
import { exportConversation } from "./export-html.ts";
import { btwSlash } from "../btw/btw-slash.ts";
import { forkFromMessage } from "../conversation/fork-actions.ts";
import { openSessionTree } from "../conversation/session-tree-store.ts";
import { goalSlash } from "../goal/goal-slash.ts";
import { dirsSlashCommands } from "../file-preview/dirs-slash.ts";
import { pluginsSlashCommands } from "../settings/plugins-slash.ts";
import { integrationsSlashCommands } from "../settings/integrations-slash.ts";
import { jobsSlash } from "./jobs-slash.ts";
import { agentsSlash } from "../agents/agents-slash.ts";
import { sessionInfoSlashCommands } from "../session-info/session-slash.ts";
import { toggleSlashCommands } from "../session-toggles/toggles-slash.ts";
import { emitStudioCommand } from "../palette/studio-command.ts";
import { archiveWithUndo } from "../sidebar/archive-store.ts";
import { getTask, setPaletteOpen, showView } from "../../store/index.ts";
import type { StudioSlashCommand } from "./studio-slash.ts";
import { setUsageDialogOpen } from "./usage-store.ts";

const openSettings = () => showView("settings");
const openShortcuts = () => showView("settings", { section: "shortcuts" });
const openModelPicker = () => emitStudioCommand("model");
const openUsage = () => setUsageDialogOpen(true);
const openPalette = () => setPaletteOpen(true);

export const studioSlashCommands: readonly StudioSlashCommand[] = [
  // 会话类：导出走 `omp --export`（对会话文件），其余 omp 在过程区里自己画界面。
  {
    name: "export",
    descKey: "slash.exportDesc",
    run: (taskId, _args, t) => exportConversation(taskId, t),
  },
  // /btw：由 studio 接管（旁路提问面板；omp 把它画成 modal 弹窗，studio 读弹窗里的问答、不画弹窗；docs/architecture/tsp-btw.md）。
  btwSlash,
  // /tree、/fork：由 studio 接管（docs/architecture/session-tree.md）：树读会话文件，回溯驱动 omp 的 /tree，分叉用 omp --fork 起新任务。
  { name: "tree", descKey: "slash.treeDesc", run: (taskId) => openSessionTree(taskId) },
  { name: "fork", descKey: "slash.forkDesc", run: (taskId) => forkFromMessage(taskId, null) },
  // /goal：由 studio 接管（目标条读输入框卡片上的"Goal …"行，操作发 omp 的 `/goal pause|resume|drop|<文字>`；docs/architecture/conversation.md「目标模式」）。
  goalSlash,
  // 导航与设置：直接开 studio 的界面。
  {
    name: "new",
    descKey: "slash.newDesc",
    run: (taskId) => startDraft(getTask(taskId)?.projectId ?? null),
  },
  { name: "resume", descKey: "slash.resumeDesc", run: openPalette, draft: openPalette },
  { name: "settings", descKey: "slash.settingsDesc", run: openSettings, draft: openSettings },
  { name: "hotkeys", descKey: "slash.hotkeysDesc", run: openShortcuts, draft: openShortcuts },
  {
    name: "git",
    descKey: "slash.gitDesc",
    run: (taskId) => openGitDialog({ kind: "commit", taskId }),
  },
  {
    name: "rename",
    descKey: "slash.renameDesc",
    run: (taskId, args) => (args === "" ? emitStudioCommand("rename") : window.studio.renameTask(taskId, args)),
  },
  // 归档：和侧栏、命令面板同一个动作（8 秒内可撤销）。
  {
    name: "delete",
    descKey: "slash.deleteDesc",
    run: (taskId, _args, t) => archiveWithUndo(taskId, taskId, t),
  },
  // 模型、思考强度、用量、上下文：开输入框工具行上对应的 studio 弹层。
  {
    name: "model",
    aliases: ["switch"],
    descKey: "slash.modelDesc",
    run: openModelPicker,
    draft: openModelPicker,
  },
  { name: "effort", descKey: "slash.effortDesc", run: openModelPicker, draft: openModelPicker },
  { name: "usage", descKey: "slash.usageDesc", run: openUsage, draft: openUsage },
  {
    name: "context",
    descKey: "slash.contextDesc",
    run: (taskId, _args, t) => {
      if (getTask(taskId)?.contextUsage === null) pushToast({ level: "info", message: t("slash.contextEmpty") });
      else emitStudioCommand("context");
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
  // 工作区目录（/add-dir）：文件面板顶部的"工作区目录"行是它的界面，命令是快捷入口（S7）。
  ...dirsSlashCommands,
  // 插件和市场：设置 → 插件页是它们的界面（S6）；/reload-plugins 在当前任务里重新加载。
  ...pluginsSlashCommands,
  // 会话开关和模型预设（/skillful /extended-context /computer /advisor /browser /prewalk /modelpreset）：输入框上的"会话开关"菜单是它们的界面（S4）。
  ...toggleSlashCommands,
  // 后台作业（/jobs、/jobs kill <id>|all）：输入框上方的作业弹层是它的界面（S2Jobs）。
  jobsSlash,
  // MCP / SSH / 工具 / 记忆 / 更新日志（/mcp /ssh /tools /memory /changelog）：设置页里对应的卡片是它们的界面（S5）。
  ...integrationsSlashCommands,
  // 会话信息 / 请求记录 / 置顶 / 分享 / 重试（/session /trace /pin /share /retry）：会话信息对话框、分享确认框等是它们的界面（S3）。
  ...sessionInfoSlashCommands,
  // 子代理面板（/hub）：右栏的子代理面板是它的界面，不弹 omp 的 Agent Hub（S1Agents）。
  agentsSlash,
];

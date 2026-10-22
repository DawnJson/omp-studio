// `/plugins`、`/marketplace`、`/reload-plugins`（studio 接管，不弹 omp 的 TSP 选择器）。
// /plugins、/marketplace 打开设置 → 插件页；带参数时不悄悄丢掉用户写的话（和 /compact 一样报错，草稿放回输入框）。
// /reload-plugins 在当前任务里重新加载（TaskCommand reloadPlugins，经任务自己的 omp 会话跑 `/reload-plugins`）。
import { pushToast } from "../dialogs/index.ts";
import { showView } from "../../store/index.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";

const openPlugins = (args: string, t: Parameters<StudioSlashCommand["run"]>[2]) => {
  if (args !== "") throw new Error(t("slash.pluginsArgs"));
  showView("settings", { section: "plugins" });
};

export const pluginsSlashCommands: readonly StudioSlashCommand[] = [
  {
    name: "plugins",
    descKey: "slash.pluginsDesc",
    run: (_taskId, args, t) => openPlugins(args, t),
    draft: (args, t) => openPlugins(args, t),
  },
  {
    name: "marketplace",
    descKey: "slash.marketplaceDesc",
    run: (_taskId, args, t) => openPlugins(args, t),
    draft: (args, t) => openPlugins(args, t),
  },
  {
    name: "reload-plugins",
    descKey: "slash.reloadPluginsDesc",
    run: async (taskId, args, t) => {
      if (args !== "") throw new Error(t("slash.reloadPluginsArgs"));
      await window.studio.runTaskCommand(taskId, { kind: "reloadPlugins" });
      pushToast({ level: "info", message: t("slash.reloadPluginsDone") });
    },
  },
];

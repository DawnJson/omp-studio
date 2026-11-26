// `/plugins`、`/marketplace`、`/reload-plugins`（studio 接管，不弹 omp 的 TSP 选择器）。
// /plugins、/marketplace 不带参数打开设置 → 集成与插件页；任务里带参数时原样交给 omp，草稿页没有 omp，报错、草稿放回输入框。
// /reload-plugins 在当前任务里重新加载（TaskCommand reloadPlugins，经任务自己的 omp 会话跑 `/reload-plugins`）。
import { pushToast } from "../dialogs/index.ts";
import { showView } from "../../store/index.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";

const openPlugins = () => showView("settings", { section: "extensions" });

export const pluginsSlashCommands: readonly StudioSlashCommand[] = [
  ...["plugins", "marketplace"].map((name): StudioSlashCommand => ({
    name,
    descKey: name === "plugins" ? "slash.pluginsDesc" : "slash.marketplaceDesc",
    run: (_taskId, args) => {
      if (args !== "") return "omp";
      openPlugins();
    },
    draft: (args, t) => {
      if (args !== "") throw new Error(t("slash.pluginsArgs"));
      openPlugins();
    },
  })),
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

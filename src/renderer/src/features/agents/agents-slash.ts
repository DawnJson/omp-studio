// `/hub`（S1，spec §4.28）：studio 接管——TSP 任务打开右栏的子代理面板（不弹 omp 的 Agent Hub）；rpc 任务的子代理在对话的过程行里（泳道），提示一句。
import { getTask } from "../../store/index.ts";
import { pushToast } from "../dialogs/toast-store.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { openAgentsPanel } from "./agents-store.ts";

export const agentsSlash: StudioSlashCommand = {
  name: "hub",
  descKey: "agents.slashDesc",
  tsp: "studio",
  run: (taskId, _args, t) => {
    if (getTask(taskId)?.engine === "tsp") openAgentsPanel(taskId);
    else pushToast({ level: "info", message: t("agents.rpcHint") });
  },
};

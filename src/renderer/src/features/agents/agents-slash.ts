// `/hub`（S1，spec §4.28）：studio 接管——打开右栏的子代理面板（不弹 omp 的 Agent Hub）。
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { openAgentsPanel } from "./agents-store.ts";

export const agentsSlash: StudioSlashCommand = {
  name: "hub",
  descKey: "agents.slashDesc",
  run: (taskId) => openAgentsPanel(taskId),
};

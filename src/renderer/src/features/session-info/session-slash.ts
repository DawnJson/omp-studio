// /session /trace /pin /share /retry 的斜杠命令行（命令表在 composer/studio-slash-table.ts）：
// 对话框、置顶、分享确认框、重试是它们的界面；rpc 任务和 TSP 任务都由 studio 接管（`tsp: "studio"`）。
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { retryTask, togglePin } from "./session-info-actions.ts";
import { openSessionInfo, openShareDialog } from "./session-info-store.ts";

export const sessionInfoSlashCommands: readonly StudioSlashCommand[] = [
  {
    name: "session",
    descKey: "sessionInfo.slash.session",
    tsp: "studio",
    run: (taskId) => openSessionInfo(taskId, "info"),
  },
  {
    name: "trace",
    descKey: "sessionInfo.slash.trace",
    tsp: "studio",
    run: (taskId) => openSessionInfo(taskId, "trace"),
  },
  {
    name: "pin",
    descKey: "sessionInfo.slash.pin",
    tsp: "studio",
    run: (taskId, _args, t) => void togglePin(t, taskId),
  },
  { name: "share", descKey: "sessionInfo.slash.share", tsp: "studio", run: (taskId) => openShareDialog(taskId) },
  {
    name: "retry",
    descKey: "sessionInfo.slash.retry",
    tsp: "studio",
    run: (taskId, _args, t) => void retryTask(t, taskId),
  },
];

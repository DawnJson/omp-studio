// /session /trace /pin /share /retry 的斜杠命令行（命令表在 composer/studio-slash-table.ts）：
// 对话框、置顶、分享确认框、重试是它们的界面；由 studio 接管。
import type { StudioSlashCommand } from "../composer/studio-slash.ts";
import { retryTask, togglePin } from "./session-info-actions.ts";
import { openSessionInfo, openShareDialog } from "./session-info-store.ts";

export const sessionInfoSlashCommands: readonly StudioSlashCommand[] = [
  {
    name: "session",
    descKey: "sessionInfo.slash.session",
    run: (taskId) => openSessionInfo(taskId, "info"),
  },
  {
    name: "trace",
    descKey: "sessionInfo.slash.trace",
    run: (taskId) => openSessionInfo(taskId, "trace"),
  },
  {
    name: "pin",
    descKey: "sessionInfo.slash.pin",
    run: (taskId, _args, t) => void togglePin(t, taskId),
  },
  { name: "share", descKey: "sessionInfo.slash.share", run: (taskId) => openShareDialog(taskId) },
  {
    name: "retry",
    descKey: "sessionInfo.slash.retry",
    run: (taskId, _args, t) => void retryTask(t, taskId),
  },
];

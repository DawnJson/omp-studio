// 会话信息 / 分享对话框的挂载点（App 里放一个）：订阅开关 store；关闭后留着上一次的内容放完退出动画。
import { useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { ShareDialog } from "./ShareDialog.tsx";
import { SessionInfoDialog } from "./SessionInfoDialog.tsx";
import { useSessionInfoState, useShareDialogTask, type SessionInfoState } from "./session-info-store.ts";

export function SessionInfoHost() {
  const state = useSessionInfoState();
  const shareTask = useShareDialogTask();
  const [lastInfo, setLastInfo] = useState<SessionInfoState | null>(state);
  const [lastShare, setLastShare] = useState<TaskId | null>(shareTask);
  if (state !== null && state !== lastInfo) setLastInfo(state);
  if (shareTask !== null && shareTask !== lastShare) setLastShare(shareTask);
  return (
    <>
      {lastInfo !== null && <SessionInfoDialog taskId={lastInfo.taskId} tab={lastInfo.tab} open={state !== null} />}
      {lastShare !== null && <ShareDialog taskId={lastShare} open={shareTask !== null} />}
    </>
  );
}

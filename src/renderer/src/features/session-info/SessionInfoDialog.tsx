// 会话信息对话框（`/session`、`/trace`、顶栏任务菜单、命令面板）：两个页签——概览、请求记录。
// 任务没了（被归档/删除）就自动关。分享在底部按钮，先经确认框（ShareDialog）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTask } from "../../store/index.ts";
import { DialogShell } from "./DialogShell.tsx";
import { InfoTab } from "./InfoTab.tsx";
import { closeSessionInfo, openShareDialog, openSessionInfo, type SessionInfoTab } from "./session-info-store.ts";
import { TraceTab } from "./TraceTab.tsx";
import { useSyncedRead } from "./use-synced-read.ts";

function TabBar({ taskId, tab }: { taskId: TaskId; tab: SessionInfoTab }) {
  const t = useT();
  const tabs: SessionInfoTab[] = ["info", "trace"];
  return (
    <div className="si-tabs" role="tablist">
      {tabs.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          className="si-tab"
          aria-selected={tab === value}
          data-testid={`si-tab-${value}`}
          onClick={() => openSessionInfo(taskId, value)}
        >
          {t(`sessionInfo.tab.${value}`)}
        </button>
      ))}
    </div>
  );
}

function InfoPage({ taskId }: { taskId: TaskId }) {
  const task = useTask(taskId);
  const read = useSyncedRead((refresh) => window.studio.getTaskSessionInfo(taskId, refresh), taskId);
  if (task === null) return null;
  return <InfoTab task={task} read={read} />;
}

function TracePage({ taskId }: { taskId: TaskId }) {
  const read = useSyncedRead((refresh) => window.studio.getTaskSessionTrace(taskId, refresh), taskId);
  return <TraceTab read={read} />;
}

export function SessionInfoDialog({ taskId, tab, open }: { taskId: TaskId; tab: SessionInfoTab; open: boolean }) {
  const t = useT();
  const task = useTask(taskId);
  if (task === null) return null;
  return (
    <DialogShell
      title={t("sessionInfo.title")}
      testId="session-info-dialog"
      wide={tab === "trace"}
      open={open}
      onClose={closeSessionInfo}
      tabs={<TabBar taskId={taskId} tab={tab} />}
      footer={
        <button type="button" className="gate-btn" data-testid="si-share" onClick={() => openShareDialog(taskId)}>
          {t("sessionInfo.share.button")}
        </button>
      }
    >
      {tab === "info" ? <InfoPage taskId={taskId} /> : <TracePage taskId={taskId} />}
    </DialogShell>
  );
}

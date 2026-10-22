// 会话信息对话框（`/session`、`/trace`、顶栏任务菜单、命令面板）：两个页签——概览、请求记录。
// 任务没了（被归档/删除）就自动关。分享只从任务菜单 / 命令面板 / `/share` 进（先经确认框 ShareDialog），这里不叠对话框。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { useTask } from "../../store/index.ts";
import { Tabs, tabPanelProps } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { InfoTab } from "./InfoTab.tsx";
import { closeSessionInfo, openSessionInfo, type SessionInfoTab } from "./session-info-store.ts";
import { TraceTab } from "./TraceTab.tsx";
import { useSyncedRead } from "./use-synced-read.ts";
import "./session-info.css";

const idBase = "si";

function TabBar({ taskId, tab }: { taskId: TaskId; tab: SessionInfoTab }) {
  const t = useT();
  return (
    <div className="si-tabs">
      <Tabs
        tabs={[
          { id: "info", label: t("sessionInfo.tab.info") },
          { id: "trace", label: t("sessionInfo.tab.trace") },
        ]}
        value={tab}
        onChange={(next) => openSessionInfo(taskId, next)}
        label={t("sessionInfo.title")}
        idBase={idBase}
        testId="si-tab"
      />
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
    <Dialog
      title={t("sessionInfo.title")}
      testId="session-info-dialog"
      size="lg"
      open={open}
      onClose={closeSessionInfo}
      tabs={<TabBar taskId={taskId} tab={tab} />}
    >
      <div className="si-page" {...tabPanelProps(idBase, tab)}>
        {tab === "info" ? <InfoPage taskId={taskId} /> : <TracePage taskId={taskId} />}
      </div>
    </Dialog>
  );
}

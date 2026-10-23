// 顶栏右侧工具区、文件面板按钮右边的子代理面板按钮（只有任务有，草稿没有子代理）。按钮状态 = 这个任务的子代理面板是否开着；
// 和输入框上方的子代理药丸（只在有子代理运行时出现）不同，它一直在，点开看这个任务派过的全部子代理。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Users } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { toggleAgentsPanel, useAgentsPanel } from "./agents-store.ts";

export function AgentsToggle({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const open = useAgentsPanel()?.taskId === taskId;
  return (
    <IconButton
      label={t("agents.panelLabel")}
      pressed={open}
      expanded={open}
      testId="topbar-agents"
      onClick={() => toggleAgentsPanel(taskId)}
    >
      <Users size={16} />
    </IconButton>
  );
}

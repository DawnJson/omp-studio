// TSP 错误卡（omp.error）旁的"重试"按钮：只在对话末尾那张错误卡、任务空闲时显示。点了发 `/retry`（runTaskCommand {kind:"retry"}）。
// 判断见 shared/tsp/error-turn.ts；omp 自己卡片上的"Retry F5"不画（isOmpErrorDuplicate），重试只有这个按钮；F5 仍由输入框转发给 omp。
import { useT } from "../../i18n/use-t.ts";
import { Button } from "../../ui/controls.tsx";
import { useTask } from "../../store/index.ts";
import { useIsTrailingErrorCard } from "../tsp/tsp-store.ts";
import { retryTask } from "./session-info-actions.ts";
import type { TaskId } from "../../../../shared/ipc.ts";
import "./session-info.css";

export function RetryButton({ taskId, sf, id }: { taskId: TaskId; sf: string; id: string }) {
  const t = useT();
  const task = useTask(taskId);
  const trailing = useIsTrailingErrorCard(taskId, sf, id);
  if (!trailing || task === null || task.status !== "idle") return null;
  return (
    <div className="si-retry">
      <Button size="sm" testId="retry-turn" onClick={() => void retryTask(t, taskId)}>
        {t("sessionInfo.retry.button")}
      </Button>
    </div>
  );
}

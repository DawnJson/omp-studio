// TSP 任务输入框上方右侧的后台任务 / 子代理按钮（S2Jobs）：和 rpc 任务同一个 JobsBoard，数据换成从 omp 节点推出来的（tsp-jobs-store）。
// omp 自己的 hud 作业胶囊不画（TspChildren 隐藏了 hud），这里是唯一入口；没有作业时整行不占位（JobsBoard 返回 null，.status-bar 空）。
import type { TaskState } from "../../../../shared/ipc.ts";
import { JobsBoard } from "./JobsBoard.tsx";
import { useTspJobs } from "./tsp-jobs-store.ts";

export function TspJobsBar({ task }: { task: TaskState }) {
  const jobs = useTspJobs(task.id, true);
  return (
    <div className="status-bar" data-testid="tsp-jobs-bar">
      <JobsBoard taskId={task.id} jobs={jobs} projectPath={task.cwd} tsp />
    </div>
  );
}

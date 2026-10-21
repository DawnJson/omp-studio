// 后台作业（job）的数据形状和计数。作业从 TSP 文档推导（shared/tsp/jobs.ts），纯函数，不碰 DOM。

type JobStatus = "running" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string;
  type: "bash" | "task";
  label: string;
  status: JobStatus;
  /** 主进程接收时间（ms）；只在 /jobs 弹窗里见过的作业是按弹窗里的时长倒推的。 */
  startedAt: number;
  /** omp 量的时长；还没有时为 null（运行中的由界面用现在 - startedAt）。 */
  durationMs: number | null;
  /** bash 的输出尾部（累积输出的最后一段）；其他类型和没有输出时为 null。 */
  output: string | null;
}

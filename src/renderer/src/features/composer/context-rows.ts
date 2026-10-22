// 上下文构成的行（ContextBreakdown 用）。任务里是 omp 现算的 /context 报告（ContextReport.rows，行和数字照 omp）；
// 新任务草稿还没有 omp 进程，行在这里算（纯函数）：已用 0，剩余空间 + 自动压缩预留（窗口 - omp 的压缩触发点）。
import type { ContextReportRow } from "../../../../shared/ipc.ts";

/** 草稿的行：trigger 是 omp 的压缩触发点（token 数），读不到压缩设置时为 null，不分出预留段。名称照 omp 的英文。 */
export function draftContextRows(window: number, trigger: number | null): ContextReportRow[] {
  const buffer = trigger === null ? 0 : Math.max(0, window - trigger);
  const rows: ContextReportRow[] = [
    { key: "messages", label: "Messages", tokens: 0 },
    { key: "free", label: "Free space", tokens: window - buffer },
  ];
  if (buffer > 0) rows.push({ key: "buffer", label: "Autocompact buffer", tokens: buffer });
  return rows;
}

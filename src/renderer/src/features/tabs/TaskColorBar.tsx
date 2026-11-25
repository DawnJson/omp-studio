// 任务颜色的竖条（spec §4.6）：标签和侧栏任务行共用；没设颜色不画。颜色在外壳状态 taskColors 里（window-state.json）。
import type { TaskId } from "../../../../shared/ipc.ts";
import { useShellValue } from "../../app/shell-store.ts";

export function TaskColorBar({ id }: { id: TaskId }) {
  const color = useShellValue("taskColors")[id];
  if (color === undefined) return null;
  return (
    <span
      className="task-color"
      aria-hidden="true"
      data-testid="task-color"
      data-color={color}
      style={{ background: `var(--chart-${color})` }}
    />
  );
}

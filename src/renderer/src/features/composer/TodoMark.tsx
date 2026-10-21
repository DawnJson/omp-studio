// 待办的状态图标（待办板按钮、阶段头、条目共用）：细线条、同一套 16×16 画布。
//   done      一个干净的对勾（没有圈、没有实心底）；
//   active    进行中：一圈很淡的底 + 一段细弧，`spinning`（任务在跑）时弧绕圈转，不转时停住；`progress`（0–1）给弧的长度；
//   pending   未开始：一圈细线；
//   blocked   受阻：红色细圈 + 感叹号；
//   abandoned 放弃：虚线圈，淡化。
// 转动用 --play-state：减少动效时弧停在原位（仍看得出"进行中"）。
export type TodoMarkState = "done" | "active" | "pending" | "blocked" | "abandoned";

export function TodoMark({
  state,
  spinning = false,
  progress,
  className,
}: {
  state: TodoMarkState;
  spinning?: boolean;
  /** active：弧占整圈的比例（0–1）；缺省 0.28（进行中的一小段）。 */
  progress?: number | undefined;
  className?: string;
}) {
  const cls = className ? `todo-mark-ico ${className}` : "todo-mark-ico";
  if (state === "done") {
    return (
      <svg className={cls} data-state="done" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.6 6.7 11.7 12.5 4.8" />
      </svg>
    );
  }
  if (state === "active") {
    const arc = Math.round(Math.min(Math.max(progress ?? 0.28, 0.08), 0.96) * 100);
    return (
      <svg
        className={cls}
        data-state="active"
        data-spinning={spinning || undefined}
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle className="todo-mark-track" cx="8" cy="8" r="6" />
        <circle
          className="todo-mark-arc"
          cx="8"
          cy="8"
          r="6"
          pathLength="100"
          strokeDasharray={`${arc} ${100 - arc}`}
        />
      </svg>
    );
  }
  if (state === "blocked") {
    return (
      <svg className={cls} data-state="blocked" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5.2v3.4M8 10.8v.01" />
      </svg>
    );
  }
  return (
    <svg className={cls} data-state={state} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

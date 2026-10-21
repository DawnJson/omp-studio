// TSP 任务输入框上方的待办板：数据是 TaskState.todoPhases（主进程从 omp 的 HUD 待办节点换算，shared/tsp/todos.ts）。
// omp 自己画的 HUD 药丸被隐藏（TspChildren.tsx），所以这里是唯一入口；运行状态、后台任务仍在 omp 的 dock 里。
// 过程默认折叠：只有一个按钮（环 + 当前项 + done/total），点开才列阶段与条目；没有待办时整行不占位。
import type { TaskState } from "../../../../shared/ipc.ts";
import { summarizeTodos } from "../conversation/todo-model.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { TodoBoard } from "./TodoBoard.tsx";
import { useHeld } from "./use-held.ts";

export function TspTodoBar({ task }: { task: TaskState }) {
  const summary = summarizeTodos(task.todoPhases);
  const visible = summary.total > 0;
  // 收起动画期间内容不能先消失：保留最后一次有内容时的快照。
  const held = useHeld(visible ? { phases: task.todoPhases, summary, running: task.status === "running" } : null);
  return (
    <Reveal open={visible}>
      {held && (
        <div className="run-status" data-testid="tsp-todo-bar">
          <TodoBoard phases={held.phases} summary={held.summary} running={held.running} />
        </div>
      )}
    </Reveal>
  );
}

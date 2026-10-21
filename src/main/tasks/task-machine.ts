// 任务状态机：纯函数 `transition(state, input)`，每条转换见 docs/architecture/task-model.md，test/task-machine.test.ts 逐条覆盖。
// 渲染进程看到的 TaskStatus 由这里算出：有未答的门（提问、审批）一定是 needs_you。
import type { DialogRequest, TaskError, TaskStatus, TurnOutcome } from "../../shared/ipc.ts";
import type { PromptError, PromptStatus } from "../../shared/omp-wire/rpc-wire.generated.ts";

export interface MachineState {
  status: TaskStatus;
  /** omp 正在跑一轮（agent_start），直到这一轮结束（prompt_result）。 */
  working: boolean;
  dialogs: DialogRequest[];
  lastTurn: TurnOutcome | null;
  error: TaskError | null;
  unread: boolean;
}

export type MachineInput =
  | { type: "start" }
  | { type: "ready" }
  | { type: "start_failed"; error: TaskError }
  | { type: "agent_start" }
  | {
      type: "prompt_result";
      status: PromptStatus;
      error?: PromptError;
      at: number;
      foreground: boolean;
    }
  | { type: "dialog_open"; request: DialogRequest }
  /** 应答已发出，或收到 omp 的 cancel。 */
  | { type: "dialog_close"; id: string }
  /** 进程意外退出。 */
  | { type: "failed"; error: TaskError }
  /** 我们主动关的（回收、归档、关应用）。 */
  | { type: "stopped" }
  | { type: "mark_read" };

export function initialMachineState(status: TaskStatus = "stopped"): MachineState {
  return { status, working: false, dialogs: [], lastTurn: null, error: null, unread: false };
}

/** starting / error / stopped 由生命周期输入决定；其余状态由对话框和 working 推导。 */
function derive(state: MachineState): MachineState {
  if (state.status === "starting" || state.status === "error" || state.status === "stopped") return state;
  const status: TaskStatus = state.dialogs.length > 0 ? "needs_you" : state.working ? "running" : "idle";
  return status === state.status ? state : { ...state, status };
}

function isLive(state: MachineState): boolean {
  return state.status === "idle" || state.status === "running" || state.status === "needs_you";
}

export function transition(state: MachineState, input: MachineInput): MachineState {
  switch (input.type) {
    case "start":
      if (state.status !== "stopped" && state.status !== "error") return state;
      return { ...state, status: "starting", working: false, dialogs: [], error: null };
    case "ready":
      return state.status === "starting" ? derive({ ...state, status: "idle" }) : state;
    case "start_failed":
      return { ...state, status: "error", working: false, dialogs: [], error: input.error };
    case "agent_start":
      return isLive(state) ? derive({ ...state, working: true }) : state;
    case "prompt_result": {
      if (!isLive(state)) return state;
      const lastTurn: TurnOutcome = {
        status: input.status,
        endedAt: input.at,
        ...(input.error && { error: input.error }),
      };
      return derive({
        ...state,
        lastTurn,
        working: false,
        unread: state.unread || !input.foreground,
      });
    }
    case "dialog_open":
      if (!isLive(state)) return state;
      return derive({ ...state, dialogs: [...state.dialogs.filter((d) => d.id !== input.request.id), input.request] });
    case "dialog_close":
      if (!state.dialogs.some((d) => d.id === input.id)) return state;
      return derive({ ...state, dialogs: state.dialogs.filter((d) => d.id !== input.id) });
    case "failed":
      return { ...state, status: "error", working: false, dialogs: [], error: input.error };
    case "stopped":
      return { ...state, status: "stopped", working: false, dialogs: [] };
    case "mark_read":
      // 用户看过：清除未读，并清掉错误色（lastTurn 为 error 时）。
      return { ...state, unread: false, lastTurn: state.lastTurn?.status === "error" ? null : state.lastTurn };
  }
}

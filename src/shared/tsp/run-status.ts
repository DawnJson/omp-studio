// OSC 7501：omp 的"程序状态"（设置 `terminal.programStatus`，默认开；TERM_PROGRAM=tern 且 stdout 是 TTY 时发），
// 照 omp 18.12.6 源码 `utils/run-status.ts` 和真实 omp 实测（docs/architecture/tsp-migration.md §7）：
//   ESC ] 7501 ; state=<s> [: kind=question|permission] : app=omp [: msg=<base64 UTF-8>] ESC \
// - `working`：一轮开始（agent_start）、被阻塞的工具结束后也回到它；
// - `blocked`：`kind=question`（ask 工具，msg = 问题）或 `kind=permission`（要审批的工具，msg = "Allow tool: bash Command: …"）。
//   注意：审批通过后工具开始执行，omp 不再发新状态，`blocked` 一直保持到这个工具结束（实测 permission2 探针：批准后 14 秒仍是 blocked）；
// - `idle`：一轮被中断（Esc）、重试间隙、会话切换；`done`：一轮正常结束；`error`：一轮以错误结束，msg = 错误文字；
// - `clear`：omp 不再报告（关了 `terminal.programStatus`、退出时）。
// 没有启用时一条都收不到。msg 只有 blocked 和 error 带，最多 2048 字节再 base64。纯函数。

export type RunState = "working" | "blocked" | "idle" | "done" | "error";
export type BlockedKind = "question" | "permission";

export interface RunStatus {
  state: RunState;
  /** 只有 blocked 带；omp 以后加了别的值时为 null。 */
  kind: BlockedKind | null;
  /** blocked 的问题 / 审批标题、error 的错误文字；没带为 null。 */
  msg: string | null;
}

export type RunStatusMessage = RunStatus | { state: "clear" };

const STATES: ReadonlySet<string> = new Set(["working", "blocked", "idle", "done", "error"]);

/** base64 → UTF-8 文字（msg 里有中文和 emoji）。 */
function decodeBase64Utf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/** OSC 的内容（`7501;` 之后的部分，如 `state=blocked:kind=question:app=omp:msg=…`）→ 状态；认不出为 null。 */
export function parseRunStatus(body: string): RunStatusMessage | null {
  const fields = new Map<string, string>();
  for (const part of body.split(":")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const state = fields.get("state");
  if (state === "clear") return { state };
  if (state === undefined || !STATES.has(state)) return null;
  const kind = fields.get("kind");
  const rawMsg = fields.get("msg");
  let msg: string | null = null;
  if (rawMsg !== undefined) {
    try {
      msg = decodeBase64Utf8(rawMsg);
    } catch {
      msg = null;
    }
  }
  return {
    state: state as RunState,
    kind: kind === "question" || kind === "permission" ? kind : null,
    msg,
  };
}

/** 一个 omp 进程里 OSC 7501 的累积结果；进程退出后换新的。 */
export interface RunSignal {
  /** 本进程里收到过（且没被 `clear`）：之后以它为主信号；没收到过的会话（`terminal.programStatus` 关了）退回节点推导。 */
  seen: boolean;
  /** 最近一条状态；还没收到为 null。 */
  state: RunState | null;
  kind: BlockedKind | null;
  msg: string | null;
  /** 这一轮的结局：从上一轮开始（`working` 或 `beginRun`）之后收到的最后一条 done / idle / error；还没结束为 null。 */
  ended: Extract<RunState, "done" | "idle" | "error"> | null;
  /** 这条 blocked 期间，对应的门节点（`omp.editor.ask*`）出现过：之后门节点没了就说明用户已经答了（见 `blockedOpen`）。 */
  gateShown: boolean;
}

export const NO_RUN_SIGNAL: RunSignal = {
  seen: false,
  state: null,
  kind: null,
  msg: null,
  ended: null,
  gateShown: false,
};

export function applyRunStatus(signal: RunSignal, message: RunStatusMessage): RunSignal {
  if (message.state === "clear") return NO_RUN_SIGNAL;
  const ended =
    message.state === "done" || message.state === "idle" || message.state === "error" ? message.state : null;
  return {
    seen: true,
    state: message.state,
    kind: message.state === "blocked" ? message.kind : null,
    msg: message.msg,
    // working 开始新的一轮；blocked 不改变这一轮的结局（还没结束）。
    ended: message.state === "blocked" ? signal.ended : ended,
    gateShown: false,
  };
}

/** 节点推导认为这一轮开始了（`working` 之前没收到，如交接）：上一轮留下的结局不能算到这一轮头上。 */
export function beginRun(signal: RunSignal): RunSignal {
  return signal.ended === null ? signal : { ...signal, ended: null };
}

/** 门节点是否在文档里：blocked 期间见到过它，之后它没了就是用户已经答了（要审批的工具之后还要执行，omp 不会再发状态）。 */
export function observeGate(signal: RunSignal, gatePresent: boolean): RunSignal {
  return signal.state === "blocked" && gatePresent && !signal.gateShown ? { ...signal, gateShown: true } : signal;
}

/** blocked 还有效：没有出现过门节点（门节点比状态晚几毫秒到），或门节点还在。 */
export function blockedOpen(signal: RunSignal, gatePresent: boolean): boolean {
  return signal.state === "blocked" && (!signal.gateShown || gatePresent);
}

export interface TurnResult {
  status: "completed" | "aborted" | "error";
  /** error 时 omp 给的错误文字。 */
  message?: string;
}

/**
 * 一轮结束时的结局。有 7501 的结局就用它（done → 完成，error → 出错并带 omp 的原文，idle → 被中断）；
 * 这一轮没收到过（交接等不经 7501 的运行、没开 programStatus）时看用户有没有按过停止。
 */
export function turnResult(signal: RunSignal, stopRequested: boolean): TurnResult {
  switch (signal.ended) {
    case "done":
      return { status: "completed" };
    case "error":
      return { status: "error", message: signal.msg ?? "" };
    case "idle":
      return { status: "aborted" };
    case null:
      return { status: stopRequested ? "aborted" : "completed" };
  }
}

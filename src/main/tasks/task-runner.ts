// 一个任务的运行时：omp 进程、状态机、帧 → TranscriptEvent、对话框 pending 表。
// 一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个进程；进程可被回收，任务和会话不会（docs/architecture/task-model.md）。
import type {
  DialogRequest,
  DialogResponse,
  ModelKey,
  ModelOption,
  Project,
  PromptInput,
  RestoredDraft,
  RestoredQueue,
  SessionTreeView,
  TaskError,
  TaskId,
  TaskNotice,
  TaskState,
  TranscriptBatch,
  TranscriptSnapshot,
} from "../../shared/ipc.ts";
import type { SubagentDetail, SubagentLane } from "../../shared/subagents.ts";
import {
  applyBtwEvent,
  mergeBtwHistory,
  btwLimits,
  interruptBtw,
  isBtwRunning,
  type BtwHistoryRecord,
  type BtwUiEvent,
} from "../../shared/btw.ts";
import type {
  AgentMessage,
  GoalOp,
  AvailableSlashCommand,
  BashExecutionMessage,
  BashResult,
  PromptParams,
  RpcServerFrame,
  SessionState,
  ThinkingLevel,
} from "../../shared/omp-wire/rpc-wire.generated.ts";
import { stat } from "node:fs/promises";
import path from "node:path";
import { log } from "../log/log.ts";
import { RpcProtocolError } from "../omp/frame-decoder.ts";
import type { OmpExit, OmpLaunch } from "../omp/omp-connection.ts";
import { OmpConnection, OmpExitedError, RpcCommandError } from "../omp/omp-connection.ts";
import { initializeSession, loadHistory } from "../omp/session-init.ts";
import { firstUserText, toModelOption, titleFromPrompt, toPromptImages, toRestoredDraft } from "./convert.ts";
import { DialogResponseError, toDialogRequest, toUiResponse } from "./dialogs.ts";
import { EventBatcher } from "./event-batcher.ts";
import { initialMachineState, transition, type MachineInput, type MachineState } from "./task-machine.ts";
import type { TaskRecord } from "./task-registry.ts";
import { messageKey, translateBtwFrame, translateFrame } from "./translate.ts";
import { SubagentRecord, type RecordSlice } from "./subagent-record.ts";
import { SubagentTracker } from "./subagent-tracker.ts";
import { NO_SESSION_EXTRAS, sessionExtras, type SessionExtras } from "./session-extras.ts";
import { sameGoal, toTaskGoal } from "./goal-state.ts";
import { buildSessionTree, locateUserEntry } from "./session-tree.ts";

/** rpc.md：入站帧应控制在 `maxFrameBytes`（默认 1 MiB）内，prompt 不分块。 */
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const STATE_REFRESH_MIN_INTERVAL_MS = 1_000;
const STDERR_LINES_IN_ERROR = 8;
const SUBAGENT_EMIT_INTERVAL_MS = 100;
/** 缓存完整记录的子代理数（每个最多 detailMessages 条 / detailBytes）。 */
const SUBAGENT_RECORD_CACHE = 6;

/** 运行时对外部世界的依赖：启动参数、Job Object、持久化、事件出口。池和测试各自提供。 */
export interface RunnerHost {
  buildLaunch(record: TaskRecord, project: Project): Promise<OmpLaunch>;
  /** 起进程前调用：必要时回收别的任务；超出硬上限时 reject（任务保持 stopped）。 */
  acquireSlot(id: TaskId): Promise<void>;
  assignJob(pid: number | undefined): void;
  persist(id: TaskId, patch: Partial<Omit<TaskRecord, "id">>): Promise<TaskRecord>;
  isForeground(id: TaskId): boolean;
  onState(state: TaskState): void;
  onTranscript(batch: TranscriptBatch): void;
  onNotice(notice: TaskNotice): void;
  onSlashCommands(taskId: TaskId, commands: AvailableSlashCommand[]): void;
  onSubagents(taskId: TaskId, lanes: SubagentLane[]): void;
  onBtw(taskId: TaskId, event: BtwUiEvent): void;
}

/** 存活进程数到了硬上限（软上限 × 2），拒绝再起。 */
export class TooManyTasksError extends Error {
  override name = "TooManyTasksError";
}

/** 分叉/回溯要求任务空闲：在跑、等确认或有后台任务时拒绝。 */
export class SessionBusyError extends Error {
  override name = "SessionBusyError";
  constructor() {
    super("the session is busy; wait for the current turn to finish");
  }
}

class TaskStartError extends Error {
  readonly taskError: TaskError;
  constructor(taskError: TaskError) {
    super(taskError.message);
    this.taskError = taskError;
  }
}

export class TaskRunner {
  readonly id: TaskId;
  #record: TaskRecord;
  readonly #project: Project;
  readonly #host: RunnerHost;
  readonly #batcher: EventBatcher;
  #machine: MachineState = initialMachineState("stopped");
  #connection: OmpConnection | null = null;
  #starting: Promise<void> | null = null;
  #closing = false;
  /** dispose() 之后：不再推任何事件，不能再启动。 */
  #disposed = false;
  /** 在途的会改变进程状态的命令（prompt、compact、set_model…）数；大于 0 时不可回收。 */
  #inflight = 0;
  #refreshAgain = false;
  /** 每次 spawn 递增；消息键 `${gen}:${messageId}`。 */
  #gen = 0;
  #model: ModelOption | null;
  #thinkingLevel: ThinkingLevel | null;
  #thinkingLevels: ThinkingLevel[] = [];
  #contextUsage: TaskState["contextUsage"] = null;
  #sessionUsage: TaskState["sessionUsage"] = null;
  #queue: TaskState["queue"] = { steering: [], followUp: [] };
  #todoPhases: TaskState["todoPhases"] = [];
  #extras: SessionExtras = NO_SESSION_EXTRAS;
  /** get_state.goal / goal_updated 的目标。goal_updated 每到一次 #goalSeq 加一，进行中的 get_state 应答据此判断自己是否已过期。 */
  #goal: TaskState["goal"] = null;
  #goalSeq = 0;
  /** 没有进程时改的名字，下次握手后发给 omp（set_session_name）。 */
  #pendingName: string | undefined;
  readonly #tracker = new SubagentTracker();
  /** 子代理完整记录的缓存（最近用到的在后）；进程退出时清空。queue 把同一子代理的读串起来。 */
  readonly #records = new Map<string, { record: SubagentRecord<AgentMessage>; queue: Promise<void> }>();
  #subagentsTimer: NodeJS.Timeout | undefined;
  /** 最近一次 get_state 的回收判据。 */
  #sessionSettled = false;
  /** prompt_result(settled) / session_settled 的计数：prompt 应答的续体可能晚于同一个数据块里的 prompt_result 才运行。 */
  #settleEpoch = 0;
  #lastStateAt = 0;
  #refreshing = false;
  #refreshTimer: NodeJS.Timeout | undefined;
  #lastActiveAt = Date.now();
  /** working 变 true 的时刻；working 为 false 时无意义。 */
  #runStartedAt = 0;
  /** 会话文件在第一轮之后才落盘；落盘前 get_state 给的路径不能存。 */
  #sessionPersistable: boolean;
  /** 在途的 `!命令` 数（omp 一次只许一条，多出的会被它拒绝，计数只用来判断要不要发 abort_bash）。 */
  #bashInFlight = 0;
  /** 在途的 bash 请求是否已发出（#live() 期间为 false）。 */
  #bashSent = false;
  /** bash 请求发出前收到的 abortBash：请求发出后立刻补发 abort_bash。 */
  #bashAbortPending = false;
  /** 最近发给 omp 的会话名，等它们的 session_info_update 回声（见 #adoptTitle）。 */
  readonly #sentNames = new Set<string>();
  /** `!命令` 消息在对话流里的序号（和 gen 一起组成 key）。 */
  #bashSeq = 0;
  /** 分叉/回溯进行中（见 #sessionExclusive）；null = 没有。 */
  #sessionOp: Promise<void> | null = null;
  /** 每次分叉/回溯开始和结束各加一：#refreshState 用它丢掉跨越了会话切换的应答。 */
  #sessionEpoch = 0;
  /** 旁路提问（`/btw`）的镜像：omp 是权威，这里按 btw_record / btw_delta 帧推进，没有进程时仍可读。 */
  #btw: readonly BtwHistoryRecord[] = [];
  /** 已经用 get_btw_history 对齐过的连接；进程换了要重读（进程退出时没落盘的 running 提问会被 omp 标成 interrupted）。 */
  #btwLoadedFor: OmpConnection | null = null;
  /** btw_record / btw_delta 帧到达一次加一：get_btw_history 的应答据此判断自己是否已过期（同 #goalSeq）。 */
  #btwSeq = 0;
  /** 在途的 set_fast_mode / set_slow_mode 数：期间 omp 推的说明性 notice / command_output 不进对话流。 */
  #speedCalls = 0;
  #btwLoading: Promise<void> | null = null;

  constructor(record: TaskRecord, project: Project, host: RunnerHost) {
    this.id = record.id;
    this.#record = record;
    this.#project = project;
    this.#host = host;
    this.#sessionPersistable = record.sessionFile !== null;
    this.#model = record.model
      ? {
          key: record.model,
          name: record.model.modelId,
          contextWindow: null,
          reasoning: false,
          acceptsImages: false,
          maxTokens: null,
          thinkingEfforts: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }
      : null;
    this.#thinkingLevel = record.thinkingLevel;
    this.#batcher = new EventBatcher((batch) => {
      if (!this.#disposed) host.onTranscript({ taskId: record.id, ...batch });
    });
  }

  // ───── 读 ─────

  get record(): TaskRecord {
    return this.#record;
  }

  get status(): TaskState["status"] {
    return this.#machine.status;
  }

  get hasProcess(): boolean {
    return this.#connection !== null;
  }

  get lastActiveAt(): number {
    return this.#lastActiveAt;
  }

  /** 可回收：idle、没有未答对话框、omp 报告已安静且没有后台任务（arch 2.3）。前台任务由池排除。 */
  get recyclable(): boolean {
    return (
      this.#machine.status === "idle" &&
      this.#machine.dialogs.length === 0 &&
      this.#sessionSettled &&
      this.#inflight === 0 &&
      !isBtwRunning(this.#btw) &&
      this.#goal?.status !== "active"
    );
  }

  get state(): TaskState {
    const m = this.#machine;
    return {
      id: this.id,
      projectId: this.#record.projectId,
      title: this.#record.title,
      status: m.status,
      unread: m.unread,
      lastTurn: m.lastTurn,
      error: m.error,
      createdAt: this.#record.createdAt,
      updatedAt: this.#record.updatedAt,
      model: this.#model,
      thinkingLevel: this.#thinkingLevel,
      thinkingLevels: this.#thinkingLevels,
      contextUsage: this.#contextUsage,
      sessionUsage: this.#sessionUsage,
      queue: this.#queue,
      todoPhases: this.#todoPhases,
      ...this.#extras,
      goal: this.#goal,
      dialogs: m.dialogs,
      runningSubagents: this.#tracker.runningCount,
      cwd: this.cwd,
      runStartedAt: m.working ? this.#runStartedAt : null,
    };
  }

  /** 释放对话快照（LRU 淘汰）；只在没有进程时调用，再次打开时从会话文件恢复历史。 */
  releaseSnapshot(): void {
    if (!this.#connection) this.#batcher.reset();
  }

  get hasSnapshot(): boolean {
    return this.#batcher.snapshot().transcript.items.length > 0;
  }

  snapshot(): TranscriptSnapshot {
    return { taskId: this.id, ...this.#batcher.snapshot() };
  }

  // ───── 状态 ─────

  #apply(input: MachineInput, options: { flush?: boolean } = {}): void {
    const next = transition(this.#machine, input);
    if (next === this.#machine) return;
    if (next.working && !this.#machine.working) this.#runStartedAt = Date.now();
    this.#machine = next;
    this.#publish(options.flush ?? true);
  }

  /** 状态变化立即冲刷对话流，再发状态，渲染进程看到的顺序和发生顺序一致。 */
  #publish(flush = true): void {
    if (this.#disposed) return;
    if (flush) this.#batcher.flush();
    this.#host.onState(this.state);
  }

  markRead(): void {
    this.#apply({ type: "mark_read" });
  }

  // ───── 生命周期 ─────

  /** 起进程并初始化；已在运行或启动中时返回同一个 promise。失败时状态已是 error，promise 也 reject。 */
  start(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("task was removed"));
    if (this.#connection && this.#machine.status !== "starting") return Promise.resolve();
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    if (this.#machine.status !== "stopped" && this.#machine.status !== "error")
      throw new Error(`cannot start a task that is ${this.#machine.status}`);
    this.#closing = false;
    this.#apply({ type: "start" });
    let connection: OmpConnection | null = null;
    try {
      // worktree 被删了（用户手动删、omp worktree clear…）：和 omp 一致，只能看记录。在占进程名额之前拒绝。
      const worktreePath = this.#record.worktreePath;
      if (
        worktreePath !== null &&
        !(await stat(worktreePath).then(
          () => true,
          () => false,
        ))
      )
        throw new TaskStartError({ kind: "worktree_missing", message: "the task's worktree no longer exists" });
      await this.#host.acquireSlot(this.id);
      this.#assertNotClosing();
      const launch = await this.#buildLaunch();
      this.#assertNotClosing();
      connection = OmpConnection.spawn(launch);
      const gen = ++this.#gen;
      // 同一个同步段里挂帧监听和放进 Job：不漏握手期间的帧，也缩小孙进程先于 assign 出生的窗口。
      connection.onFrame((frame) => this.#onFrame(connection!, gen, frame));
      this.#host.assignJob(connection.pid);
      this.#connection = connection;
      void connection.exited.then((exit) => this.#onExit(connection!, exit));
      await this.#handshake(connection);
      this.#assertNotClosing();
      this.#apply({ type: "ready" });
    } catch (error) {
      // 启动过程中被关闭或移除：丢掉连接，状态回到 stopped（不是 error），调用方的 start() 照样 reject。
      if (this.#closing || this.#disposed) {
        if (connection) await this.#discard(connection);
        this.#apply({ type: "stopped" });
        throw error;
      }
      const taskError = error instanceof TaskStartError ? error.taskError : this.#classifyStartError(error);
      if (connection) await this.#discard(connection);
      log.warn(`task ${this.id} failed to start`, taskError);
      this.#apply({ type: "start_failed", error: taskError });
      throw error;
    }
  }

  #assertNotClosing(): void {
    if (this.#closing || this.#disposed) throw new Error("task was stopped while starting");
  }

  async #buildLaunch(): Promise<OmpLaunch> {
    try {
      return await this.#host.buildLaunch(this.#record, this.#project);
    } catch (error) {
      throw new TaskStartError({
        kind: "omp_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #handshake(connection: OmpConnection): Promise<void> {
    await connection.ready;
    this.#assertNotClosing();
    const record = this.#record;
    const resumeSessionFile = record.sessionFile ?? undefined;
    const init = await initializeSession(connection, {
      ...(resumeSessionFile !== undefined && { resumeSessionFile }),
      ...(record.model && { restoreModel: record.model }),
    });
    this.#assertNotClosing();
    this.#sessionPersistable = this.#sessionPersistable || resumeSessionFile !== undefined;
    this.#thinkingLevels = init.thinkingLevels;
    await this.#adoptState(init.state, { adoptQueue: true });
    const pendingName = this.#pendingName;
    this.#pendingName = undefined;
    if (pendingName !== undefined) await this.#sendSessionName(connection, pendingName);
    // 回收后再打开的任务保留着最近的对话快照，不用历史覆盖它（会丢工具执行细节）。
    if (resumeSessionFile !== undefined && this.#batcher.snapshot().transcript.items.length === 0) {
      const messages = await loadHistory(connection);
      this.#batcher.push([{ type: "history", messages }]);
      if (this.#record.title === "")
        this.#record = await this.#host.persist(this.id, { title: titleFromPrompt(firstUserText(messages)) });
    }
  }

  #classifyStartError(error: unknown): TaskError {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof TooManyTasksError) return { kind: "too_many_tasks", message };
    if (error instanceof RpcCommandError && error.command === "switch_session" && /restore model/i.test(error.message))
      return { kind: "restore_model_failed", message };
    if (
      error instanceof OmpExitedError &&
      error.exit.error &&
      "code" in error.exit.error &&
      error.exit.error.code === "ENOENT"
    )
      return { kind: "spawn_failed", message };
    if (error instanceof OmpExitedError && error.exit.code === null && error.exit.stderrTail === "")
      return { kind: "spawn_failed", message };
    return {
      kind: "handshake_failed",
      message: this.#withStderr(message, error instanceof OmpExitedError ? error.exit.stderrTail : ""),
    };
  }

  #withStderr(message: string, stderrTail: string): string {
    const tail = stderrTail.trim().split(/\r?\n/).slice(-STDERR_LINES_IN_ERROR).join("\n");
    return tail ? `${message}\n${tail}` : message;
  }

  async #discard(connection: OmpConnection): Promise<void> {
    if (this.#connection === connection) this.#connection = null;
    await connection.close(0);
  }

  #onExit(connection: OmpConnection, exit: OmpExit): void {
    if (this.#connection !== connection) return;
    this.#connection = null;
    clearTimeout(this.#refreshTimer);
    if (this.#tracker.abortRunning(Date.now())) this.#emitSubagents();
    // 旁路提问跑到一半进程没了：标成 interrupted（omp 重新读历史时也这么标），并重新对齐。
    this.#btwLoadedFor = null;
    const interrupted = interruptBtw(this.#btw, Date.now());
    if (interrupted !== this.#btw) this.#setBtw({ type: "records", records: [...interrupted] });
    this.#records.clear();
    this.#queue = { steering: [], followUp: [] };
    if (this.#closing) {
      this.#apply({ type: "stopped" });
      return;
    }
    // 启动阶段的退出由 #start 的 catch 处理（它会把状态设成 error）。
    if (this.#machine.status === "starting") return;
    const protocol = exit.error instanceof RpcProtocolError;
    const message = this.#withStderr(
      exit.error?.message ?? `omp exited with ${exit.code ?? exit.signal}`,
      exit.stderrTail,
    );
    log.warn(`task ${this.id} omp exited unexpectedly`, { kind: protocol ? "protocol" : "exited", message });
    this.#apply({ type: "failed", error: { kind: protocol ? "protocol" : "exited", message } });
  }

  /** 正常关闭：关 stdin、读完 stdout，超时按进程树结束。状态变成 stopped，对话快照保留。 */
  async close(timeoutMs = 5_000): Promise<void> {
    this.#closing = true;
    // 正在启动：等它在下一个检查点中止（最多等 timeoutMs，buildLaunch 可能在等 omp 安装），再关它已经建好的连接。
    const starting = this.#starting;
    if (starting) {
      const timedOut = Promise.withResolvers<void>();
      const timer = setTimeout(timedOut.resolve, timeoutMs);
      await Promise.race([starting.catch(() => {}), timedOut.promise]);
      clearTimeout(timer);
    }
    const connection = this.#connection;
    if (!connection) return;
    await connection.close(timeoutMs);
    // #onExit 已经（或马上）把状态设成 stopped；连接退出的事件可能晚一个 tick。
    await connection.exited;
  }

  /** 关掉进程、释放计时器；任务从池里移除时调用。 */
  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.close();
    clearTimeout(this.#refreshTimer);
    clearTimeout(this.#subagentsTimer);
    this.#batcher.dispose();
  }

  // ───── 帧 ─────

  #onFrame(connection: OmpConnection, gen: number, frame: RpcServerFrame): void {
    if (this.#connection !== connection || this.#disposed) return;
    const at = Date.now();
    // 开关命令在途时 omp 推的说明文字（notice / command_output）和应答里的错误重复：丢掉。
    if (this.#speedCalls > 0 && (frame.type === "notice" || frame.type === "command_output")) return;
    switch (frame.type) {
      case "extension_ui_request":
        this.#onUiRequest(frame);
        return;
      case "available_commands_update":
        this.#host.onSlashCommands(this.id, frame.commands);
        return;
      case "queue_update":
        this.#queue = { steering: frame.steering, followUp: frame.followUp };
        this.#publish(false);
        return;
      case "model_changed":
      case "thinking_level_changed":
      case "config_update":
        void this.#refreshState();
        return;
      case "subagent_lifecycle": {
        this.#tracker.lifecycle(frame.payload, at);
        this.#batcher.push(translateFrame(frame, gen, at));
        this.#publish(false);
        this.#emitSubagents();
        return;
      }
      case "btw_delta":
      case "btw_record": {
        const event = translateBtwFrame(frame);
        if (event) this.#setBtw(event);
        return;
      }
      case "subagent_progress":
        if (this.#tracker.progress(frame.payload, at)) this.#emitSubagents();
        return;
      case "agent_start":
        this.#batcher.push(translateFrame(frame, gen, at));
        this.#apply({ type: "agent_start" });
        return;
      case "prompt_result":
        this.#sessionPersistable = true;
        if (frame.sessionSettled) this.#settleEpoch++;
        this.#batcher.push(translateFrame(frame, gen, at));
        this.#apply({
          type: "prompt_result",
          status: frame.status,
          sessionSettled: frame.sessionSettled,
          at,
          foreground: this.#host.isForeground(this.id),
          ...(frame.error && { error: frame.error }),
        });
        void this.#refreshState();
        return;
      case "session_settled":
        this.#settleEpoch++;
        this.#batcher.push(translateFrame(frame, gen, at));
        this.#apply({ type: "session_settled" });
        void this.#refreshState();
        return;
      case "tool_execution_end":
        this.#batcher.push(translateFrame(frame, gen, at));
        // todo 工具改了待办：get_state 才有完整的 todoPhases（tool 结果里只有文字）。
        if (/todo/i.test(frame.toolName)) this.#scheduleRefresh();
        return;
      case "goal_updated":
        // goal_updated 自带完整目标（用量每 1–2 秒推一次），不必再 get_state。complete / dropped 对应 null。
        this.#applyGoal(toTaskGoal(frame.goal));
        if (frame.goal?.status === "complete") this.#host.onNotice({ taskId: this.id, kind: "goal_complete" });
        return;
      case "todo_auto_clear":
        this.#scheduleRefresh();
        return;
      case "session_info_update":
        this.#adoptTitle(frame.title).catch((error: unknown) => {
          log.warn(`task ${this.id} adopt title failed`, { message: String(error) });
        });
        return;
      case "message_end":
      case "agent_end":
      case "auto_compaction_end":
      case "notice":
        this.#batcher.push(translateFrame(frame, gen, at));
        this.#scheduleRefresh();
        return;
      default:
        this.#batcher.push(translateFrame(frame, gen, at));
    }
  }

  #onUiRequest(frame: Extract<RpcServerFrame, { type: "extension_ui_request" }>): void {
    switch (frame.method) {
      case "cancel":
        // omp 超时或中止：关掉对话框，之后的回答会被忽略。
        this.#apply({ type: "dialog_close", id: frame.targetId });
        return;
      case "notify":
        this.#host.onNotice({
          taskId: this.id,
          kind: "toast",
          level: frame.notifyType ?? "info",
          message: frame.message,
        });
        return;
      case "set_editor_text":
        this.#host.onNotice({ taskId: this.id, kind: "editor_text", text: frame.text });
        return;
      default: {
        const request = toDialogRequest(frame);
        if (request) this.#apply({ type: "dialog_open", request: { ...request, receivedAt: Date.now() } });
      }
    }
  }

  // ───── get_state ─────

  /** 队列以 queue_update 推来的为准；get_state 的队列只在握手时采用（过期的应答会盖掉更新的值）。 */
  async #adoptState(state: SessionState, options: { adoptQueue?: boolean; goalSeq?: number } = {}): Promise<void> {
    this.#sessionSettled = (state.isSettled ?? false) && !(state.hasPendingAsyncWork ?? false);
    this.#contextUsage = state.contextUsage ?? null;
    if (state.model) this.#model = toModelOption(state.model);
    this.#thinkingLevel = state.thinkingLevel ?? this.#thinkingLevel;
    this.#todoPhases = state.todoPhases ?? [];
    this.#extras = sessionExtras(state);
    // get_state 在途时到达的 goal_updated 更新，应答里的目标已经是旧的：不让它盖掉。
    if (options.goalSeq === undefined || options.goalSeq === this.#goalSeq) this.#goal = toTaskGoal(state.goal?.goal);
    if (options.adoptQueue && state.queuedMessages)
      this.#queue = { steering: state.queuedMessages.steering, followUp: state.queuedMessages.followUp };
    const patch: Partial<Omit<TaskRecord, "id">> = {};
    if (this.#sessionPersistable && state.sessionFile && state.sessionFile !== this.#record.sessionFile)
      patch.sessionFile = state.sessionFile;
    if (
      this.#model &&
      (this.#record.model?.provider !== this.#model.key.provider ||
        this.#record.model?.modelId !== this.#model.key.modelId)
    )
      patch.model = this.#model.key;
    if (this.#thinkingLevel && this.#thinkingLevel !== this.#record.thinkingLevel)
      patch.thinkingLevel = this.#thinkingLevel;
    if (Object.keys(patch).length > 0) this.#record = await this.#host.persist(this.id, patch);
  }

  /** 同一任务 1 秒内最多一次（get_state 的应答带 systemPrompt 和 dumpTools，不小）。 */
  #scheduleRefresh(): void {
    if (this.#refreshTimer) return;
    const wait = Math.max(0, this.#lastStateAt + STATE_REFRESH_MIN_INTERVAL_MS - Date.now());
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined;
      void this.#refreshState();
    }, wait);
  }

  async #refreshState(): Promise<void> {
    const connection = this.#connection;
    if (!connection || this.#sessionOp !== null) return;
    if (this.#refreshing) {
      // 进行中的应答可能已经过期（isSettled=false 之后才 settled）：结束后补跑一次。
      this.#refreshAgain = true;
      return;
    }
    this.#refreshing = true;
    const epoch = this.#sessionEpoch;
    const goalSeq = this.#goalSeq;
    try {
      // 一起等：进程中途退出时两个请求同时 reject，不能留一个没人等的。
      const [thinking, state, stats] = await Promise.all([
        connection.request("get_available_thinking_levels"),
        connection.request("get_state"),
        // 用量只是显示用：取不到（比如 omp 这条命令失败）不能连累模型、上下文的刷新；进程退出仍然照常抛出。
        connection.request("get_session_stats").catch((error: unknown) => {
          if (error instanceof OmpExitedError) throw error;
          return null;
        }),
      ]);
      this.#lastStateAt = Date.now();
      if (this.#connection !== connection) return;
      // 查询期间发生了分叉/回溯：这份应答可能来自别的会话文件，丢弃，op 结束后会再刷新一次。
      if (epoch !== this.#sessionEpoch) {
        this.#refreshAgain = true;
        return;
      }
      this.#thinkingLevels = thinking.levels;
      if (stats) {
        this.#sessionUsage = {
          tokens: stats.tokens,
          cost: stats.cost,
          premiumRequests: stats.premiumRequests,
          ...(stats.credits && { credits: stats.credits }),
        };
      }
      await this.#adoptState(state, { goalSeq });
      this.#publish(false);
    } catch (error) {
      // 进程在查询中途退出由 #onExit 报告；其余错误（协议层面的失败应答）不应被吞掉，但也不该让任务进入 error。
      if (!(error instanceof OmpExitedError))
        this.#host.onNotice({
          taskId: this.id,
          kind: "toast",
          level: "warning",
          message: error instanceof Error ? error.message : String(error),
        });
    } finally {
      this.#refreshing = false;
      if (this.#refreshAgain) {
        this.#refreshAgain = false;
        void this.#refreshState();
      }
    }
  }

  // ───── 命令 ─────

  async #live(): Promise<OmpConnection> {
    if (this.#machine.status === "error") throw new Error("task is in error state; restart it first");
    await this.start();
    if (!this.#connection) throw new Error("task is not running");
    this.#lastActiveAt = Date.now();
    return this.#connection;
  }

  /** 在途命令计数：期间不可回收。 */
  async #tracked<T>(run: () => Promise<T>): Promise<T> {
    this.#inflight++;
    try {
      return await run();
    } finally {
      this.#inflight--;
    }
  }

  /** 只用已有的进程：启动中等它结束；已停止或出错返回 null，不为了一条查询/撤销专门拉起 omp。 */
  async #existing(): Promise<OmpConnection | null> {
    if (this.#starting) await this.#starting.catch(() => {});
    return this.#connection;
  }

  /** 分叉/回溯期间进程暂时在别的会话文件上：所有写命令和要进程的命令先等它切回来，否则会作用到分叉的会话文件。 */
  async #awaitSessionIdle(): Promise<void> {
    while (this.#sessionOp !== null) await this.#sessionOp;
  }

  /** 应答到达（消息被 omp 接收）即返回，不等这一轮跑完。 */
  sendPrompt(input: PromptInput): Promise<void> {
    return this.#tracked(() => this.#sendPrompt(input));
  }

  async #sendPrompt(input: PromptInput): Promise<void> {
    await this.#awaitSessionIdle();
    let connection = await this.#live();
    const params: PromptParams = {
      message: input.text,
      streamingBehavior: input.whenBusy,
      ...(input.images && {
        images: input.images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })),
      }),
    };
    const limit = connection.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    if (Buffer.byteLength(JSON.stringify({ ...params, id: "req-0000000", type: "prompt" })) > limit)
      throw new Error(`message is larger than the ${limit}-byte frame limit`);
    if (this.#record.title === "")
      this.#record = await this.#host.persist(this.id, { title: titleFromPrompt(input.text) });
    // 上面的 await 期间分叉/回溯可能已经开始：最后一个 await 之后、发出之前再等一次（它们切回后进程可能已被换掉）。
    await this.#awaitSessionIdle();
    if (this.#connection !== connection) connection = await this.#live();
    const epoch = this.#settleEpoch;
    try {
      const ack = await connection.request("prompt", params);
      // 应答之后这一轮已经跑完并 settled（同一数据块里的帧先于这里的续体处理）：不能再把任务置回 running。
      if (this.#settleEpoch === epoch)
        this.#apply({ type: "prompt_accepted", agentInvoked: ack?.agentInvoked !== false });
      // 本地完成的斜杠命令（/fast、/slow、/model…）不会有 prompt_result，状态要自己去读。
      if (ack?.agentInvoked === false) void this.#refreshState();
    } catch (error) {
      if (error instanceof RpcCommandError) {
        this.#batcher.push([
          {
            type: "prompt_result",
            promptId: "",
            status: "error",
            error: { message: error.message, retryable: false },
            at: Date.now(),
          },
        ]);
        this.#apply({ type: "prompt_rejected", message: error.message, at: Date.now() });
      }
      throw error;
    }
  }

  async removeQueuedMessage(text: string, queue: "steering" | "followUp"): Promise<RestoredDraft | null> {
    await this.#awaitSessionIdle();
    const connection = await this.#existing();
    if (!connection) return null;
    const result = await connection.request("remove_queued_message", { message: text, queue });
    if (!result.removed) return null;
    const images = toPromptImages(result.images);
    return images ? { text, images } : { text };
  }

  async promoteQueuedMessage(text: string): Promise<boolean> {
    await this.#awaitSessionIdle();
    const connection = await this.#existing();
    if (!connection) return false;
    return (await connection.request("promote_queued_message", { message: text })).promoted;
  }

  /**
   * 停止：撤回排队消息再中止（不会因残留 steer 再开一轮）；文本放回输入框。
   * 应答在 abort 完成后才写，这里再读一次 get_state 核实：这一轮是否真的停了，以及后台任务（自动转后台的 bash、
   * 异步 task）是否还会在之后唤醒会话——rpc.md 没有取消后台任务的命令，abort 也不碰它们（实测 sleep 转后台后 Esc，
   * 任务结束时 omp 自己开了新一轮）。界面据此决定能不能说"已停止"。
   */
  async stop(): Promise<RestoredQueue> {
    await this.#awaitSessionIdle();
    const sessionEpoch = this.#sessionEpoch;
    const connection = await this.#existing();
    if (!connection)
      return {
        steering: [],
        followUp: [],
        imagesDropped: false,
        truncated: false,
        aborted: true,
        backgroundWork: false,
      };
    const result = await connection.request("abort_and_restore_queue");
    // 查询失败不改变"abort 命令已成功"这一事实；按成功、无后台任务处理。
    const state = await connection.request("get_state").catch(() => null);
    if (state && sessionEpoch === this.#sessionEpoch) {
      // 重读/持久化失败不改变"abort 已成功"：按 abort 应答处理，只记日志。
      try {
        await this.#adoptState(state);
        this.#publish(false);
      } catch (error) {
        log.warn(`task ${this.id} adopt state after abort failed`, { message: String(error) });
      }
    }
    return {
      steering: result.steering.map(toRestoredDraft),
      followUp: result.followUp.map(toRestoredDraft),
      imagesDropped: result.imagesDropped ?? false,
      truncated: result.truncated ?? false,
      aborted: state?.isStreaming !== true,
      backgroundWork: state?.hasPendingAsyncWork === true,
    };
  }

  async respondDialog(dialogId: string, response: DialogResponse): Promise<void> {
    const request: DialogRequest | undefined = this.#machine.dialogs.find((dialog) => dialog.id === dialogId);
    // 未知 id 的应答会被 omp 忽略（rpc.md），所以只对 pending 表里的请求发应答。
    if (!request) throw new DialogResponseError(`no pending dialog ${dialogId}`);
    const uiResponse = toUiResponse(request, response);
    const connection = this.#connection;
    if (!connection) throw new Error("task is not running");
    connection.send(uiResponse);
    this.#apply({ type: "dialog_close", id: dialogId });
  }

  /** 没有进程时返回 []（不为了列命令拉起 omp）。 */
  async listSlashCommands(): Promise<AvailableSlashCommand[]> {
    const connection = this.#connection;
    if (!connection || this.#machine.status === "starting") return [];
    return (await connection.request("get_available_commands")).commands;
  }

  async listModels(): Promise<ModelOption[]> {
    const connection = await this.#existing();
    if (!connection) return [];
    return (await connection.request("get_available_models")).models.map(toModelOption);
  }

  setModel(key: ModelKey): Promise<void> {
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      await connection.request("set_model", { provider: key.provider, modelId: key.modelId });
      await this.#refreshState();
    });
  }

  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      await connection.request("set_thinking_level", { level });
      await this.#refreshState();
    });
  }

  /**
   * `/fast`（set_fast_mode）。不支持的模型 omp 报错，原文抛给调用方（界面弹 toast）。omp 同时会推一条 notice / command_output
   * 帧说同样的事（实测 2026-10-19：`The current model has no service-tier control for /fast to toggle.`），不让它进对话流，免得和 toast 重复。
   */
  setFastMode(enabled: boolean): Promise<void> {
    return this.#speedCall("set_fast_mode", enabled);
  }

  /** `/slow`（set_slow_mode）。同 setFastMode：不支持的模型 omp 报错，原文抛给调用方。 */
  setSlowMode(enabled: boolean): Promise<void> {
    return this.#speedCall("set_slow_mode", enabled);
  }

  #speedCall(command: "set_fast_mode" | "set_slow_mode", enabled: boolean): Promise<void> {
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      this.#speedCalls++;
      try {
        await connection.request(command, { enabled });
      } finally {
        this.#speedCalls--;
      }
      await this.#refreshState();
    });
  }

  /** 压缩上下文（RPC compact）。压缩结果会作为 auto_compaction 类事件/摘要回到对话流；这里只管发命令。 */
  compact(): Promise<void> {
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      await connection.request("compact", {});
      await this.#refreshState();
    });
  }

  /**
   * 导出成 HTML（RPC export_html）。`outputPath` 必须是主进程自己经保存对话框拿到的绝对路径：不传时 omp 会把
   * `omp-session-*.html` 写进任务 cwd（实测），相对路径同样按 omp 进程的 cwd 解析。没有进程时先拉起。
   * omp 照写给定的路径（缺的目录会建，不补扩展名，同名覆盖），返回它实际写到的路径。
   */
  exportHtml(outputPath: string): Promise<string> {
    if (!path.isAbsolute(outputPath)) return Promise.reject(new Error("export path must be absolute"));
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      return (await connection.request("export_html", { outputPath })).path;
    });
  }

  /**
   * `!命令`（RPC bash）：omp 在任务 cwd 里跑完才应答，期间没有任何事件帧；应答后 omp 已把结果记成 bashExecution 消息，
   * 但不会为它推 message_end（实测），所以这里把同一条消息放进对话流，渲染进程不用等下一次 get_messages。
   * omp 一次只许一条在跑，重复发会得到 omp 的错误应答，原样抛给调用方。
   */
  runBash(command: string): Promise<void> {
    if (command.trim() === "") return Promise.reject(new Error("command is empty"));
    return this.#tracked(async () => {
      // 在 #live() 之前就计数：进程启动期间到达的 abortBash 要被看见，而不是丢掉。
      this.#bashInFlight++;
      let gen: number;
      let result: BashResult;
      try {
        await this.#awaitSessionIdle();
        const connection = await this.#live();
        gen = this.#gen;
        const pending = connection.request("bash", { command });
        this.#bashSent = true;
        if (this.#bashAbortPending) {
          this.#bashAbortPending = false;
          connection.request("abort_bash").catch((error: unknown) => {
            log.warn(`task ${this.id} abort_bash failed`, { message: String(error) });
          });
        }
        result = await pending;
        if (this.#connection !== connection || this.#disposed) return;
      } finally {
        if (--this.#bashInFlight === 0) {
          this.#bashSent = false;
          this.#bashAbortPending = false;
        }
      }
      const message: BashExecutionMessage = {
        role: "bashExecution",
        command,
        output: result.output,
        cancelled: result.cancelled,
        truncated: result.truncated,
        timestamp: Date.now(),
        ...(result.exitCode !== undefined && { exitCode: result.exitCode }),
      };
      this.#batcher.push([
        { type: "message_end", key: messageKey(gen, `bash-${++this.#bashSeq}`), message, at: message.timestamp },
      ]);
      this.#batcher.flush();
    });
  }

  /**
   * 目标模式（RPC goal）：`create` 创建（需要 `goal.enabled`，且没有进行中或暂停的目标，计划模式下拒绝），`pause` / `resume` / `drop`
   * 作用于当前目标，`get` 只读（都不起轮次）。omp 拒绝时抛 RpcCommandError，原文透传。返回操作后的目标。
   * 目标会不会在轮次之间自己继续，取决于 omp 的 `goal.continuationModes` 含不含 "rpc"（实测默认只有 "interactive"，不含时 create 后什么也不发生）。
   */
  goal(op: GoalOp, objective?: string): Promise<TaskState["goal"]> {
    if (op === "create" && (objective === undefined || objective.trim() === ""))
      return Promise.reject(new Error("goal objective is empty"));
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      const result = await connection.request("goal", { op, ...(objective !== undefined && { objective }) });
      this.#applyGoal(toTaskGoal(result.goal));
      return this.#goal;
    });
  }

  #applyGoal(next: TaskState["goal"]): void {
    this.#goalSeq++;
    if (sameGoal(this.#goal, next)) return;
    this.#goal = next;
    this.#publish(false);
  }

  /** 中止正在跑的 `!命令`（RPC abort_bash）。没有在跑的就什么也不发；不为它拉起进程。 */
  async abortBash(): Promise<void> {
    if (this.#bashInFlight === 0) return;
    const connection = this.#connection;
    if (!this.#bashSent || !connection) {
      // bash 请求还没发出（进程在启动）：记下，发出后立刻补发 abort_bash。
      this.#bashAbortPending = true;
      return;
    }
    await connection.request("abort_bash");
  }

  // ───── 旁路提问（/btw）─────

  #setBtw(event: BtwUiEvent): void {
    if (event.type !== "records") this.#btwSeq++;
    this.#btw = applyBtwEvent(this.#btw, event);
    if (!this.#disposed) this.#host.onBtw(this.id, event);
  }

  /**
   * 发一条旁路提问（RPC btw）。不进主对话流，主轮正在跑时也能问（实测）；omp 同一时刻只许一条在跑，多出的被它拒绝，原样抛给调用方。
   * recordId 给了就是对那个话题追问。返回话题 id。进度走 btw_record / btw_delta 帧（先于应答到达）：应答里的记录只在帧没到时补上，
   * 绝不覆盖已经累积了 delta 的记录。
   */
  askBtw(question: string, recordId?: string): Promise<string> {
    const text = question.trim();
    if (text === "") return Promise.reject(new Error("question is empty"));
    if (text.length > btwLimits.questionChars) return Promise.reject(new Error("question is too long"));
    if (recordId !== undefined && !this.#btw.some((record) => record.id === recordId))
      return Promise.reject(new Error(`unknown side-question topic ${recordId}`));
    return this.#tracked(async () => {
      await this.#awaitSessionIdle();
      const connection = await this.#live();
      const { record } = await connection.request("btw", {
        question: text,
        ...(recordId !== undefined && { recordId }),
      });
      if (this.#connection === connection && !this.#btw.some((known) => known.id === record.id))
        this.#setBtw({ type: "record", record });
      return record.id;
    });
  }

  /** 取消在跑的旁路提问（RPC btw_cancel）。recordId 省略时取消正在跑的那条。没有进程时返回 false，不为它拉起 omp。 */
  async cancelBtw(recordId?: string): Promise<boolean> {
    if (recordId !== undefined && !this.#btw.some((record) => record.id === recordId))
      throw new Error(`unknown side-question topic ${recordId}`);
    const connection = await this.#existing();
    if (!connection) return false;
    return (await connection.request("btw_cancel", recordId !== undefined ? { recordId } : {})).cancelled;
  }

  /**
   * 当前任务的旁路提问记录（新到旧）。有进程且还没对齐过就先读 get_btw_history（历史随会话落盘，恢复后仍在；实测）；
   * 没有进程或进程在启动时返回镜像现状，不为它拉起 omp。
   */
  async getBtw(): Promise<BtwHistoryRecord[]> {
    const connection = this.#connection;
    if (connection && this.#machine.status !== "starting" && this.#btwLoadedFor !== connection) {
      this.#btwLoading ??= this.#loadBtw(connection).finally(() => {
        this.#btwLoading = null;
      });
      await this.#btwLoading;
    }
    return [...this.#btw];
  }

  async #loadBtw(connection: OmpConnection): Promise<void> {
    const seq = this.#btwSeq;
    try {
      const { records } = await connection.request("get_btw_history");
      if (this.#connection !== connection) return;
      this.#btwLoadedFor = connection;
      // 应答在途期间到过 btw 帧（/btw 提问会同时触发读历史和发问）：镜像更新，按 id 合并而不是整体替换。
      this.#setBtw({
        type: "records",
        records: this.#btwSeq === seq ? records : mergeBtwHistory(this.#btw, records),
      });
    } catch (error) {
      // 历史只是附带信息：读不到（进程中途退出、omp 拒绝）时用镜像现状，下次再试。
      if (!(error instanceof OmpExitedError))
        log.warn(`task ${this.id} get_btw_history failed`, { message: String(error) });
    }
  }

  // ───── 会话树、分叉、回溯（docs/architecture/session-tree.md） ─────

  /**
   * 会话里的用户消息树。只读：不改进程的会话，运行中也能看（看到的是当前已写入的部分）。
   */
  async getSessionTree(): Promise<SessionTreeView> {
    await this.#awaitSessionIdle();
    const connection = await this.#live();
    const { tree, leafId } = await connection.request("get_tree");
    return { nodes: buildSessionTree(tree, leafId) };
  }

  /**
   * 分叉和回溯会让 omp 进程暂时换会话文件（`branch` 实测：新建一个会话文件并切过去）。期间别的写命令要等，
   * get_state 的应答也不能写进任务记录（见 #refreshState 的 epoch），结束后补一次刷新。同时只许一个。
   */
  async #sessionExclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.#sessionOp !== null) throw new SessionBusyError();
    const op = this.#tracked(run);
    this.#sessionOp = op.then(
      () => {},
      () => {},
    );
    this.#sessionEpoch++;
    try {
      return await op;
    } finally {
      this.#sessionOp = null;
      this.#sessionEpoch++;
      void this.#refreshState();
    }
  }

  /**
   * 分叉/回溯只在任务空闲时做。实测 omp 的 `fork` 在跑时报 session_busy，但 `branch` 不报，会把正在跑的会话直接切走，
   * 所以这里自己查：状态机空闲、没有未答对话框，且 omp 自己说已安静（get_state.isSettled，没有后台任务）。
   */
  async #requireQuiet(connection: OmpConnection): Promise<SessionState> {
    // #inflight 含这次分叉/回溯自己（1）：更多说明还有命令在途，包括没改状态机的 `!命令`、`/btw`、已发出的 prompt。
    if (
      this.#machine.status !== "idle" ||
      this.#machine.dialogs.length > 0 ||
      this.#inflight > 1 ||
      this.#bashInFlight > 0 ||
      isBtwRunning(this.#btw)
    )
      throw new SessionBusyError();
    const state = await connection.request("get_state");
    if (state.isStreaming === true || state.isSettled !== true || state.hasPendingAsyncWork === true)
      throw new SessionBusyError();
    // get_state 的往返期间可能又来了命令。
    if (this.#inflight > 1 || this.#bashInFlight > 0 || isBtwRunning(this.#btw)) throw new SessionBusyError();
    return state;
  }

  /**
   * 从一条用户消息分叉出一个新会话文件，原会话不动：在这个进程上 `branch`（新文件 = 这条消息之前的历史，
   * 应答里是这条消息的文字），读出新文件的路径，再 `switch_session` 切回原文件。新任务稍后自己起进程恢复新文件。
   * 切回失败时进程留在分叉的会话上，不能再用：关掉它，下次启动按任务记录恢复原会话。
   */
  forkSession(userMessageKey: string | null): Promise<{ sessionFile: string; text: string }> {
    return this.#sessionExclusive(async () => {
      const connection = await this.#live();
      const state = await this.#requireQuiet(connection);
      const original = state.sessionFile;
      if (!original) throw new Error("the session has no file yet; there is nothing to fork");
      const { messages } = await connection.request("get_branch_messages");
      const entryId = locateUserEntry(this.#batcher.snapshot().transcript.items, messages, userMessageKey);
      const branched = await connection.request("branch", { entryId });
      if (branched.cancelled) throw new Error("omp cancelled the branch");
      let forkFile: string | undefined;
      try {
        forkFile = (await connection.request("get_state")).sessionFile;
      } finally {
        await this.#switchBack(connection, original);
      }
      if (!forkFile || forkFile === original) throw new Error("omp did not create a new session file");
      return { sessionFile: forkFile, text: branched.text };
    });
  }

  async #switchBack(connection: OmpConnection, sessionFile: string): Promise<void> {
    try {
      const { cancelled } = await connection.request("switch_session", { sessionPath: sessionFile });
      if (!cancelled) return;
      throw new Error("omp cancelled switching back to the original session");
    } catch (error) {
      if (!(error instanceof OmpExitedError)) {
        log.warn(`task ${this.id} could not switch back after a fork; restarting its omp`, { message: String(error) });
        await this.close();
      }
      throw error;
    }
  }

  /**
   * 就地回到树里的一个用户消息节点：`branch` 之后进程用的是 omp 新建的会话文件（节点之前的历史），任务改记这个文件，
   * 对话流整体换成它的历史。原会话文件留在磁盘上（终端版 /resume、历史列表里还在）。
   */
  branchInPlace(entryId: string): Promise<{ text: string }> {
    return this.#sessionExclusive(async () => {
      const connection = await this.#live();
      await this.#requireQuiet(connection);
      const branched = await connection.request("branch", { entryId });
      if (branched.cancelled) throw new Error("omp cancelled the branch");
      // branch 已经让进程换到新文件：后面任何一步失败，对话流还是旧历史、记录还是旧文件，两边对不上。
      // 和分叉切回失败一样处理：关掉进程（下次启动按未改动的记录恢复原会话）并抛错，记录不更新。
      try {
        const state = await connection.request("get_state");
        const messages = await loadHistory(connection);
        this.#sessionPersistable = true;
        await this.#adoptState(state);
        this.#batcher.push([{ type: "history", messages }]);
        // 旁路提问属于旧会话：清空镜像，下次 getBtw 重新对齐。
        this.#btwLoadedFor = null;
        if (this.#btw.length > 0) this.#setBtw({ type: "records", records: [] });
        this.#publish(true);
      } catch (error) {
        log.warn(`task ${this.id} rewind failed after branch; restarting its omp`, { message: String(error) });
        await this.close();
        throw error;
      }
      return { text: branched.text };
    });
  }

  // ───── 子代理泳道 ─────

  /** progress 帧一个子代理 5–15 条：合并成每 100 ms 最多一次整份快照。 */
  #emitSubagents(): void {
    if (this.#subagentsTimer || this.#disposed) return;
    this.#subagentsTimer = setTimeout(() => {
      this.#subagentsTimer = undefined;
      if (!this.#disposed) this.#host.onSubagents(this.id, this.#tracker.lanes());
    }, SUBAGENT_EMIT_INTERVAL_MS);
  }

  getSubagents(): SubagentLane[] {
    return this.#tracker.lanes();
  }

  /** 完整记录读不到时（没有进程、读取失败）messages 为 null，泳道数据照常返回。 */
  async getSubagentDetail(subagentId: string, since?: number): Promise<SubagentDetail> {
    const lane = this.#tracker.lane(subagentId);
    if (!lane) throw new Error(`unknown subagent ${subagentId}`);
    const none = { lane, messages: null, from: 0, total: 0, truncated: false, error: null };
    const connection = this.#connection;
    if (!connection || this.#machine.status === "starting") return { ...none, unavailable: "no_process" };
    try {
      const slice = await this.#readSubagentMessages(connection, subagentId, since);
      return { lane, ...slice, unavailable: null, error: null };
    } catch (error) {
      if (error instanceof OmpExitedError) return { ...none, unavailable: "no_process" };
      return { ...none, unavailable: "error", error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 按子代理缓存已读记录，之后只读 fromByte 之后新增的部分；同一子代理的读串行（并发读会重复追加）。
   * 按 id 查不到时（omp 已忘了它）退回用 tracker 记下的 sessionFile。
   */
  async #readSubagentMessages(
    connection: OmpConnection,
    subagentId: string,
    since: number | undefined,
  ): Promise<RecordSlice<AgentMessage>> {
    let cached = this.#records.get(subagentId);
    if (!cached) {
      cached = { record: new SubagentRecord<AgentMessage>(), queue: Promise.resolve() };
      this.#records.set(subagentId, cached);
      // 只留最近用到的几个，别让长会话里所有子代理的记录都压在内存里。
      if (this.#records.size > SUBAGENT_RECORD_CACHE) this.#records.delete(this.#records.keys().next().value!);
    } else {
      this.#records.delete(subagentId);
      this.#records.set(subagentId, cached);
    }
    const { record } = cached;
    const run = cached.queue.then(() =>
      record.refresh(async (fromByte) => {
        const extra = fromByte !== undefined ? { fromByte } : {};
        try {
          return await connection.request("get_subagent_messages", { subagentId, ...extra });
        } catch (error) {
          const sessionFile = this.#tracker.sessionFile(subagentId);
          if (!(error instanceof RpcCommandError) || sessionFile === null) throw error;
          return await connection.request("get_subagent_messages", { sessionFile, ...extra });
        }
      }),
    );
    cached.queue = run.catch(() => {});
    await run;
    return record.slice(since);
  }

  /** 只对已知且在运行的子代理发命令；id 来自渲染进程，不可信。 */
  async steerSubagent(subagentId: string, text: string): Promise<void> {
    const connection = await this.#runningSubagentConnection(subagentId);
    await connection.request("steer_subagent", { subagentId, message: text });
  }

  async cancelSubagent(subagentId: string): Promise<boolean> {
    const connection = await this.#runningSubagentConnection(subagentId);
    return (await connection.request("cancel_subagent", { subagentId })).cancelled;
  }

  async #runningSubagentConnection(subagentId: string): Promise<OmpConnection> {
    if (this.#tracker.lane(subagentId)?.status !== "running") throw new Error(`subagent ${subagentId} is not running`);
    const connection = await this.#existing();
    if (!connection) throw new Error("task is not running");
    return connection;
  }

  /** 任务的工作目录（有 worktree 时是 worktree 根，否则是项目路径），用于校验渲染进程传来的相对路径。 */
  get cwd(): string {
    return this.#record.worktreePath ?? this.#project.path;
  }

  /** 改名：studio 的标题是 omp 会话名的镜像，所以有进程就同步给 omp（终端版 /resume 里看到的也是新名字）；没进程的下次启动补发。 */
  async rename(title: string): Promise<void> {
    await this.#awaitSessionIdle();
    this.#record = await this.#host.persist(this.id, { title });
    this.#publish(false);
    const name = title.trim();
    if (name === "") return;
    const connection = await this.#existing();
    if (!connection) {
      this.#pendingName = name;
      return;
    }
    await this.#sendSessionName(connection, name);
  }

  async #sendSessionName(connection: OmpConnection, name: string): Promise<void> {
    try {
      this.#sentNames.add(name);
      if (this.#sentNames.size > 4) this.#sentNames.delete(this.#sentNames.values().next().value as string);
      await connection.request("set_session_name", { name });
    } catch (error) {
      // studio 的标题已经保存，同步失败不该让改名失败；进程中途退出的补到下次启动。
      if (error instanceof OmpExitedError) this.#pendingName = name;
      else log.warn(`task ${this.id} set_session_name failed`, { message: String(error) });
    }
  }

  /** omp 自己改了会话名（/rename 等）：studio 的标题跟着走，和用户改名走同一条保存路径。 */
  async #adoptTitle(title: string | undefined): Promise<void> {
    const name = title?.trim();
    // 自己发出去的名字的回声（每个名字一条）：旧名字的回声在连续改名后晚到时不能回写。
    const echoed = name !== undefined && this.#sentNames.delete(name);
    if (!name || echoed || name === this.#record.title) return;
    this.#record = await this.#host.persist(this.id, { title: name });
    this.#publish(false);
  }

  async setArchived(archived: boolean): Promise<void> {
    this.#record = await this.#host.persist(this.id, { archived });
  }
}

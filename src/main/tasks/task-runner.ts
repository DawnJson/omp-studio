// 一个任务的运行时：omp 进程、状态机、帧 → TranscriptEvent、对话框 pending 表。
// 一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个进程；进程可被回收，任务和会话不会（docs/architecture/task-model.md）。
import type {
  ApprovalMode,
  DialogRequest,
  DialogResponse,
  ModelKey,
  ModelOption,
  Project,
  PromptInput,
  RestoredDraft,
  RestoredQueue,
  TaskError,
  TaskId,
  TaskNotice,
  TaskState,
  TranscriptBatch,
  TranscriptSnapshot,
} from "../../shared/ipc.ts";
import type {
  AvailableSlashCommand,
  PromptParams,
  RpcServerFrame,
  SessionState,
  ThinkingLevel,
} from "../../shared/omp-wire/rpc-wire.generated.ts";
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
import { translateFrame } from "./translate.ts";

/** rpc.md：入站帧应控制在 `maxFrameBytes`（默认 1 MiB）内，prompt 不分块。 */
const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const STATE_REFRESH_MIN_INTERVAL_MS = 1_000;
const STDERR_LINES_IN_ERROR = 8;

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
}

/** 存活进程数到了硬上限（软上限 × 2），拒绝再起。 */
export class TooManyTasksError extends Error {
  override name = "TooManyTasksError";
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
  #queue: TaskState["queue"] = { steering: [], followUp: [] };
  readonly #subagents = new Set<string>();
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

  constructor(record: TaskRecord, project: Project, host: RunnerHost) {
    this.id = record.id;
    this.#record = record;
    this.#project = project;
    this.#host = host;
    this.#sessionPersistable = record.sessionFile !== null;
    this.#model = record.model
      ? { key: record.model, name: record.model.modelId, contextWindow: null, reasoning: false, acceptsImages: false }
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
      this.#inflight === 0
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
      approvalMode: this.#record.approvalMode,
      contextUsage: this.#contextUsage,
      queue: this.#queue,
      dialogs: m.dialogs,
      runningSubagents: this.#subagents.size,
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
    this.#subagents.clear();
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
    this.#batcher.dispose();
  }

  // ───── 帧 ─────

  #onFrame(connection: OmpConnection, gen: number, frame: RpcServerFrame): void {
    if (this.#connection !== connection || this.#disposed) return;
    const at = Date.now();
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
        if (frame.payload.status === "started") this.#subagents.add(frame.payload.id);
        else this.#subagents.delete(frame.payload.id);
        this.#batcher.push(translateFrame(frame, gen, at));
        this.#publish(false);
        return;
      }
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
  async #adoptState(state: SessionState, options: { adoptQueue?: boolean } = {}): Promise<void> {
    this.#sessionSettled = (state.isSettled ?? false) && !(state.hasPendingAsyncWork ?? false);
    this.#contextUsage = state.contextUsage ?? null;
    if (state.model) this.#model = toModelOption(state.model);
    this.#thinkingLevel = state.thinkingLevel ?? this.#thinkingLevel;
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
    if (!connection) return;
    if (this.#refreshing) {
      // 进行中的应答可能已经过期（isSettled=false 之后才 settled）：结束后补跑一次。
      this.#refreshAgain = true;
      return;
    }
    this.#refreshing = true;
    try {
      // 一起等：进程中途退出时两个请求同时 reject，不能留一个没人等的。
      const [thinking, state] = await Promise.all([
        connection.request("get_available_thinking_levels"),
        connection.request("get_state"),
      ]);
      this.#lastStateAt = Date.now();
      if (this.#connection !== connection) return;
      this.#thinkingLevels = thinking.levels;
      await this.#adoptState(state);
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

  /** 应答到达（消息被 omp 接收）即返回，不等这一轮跑完。 */
  sendPrompt(input: PromptInput): Promise<void> {
    return this.#tracked(() => this.#sendPrompt(input));
  }

  async #sendPrompt(input: PromptInput): Promise<void> {
    const connection = await this.#live();
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
    const epoch = this.#settleEpoch;
    try {
      const ack = await connection.request("prompt", params);
      // 应答之后这一轮已经跑完并 settled（同一数据块里的帧先于这里的续体处理）：不能再把任务置回 running。
      if (this.#settleEpoch === epoch)
        this.#apply({ type: "prompt_accepted", agentInvoked: ack?.agentInvoked !== false });
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
    const connection = await this.#existing();
    if (!connection) return null;
    const result = await connection.request("remove_queued_message", { message: text, queue });
    if (!result.removed) return null;
    const images = toPromptImages(result.images);
    return images ? { text, images } : { text };
  }

  async promoteQueuedMessage(text: string): Promise<boolean> {
    const connection = await this.#existing();
    if (!connection) return false;
    return (await connection.request("promote_queued_message", { message: text })).promoted;
  }

  /** 停止：撤回排队消息再中止（不会因残留 steer 再开一轮）；文本放回输入框。 */
  async stop(): Promise<RestoredQueue> {
    const connection = await this.#existing();
    if (!connection) return { steering: [], followUp: [], imagesDropped: false, truncated: false };
    const result = await connection.request("abort_and_restore_queue");
    return {
      steering: result.steering.map(toRestoredDraft),
      followUp: result.followUp.map(toRestoredDraft),
      imagesDropped: result.imagesDropped ?? false,
      truncated: result.truncated ?? false,
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
      const connection = await this.#live();
      await connection.request("set_model", { provider: key.provider, modelId: key.modelId });
      await this.#refreshState();
    });
  }

  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.#tracked(async () => {
      const connection = await this.#live();
      await connection.request("set_thinking_level", { level });
      await this.#refreshState();
    });
  }

  /** 压缩上下文（RPC compact）。压缩结果会作为 auto_compaction 类事件/摘要回到对话流；这里只管发命令。 */
  compact(): Promise<void> {
    return this.#tracked(async () => {
      const connection = await this.#live();
      await connection.request("compact", {});
      await this.#refreshState();
    });
  }

  /** 任务的工作目录（项目路径），用于校验渲染进程传来的相对路径。 */
  get cwd(): string {
    return this.#project.path;
  }

  async rename(title: string): Promise<void> {
    this.#record = await this.#host.persist(this.id, { title });
    this.#publish(false);
  }

  /** 审批模式在进程启动时固定：只改记录，下次启动生效；有进程时调用方应拒绝。 */
  async setApprovalMode(mode: ApprovalMode | null): Promise<void> {
    this.#record = await this.#host.persist(this.id, { approvalMode: mode });
    this.#publish(false);
  }

  async setArchived(archived: boolean): Promise<void> {
    this.#record = await this.#host.persist(this.id, { archived });
  }
}

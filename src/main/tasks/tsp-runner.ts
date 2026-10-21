// TSP 任务的运行时：一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个伪终端里的交互式 omp（TspSession）。
// 和 TaskRunner 并存（新任务按设置 `taskEngine` 定引擎；设置是 tsp 时没有进程的 rpc 老任务下次启动也换成它）；对任务池的接口（生命周期、回收、状态）一致，
// rpc 专有的操作（队列、btw、子代理详情、分叉…）由池对 tsp 任务直接拒绝。
// 状态来自 omp 发来的节点树（task-status.ts，规则和依据见那里），状态机复用 rpc 路径的 task-machine。
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  PromptImage,
  DefaultModelInfo,
  ModelKey,
  ModelOption,
  Project,
  PromptInput,
  RestoredQueue,
  TaskError,
  TaskId,
  TaskState,
  TranscriptSnapshot,
  TspBatch,
  TspSessionExtras,
  TspSnapshot,
} from "../../shared/ipc.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import {
  createDocument,
  findNode,
  snapshotDocument,
  type DocumentSnapshot,
  type TspDocument,
} from "../../shared/tsp/document.ts";
import {
  ACTION_CYCLE_THINKING,
  ACTION_PICK_MODEL,
  TSP_COMPOSER_UNAVAILABLE,
  deriveComposerInfo,
  findComposerTargets,
  findPicker,
  statusToastTexts,
  type TspComposerInfo,
  type TspComposerTargets,
} from "../../shared/tsp/composer-state.ts";
import { deriveTaskStatus, hasRunningWork } from "../../shared/tsp/task-status.ts";
import { emptyTranscript } from "../../shared/transcript.ts";
import { log } from "../log/log.ts";
import type { OmpLaunch } from "../omp/omp-connection.ts";
import type { ThinkingLevel, AvailableSlashCommand } from "../../shared/omp-wire/rpc-wire.generated.ts";
import {
  buildTspEnv,
  TspExitedError,
  TspHandshakeError,
  TspSession,
  type TspSessionExit,
  type TspSessionOptions,
} from "../tsp/tsp-session.ts";
import { resolveNewTaskDefault } from "../../shared/ui/new-task-default.ts";
import { titleFromPrompt } from "./convert.ts";
import { readSessionExtras } from "../tsp/session-extras.ts";
import { readTurnCosts } from "../tsp/turn-costs.ts";
import { initialMachineState, transition, type MachineInput, type MachineState } from "./task-machine.ts";
import type { TaskRecord } from "./task-registry.ts";
import { TooManyTasksError } from "./task-runner.ts";

/** 新进程的初始列数；渲染进程挂载后用 resizeTsp 改成真实宽度。 */
const INITIAL_COLS = 100;
/** 等 omp 的输入框 `sendable` 的上限：omp 启动（加载扩展、MCP）可能要十几秒。 */
const COMPOSER_TIMEOUT_MS = 30_000;
const IMAGE_EXTENSIONS: Record<PromptImage["mimeType"], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
/** 切模型、切思考强度时等 omp 响应的上限：选择器（要读模型目录）打开、确认提示出现。 */
const PICKER_TIMEOUT_MS = 8_000;
const CONFIRM_TIMEOUT_MS = 5_000;
/** 思考强度循环的最多步数（omp 最多 8 个级别，转满一圈就不会再有新的）。 */
const MAX_THINKING_CYCLES = 10;
const STDERR_LINES_IN_ERROR = 8;
/** 提问/审批的门在 TaskState.dialogs 里的 id：GateNotifier 靠 dialogs[0] 发"等你确认"通知。 */
const ASK_DIALOG_ID = "tsp-ask";
const ESC_KEY = "\x1b";
/** omp 的终端标题是 `<图标字形> <标题>`：去掉私有区字符（Nerd Font 图标）。 */
const ICON_GLYPHS = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

/** TSP 会话的外部依赖：池和测试各自提供。 */
export type TspSessionDeps = Pick<
  TspSessionOptions,
  "appVersion" | "spawn" | "killTree" | "assignJob" | "helloTimeoutMs"
> & {
  /** hello 回复里的外观（深色、减少动效）；每次启动时读一次。 */
  appearance(): { dark: boolean; reduceMotion: boolean };
};

export interface TspRunnerHost {
  buildLaunch(record: TaskRecord, project: Project): Promise<OmpLaunch>;
  /** 起进程前调用：必要时回收别的任务；超出硬上限时 reject（任务保持 stopped）。 */
  acquireSlot(id: TaskId): Promise<void>;
  persist(id: TaskId, patch: Partial<Omit<TaskRecord, "id">>): Promise<TaskRecord>;
  isForeground(id: TaskId): boolean;
  onState(state: TaskState): void;
  onTspBatch(batch: TspBatch): void;
  session: TspSessionDeps;
  /** 上次读到的模型目录里的这一项；没有（或没提供）时胶囊先显示模型 id。 */
  knownModel?(key: ModelKey): ModelOption | null;
  /** 模型目录（服务进程的 get_available_models，和草稿输入框用的同一份）：把 omp 的模型显示名换成模型键、给 listTaskModels。 */
  listModels?(): Promise<ModelOption[]>;
  /** omp 的命令列表（服务进程）；没提供时 TSP 任务的列表为空。 */
  listSlashCommands?(): Promise<AvailableSlashCommand[]>;
  /** 新任务默认值；没提供时输入框出现之前不显示模型。 */
  newTaskDefaults?(project: Project): Promise<NewTaskDefaults>;
}

/** omp 对一个项目的新任务默认值：和草稿页同源（`omp config list` 的 modelRoles.default / defaultThinkingLevel，没设置时用服务进程 get_state 的模型）。 */
export interface NewTaskDefaults {
  /** modelRoles.default 原文（可能带 `:high` 后缀）；null = 没设置。 */
  model: string | null;
  thinkingLevel: string | null;
  ompDefault: DefaultModelInfo | null;
}

/** 启动失败：带着给界面的 TaskError。 */
class StartError extends Error {
  readonly taskError: TaskError;
  constructor(taskError: TaskError) {
    super(taskError.message);
    this.taskError = taskError;
  }
}

interface DocumentWaiter {
  check(document: TspDocument): unknown;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface DerivedComposerState {
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
  thinkingLevels: ThinkingLevel[];
  fastEnabled: boolean;
  contextUsage: TaskState["contextUsage"];
  sessionUsage: TaskState["sessionUsage"];
}

function sameKey(a: ModelKey, b: ModelKey): boolean {
  return a.provider === b.provider && a.modelId === b.modelId;
}

const THINKING_LEVELS: ReadonlySet<string> = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** omp 的思考强度显示值 → ThinkingLevel；`auto`（omp 按模型自选）不是 ThinkingLevel，为 null。 */
function toThinkingLevel(effort: string | null): ThinkingLevel | null {
  return effort !== null && THINKING_LEVELS.has(effort) ? (effort as ThinkingLevel) : null;
}

/** 这个模型能选的思考强度：目录里的 efforts 加 off；目录没给或模型不支持思考时为空。 */
function thinkingLevelsOf(model: ModelOption | null): ThinkingLevel[] {
  if (!model?.thinkingEfforts) return [];
  return ["off", ...model.thinkingEfforts];
}

/** 去掉图标字形；"omp" 是 omp 没有标题时的占位，不是标题。 */
export function cleanOmpTitle(raw: string): string {
  const title = raw.replace(ICON_GLYPHS, "").trim();
  return title === "omp" ? "" : title;
}

export class TspRunner {
  readonly engine = "tsp" as const;
  readonly id: TaskId;
  #record: TaskRecord;
  readonly #project: Project;
  readonly #host: TspRunnerHost;
  #machine: MachineState = initialMachineState("stopped");
  #session: TspSession | null = null;
  /** 终端列数：渲染进程量出来的对话列宽（起进程前也可能先到），没量过时用 INITIAL_COLS。 */
  #cols = INITIAL_COLS;
  /** 每次起进程递增：过期会话的回调据此丢弃。 */
  #gen = 0;
  #starting: Promise<void> | null = null;
  #closing = false;
  #disposed = false;
  #lastActiveAt = Date.now();
  #runStartedAt = 0;
  /** 最后一次任务活动（发消息、一轮结束）；不随 #record 的记账写入变化。 */
  #activityAt: number;
  readonly #model: ModelOption | null;
  /** 进程退出后保留最后一份文档，界面还能看到发生了什么。 */
  #finalSnapshot: { seq: number; document: DocumentSnapshot } | null = null;
  /**
   * 批次序号的偏移。每个进程的消息序号从 1 开始，但渲染进程按"上一个序号 + 1"接收批次：新进程的序号要接在上一个进程之后
   * 并留一个空位（最后序号 + 2 起），渲染进程发现不连续就重新取快照，不会把新进程的消息接在旧文档上。
   */
  #seqBase = 0;
  #documentWaiters = new Set<DocumentWaiter>();
  /** 输入框卡片上最后一次读到的值（输入框被提问/审批换掉的那几帧沿用）。 */
  #composer: TspComposerInfo = { modelName: null, effort: null, context: null, cost: null, fast: false };
  #derived: DerivedComposerState = {
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    contextUsage: null,
    sessionUsage: null,
    fastEnabled: false,
  };
  #catalog: ModelOption[] = [];
  /** omp 对这个项目的新任务默认值解析出的模型和思考强度：任务记录没指定、输入框卡片也还没出现时显示它（不传给 omp）。 */
  #newTaskDefault: { model: ModelOption | null; thinkingLevel: ThinkingLevel | null } = {
    model: null,
    thinkingLevel: null,
  };
  /** 刚在选择器里选的模型：目录里有重名的显示名时以它为准。 */
  #chosenKey: ModelKey | null = null;
  #persistingChoice = false;
  #uiChain: Promise<void> = Promise.resolve();
  /** `/slow` 的状态：omp 没有状态节点，按 toast 记；一开始未知，当关。 */
  #slowEnabled = false;
  /** 用户按了停止、这一轮还没结束：这一轮的结局记为 aborted。 */
  #stopRequested = false;
  /** omp 报告的会话文件；文件在第一条回复之后才落盘，落盘之前不能存（恢复会失败）。 */
  #sessionFile: string | null = null;
  #persistingSessionFile = false;
  /** 标题的来源：用户改名之后（既不是空、也不是下面两个）omp 的标题不再覆盖。 */
  #provisionalTitle: string | null = null;
  #adoptedTitle: string | null = null;
  #lastOmpTitle: string | null = null;

  constructor(record: TaskRecord, project: Project, host: TspRunnerHost) {
    this.id = record.id;
    this.#record = record;
    this.#activityAt = record.updatedAt;
    this.#project = project;
    this.#host = host;
    this.#model = record.model
      ? (host.knownModel?.(record.model) ?? {
          key: record.model,
          name: record.model.modelId,
          contextWindow: null,
          reasoning: false,
          acceptsImages: false,
          maxTokens: null,
          thinkingEfforts: null,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })
      : null;
  }

  // ───── 读 ─────

  get record(): TaskRecord {
    return this.#record;
  }

  get status(): TaskState["status"] {
    return this.#machine.status;
  }

  get hasProcess(): boolean {
    return this.#session !== null;
  }

  get lastActiveAt(): number {
    return this.#lastActiveAt;
  }

  /** 可回收：idle、没有等待、没有还在跑的工具或子代理（转到后台的任务）。前台任务由池排除。 */
  get recyclable(): boolean {
    const session = this.#session;
    return (
      session !== null &&
      this.#machine.status === "idle" &&
      this.#machine.dialogs.length === 0 &&
      !hasRunningWork(session.document)
    );
  }

  get cwd(): string {
    return this.#record.worktreePath ?? this.#project.path;
  }

  get state(): TaskState {
    const m = this.#machine;
    return {
      id: this.id,
      projectId: this.#record.projectId,
      title: this.#record.title,
      engine: "tsp",
      status: m.status,
      unread: m.unread,
      lastTurn: m.lastTurn,
      error: m.error,
      createdAt: this.#record.createdAt,
      updatedAt: this.#activityAt,
      // 模型、思考强度、上下文用量、费用从 omp 输入框卡片上读（composer-state.ts）；输入框还没出现时用任务记录里的。
      model: this.#derived.model ?? this.#model ?? this.#newTaskDefault.model,
      thinkingLevel: this.#derived.thinkingLevel ?? this.#record.thinkingLevel ?? this.#newTaskDefault.thinkingLevel,
      thinkingLevels: this.#derived.thinkingLevels,
      contextUsage: this.#derived.contextUsage,
      sessionUsage: this.#derived.sessionUsage,
      queue: { steering: [], followUp: [] },
      dialogs: m.dialogs,
      todoPhases: [],
      runningSubagents: 0,
      cwd: this.cwd,
      runStartedAt: m.working ? this.#runStartedAt : null,
      fastMode: { enabled: this.#derived.fastEnabled, active: this.#derived.fastEnabled },
      // omp 没有慢速模式的状态节点和"支持与否"的信息：一律 supported，不支持的模型 omp 的 toast 原文作为错误抛出（同 fast）。
      slowMode: { supported: true, enabled: this.#slowEnabled, scope: null },
      usageLimit: null,
      tokensPerSecond: null,
      goal: null,
      contextParts: null,
    };
  }

  /** TSP 任务没有 rpc 的对话流：打开任务时给一份空的（界面渲染的是节点树）。 */
  snapshot(): TranscriptSnapshot {
    return { taskId: this.id, seq: 0, transcript: emptyTranscript() };
  }

  /** 池按"有对话快照的已停止任务"做 LRU 淘汰：TSP 任务的最后一份文档是它的快照。 */
  get hasSnapshot(): boolean {
    return this.#session === null && this.#finalSnapshot !== null;
  }

  releaseSnapshot(): void {
    if (this.#session === null) this.#finalSnapshot = null;
  }

  /** 当前节点树和它的序号；没有进程时是上一个进程退出时的文档，从没起过进程是空文档。 */
  tspSnapshot(): TspSnapshot {
    const current = this.#session
      ? { ...this.#session.snapshot() }
      : (this.#finalSnapshot ?? { seq: 0, document: snapshotDocument(createDocument()) });
    const seq = this.#session ? this.#seqBase + current.seq : current.seq;
    return { taskId: this.id, seq, document: current.document };
  }

  /** 记一次任务活动（用户发消息、一轮结束）：内存里立即生效，随后落盘。其它记账写入不碰 updatedAt。 */
  #touch(at: number): void {
    this.#activityAt = at;
    this.#host.persist(this.id, { updatedAt: at }).catch((error: unknown) => {
      log.warn(`task ${this.id} persisting its activity time failed`, { message: String(error) });
    });
  }

  // ───── 状态 ─────

  #apply(input: MachineInput): void {
    const next = transition(this.#machine, input);
    if (next === this.#machine) return;
    if (next.working && !this.#machine.working) this.#runStartedAt = Date.now();
    this.#machine = next;
    this.#publish();
  }

  #publish(): void {
    if (this.#disposed) return;
    this.#host.onState(this.state);
  }

  markRead(): void {
    this.#apply({ type: "mark_read" });
  }

  /** 让状态机和节点树一致：幂等，每次文档变化和握手完成时调用。 */
  #syncStatus(document: TspDocument): void {
    if (this.#machine.status === "starting" || this.#machine.status === "stopped" || this.#machine.status === "error")
      return;
    const info = deriveTaskStatus(document);
    if (info.working) this.#lastActiveAt = Date.now();
    if (info.working !== this.#machine.working) {
      if (info.working) {
        this.#apply({ type: "agent_start" });
      } else {
        const aborted = this.#stopRequested;
        // 一轮结束的时间和任务活动时间是同一刻：只读一次时钟，两处才相等。
        const endedAt = Date.now();
        this.#touch(endedAt);
        this.#stopRequested = false;
        this.#apply({
          type: "prompt_result",
          status: aborted ? "aborted" : "completed",
          sessionSettled: true,
          at: endedAt,
          foreground: this.#host.isForeground(this.id),
        });
        // 回合结束：会话文件这时一定落盘了。
        void this.#persistSessionFile();
      }
    }
    const open = this.#machine.dialogs.find((dialog) => dialog.id === ASK_DIALOG_ID);
    if (info.ask) {
      if (!open || (open.kind === "confirm" && open.title !== info.ask.title))
        this.#apply({
          type: "dialog_open",
          request: { id: ASK_DIALOG_ID, kind: "confirm", title: info.ask.title, message: "", receivedAt: Date.now() },
        });
    } else if (open) {
      this.#apply({ type: "dialog_close", id: ASK_DIALOG_ID });
    }
  }

  // ───── 生命周期 ─────

  /** 起进程并等握手完成；已在运行或启动中时返回同一个 promise。失败时状态已是 error，promise 也 reject。 */
  start(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error("task was removed"));
    if (this.#session && this.#machine.status !== "starting") return Promise.resolve();
    this.#starting ??= this.#start().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  async #start(): Promise<void> {
    if (this.#machine.status !== "stopped" && this.#machine.status !== "error")
      throw new Error(`cannot start a task that is ${this.#machine.status}`);
    this.#closing = false;
    this.#stopRequested = false;
    this.#apply({ type: "start" });
    let session: TspSession | null = null;
    try {
      const worktreePath = this.#record.worktreePath;
      if (
        worktreePath !== null &&
        !(await stat(worktreePath).then(
          () => true,
          () => false,
        ))
      )
        throw new StartError({ kind: "worktree_missing", message: "the task's worktree no longer exists" });
      const defaultsLoaded = this.#loadNewTaskDefaults();
      await this.#host.acquireSlot(this.id);
      this.#assertNotClosing();
      const launch = await this.#buildLaunch();
      this.#assertNotClosing();
      // 输入框出现之前 TaskState 就要有模型：默认值读完（缓存优先，通常已就绪）再起进程，这样第一帧状态里就有它。
      await defaultsLoaded;
      this.#assertNotClosing();
      const gen = ++this.#gen;
      const deps = this.#host.session;
      try {
        session = await TspSession.start({
          launch: {
            command: launch.command,
            args: launch.args,
            cwd: launch.cwd,
            env: buildTspEnv(launch.env, deps.appVersion),
          },
          cols: this.#cols,
          appVersion: deps.appVersion,
          appearance: deps.appearance(),
          ...(deps.spawn && { spawn: deps.spawn }),
          ...(deps.killTree && { killTree: deps.killTree }),
          ...(deps.assignJob && { assignJob: deps.assignJob }),
          ...(deps.helloTimeoutMs !== undefined && { helloTimeoutMs: deps.helloTimeoutMs }),
          onBatch: (batch) => {
            if (gen === this.#gen && !this.#disposed)
              this.#host.onTspBatch({
                taskId: this.id,
                firstSeq: this.#seqBase + batch.firstSeq,
                messages: batch.messages,
              });
          },
          onChange: (document) => {
            if (gen !== this.#gen) return;
            this.#syncStatus(document);
            this.#syncComposer(document);
            this.#notifyWaiters(document);
          },
          onSessionFile: (file) => {
            if (gen !== this.#gen) return;
            this.#sessionFile = file;
            void this.#persistSessionFile();
          },
          onTitle: (title) => {
            if (gen === this.#gen) this.#onTitle(title);
          },
          onExit: (exit) => {
            if (gen === this.#gen) this.#onExit(session, exit);
          },
        });
      } catch (error) {
        throw new StartError({ kind: "spawn_failed", message: error instanceof Error ? error.message : String(error) });
      }
      this.#finalSnapshot = null;
      this.#session = session;
      await session.ready;
      this.#assertNotClosing();
      this.#apply({ type: "ready" });
      // omp 在回复 hello 之前就可能已经发了第一批帧（它按假定的能力先开 surface）：握手前的变化没有进状态机。
      this.#syncStatus(session.document);
      this.#syncComposer(session.document);
      this.#notifyWaiters(session.document);
      void this.#refreshCatalog().then(() => {
        if (gen === this.#gen && this.#session) this.#syncComposer(this.#session.document);
      });
    } catch (error) {
      if (this.#closing || this.#disposed) {
        if (session) await this.#discard(session);
        this.#apply({ type: "stopped" });
        throw error;
      }
      const taskError = this.#classifyStartError(error);
      if (session) await this.#discard(session);
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
      throw new StartError({
        kind: "omp_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #classifyStartError(error: unknown): TaskError {
    if (error instanceof StartError) return error.taskError;
    if (error instanceof TooManyTasksError) return { kind: "too_many_tasks", message: error.message };
    if (error instanceof TspExitedError)
      return { kind: "handshake_failed", message: this.#withTail(error.message, error.exit.textTail) };
    if (error instanceof TspHandshakeError)
      return { kind: "handshake_failed", message: this.#withTail(error.message, error.textTail) };
    return { kind: "handshake_failed", message: error instanceof Error ? error.message : String(error) };
  }

  #withTail(message: string, tail: string): string {
    const lines = tail.trim().split(/\r?\n/).slice(-STDERR_LINES_IN_ERROR).join("\n");
    return lines ? `${message}\n${lines}` : message;
  }

  async #discard(session: TspSession): Promise<void> {
    if (this.#session === session) this.#session = null;
    await session.close();
  }

  #onExit(session: TspSession | null, exit: TspSessionExit): void {
    if (session === null || this.#session !== session) return;
    const snapshot = session.snapshot();
    this.#finalSnapshot = { seq: this.#seqBase + snapshot.seq, document: snapshot.document };
    this.#seqBase = this.#finalSnapshot.seq + 1;
    this.#session = null;
    this.#stopRequested = false;
    this.#failDocumentWaiters(new Error("the omp process exited"));
    // 退出前最后一次尝试保存会话文件（关闭时它一定已经落盘，除非一句话都没说）。
    void this.#persistSessionFile();
    if (this.#closing) {
      this.#apply({ type: "stopped" });
      return;
    }
    // 启动阶段的退出由 #start 的 catch 处理（它会把状态设成 error）。
    if (this.#machine.status === "starting") return;
    const message = this.#withTail(
      `omp exited with ${exit.exitCode ?? exit.signal ?? "unknown status"}`,
      exit.textTail,
    );
    log.warn(`task ${this.id} omp exited unexpectedly`, { message });
    this.#apply({ type: "failed", error: { kind: "exited", message } });
  }

  /** 正常关闭：结束进程树。状态变成 stopped，最后一份文档保留。 */
  async close(timeoutMs = 5_000): Promise<void> {
    this.#closing = true;
    const starting = this.#starting;
    if (starting) {
      const timedOut = Promise.withResolvers<void>();
      const timer = setTimeout(timedOut.resolve, timeoutMs);
      await Promise.race([starting.catch(() => {}), timedOut.promise]);
      clearTimeout(timer);
    }
    const session = this.#session;
    if (!session) return;
    await this.#persistSessionFile();
    await session.close(timeoutMs);
  }

  /** 关掉进程、释放等待者；任务从池里移除时调用。 */
  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.close();
    this.#failDocumentWaiters(new Error("task was removed"));
    await rm(this.#imagesDir(), { recursive: true, force: true });
  }

  async setArchived(archived: boolean): Promise<void> {
    this.#record = await this.#host.persist(this.id, { archived });
  }

  // ───── 会话文件、标题 ─────

  async #persistSessionFile(): Promise<void> {
    const file = this.#sessionFile;
    if (file === null || file === this.#record.sessionFile || this.#persistingSessionFile) return;
    this.#persistingSessionFile = true;
    try {
      const exists = await stat(file).then(
        () => true,
        () => false,
      );
      if (exists && !this.#disposed && file !== this.#record.sessionFile) {
        this.#record = await this.#host.persist(this.id, { sessionFile: file });
        this.#publish();
      }
    } catch (error) {
      log.warn(`task ${this.id} persisting the session file failed`, { message: String(error) });
    } finally {
      this.#persistingSessionFile = false;
    }
  }

  #onTitle(raw: string): void {
    const title = cleanOmpTitle(raw);
    if (title === "" || title === this.#lastOmpTitle) return;
    this.#lastOmpTitle = title;
    const current = this.#record.title;
    if (title === current) {
      this.#adoptedTitle = title;
      return;
    }
    // 用户改过名（既不是空、也不是我们临时取的、也不是上一次采用 omp 的）：不覆盖。
    if (current !== "" && current !== this.#provisionalTitle && current !== this.#adoptedTitle) return;
    this.#adoptedTitle = title;
    this.#host
      .persist(this.id, { title })
      .then((record) => {
        this.#record = record;
        this.#publish();
      })
      .catch((error: unknown) => log.warn(`task ${this.id} saving the omp title failed`, { message: String(error) }));
  }

  /** 改名：只改本地记录。omp 没有可以从外部调用的"改会话名"入口（rpc 的 set_session_name 在交互模式下不存在），
   *  往输入框塞 `/rename` 会混进用户的草稿，所以不同步给 omp；之后 omp 自己改标题时也不会覆盖用户起的名字（见 #onTitle）。 */
  async rename(title: string): Promise<void> {
    this.#record = await this.#host.persist(this.id, { title });
    this.#publish();
  }

  // ───── 操作 ─────

  /**
   * 发一句话：等输入框就绪后用 `send` 事件提交（和在输入框里回车同一条路径）；运行中也直接 `send`，omp 自己排队/steer。
   * 图片：TSP 没有传图片的通道，把图片写成临时文件、在文字后面加 omp 的 `@"<路径>"` 提及（实测 omp 读成图片附件，
   * 工具行显示 "Read <路径> (image)"；带空格的路径要用引号）。
   */
  async sendPrompt(input: PromptInput): Promise<void> {
    await this.start();
    const target = await this.#awaitComposer();
    const session = this.#session;
    if (!session) throw new Error("the omp process exited");
    const paths = input.images && input.images.length > 0 ? await this.#stageImages(input.images) : [];
    if (this.#record.title === "") {
      this.#provisionalTitle = titleFromPrompt(input.text);
      this.#record = await this.#host.persist(this.id, { title: this.#provisionalTitle });
      this.#publish();
    }
    this.#touch(Date.now());
    this.#publish();
    this.#lastActiveAt = Date.now();
    const mentions = paths.map((file) => `@"${file}"`).join(" ");
    const text = mentions === "" ? input.text : input.text === "" ? mentions : `${input.text} ${mentions}`;
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
  }

  #imagesDir(): string {
    return path.join(os.tmpdir(), "omp-studio-images", this.id);
  }

  /** 图片落成临时文件（omp 发出时读进会话，之后不再需要；任务移除时整个目录删掉）。路径用正斜杠，omp 的 `@` 提及两种都认。 */
  async #stageImages(images: readonly PromptImage[]): Promise<string[]> {
    const dir = this.#imagesDir();
    await mkdir(dir, { recursive: true });
    const stamp = Date.now();
    return Promise.all(
      images.map(async (image, index) => {
        const file = path.join(dir, `${stamp}-${index}.${IMAGE_EXTENSIONS[image.mimeType]}`);
        await writeFile(file, Buffer.from(image.data, "base64"));
        return file.replaceAll("\\", "/");
      }),
    );
  }

  /** 停止：发 Esc（omp 自己的中断键）。TSP 里没有"撤回排队消息"，队列由 omp 管。 */
  async stop(): Promise<RestoredQueue> {
    const session = this.#session;
    if (session && this.#machine.working) {
      this.#stopRequested = true;
      session.sendKeys(ESC_KEY);
    }
    return { steering: [], followUp: [], imagesDropped: false, truncated: false, aborted: true, backgroundWork: false };
  }

  sendTspEvent(event: TspEvent): void {
    this.#liveSession().sendEvent(event);
    this.#lastActiveAt = Date.now();
  }

  sendTspKeys(data: string): void {
    this.#liveSession().sendKeys(data);
    this.#lastActiveAt = Date.now();
  }

  /** 进程还没起（或已退出）时记下列数，起进程时用；首发时渲染进程在 omp 起来之前就量好了宽度。 */
  resizeTsp(cols: number): void {
    this.#cols = cols;
    this.#session?.resize(cols);
  }

  #liveSession(): TspSession {
    if (!this.#session) throw new Error("task has no running omp process");
    return this.#session;
  }

  // ───── 等文档 ─────

  /** 输入框节点（`editor`，`sendable: true`）：`send` 事件的目标。 */
  #findComposer(document: TspDocument): { sf: string; id: string } | null {
    for (const sf of document.live) {
      const surface = document.surfaces.get(sf);
      if (!surface) continue;
      const node = findNode(surface, (candidate) => candidate.k === "editor" && candidate.p.sendable === true, "dock");
      if (node) return { sf, id: node.id };
    }
    return null;
  }

  /**
   * 等文档满足 `check`（返回非 null）：现在就满足立刻返回，否则每次文档变化时再查，到时间 reject。
   * `check` 抛错 = 等不到了（reject）。进程退出、任务移除时所有等待者被 reject。
   */
  #awaitDocument<T>(
    check: (document: TspDocument) => T | null,
    timeoutMs: number,
    timeoutMessage: string,
    checkNow = true,
  ): Promise<T> {
    const session = this.#session;
    if (!session) return Promise.reject(new Error("the omp process exited"));
    if (checkNow) {
      try {
        const ready = check(session.document);
        if (ready !== null) return Promise.resolve(ready);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const waiter: DocumentWaiter = {
      check,
      resolve: resolve as (value: unknown) => void,
      reject,
      timer: setTimeout(() => {
        this.#documentWaiters.delete(waiter);
        reject(new Error(timeoutMessage));
      }, timeoutMs),
    };
    this.#documentWaiters.add(waiter);
    return promise;
  }

  /** 等输入框就绪；提问/审批把它换掉时立刻 reject（回答之前没有地方可发，不让调用方白等 30 秒）。 */
  #awaitComposer(): Promise<{ sf: string; id: string }> {
    return this.#awaitDocument(
      (document) => {
        // 提问/审批期间 dock 里可能还留着旧的可发送编辑器节点：以"在等用户"为准，不往里发。
        if (deriveTaskStatus(document).ask) throw new Error(TSP_COMPOSER_UNAVAILABLE);
        return this.#findComposer(document);
      },
      COMPOSER_TIMEOUT_MS,
      "omp's input box did not become ready in time",
    );
  }

  #notifyWaiters(document: TspDocument): void {
    if (this.#documentWaiters.size === 0) return;
    for (const waiter of this.#documentWaiters) {
      try {
        const value = waiter.check(document);
        if (value === null) continue;
        this.#documentWaiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(value);
      } catch (error) {
        this.#documentWaiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  #failDocumentWaiters(error: Error): void {
    for (const waiter of this.#documentWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#documentWaiters.clear();
  }

  // ───── 模型、思考强度 ─────

  /** 起进程前读新任务默认值并在目录里找到对应的模型；任务记录已有模型时不需要。从不 reject。 */
  async #loadNewTaskDefaults(): Promise<void> {
    const load = this.#host.newTaskDefaults;
    if (!load || this.#record.model) return;
    try {
      const defaults = await load(this.#project);
      const catalog = this.#catalog.length > 0 ? this.#catalog : await this.#refreshCatalog();
      // 和草稿、起进程前的输入框同一份计算（shared/ui/new-task-default.ts）：档位按模型钳制，不会只有模型名没有强度。
      const { model, thinkingLevel } = resolveNewTaskDefault(defaults, defaults.ompDefault, catalog);
      this.#newTaskDefault = { model, thinkingLevel };
      if (!this.#disposed) this.#publish();
    } catch (error) {
      log.warn(`task ${this.id} reading the new-task defaults failed`, { message: String(error) });
    }
  }

  /** 模型目录：构造时没有，进程起来后读一次（服务进程的 get_available_models，和草稿用的同一份）；失败时用上次的。 */
  async #refreshCatalog(): Promise<ModelOption[]> {
    const list = this.#host.listModels;
    if (!list) return this.#catalog;
    try {
      this.#catalog = await list();
    } catch (error) {
      log.warn(`task ${this.id} reading the model list failed`, { message: String(error) });
    }
    return this.#catalog;
  }

  async listModels(): Promise<ModelOption[]> {
    const models = await this.#refreshCatalog();
    const session = this.#session;
    if (session) this.#syncComposer(session.document);
    return models;
  }

  /** omp 显示的模型名 → 模型：重名时先取刚选的、再取记录里的，最后取目录里第一个；目录里没有时用名字造一个只显示用的。 */
  #resolveModel(name: string): ModelOption {
    const candidates = this.#catalog.filter((option) => option.name === name);
    if (this.#model?.name === name && !candidates.some((option) => sameKey(option.key, this.#model!.key)))
      candidates.push(this.#model);
    const preferred = [this.#chosenKey, this.#record.model];
    for (const key of preferred) {
      const hit = key && candidates.find((option) => sameKey(option.key, key));
      if (hit) return hit;
    }
    return (
      candidates[0] ?? {
        key: { provider: "", modelId: name },
        name,
        contextWindow: null,
        reasoning: false,
        acceptsImages: false,
        maxTokens: null,
        thinkingEfforts: null,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }
    );
  }

  /** 文档变化时调用：把输入框卡片上的模型名、思考强度、上下文、费用换算成 TaskState 的字段；变了才发布。 */
  #syncComposer(document: TspDocument): void {
    const info = deriveComposerInfo(document);
    if (!info) return; // 输入框被提问/审批换掉的那几帧：保留上一次的值
    const previous = this.#composer;
    const composer: TspComposerInfo = {
      modelName: info.modelName ?? previous.modelName,
      effort: info.effort ?? previous.effort,
      context: info.context ?? previous.context,
      cost: info.cost ?? previous.cost,
      fast: info.fast,
    };
    this.#composer = composer;
    const model = composer.modelName === null ? null : this.#resolveModel(composer.modelName);
    const thinkingLevel = toThinkingLevel(composer.effort);
    const window = composer.context?.contextWindow ?? model?.contextWindow ?? null;
    const contextUsage =
      composer.context && window !== null
        ? {
            tokens: composer.context.tokens ?? Math.round((composer.context.percent / 100) * window),
            contextWindow: window,
            percent: composer.context.percent,
          }
        : null;
    const sessionUsage =
      composer.cost === null
        ? null
        : {
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            cost: composer.cost,
            premiumRequests: 0,
          };
    const thinkingLevels = thinkingLevelsOf(model);
    const next: DerivedComposerState = {
      model,
      thinkingLevel,
      thinkingLevels,
      contextUsage,
      sessionUsage,
      fastEnabled: composer.fast,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(this.#derived);
    this.#derived = next;
    if (changed) this.#publish();
    void this.#persistModelChoice(model, thinkingLevel);
  }

  /**
   * 和 rpc 一样把当前模型和思考强度记进任务记录（下次 `--resume` 起来用）。只记目录里确有、且不会认错的模型：
   * 显示用的占位（provider 为空）和目录里重名又没有明确选择的不记（记错 provider 会让下次 `--model` 指到别家）。
   */
  async #persistModelChoice(model: ModelOption | null, thinkingLevel: ThinkingLevel | null): Promise<void> {
    if (this.#persistingChoice || this.#disposed) return;
    const patch: Partial<Omit<TaskRecord, "id">> = {};
    const unambiguous =
      model !== null &&
      model.key.provider !== "" &&
      (this.#catalog.filter((option) => option.name === model.name).length === 1 ||
        (this.#chosenKey !== null && sameKey(model.key, this.#chosenKey)));
    if (unambiguous && !(this.#record.model && sameKey(model.key, this.#record.model))) patch.model = model.key;
    if (thinkingLevel !== null && thinkingLevel !== this.#record.thinkingLevel) patch.thinkingLevel = thinkingLevel;
    if (Object.keys(patch).length === 0) return;
    this.#persistingChoice = true;
    try {
      this.#record = await this.#host.persist(this.id, patch);
    } catch (error) {
      log.warn(`task ${this.id} persisting the model choice failed`, { message: String(error) });
    } finally {
      this.#persistingChoice = false;
    }
  }

  /** 界面操作（切模型、切思考强度）一次只做一个：它们共用 omp 的一个选择器/一个循环键。 */
  #exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#uiChain.then(job, job);
    this.#uiChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #composerTargets(): Promise<TspComposerTargets & { session: TspSession }> {
    await this.start();
    await this.#awaitComposer();
    const session = this.#session;
    if (!session) throw new Error("the omp process exited");
    const targets = findComposerTargets(session.document);
    if (!targets) throw new Error(TSP_COMPOSER_UNAVAILABLE);
    return { ...targets, session };
  }

  /**
   * 切模型：点 omp 输入框上的模型胶囊（action `status.model` = Alt+P）打开选择器，在选择器里 `activate` 那一项
   * （item id 就是 `provider/model`）；omp 关掉选择器并给出 "Session-only model: <id>" 的提示（或输入框的模型名变了）才算完成。
   */
  setModel(key: ModelKey): Promise<void> {
    return this.#exclusive(async () => {
      const id = `${key.provider}/${key.modelId}`;
      const { sf, model, session } = await this.#composerTargets();
      if (model === null) throw new Error("omp's model switcher is not available");
      const nameBefore = this.#composer.modelName;
      session.sendEvent({ ev: "action", sf, id: model, act: ACTION_PICK_MODEL });
      const picker = await this.#awaitDocument(
        (document) => findPicker(document),
        PICKER_TIMEOUT_MS,
        "omp's model picker did not open in time",
      );
      if (!picker.items.includes(id)) {
        session.sendKeys(ESC_KEY);
        throw new Error(`model ${id} is not available in omp`);
      }
      const previousChoice = this.#chosenKey;
      this.#chosenKey = key;
      session.sendEvent({ ev: "activate", sf: picker.sf, id: picker.id, item: id });
      try {
        await this.#awaitDocument(
          (document) => {
            if (findPicker(document) !== null) return null;
            const confirmed = statusToastTexts(document).some((text) => text.includes(`Session-only model: ${id}`));
            const renamed = deriveComposerInfo(document)?.modelName;
            return confirmed || (renamed !== undefined && renamed !== null && renamed !== nameBefore) ? true : null;
          },
          CONFIRM_TIMEOUT_MS,
          `omp did not confirm switching to ${id}`,
        );
      } catch (error) {
        this.#chosenKey = previousChoice;
        throw error;
      }
      const live = this.#session;
      if (live) this.#syncComposer(live.document);
    });
  }

  /**
   * 切思考强度：反复点 omp 的思考强度节点（action `thinking.cycle` = ⇧⇥）直到显示目标级别。omp 按模型支持的级别循环
   * （实测 deepseek-v4-pro：high → max → off → auto → low → high…），转满一圈还没有就是这个模型不支持。
   */
  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.#exclusive(async () => {
      const { sf, effort, session } = await this.#composerTargets();
      if (effort === null) throw new Error("omp's thinking effort control is not available");
      const start = deriveComposerInfo(session.document)?.effort ?? null;
      if (start === level) return;
      let shown = start;
      for (let step = 0; step < MAX_THINKING_CYCLES; step += 1) {
        const before = shown;
        session.sendEvent({ ev: "action", sf, id: effort, act: ACTION_CYCLE_THINKING });
        shown = await this.#awaitDocument(
          (document) => {
            const current = deriveComposerInfo(document)?.effort ?? null;
            return current !== null && current !== before ? current : null;
          },
          CONFIRM_TIMEOUT_MS,
          "omp did not change the thinking effort",
        );
        if (shown === level) {
          const live = this.#session;
          if (live) this.#syncComposer(live.document);
          return;
        }
        if (shown === start) break;
      }
      throw new Error(`thinking level ${level} is not available for this model`);
    });
  }

  // ───── 斜杠命令、快速/慢速模式 ─────

  /** 这个任务每一轮的费用（见 tsp/turn-costs.ts）；会话文件还没落盘、读失败时 []。 */
  turnCosts(): Promise<number[]> {
    return readTurnCosts(this.#sessionFile ?? this.#record.sessionFile);
  }

  /** 用量脚注和空闲回顾：omp 恢复会话时不重发，从会话文件和 history.db 补（见 tsp/session-extras.ts）。 */
  sessionExtras(): Promise<TspSessionExtras> {
    return readSessionExtras(this.#sessionFile ?? this.#record.sessionFile);
  }

  /** omp 的命令列表（服务进程的 get_available_commands：内置命令一致，项目目录里的自定义命令/技能看不到）；没有进程时 []。 */
  async listSlashCommands(): Promise<AvailableSlashCommand[]> {
    const list = this.#host.listSlashCommands;
    if (!list || !this.#session || this.#machine.status === "starting") return [];
    return list();
  }

  /**
   * 把 `/命令` 当普通 `send` 交给 omp（实测:单独的 `/fast`、`/slow`、`/fast on` 在空闲和运行中都当命令执行；`/model <id>`
   * 带参数的当普通消息），等 omp 的状态 toast：匹配 `success` 就返回它，出现新的别的 toast 就当失败，原文抛出。
   */
  async #runSlash(text: string, success: RegExp): Promise<RegExpExecArray> {
    await this.start();
    const target = await this.#awaitComposer();
    const session = this.#liveSession();
    const before = statusToastTexts(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
    return this.#awaitDocument(
      (document) => {
        const texts = statusToastTexts(document);
        for (const toast of texts) {
          const hit = success.exec(toast);
          if (hit) return hit;
        }
        const fresh = texts.find((toast) => !before.includes(toast));
        if (fresh !== undefined) throw new Error(fresh);
        return null;
      },
      CONFIRM_TIMEOUT_MS,
      `omp did not confirm ${text}`,
      false,
    );
  }

  /** `/fast on|off`。模型不支持时 omp 的 toast 原文作为错误抛出。 */
  setFastMode(enabled: boolean): Promise<void> {
    return this.#exclusive(async () => {
      if (enabled && this.#composer.fast) return;
      await this.#runSlash(enabled ? "/fast on" : "/fast off", enabled ? /^Fast mode enabled/ : /^Fast mode disabled/);
      const live = this.#session;
      if (live) this.#syncComposer(live.document);
    });
  }

  /** `/slow on|off`。omp 的界面上没有慢速模式的状态节点，状态按它的 toast（"Slow mode on: …" / "Slow mode off: …"）记。 */
  setSlowMode(enabled: boolean): Promise<void> {
    return this.#exclusive(async () => {
      const hit = await this.#runSlash(enabled ? "/slow on" : "/slow off", /^Slow mode (on|off)/);
      this.#slowEnabled = hit[1] === "on";
      this.#publish();
    });
  }
}

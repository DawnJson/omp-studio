// TSP 任务的运行时：一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个伪终端里的交互式 omp（TspSession）。
// 对任务池的接口（生命周期、回收、状态）：start / close / state；状态来自 omp 发来的节点树（task-status.ts，规则和依据见那里），
// 状态机是 task-machine。旁路提问（/btw）见 tsp-btw.ts；会话命令（切模型、斜杠命令、模式、目标、快慢模式）见 tsp-commands.ts；
// 会话树 / 回溯 / 标签见 tsp-session-tree.ts；输入框卡片的派生状态（模型、用量、待办、开关）见 tsp-composer-observer.ts。
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ContextReport,
  PromptImage,
  DefaultModelInfo,
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
  TspBatch,
  TspSessionExtras,
  TspSnapshot,
  TspSubagentRecord,
} from "../../shared/ipc.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import {
  createDocument,
  snapshotDocument,
  type DocBlob,
  type DocumentSnapshot,
  type TspDocument,
} from "../../shared/tsp/document.ts";
import { TSP_COMPOSER_UNAVAILABLE, statusToastTexts } from "../../shared/tsp/composer-state.ts";
import { deriveTaskStatus, resolveTaskStatus } from "../../shared/tsp/task-status.ts";
import {
  NO_RUN_SIGNAL,
  applyRunStatus,
  beginRun,
  observeGate,
  turnResult,
  type RunSignal,
  type RunStatusMessage,
} from "../../shared/tsp/run-status.ts";
import { findComposerEditor } from "../../shared/tsp/session-tree.ts";
import { hasQueuedMessages } from "../../shared/tsp/queue-restore.ts";
import { clearEditorEvent, foreignEditorText } from "../../shared/tsp/editor-prefill.ts";
import { followUpText } from "../../shared/tsp/queue-command.ts";
import {
  appendEditorEvent,
  editorDraft,
  imagePasteKeys,
  imagePasteParts,
  pendingImageCount,
} from "../../shared/tsp/image-paste.ts";
import {
  TSP_APPROVAL_DIALOG_ID,
  TSP_ASK_DIALOG_ID,
  TSP_MODAL_DIALOG_ID,
  TSP_SCREEN_OPEN,
  findMessageTarget,
} from "../../shared/tsp/gate.ts";
import { log } from "../log/log.ts";
import { waitWithTimeout } from "../platform/wait-with-timeout.ts";
import type { OmpLaunch } from "../omp/omp-connection.ts";
import type { ThinkingLevel, AvailableSlashCommand, GoalOp } from "../../shared/omp-wire/rpc-wire.generated.ts";
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
import { stripIconGlyphs } from "../../shared/ui/clean-title.ts";
import { SessionExtrasAccumulator } from "../tsp/session-extras.ts";
import { SessionFileReader } from "../tsp/session-file-reader.ts";
import { readSubagentRecord } from "../tsp/subagent-file.ts";
import { HubDriver } from "./tsp-hub-driver.ts";
import { SessionUsageAccumulator } from "../history/session-usage.ts";
import type { RewindTarget } from "../tsp/session-tree-file.ts";
import { initialMachineState, transition, type MachineInput, type MachineState } from "./task-machine.ts";
import { pathKey, type TaskRecord } from "./task-registry.ts";
import { WorkspaceDirs } from "./workspace-dirs.ts";
import { TspGoalTracker } from "./tsp-goal.ts";
import { TspComposerFactsTracker } from "./tsp-composer-facts.ts";
import { deriveComposerFacts, type ComposerFacts, type ModeOp } from "../../shared/tsp/composer-facts.ts";
import { TspBtw } from "./tsp-btw.ts";
import { TspDocScans } from "./tsp-doc-scans.ts";
import { TspCommands, CONFIRM_TIMEOUT_MS, ESC_KEY } from "./tsp-commands.ts";
import { TspSessionTree } from "./tsp-session-tree.ts";
import { TspComposerObserver } from "./tsp-composer-observer.ts";
import { fillFileSlots } from "../../shared/composer-files.ts";
import { resolveComposerFiles } from "../files/composer-files.ts";
import { isBtwRunning, type BtwHistoryRecord, type BtwUiEvent } from "../../shared/btw.ts";

/** 存活进程数到了硬上限（软上限 × 2），拒绝再起。 */
export class TooManyTasksError extends Error {
  override name = "TooManyTasksError";
}

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
/** Esc 之后等 omp 把排队文字写回它自己的输入框的上限（只在 Esc 时队列里有消息才等）。 */
const QUEUE_RESTORE_MS = 3_000;
const STDERR_LINES_IN_ERROR = 8;

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
  /** 目标完成等一次性提示（可选；没提供时不弹）。 */
  onNotice?(notice: TaskNotice): void;
  /** 旁路提问（`/btw`）镜像的变化；没提供（多数测试）时不推。 */
  onBtw?(taskId: TaskId, event: BtwUiEvent): void;
  /** omp 往它自己的输入框里写了 studio 没发的草稿（文字和挂着的图片）：已清空 omp 那边，放进 studio 的输入框；没提供（多数测试）时不推。 */
  onComposerPrefill?(taskId: TaskId, draft: RestoredDraft): void;
  session: TspSessionDeps;
  /** 上次读到的模型目录里的这一项；没有（或没提供）时胶囊先显示模型 id。 */
  knownModel?(key: ModelKey): ModelOption | null;
  /** 模型目录（服务进程的 get_available_models，和草稿输入框用的同一份）：把 omp 的模型显示名换成模型键、给 listTaskModels。 */
  listModels?(): Promise<ModelOption[]>;
  /** omp 的命令列表：任务目录里的项目 rpc-ui（项目 skill、自定义命令、扩展命令）；没提供时 TSP 任务的列表为空。 */
  listSlashCommands?(cwd: string): Promise<AvailableSlashCommand[]>;
  /** 把会话文件导出成 HTML（`omp --export`，见 omp/export-session.ts）；没提供时 TSP 任务不能导出。 */
  exportSession?(sessionFile: string, outputPath: string, cwd: string): Promise<void>;
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

/** omp 在标题后面追加 ` · #<PR 号>`（title-generator 的 `ugr`：当前分支有 PR 时）。 */
const PR_SUFFIX = /\s*·\s*#(\d+)$/;

/** 标题里的 PR 号；没有后缀为 null。 */
export function ompTitlePullRequest(raw: string): number | null {
  const match = PR_SUFFIX.exec(stripIconGlyphs(raw));
  return match ? Number(match[1]) : null;
}

/** 去掉图标字形和 ` · #12` 的 PR 后缀；"omp" 是 omp 没有标题时的占位，不是标题（`omp · #12` 也是空）。 */
export function cleanOmpTitle(raw: string): string {
  const title = stripIconGlyphs(raw).replace(PR_SUFFIX, "").trim();
  return title === "omp" ? "" : title;
}

export class TspRunner {
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
  /** 进程退出后保留最后一份文档，界面还能看到发生了什么。快照不带 blob 字节，字节留在 `blobs`（那个进程文档的 blob 表，只此一份），按需取（`tspBlob`）。 */
  #finalSnapshot: { seq: number; document: DocumentSnapshot; blobs: ReadonlyMap<string, DocBlob> } | null = null;
  /**
   * 批次序号的偏移。每个进程的消息序号从 1 开始，但渲染进程按"上一个序号 + 1"接收批次：新进程的序号要接在上一个进程之后
   * 并留一个空位（最后序号 + 2 起），渲染进程发现不连续就重新取快照，不会把新进程的消息接在旧文档上。
   */
  #seqBase = 0;
  #documentWaiters = new Set<DocumentWaiter>();
  /** 输入框卡片的派生状态：模型、思考强度、用量、待办阶段、自动压缩、会话开关、`/slow`（tsp-composer-observer.ts）。 */
  readonly #composerState: TspComposerObserver;
  #catalog: ModelOption[] = [];
  /** omp 对这个项目的新任务默认值解析出的模型和思考强度：任务记录没指定、输入框卡片也还没出现时显示它（不传给 omp）。 */
  #newTaskDefault: { model: ModelOption | null; thinkingLevel: ThinkingLevel | null } = {
    model: null,
    thinkingLevel: null,
  };
  #uiChain: Promise<void> = Promise.resolve();
  /** 正在自己读 omp 输入框文字的操作数（Esc 取回排队消息、`#exclusive` 里的界面操作）；大于 0 时通用回填不动输入框。 */
  #editorClaims = 0;
  /** 通用回填正在取走 omp 输入框里的文字（取走 → 清空确认之间不重复触发）。 */
  #takingEditor = false;
  /** 上一次发布出去的 TaskState.restartable（#syncRestartable 只在它变了时补发）。 */
  #publishedRestartable = false;
  /** 后台驱动 Agent Hub（插话 / 结束 / 恢复）期间为真：#awaitComposer 等它结束，渲染进程这期间也不画 Hub。 */
  #hubDriving = false;
  readonly #hub = new HubDriver({
    document: () => this.#session?.document ?? null,
    sendEvent: (event) => this.sendTspEvent(event),
    sendKeys: (data) => this.sendTspKeys(data),
    awaitDocument: (check, timeoutMs, message) => this.#awaitDocument(check, timeoutMs, message),
    exclusive: (job) => this.#exclusive(job),
    setDriving: (on) => {
      this.#hubDriving = on;
      const session = this.#session;
      if (!on && session) this.#notifyWaiters(session.document);
    },
  });
  /** `/add-dir` 的额外工作区目录（只来自 omp 的 toast，进程退出清空）。 */
  #workspace = new WorkspaceDirs();
  /** 目标模式（`/goal`）：状态来自输入框卡片上的"Goal …"事实行，目标文字来自会话文件（shared/tsp/goal.ts、tsp-goal.ts）。 */
  #goalTracker = new TspGoalTracker({
    sessionFile: () => this.#currentSessionFile(),
    changed: () => this.#publish(),
    completed: () => this.#host.onNotice?.({ taskId: this.id, kind: "goal_complete" }),
  });
  /** 模式和扩展状态（TaskState.composerMode / extStatuses）：同样来自输入框卡片的事实行（shared/tsp/composer-facts.ts）。 */
  readonly #factsTracker = new TspComposerFactsTracker();
  /** 后台驱动旁路提问期间为真：#awaitComposer 等它结束。 */
  #btwDriving = false;
  /** 旁路提问（`/btw`）：omp 画成 modal 弹窗，这里读成话题镜像（tsp-btw.ts、docs/architecture/tsp-btw.md）。 */
  readonly #btw = new TspBtw({
    document: () => this.#session?.document ?? null,
    sendEvent: (event) => this.sendTspEvent(event),
    awaitDocument: (check, timeoutMs, message) => this.#awaitDocument(check, timeoutMs, message),
    composer: async () => {
      await this.start();
      return this.#awaitComposer();
    },
    exclusive: (job) => this.#exclusive(job),
    sessionFile: () => this.#currentSessionFile(),
    emit: (event) => this.#host.onBtw?.(this.id, event),
    setDriving: (on) => {
      this.#btwDriving = on;
      const session = this.#session;
      if (!on && session) this.#notifyWaiters(session.document);
    },
  });
  /** 会话命令（切模型 / 思考强度、斜杠命令、模式、目标、快慢模式），共用本任务的界面操作队列（tsp-commands.ts）。 */
  readonly #commands = new TspCommands({
    start: () => this.start(),
    session: () => this.#session,
    liveSession: () => this.#liveSession(),
    awaitComposer: () => this.#awaitComposer(),
    awaitDocument: (check, timeoutMs, message, checkNow) => this.#awaitDocument(check, timeoutMs, message, checkNow),
    exclusive: (job) => this.#exclusive(job),
    composerInfo: () => this.#composerState.info,
    chosenKey: () => this.#composerState.chosenKey,
    setChosenKey: (key) => {
      this.#composerState.chosenKey = key;
    },
    syncComposer: () => {
      const live = this.#session;
      if (live) this.#composerState.syncComposer(live.document);
    },
    setSlowEnabled: (enabled) => {
      this.#composerState.setSlowEnabled(enabled);
      this.#publish();
    },
    goal: this.#goalTracker,
  });
  /** 会话树、回溯、标签、分叉前检查（tsp-session-tree.ts）。 */
  readonly #tree = new TspSessionTree({
    sessionFile: () => this.#currentSessionFile(),
    assertTurnFinished: () => this.#assertTurnFinished(),
    start: () => this.start(),
    session: () => this.#session,
    liveSession: () => this.#liveSession(),
    awaitComposer: () => this.#awaitComposer(),
    awaitDocument: (check, timeoutMs, message) => this.#awaitDocument(check, timeoutMs, message),
    exclusive: (job) => this.#exclusive(job),
    takeEditorText: (session) => this.#takeEditorText(session),
  });
  /** OSC 7501 的累积结果（本进程；shared/tsp/run-status.ts）。 */
  #signal: RunSignal = NO_RUN_SIGNAL;
  /** dock 里 `omp.loader` 的文字（交接、建 worktree、分支摘要等；TaskState.loaderText）。 */
  #loaderText: string | null = null;
  /** 上一次发布出去的 TaskState.loaderText（#syncStatus 只在它变了而状态机没发布时补发）。 */
  #publishedLoaderText: string | null = null;
  /** 标题后缀 ` · #12` 里的 PR 号（TaskState.prNumber）。 */
  #prNumber: number | null = null;
  /** 当前会话文档的整篇扫描结果（待办、toast、旁路弹窗、后台工作），相关节点变了才重扫（tsp-doc-scans.ts）。 */
  #scans: TspDocScans | null = null;
  /** 当前会话文件的增量读取（token 合计和用量脚注共用，见 #readSessionFile）；会话文件换了就换一个。 */
  #sessionReader: {
    reader: SessionFileReader;
    usage: SessionUsageAccumulator;
    extras: SessionExtrasAccumulator;
  } | null = null;
  /** 用户按了停止、这一轮还没结束：这一轮的结局记为 aborted。 */
  #stopRequested = false;
  /** omp 报告的会话文件；文件在第一条回复之后才落盘，落盘之前不能存（恢复会失败）。undefined = 还没报过（用任务记录里的），null = omp 清空了它。 */
  #sessionFile: string | null | undefined = undefined;
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
          intelligence: null,
          catalogTps: null,
        })
      : null;
    this.#composerState = new TspComposerObserver({
      taskId: this.id,
      record: () => this.#record,
      persistRecord: async (patch) => {
        this.#record = await this.#host.persist(this.id, patch);
      },
      ownModel: () => this.#model,
      catalog: () => this.#catalog,
      disposed: () => this.#disposed,
      scans: (document) => this.#scansFor(document),
      readSessionFile: () => this.#readSessionFile(),
      publish: () => this.#publish(),
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
      !this.#scansFor(session.document).runningWork &&
      !isBtwRunning(this.#btw.records)
    );
  }

  /** 能重开会话：可回收（空闲、没有等待和后台工作），或者进程已经不在。 */
  get restartable(): boolean {
    const status = this.#machine.status;
    return status === "stopped" || status === "error" || this.recyclable;
  }

  /** omp 标题后缀里的 PR 号（TaskState.prNumber）；顶栏 PR 徽标的点击在主进程按它取地址。 */
  get prNumber(): number | null {
    return this.#prNumber;
  }

  /** 任务现在的工作目录：omp 里 `/move`、`/wt` 过的（OSC 7，记在任务记录里）> worktree 根 > 项目目录。 */
  get cwd(): string {
    return this.#record.cwd ?? this.#record.worktreePath ?? this.#project.path;
  }

  get state(): TaskState {
    const m = this.#machine;
    const derived = this.#composerState.derived;
    return {
      id: this.id,
      projectId: this.#record.projectId,
      title: this.#record.title,
      status: m.status,
      unread: m.unread,
      lastTurn: m.lastTurn,
      error: m.error,
      createdAt: this.#record.createdAt,
      updatedAt: this.#activityAt,
      // 模型、思考强度、上下文用量、费用从 omp 输入框卡片上读（composer-state.ts）；输入框还没出现时用任务记录里的。
      model: derived.model ?? this.#model ?? this.#newTaskDefault.model,
      thinkingLevel: derived.thinkingLevel ?? this.#record.thinkingLevel ?? this.#newTaskDefault.thinkingLevel,
      thinkingLevels: derived.thinkingLevels,
      contextUsage: derived.contextUsage,
      sessionUsage: derived.sessionUsage,
      dialogs: m.dialogs,
      todoPhases: this.#composerState.todoPhases,
      workspaceDirs: this.#workspace.dirs,
      cwd: this.cwd,
      worktreeBranch: this.#record.worktreeBranch,
      runStartedAt: m.working ? this.#runStartedAt : null,
      fastMode: { enabled: derived.fastEnabled, active: derived.fastEnabled },
      // omp 没有慢速模式的状态节点和"支持与否"的信息：一律 supported，不支持的模型 omp 的 toast 原文作为错误抛出（同 fast）。
      slowMode: { supported: true, enabled: this.#composerState.slowEnabled, scope: null },
      sessionToggles: this.#composerState.toggles,
      goal: this.#goalTracker.goal,
      restartable: this.restartable,
      loaderText: this.#loaderText,
      prNumber: this.#prNumber,
      contextCompaction: this.#composerState.contextCompaction,
      composerMode: this.#factsTracker.mode,
      extStatuses: this.#factsTracker.extStatuses,
    };
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

  /** 已发给渲染进程的最后一条消息的序号（先把攒着的批次发出去）：渲染进程结束一次驱动前等自己的镜像追上它。 */
  tspSeq(): number {
    return this.#session ? this.#seqBase + this.#session.flushedSeq() : (this.#finalSnapshot?.seq ?? 0);
  }

  /** 快照里列出的 blob 的字节（DocumentSnapshot.blobIds）；`id` 已是小写。没有进程时取上一个进程退出时留下的；没有为 null。 */
  tspBlob(id: string): DocBlob | null {
    const blobs = this.#session ? this.#session.document.blobs : this.#finalSnapshot?.blobs;
    return blobs?.get(id) ?? null;
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
    const state = this.state;
    this.#publishedRestartable = state.restartable;
    this.#publishedLoaderText = state.loaderText;
    this.#host.onState(state);
  }

  /** 后台作业、子代理、旁路提问的起止不经过状态机：文档变了就看一眼"能否重开"变没变，变了才发布。 */
  #syncRestartable(): void {
    if (this.restartable !== this.#publishedRestartable) this.#publish();
  }

  /** 文档的扫描缓存；换了会话（新文档）就从头建一份。 */
  #scansFor(document: TspDocument): TspDocScans {
    if (this.#scans?.document !== document) this.#scans = new TspDocScans(document);
    return this.#scans;
  }

  markRead(): void {
    this.#apply({ type: "mark_read" });
  }

  /** OSC 7501：折进 #signal，然后重新推一次状态（节点没变也要推：`working` 比 `omp.working` 那一帧早到，`done` 带着这一轮的结局）。 */
  #onRunStatus(status: RunStatusMessage): void {
    this.#signal = applyRunStatus(this.#signal, status);
    if (this.#session) this.#syncStatus(this.#session.document);
  }

  /** 让状态机和节点树 + 7501 一致：幂等，每次文档变化、7501 到达和握手完成时调用。规则和依据见 task-status.ts。 */
  #syncStatus(document: TspDocument): void {
    if (this.#machine.status === "starting" || this.#machine.status === "stopped" || this.#machine.status === "error")
      return;
    const nodes = deriveTaskStatus(document);
    this.#signal = observeGate(this.#signal, nodes.ask !== null);
    const info = resolveTaskStatus(nodes, this.#signal);
    this.#loaderText = nodes.loader;
    if (info.working) this.#lastActiveAt = Date.now();
    if (info.working !== this.#machine.working) {
      if (info.working) {
        // 7501 没报开始（交接这类只有 loader 的运行）：上一轮留下的结局不能算到这一轮头上。
        this.#signal = beginRun(this.#signal);
        this.#apply({ type: "agent_start" });
      } else {
        // 结局以 7501 为准（done / error / idle = 被中断），这一轮没收到过才看用户有没有按停止。
        const result = turnResult(this.#signal, this.#stopRequested);
        // 一轮结束的时间和任务活动时间是同一刻：只读一次时钟，两处才相等。
        const endedAt = Date.now();
        this.#touch(endedAt);
        this.#stopRequested = false;
        this.#apply({
          type: "prompt_result",
          status: result.status,
          ...(result.status === "error" && { error: { message: result.message ?? "", retryable: false } }),
          at: endedAt,
          foreground: this.#host.isForeground(this.id),
        });
        // 回合结束：会话文件这时一定落盘了。
        void this.#persistSessionFile();
      }
    }
    const open = this.#machine.dialogs.find(
      (dialog) =>
        dialog.id === TSP_ASK_DIALOG_ID || dialog.id === TSP_APPROVAL_DIALOG_ID || dialog.id === TSP_MODAL_DIALOG_ID,
    );
    const waiting = info.waiting;
    if (waiting) {
      const id =
        waiting.kind === "approval"
          ? TSP_APPROVAL_DIALOG_ID
          : waiting.kind === "modal"
            ? TSP_MODAL_DIALOG_ID
            : TSP_ASK_DIALOG_ID;
      if (open && open.id !== id) this.#apply({ type: "dialog_close", id: open.id });
      if (!open || open.id !== id || (open.kind === "confirm" && open.title !== waiting.title))
        this.#apply({
          type: "dialog_open",
          request: { id, kind: "confirm", title: waiting.title, message: "", receivedAt: Date.now() },
        });
    } else if (open) {
      this.#apply({ type: "dialog_close", id: open.id });
    }
    // loader 的文字变了而状态机没有动（上面没发布过）：补发一次。
    if (this.#loaderText !== this.#publishedLoaderText) this.#publish();
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
      const movedTo = this.#record.cwd;
      if (
        movedTo != null &&
        !(await stat(movedTo).then(
          (info) => info.isDirectory(),
          () => false,
        ))
      ) {
        // omp 里 `/move` 去过的目录已经没了：退回默认目录（omp 看会话文件里记的目录是否还在，由它自己报错），不让 spawn 的 ENOENT 当成启动失败。
        log.warn(`task ${this.id} working directory no longer exists, falling back to the default`);
        this.#record = await this.#host.persist(this.id, { cwd: null });
      }
      const defaultsLoaded = this.#loadNewTaskDefaults();
      await this.#host.acquireSlot(this.id);
      this.#assertNotClosing();
      const launch = await this.#buildLaunch();
      this.#assertNotClosing();
      // 新进程的 7501 从头累积；握手前就可能到（omp 一启动就发 `state=idle`），所以在起进程之前清。
      this.#signal = NO_RUN_SIGNAL;
      this.#loaderText = null;
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
          onChange: (document, message, result) => {
            if (gen !== this.#gen) return;
            this.#scansFor(document).observe(message, result);
            this.#syncStatus(document);
            this.#composerState.observe(document);
            this.#observeFacts(document);
            this.#btw.sync(this.#scansFor(document).btwView);
            this.#notifyWaiters(document);
            this.#syncRestartable();
            this.#syncEditorText(document);
            // 新会话的文件在第一条回复之后才落盘，第一轮可能跑上几个小时：文件一出现就记进任务，不等这一轮结束。
            // 否则会话列表把它当成另一条会话列出来，点开就对同一个文件再起一个 omp（omp 会分叉出新文件），侧栏出现两条。
            void this.#persistSessionFile();
          },
          onSessionFile: (file) => {
            if (gen !== this.#gen) return;
            this.#sessionFile = file;
            void this.#persistSessionFile();
          },
          onTitle: (title) => {
            if (gen === this.#gen) this.#onTitle(title);
          },
          onCwd: (cwd) => {
            if (gen === this.#gen) this.#onCwd(cwd);
          },
          onRunStatus: (status) => {
            if (gen === this.#gen) this.#onRunStatus(status);
          },
          onExit: (exit) => {
            if (gen === this.#gen) this.#onExit(session, exit);
          },
        });
      } catch (error) {
        throw new StartError({ kind: "spawn_failed", message: error instanceof Error ? error.message : String(error) });
      }
      this.#finalSnapshot = null;
      // 开关是会话（进程）级的：新进程从配置默认值开始。
      this.#composerState.resetSession();
      this.#goalTracker.reset();
      this.#factsTracker.reset();
      this.#btw.reset();
      this.#session = session;
      await session.ready;
      // 输入框出现之前 TaskState 就要有模型：默认值（缓存优先；服务进程冷启动时要等它拉模型目录，约 1.5 秒）
      // 和 omp 启动同时进行，握手之后、进 ready 之前等它读完，这样 ready 的状态里就有它。
      await defaultsLoaded;
      this.#assertNotClosing();
      this.#apply({ type: "ready" });
      // omp 在回复 hello 之前就可能已经发了第一批帧（它按假定的能力先开 surface）：握手前的变化没有进状态机。
      this.#syncStatus(session.document);
      this.#composerState.observe(session.document);
      this.#observeFacts(session.document);
      this.#btw.sync(this.#scansFor(session.document).btwView);
      this.#notifyWaiters(session.document);
      void this.#refreshCatalog().then(() => {
        if (gen === this.#gen && this.#session) this.#composerState.syncComposer(this.#session.document);
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
    if (this.#session === session) {
      this.#session = null;
      this.#scans = null;
    }
    await session.close();
  }

  #onExit(session: TspSession | null, exit: TspSessionExit): void {
    if (session === null || this.#session !== session) return;
    const snapshot = session.snapshot();
    this.#finalSnapshot = {
      seq: this.#seqBase + snapshot.seq,
      document: snapshot.document,
      blobs: session.document.blobs,
    };
    this.#seqBase = this.#finalSnapshot.seq + 1;
    this.#session = null;
    this.#scans = null;
    this.#workspace.reset();
    this.#signal = NO_RUN_SIGNAL;
    this.#loaderText = null;
    this.#goalTracker.reset();
    this.#factsTracker.reset();
    this.#btw.reset();
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
    if (starting) await waitWithTimeout(starting, timeoutMs);
    const session = this.#session;
    if (!session) return;
    await this.#persistSessionFile();
    await session.close(timeoutMs);
  }

  /** 重开会话：关进程、再用 `--resume` 起（等于终端里退出再进），skill、MCP、插件和配置全部重新读。忙的时候拒绝，不打断正在做的事。 */
  async restart(): Promise<void> {
    if (!this.restartable) throw new Error("the task is busy; restart it when it is idle");
    await this.close();
    await this.start();
  }

  /** 关掉进程、释放等待者；任务从池里移除时调用。 */
  async dispose(): Promise<void> {
    this.#disposed = true;
    await this.close();
    this.#failDocumentWaiters(new Error("task was removed"));
    this.#sessionReader = null;
    await rm(this.#imagesDir(), { recursive: true, force: true });
  }

  async setArchived(archived: boolean): Promise<void> {
    this.#record = await this.#host.persist(this.id, { archived });
  }

  // ───── 会话文件、标题 ─────

  async #persistSessionFile(): Promise<void> {
    const file = this.#sessionFile;
    if (!file || file === this.#record.sessionFile || this.#persistingSessionFile) return;
    this.#persistingSessionFile = true;
    try {
      const exists = await stat(file).then(
        () => true,
        () => false,
      );
      if (exists && !this.#disposed && file !== this.#record.sessionFile) {
        this.#record = await this.#host.persist(this.id, {
          sessionFile: file,
          ...((this.#record.forkFrom ?? null) !== null && { forkFrom: null }),
        });
        this.#publish();
      }
    } catch (error) {
      log.warn(`task ${this.id} persisting the session file failed`, { message: String(error) });
    } finally {
      this.#persistingSessionFile = false;
    }
  }

  /**
   * omp 里换了会话目录（OSC 7：启动时、`/move`、`/wt`）：记进任务记录，之后文件面板、评审、git、新开终端、`--resume` 都用它（`cwd` getter）。
   * 就是默认目录（worktree 根或项目目录）时记 null。worktree 任务的 `worktreePath` 等字段不动：合并、丢弃仍按它们。
   */
  #onCwd(raw: string): void {
    const next = path.resolve(raw);
    if (pathKey(next) === pathKey(this.cwd)) return;
    const wanted = pathKey(next) === pathKey(this.#record.worktreePath ?? this.#project.path) ? null : next;
    // 内存里立即生效（registry 的 updateTask 在调用时同步改它自己的表，之后别处 await persist 拿到的记录也带着它）。
    this.#record = { ...this.#record, cwd: wanted };
    this.#publish();
    this.#host
      .persist(this.id, { cwd: wanted })
      .catch((error: unknown) =>
        log.warn(`task ${this.id} saving the omp working directory failed`, { message: String(error) }),
      );
  }

  #onTitle(raw: string): void {
    const prNumber = ompTitlePullRequest(raw);
    if (prNumber !== this.#prNumber) {
      this.#prNumber = prNumber;
      this.#publish();
    }
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

  /** 改名：只改本地记录。omp 没有可以从外部调用的"改会话名"入口，
   *  往输入框塞 `/rename` 会混进用户的草稿，所以不同步给 omp；之后 omp 自己改标题时也不会覆盖用户起的名字（见 #onTitle）。 */
  async rename(title: string): Promise<void> {
    this.#record = await this.#host.persist(this.id, { title });
    this.#publish();
  }

  // ───── 操作 ─────

  /**
   * 发一句话：等输入框就绪后用 `send` 事件提交（和在输入框里回车同一条路径）；运行中也直接 `send`，omp 自己排队/steer。
   * 带图片时走 omp 自己的图片附件（shared/tsp/image-paste.ts）：`send` 会丢掉粘贴的图片，所以文字用 `edit` 填进 omp 的输入框、
   * 括号粘贴图片的临时文件路径、等 omp 挂上图片，再 `action submit`。
   */
  async sendPrompt(input: PromptInput): Promise<void> {
    // 文件附件：id → 路径，文字里的占位符换成 omp 的 `@"路径"` 提及（omp 自己读文件）。
    const body = fillFileSlots(input.text, input.fileIds ? await resolveComposerFiles(input.fileIds) : []);
    await this.start();
    const target = await this.#awaitComposer(true);
    const session = this.#session;
    if (!session) throw new Error("the omp process exited");
    const paths = input.images && input.images.length > 0 ? await this.#stageImages(input.images) : [];
    if (this.#record.title === "") {
      this.#provisionalTitle = titleFromPrompt(body);
      this.#record = await this.#host.persist(this.id, { title: this.#provisionalTitle });
      this.#publish();
    }
    this.#touch(Date.now());
    this.#publish();
    this.#lastActiveAt = Date.now();
    // 运行中的"等这一轮结束再发"：`send` 在运行中是插话（steer），follow-up 要用 omp 的 `/queue`；空闲时就是普通的一轮。
    const wire = input.whenBusy === "followUp" && this.#machine.working ? followUpText(body) : body;
    if (paths.length === 0) {
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: wire });
      return;
    }
    await this.#sendWithImages(session, target, wire, paths);
  }

  /** 文字 + 图片：在 omp 的输入框里按顺序重建草稿再提交。期间 studio 自己往那里填字，通用回填（`#syncEditorText`）先让开。 */
  async #sendWithImages(
    session: TspSession,
    target: { sf: string; id: string },
    text: string,
    files: readonly string[],
  ): Promise<void> {
    this.#editorClaims++;
    try {
      // 通用回填已经把 omp 自己放进去的文字搬走了；剩下的（还没来得及搬）不能混进这条消息。
      await this.#takeEditorText(session);
      for (const part of imagePasteParts(text, files.length)) {
        if (part.kind === "text") {
          const editor = findComposerEditor(session.document) ?? { ...target, text: "" };
          session.sendEvent(appendEditorEvent(editor, part.text));
          await this.#awaitDocument(
            (document) => (findComposerEditor(document)?.text !== editor.text ? true : null),
            CONFIRM_TIMEOUT_MS,
            "omp's input box did not take the text",
          );
          continue;
        }
        const imagesBefore = pendingImageCount(session.document);
        const toastsBefore = statusToastTexts(session.document);
        let failure: string | undefined;
        session.sendKeys(imagePasteKeys(files[part.index]!));
        await this.#awaitDocument(
          (document) => {
            // omp 读不了文件时只弹一条状态 toast（"Image not found at …" 等），不会挂上图片。但新 toast 不一定是这次粘贴的：
            // 刚起的 omp 一秒后才弹 MCP 挂载通知（"xdev: xd://: mounted …"），后台作业结束也弹。所以只以挂上图片为准，
            // 等不到时再以最后一条新 toast 的原文报错。
            failure = statusToastTexts(document).findLast((candidate) => !toastsBefore.includes(candidate)) ?? failure;
            return pendingImageCount(document) > imagesBefore ? true : null;
          },
          CONFIRM_TIMEOUT_MS,
          () => failure ?? "omp did not attach the image",
        );
      }
      session.sendEvent({ ev: "action", sf: target.sf, id: target.id, act: "submit" });
      // 提交后 omp 清空输入框（实测同一帧）；清空之前放开的话，通用回填会把刚发出的文字当成 omp 的预填搬回 studio 的输入框。
      await this.#awaitDocument(
        (document) => ((findComposerEditor(document)?.text ?? "") === "" ? true : null),
        CONFIRM_TIMEOUT_MS,
        "omp did not submit the message",
      );
    } finally {
      this.#releaseEditor();
    }
  }

  #imagesDir(): string {
    return path.join(os.tmpdir(), "omp-studio-images", this.id);
  }

  /** 图片落成临时文件（粘贴时 omp 读进会话，之后不再需要；任务移除时整个目录删掉）。 */
  async #stageImages(images: readonly PromptImage[]): Promise<string[]> {
    const dir = this.#imagesDir();
    await mkdir(dir, { recursive: true });
    const stamp = Date.now();
    return Promise.all(
      images.map(async (image, index) => {
        const file = path.join(dir, `${stamp}-${index}.${IMAGE_EXTENSIONS[image.mimeType]}`);
        await writeFile(file, Buffer.from(image.data, "base64"));
        return file;
      }),
    );
  }

  /**
   * 停止：发 Esc（omp 自己的中断键）。TSP 里没有"撤回排队消息"的命令，但 omp 在中断时把排队的文字写回**它自己的**
   * 输入框（实录 fixtures/tsp/queue-esc.jsonl）：Esc 时队列里有消息就等那段文字出现，读出来返回（渲染进程把它放回
   * studio 的输入框），并清空 omp 的输入框（否则下一次 send 之外的任何地方都看不到它，也不会再被用）。
   */
  async stop(): Promise<RestoredQueue> {
    const session = this.#session;
    const steering: RestoredDraft[] = [];
    if (session && this.#machine.working) {
      // 旁路提问的弹窗开着时 Esc 会落在它上面：先取消旁路提问、关掉弹窗、等它撤掉，再给主轮发 Esc（tsp-btw.md §4）。
      await this.#btw.yieldToMain();
      const hadQueue = hasQueuedMessages(session.document);
      this.#stopRequested = true;
      // 有排队消息时 omp 把它们写回自己的输入框：这条路径自己读、自己清（返回给渲染进程），通用回填先让开。
      if (hadQueue) this.#editorClaims++;
      try {
        session.sendKeys(ESC_KEY);
        if (hadQueue) {
          try {
            await this.#awaitDocument(
              (document) => foreignEditorText(document),
              QUEUE_RESTORE_MS,
              "omp did not return the queued message to its input box",
            );
            const draft = await this.#takeEditorText(session);
            if (draft !== null) steering.push(draft);
          } catch (error) {
            log.warn(`task ${this.id} taking back the queued message failed`, { message: String(error) });
          }
        }
      } finally {
        if (hadQueue) this.#releaseEditor();
      }
    }
    return { steering, followUp: [], imagesDropped: false, truncated: false, aborted: true, backgroundWork: false };
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

  /** 深浅主题或减少动效变了：转给运行中的会话发 `theme` / `motion` 事件；没有进程的任务下次起进程时 hello 回复读最新值（`host.session.appearance()`）。 */
  setAppearance(next: { dark: boolean; reduceMotion: boolean }): void {
    this.#session?.setAppearance(next);
  }

  #liveSession(): TspSession {
    if (!this.#session) throw new Error("task has no running omp process");
    return this.#session;
  }

  // ───── 等文档 ─────

  /**
   * 等文档满足 `check`（返回非 null）：现在就满足立刻返回，否则每次文档变化时再查，到时间 reject（`timeoutMessage` 是函数时到时间才取）。
   * `check` 抛错 = 等不到了（reject）。进程退出、任务移除时所有等待者被 reject。
   */
  #awaitDocument<T>(
    check: (document: TspDocument) => T | null,
    timeoutMs: number,
    timeoutMessage: string | (() => string),
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
        reject(new Error(typeof timeoutMessage === "function" ? timeoutMessage() : timeoutMessage));
      }, timeoutMs),
    };
    this.#documentWaiters.add(waiter);
    return promise;
  }

  /**
   * 等输入框就绪（目标选择见 shared/tsp/gate.ts）。提问把它换掉、全屏面板（Agent Hub 等）开着时立刻 reject
   * （回答/关掉之前没有该发的地方，不让调用方白等 30 秒，更不能让消息变成对主代理的插话）。
   * 有审批在等时：`allowApproval` 为真（发用户消息）就往里发，omp 会拒绝这个审批并把消息当插话；
   * 为假（切模型、斜杠命令）立刻 reject，不能让这些操作顺手拒绝掉审批。
   */
  #awaitComposer(allowApproval = false): Promise<{ sf: string; id: string }> {
    return this.#awaitDocument(
      (document) => {
        // 后台驱动 Agent Hub 期间不往主会话发别的消息（聚焦模式下它们会变成对那个子代理的插话）：等驱动结束。
        if (this.#hubDriving || this.#btwDriving) return null;
        const target = findMessageTarget(document);
        switch (target.kind) {
          case "panel":
            throw new Error(TSP_SCREEN_OPEN);
          case "ask":
            throw new Error(TSP_COMPOSER_UNAVAILABLE);
          case "pending":
            return null;
          case "ready":
            if (target.approval && !allowApproval) throw new Error(TSP_COMPOSER_UNAVAILABLE);
            return { sf: target.sf, id: target.id };
        }
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
    if (session) this.#composerState.syncComposer(session.document);
    return models;
  }

  /**
   * 界面操作（切模型、切思考强度、回溯……）一次只做一个：它们共用 omp 的一个选择器/一个循环键。
   * 这期间 studio 自己在驱动 omp，输入框里出现的预填（回溯填回的那条消息等）由操作自己读、自己清，通用回填（`#syncEditorText`）先让开。
   */
  #exclusive<T>(job: () => Promise<T>): Promise<T> {
    this.#editorClaims++;
    const run = this.#uiChain.then(job, job).finally(() => this.#releaseEditor());
    this.#uiChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 一个"自己读输入框"的操作结束：放开通用回填，并检查这期间有没有留下没人取的文字（比如 `/plan` 的预填）。 */
  #releaseEditor(): void {
    this.#editorClaims--;
    if (this.#session !== null) this.#syncEditorText(this.#session.document);
  }

  /** 切模型、切思考强度：驱动 omp 输入框卡片上的控件（tsp-commands.ts）。 */
  setModel(key: ModelKey): Promise<void> {
    return this.#commands.setModel(key);
  }

  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.#commands.setThinkingLevel(level);
  }

  // ───── 斜杠命令、快速/慢速模式 ─────

  /** 用量脚注：omp 恢复会话时不重发，从会话文件补（见 tsp/session-extras.ts）；没有文件、读失败时为空。 */
  async sessionExtras(): Promise<TspSessionExtras> {
    try {
      const session = await this.#readSessionFile();
      return session?.extras.result() ?? { turns: [], tokensPerSecond: null };
    } catch (error) {
      log.warn("reading the session file for turn footers failed", { taskId: this.id, message: String(error) });
      return { turns: [], tokensPerSecond: null };
    }
  }

  /**
   * 把当前会话文件新追加的部分读进累加器：只读上次之后的字节（会话文件动辄上百 MB，整份重读会卡主进程）。
   * 会话文件换了（分叉、新会话、/move）换一个读取器从头读；还没有会话文件时为 null。
   */
  async #readSessionFile(): Promise<{ usage: SessionUsageAccumulator; extras: SessionExtrasAccumulator } | null> {
    const file = this.#currentSessionFile();
    if (file === null) return null;
    let session = this.#sessionReader;
    if (session?.reader.file !== file) {
      const usage = new SessionUsageAccumulator();
      const extras = new SessionExtrasAccumulator();
      session = { reader: new SessionFileReader(file, [usage, extras]), usage, extras };
      this.#sessionReader = session;
    }
    await session.reader.update();
    return session;
  }

  readContext(): Promise<ContextReport | null> {
    return this.#commands.readContext();
  }

  // ───── 旁路提问（/btw，tsp-btw.ts） ─────

  /** 提问（`recordId` 缺省开新话题，否则追问）：经 omp 的主输入框发 `/btw`，返回话题 id。 */
  askBtw(question: string, recordId?: string): Promise<string> {
    return this.#btw.ask(question, recordId);
  }

  /** 取消在跑的旁路提问（点弹窗的 Stop）；没有在跑的 false。 */
  cancelBtw(recordId?: string): Promise<boolean> {
    return Promise.resolve(this.#btw.cancel(recordId));
  }

  /** 话题历史：镜像 + 会话旁边的 btw-history/（没有进程也能读，不为它起进程）。 */
  getBtw(): Promise<BtwHistoryRecord[]> {
    return this.#btw.history();
  }

  /** omp 的命令列表：任务目录（`cwd`，含 `/move`、worktree）里的项目 rpc-ui 取，项目 skill、自定义命令、扩展命令都在；任务还没起进程（草稿、starting）时照给，没接服务进程时 []。 */
  async listSlashCommands(): Promise<AvailableSlashCommand[]> {
    const list = this.#host.listSlashCommands;
    if (!list) return [];
    return list(this.cwd);
  }

  /**
   * 导出成 HTML：不经 omp 进程，对会话文件跑 `omp --export <文件> <输出路径>`（omp/export-session.ts）。
   * `outputPath` 必须是主进程自己经保存对话框拿到的绝对路径；还没有会话文件（没发过消息）时拒绝。返回写出的路径。
   */
  async exportHtml(outputPath: string): Promise<string> {
    const exportSession = this.#host.exportSession;
    if (!exportSession) throw new Error("exporting is not available for this task");
    if (!path.isAbsolute(outputPath)) throw new Error("export path must be absolute");
    const file = this.#currentSessionFile();
    if (file === null) throw new Error("this task has no session file yet");
    await exportSession(file, outputPath, this.cwd);
    return outputPath;
  }

  // 会话命令的实现在 tsp-commands.ts；这里只转发。

  runSessionCommand(text: string, success?: (toast: string) => boolean): Promise<string> {
    return this.#commands.runSessionCommand(text, success);
  }

  runQuietCommand(text: string): Promise<string> {
    return this.#commands.runQuietCommand(text);
  }

  compact(): Promise<void> {
    return this.#commands.compact();
  }

  handoff(): Promise<void> {
    return this.#commands.handoff();
  }

  runTodoCommand(text: string): Promise<string> {
    return this.#commands.runTodoCommand(text);
  }

  // ───── 模式（/plan /vibe /loop）和输入框卡片上的事实 ─────

  /** 文档变了：模式、扩展状态、目标都跟着 omp 输入框卡片上的事实行走（shared/tsp/composer-facts.ts）；变了才发布。 */
  #observeFacts(document: TspDocument): void {
    const facts: ComposerFacts = deriveComposerFacts(document);
    this.#goalTracker.observe(facts);
    if (this.#factsTracker.observe(facts)) this.#publish();
  }

  runModeCommand(op: ModeOp, text: string): Promise<string> {
    return this.#commands.runModeCommand(op, text);
  }

  goal(op: GoalOp, objective?: string): Promise<TaskState["goal"]> {
    return this.#commands.goal(op, objective);
  }

  get workspaceDirs(): readonly string[] {
    return this.#workspace.dirs;
  }

  /** `/dirs`、`/add-dir`、`/remove-dir` 的 toast → 额外工作区目录（omp 拒绝或 toast 认不出来时以原文抛错）；有变化就发布状态。 */
  applyWorkspaceDirsOutput(text: string): void {
    if (this.#workspace.apply(text)) this.#publish();
  }

  setFastMode(enabled: boolean): Promise<void> {
    return this.#commands.setFastMode(enabled);
  }

  setSlowMode(enabled: boolean): Promise<void> {
    return this.#commands.setSlowMode(enabled);
  }

  // ───── 会话树、回溯、分叉（tsp-session-tree.ts，docs/architecture/session-tree.md） ─────

  #currentSessionFile(): string | null {
    return this.#sessionFile === undefined ? this.#record.sessionFile : this.#sessionFile;
  }

  /** 回溯和分叉要求这一轮已经结束：omp 的 `/tree` 在运行中会打断或搅乱这一轮，分叉复制的文件也要写完。 */
  #assertTurnFinished(): void {
    const session = this.#session;
    if (
      this.#machine.working ||
      this.#machine.dialogs.length > 0 ||
      (session !== null && this.#scansFor(session.document).runningWork)
    )
      throw new Error("the session is busy; wait for the current turn to finish");
  }

  getSessionTree(): Promise<SessionTreeView> {
    return this.#tree.getSessionTree();
  }

  prepareFork(entryId: string | null): Promise<{ sourceFile: string; entryId: string; target: RewindTarget }> {
    return this.#tree.prepareFork(entryId);
  }

  rewindTo(entryId: string, known?: RewindTarget, summarize = false): Promise<{ text: string; summarized: boolean }> {
    return this.#tree.rewindTo(entryId, known, summarize);
  }

  labelEntry(entryId: string, label: string | null): Promise<void> {
    return this.#tree.labelEntry(entryId, label);
  }

  /**
   * 取走 omp 输入框里的草稿：读出文字和挂着的图片（`editorDraft`）、发 `edit` 清空 omp 那边（否则文字一直留在那里，也挡住 omp 的下一次预填）、
   * 等清空确认；本来就空返回 null。studio 只在发带图片的消息时往那里填字（`#sendWithImages`，期间不走这里的通用回填），所以这里出现的文字是 omp 自己放的（shared/tsp/editor-prefill.ts）。
   */
  async #takeEditorText(session: TspSession): Promise<RestoredDraft | null> {
    const editor = foreignEditorText(session.document);
    if (editor === null) return null;
    // 清空会连同图片一起删掉：先读。
    const draft = editorDraft(session.document, editor.text);
    session.sendEvent(clearEditorEvent(editor));
    await this.#awaitDocument(
      (document) => (foreignEditorText(document) === null ? true : null),
      CONFIRM_TIMEOUT_MS,
      "omp's input box did not clear",
    );
    return draft;
  }

  /**
   * 通用回填规则：omp 的输入框里出现文字（Ctrl+R 选中的历史、⌥↑ 取回的排队消息、`/annotate`、`/plan` 的预填……），
   * 而 studio 自己没有在等它（Esc 取回排队消息、回溯这两条路径自己读、自己清，期间 `#editorClaims` > 0），就搬进 studio 的输入框
   * （`onComposerPrefill`）并清空 omp 那边。
   */
  #syncEditorText(document: TspDocument): void {
    const session = this.#session;
    if (session === null || this.#editorClaims > 0 || this.#takingEditor || foreignEditorText(document) === null)
      return;
    this.#takingEditor = true;
    void this.#takeEditorText(session)
      .then((draft) => {
        if (draft !== null && this.#session === session) this.#host.onComposerPrefill?.(this.id, draft);
      })
      .catch((error: unknown) => {
        log.warn(`task ${this.id} moving omp's input box text failed`, { message: String(error) });
      })
      .finally(() => {
        this.#takingEditor = false;
      });
  }

  // ───── 子代理面板（S1，docs/architecture/subagents.md "TSP 任务里的子代理面板"） ─────
  // 列表直接从文档读（shared/tsp/agent-hub.ts）；记录读 omp 的存档（tsp/subagent-file.ts）；
  // 插话 / 结束 / 恢复在后台驱动 omp 的 Agent Hub（tasks/tsp-hub-driver.ts）。

  /** 子代理的记录和最终输出（会话文件旁的 `<名字>.jsonl` / `.md`）；名字不合规时返回 unavailable，不抛错。 */
  subagentRecord(name: string): Promise<TspSubagentRecord> {
    return readSubagentRecord(this.#currentSessionFile(), name);
  }

  focusSubagent(name: string): Promise<void> {
    return this.#hub.focus(name);
  }

  steerSubagent(name: string, text: string): Promise<void> {
    return this.#hub.steer(name, text);
  }

  killSubagent(name: string): Promise<void> {
    return this.#hub.kill(name);
  }

  reviveSubagent(name: string): Promise<void> {
    return this.#hub.revive(name);
  }
}

// TSP 任务的运行时：一个任务 = 一个项目目录 + 一个 omp 会话 + （存活时）一个伪终端里的交互式 omp（TspSession）。
// 对任务池的接口（生命周期、回收、状态）：start / close / state；状态来自 omp 发来的节点树（task-status.ts，规则和依据见那里），
// 状态机是 task-machine。旁路提问（/btw）见 tsp-btw.ts。
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
  isShownModelName,
  statusToastTexts,
  type TspComposerInfo,
  type TspComposerTargets,
} from "../../shared/tsp/composer-state.ts";
import { compactionMark, compactionOutcome } from "../../shared/tsp/compaction.ts";
import { deriveContextCompaction } from "../../shared/tsp/context-compaction.ts";
import { errorLines, newErrorLine } from "../../shared/tsp/error-lines.ts";
import { ACTION_CONTEXT_REPORT, findContextReport } from "../../shared/tsp/context-report.ts";
import {
  applyToggleObservation,
  emptySessionToggles,
  freshToasts,
  parseToggleToast,
  type SessionToggles,
} from "../../shared/omp-output/toggles.ts";
import { deriveTaskStatus, hasRunningWork, resolveTaskStatus } from "../../shared/tsp/task-status.ts";
import {
  NO_RUN_SIGNAL,
  applyRunStatus,
  beginRun,
  observeGate,
  turnResult,
  type RunSignal,
  type RunStatusMessage,
} from "../../shared/tsp/run-status.ts";
import { deriveTodoPhases } from "../../shared/tsp/todos.ts";
import {
  SUMMARY_NO,
  TREE_ACT_LABEL,
  TREE_ACT_LABEL_SAVE,
  findComposerEditor,
  findSummaryPicker,
  findTreeLabelInput,
  findTreePicker,
  hasNavigatedToast,
} from "../../shared/tsp/session-tree.ts";
import { hasQueuedMessages } from "../../shared/tsp/queue-restore.ts";
import { clearEditorEvent, foreignEditorText } from "../../shared/tsp/editor-prefill.ts";
import { followUpText } from "../../shared/tsp/queue-command.ts";
import {
  TSP_APPROVAL_DIALOG_ID,
  TSP_ASK_DIALOG_ID,
  TSP_MODAL_DIALOG_ID,
  TSP_SCREEN_OPEN,
  findMessageTarget,
} from "../../shared/tsp/gate.ts";
import { log } from "../log/log.ts";
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
import { readSessionExtras } from "../tsp/session-extras.ts";
import { readSubagentRecord } from "../tsp/subagent-file.ts";
import { HubDriver } from "./tsp-hub-driver.ts";
import { readSessionUsage, totalUsage, type SessionTotals } from "../history/session-usage.ts";
import {
  buildTreeFromEntries,
  findUserEntry,
  isLabellableEntry,
  readSessionEntries,
  type LeafOverride,
  type RewindTarget,
  type SessionEntry,
} from "../tsp/session-tree-file.ts";
import { initialMachineState, transition, type MachineInput, type MachineState } from "./task-machine.ts";
import { pathKey, type TaskRecord } from "./task-registry.ts";
import { WorkspaceDirs } from "./workspace-dirs.ts";
import { TspGoalTracker } from "./tsp-goal.ts";
import { GOAL_TOASTS, findGoalDropPrompt } from "../../shared/tsp/goal.ts";
import { TspComposerFactsTracker } from "./tsp-composer-facts.ts";
import {
  deriveComposerFacts,
  modeCommandBlocker,
  modeCommandDone,
  type ComposerFacts,
  type ModeOp,
} from "../../shared/tsp/composer-facts.ts";
import { TspBtw } from "./tsp-btw.ts";
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
/** 切模型、切思考强度时等 omp 响应的上限：选择器（要读模型目录）打开、确认提示出现。 */
const PICKER_TIMEOUT_MS = 8_000;
const CONFIRM_TIMEOUT_MS = 5_000;
/** 回溯完成后等 omp 的输入框预填/toast 的上限（等不到不算失败）。 */
const NAVIGATION_SETTLE_MS = 1_500;
/** Esc 之后等 omp 把排队文字写回它自己的输入框的上限（只在 Esc 时队列里有消息才等）。 */
const QUEUE_RESTORE_MS = 3_000;
/** 回溯时让 omp 摘要被放弃的分支：要调一次模型，实测约 10 秒，留足余量。 */
const SUMMARY_TIMEOUT_MS = 120_000;
/** `runQuietCommand` 观察 toast 的时长；到点没有 toast 就算成功。 */
const QUIET_SETTLE_MS = 1_500;
/** `/compact` 要调模型：等压缩结局的上限。 */
const COMPACT_TIMEOUT_MS = 5 * 60_000;
const QUIET_SETTLED = "quiet-settled";
/** 思考强度循环的最多步数（omp 最多 8 个级别，转满一圈就不会再有新的）。 */
const MAX_THINKING_CYCLES = 10;
const STDERR_LINES_IN_ERROR = 8;
const ESC_KEY = "\x1b";

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
  /** omp 往它自己的输入框里写了 studio 没发的文字：已清空 omp 那边，放进 studio 的输入框；没提供（多数测试）时不推。 */
  onComposerPrefill?(taskId: TaskId, text: string): void;
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
  /** 进程退出后保留最后一份文档，界面还能看到发生了什么。 */
  #finalSnapshot: { seq: number; document: DocumentSnapshot } | null = null;
  /** `#refreshTotals` 的合并状态：正在读、读的时候是否又来了请求。 */
  #totalsReading = false;
  #totalsDirty = false;
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
  /** 正在自己读 omp 输入框文字的操作数（Esc 取回排队消息、`#exclusive` 里的界面操作）；大于 0 时通用回填不动输入框。 */
  #editorClaims = 0;
  /** 通用回填正在取走 omp 输入框里的文字（取走 → 清空确认之间不重复触发）。 */
  #takingEditor = false;
  /** `/slow` 的状态：omp 没有状态节点，按 toast 记；一开始未知，当关。 */
  #slowEnabled = false;
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
  /** 会话开关（/skillful 等）：按 omp 的状态 toast 记（parseToggleToast），用户在输入框里自己敲的命令也同步；null 项 = 本会话没动过。 */
  #toggles: SessionToggles = emptySessionToggles();
  /** 上一次文档里的状态 toast 文字：只读新出现的那些（freshToasts）。 */
  #toastTexts: string[] = [];
  /** 已读过的状态行记录条数（`DocSurface.statusNotes` 只增不减；toast 节点下一帧就没了，所以两条路都读）。 */
  #noteCount = 0;
  /** OSC 7501 的累积结果（本进程；shared/tsp/run-status.ts）。 */
  #signal: RunSignal = NO_RUN_SIGNAL;
  /** dock 里 `omp.loader` 的文字（交接、建 worktree、分支摘要等；TaskState.loaderText）。 */
  #loaderText: string | null = null;
  /** 上一次发布出去的 TaskState.loaderText（#syncStatus 只在它变了而状态机没发布时补发）。 */
  #publishedLoaderText: string | null = null;
  /** 标题后缀 ` · #12` 里的 PR 号（TaskState.prNumber）。 */
  #prNumber: number | null = null;
  /** 文档里 HUD 待办节点换算出的阶段（todos.ts）；变了才发布。 */
  #todoPhases: TaskState["todoPhases"] = [];
  /** 输入框卡片上上下文 meter 里 omp 给的自动压缩信息（context-compaction.ts）；变了才发布。 */
  #contextCompaction: TaskState["contextCompaction"] = null;
  /** 会话文件里的 token 分项和请求数（见 #sessionUsageFor）。 */
  #totals: SessionTotals | null = null;
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
      !hasRunningWork(session.document) &&
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
      model: this.#derived.model ?? this.#model ?? this.#newTaskDefault.model,
      thinkingLevel: this.#derived.thinkingLevel ?? this.#record.thinkingLevel ?? this.#newTaskDefault.thinkingLevel,
      thinkingLevels: this.#derived.thinkingLevels,
      contextUsage: this.#derived.contextUsage,
      sessionUsage: this.#derived.sessionUsage,
      dialogs: m.dialogs,
      todoPhases: this.#todoPhases,
      workspaceDirs: this.#workspace.dirs,
      cwd: this.cwd,
      runStartedAt: m.working ? this.#runStartedAt : null,
      fastMode: { enabled: this.#derived.fastEnabled, active: this.#derived.fastEnabled },
      // omp 没有慢速模式的状态节点和"支持与否"的信息：一律 supported，不支持的模型 omp 的 toast 原文作为错误抛出（同 fast）。
      slowMode: { supported: true, enabled: this.#slowEnabled, scope: null },
      sessionToggles: this.#toggles,
      goal: this.#goalTracker.goal,
      restartable: this.restartable,
      loaderText: this.#loaderText,
      prNumber: this.#prNumber,
      contextCompaction: this.#contextCompaction,
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
      // 输入框出现之前 TaskState 就要有模型：默认值读完（缓存优先，通常已就绪）再起进程，这样第一帧状态里就有它。
      await defaultsLoaded;
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
          onChange: (document) => {
            if (gen !== this.#gen) return;
            this.#syncStatus(document);
            this.#syncComposer(document);
            this.#syncToggles(document);
            this.#observeFacts(document);
            this.#btw.sync(document);
            this.#notifyWaiters(document);
            this.#syncRestartable();
            this.#syncEditorText(document);
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
      this.#toggles = emptySessionToggles();
      this.#goalTracker.reset();
      this.#factsTracker.reset();
      this.#btw.reset();
      this.#toastTexts = [];
      this.#noteCount = 0;
      this.#session = session;
      await session.ready;
      this.#assertNotClosing();
      this.#apply({ type: "ready" });
      // omp 在回复 hello 之前就可能已经发了第一批帧（它按假定的能力先开 surface）：握手前的变化没有进状态机。
      this.#syncStatus(session.document);
      this.#syncComposer(session.document);
      this.#syncToggles(session.document);
      this.#observeFacts(session.document);
      this.#btw.sync(session.document);
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
   * 图片：TSP 没有传图片的通道，把图片写成临时文件、在文字后面加 omp 的 `@"<路径>"` 提及（实测 omp 读成图片附件，
   * 工具行显示 "Read <路径> (image)"；带空格的路径要用引号）。
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
    const mentions = paths.map((file) => `@"${file}"`).join(" ");
    const text = mentions === "" ? body : body === "" ? mentions : `${body} ${mentions}`;
    // 运行中的"等这一轮结束再发"：`send` 在运行中是插话（steer），follow-up 要用 omp 的 `/queue`；空闲时就是普通的一轮。
    const wire = input.whenBusy === "followUp" && this.#machine.working ? followUpText(text) : text;
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: wire });
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
            const text = await this.#takeEditorText(session);
            if (text !== null) steering.push({ text });
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
    if (session) this.#syncComposer(session.document);
    return models;
  }

  /** omp 显示的模型名 → 模型：重名时先取刚选的、再取记录里的，最后取目录里第一个；目录里没有时用名字造一个只显示用的。 */
  #resolveModel(name: string): ModelOption {
    const candidates = this.#catalog.filter((option) => isShownModelName(option.name, name));
    const own = this.#model;
    if (own && isShownModelName(own.name, name) && !candidates.some((option) => sameKey(option.key, own.key)))
      candidates.push(own);
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
        intelligence: null,
        catalogTps: null,
      }
    );
  }

  /**
   * 文档变化时读新出现的状态 toast：认得出的开关状态（parseToggleToast）合进 `#toggles`（包括用户自己在输入框里敲的 `/skillful` 等）；
   * 变了才发布。`/slow` 的状态也在这里记（omp 没有慢速模式的状态节点）。
   */
  #syncToggles(document: TspDocument): void {
    const texts = statusToastTexts(document);
    const notes = [...document.live].flatMap(
      (sf) => document.surfaces.get(sf)?.statusNotes.map((note) => note.text) ?? [],
    );
    if (notes.length < this.#noteCount) this.#noteCount = 0; // surface 关了又开：新的一批从头读
    const fresh = [...notes.slice(this.#noteCount), ...freshToasts(this.#toastTexts, texts)];
    this.#toastTexts = texts;
    this.#noteCount = notes.length;
    let next = this.#toggles;
    let changed = false;
    for (const text of fresh) {
      const observation = parseToggleToast(text);
      if (observation === null) continue;
      if (observation.name === "slow") {
        if (this.#slowEnabled !== observation.on) {
          this.#slowEnabled = observation.on;
          changed = true;
        }
        continue;
      }
      next = applyToggleObservation(next, observation);
    }
    if (next !== this.#toggles) {
      this.#toggles = next;
      changed = true;
    }
    if (changed) this.#publish();
  }

  /**
   * 本会话用量：费用是 omp 输入框卡片上的值；token 分项和请求数 omp 的 TSP 卡片不给，从会话文件读（`#refreshTotals`）。
   * 读到之前 token 是 0。不用 stats.db 的 session_rollup：它只在 `omp stats` 运行时才同步，
   * 对正在进行的会话是旧的；会话信息对话框里才用它（session-info/session-stats.ts）。
   */
  #sessionUsageFor(cost: number | null): TaskState["sessionUsage"] {
    if (cost === null) return null;
    const totals = this.#totals;
    return {
      tokens: totals?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost,
      premiumRequests: 0,
      ...(totals && { requests: totals.requests }),
    };
  }

  /**
   * 读会话文件里的 token 和请求数；读失败只记日志（费用照常显示，token 保持上一次的值）。
   * 同一任务同时只读一次：读的时候又来的请求合并成这次读完后再读一次（文件在读的过程中可能又被 omp 追加或重写）。
   */
  async #refreshTotals(): Promise<void> {
    if (this.#totalsReading) {
      this.#totalsDirty = true;
      return;
    }
    this.#totalsReading = true;
    try {
      do {
        this.#totalsDirty = false;
        await this.#readTotals();
      } while (this.#totalsDirty && !this.#disposed);
    } finally {
      this.#totalsReading = false;
    }
  }

  async #readTotals(): Promise<void> {
    const file = this.#currentSessionFile();
    if (file === null) return;
    try {
      const totals = totalUsage((await readSessionUsage(file)).models);
      if (this.#disposed || JSON.stringify(totals) === JSON.stringify(this.#totals)) return;
      this.#totals = totals;
      this.#derived = { ...this.#derived, sessionUsage: this.#sessionUsageFor(this.#composer.cost) };
      this.#publish();
    } catch (error) {
      log.warn("reading the session file for token totals failed", { taskId: this.id, message: String(error) });
    }
  }

  /** 文档变化时调用：把输入框卡片上的模型名、思考强度、上下文、费用换算成 TaskState 的字段；变了才发布。 */
  #syncComposer(document: TspDocument): void {
    const todoPhases = deriveTodoPhases(document);
    if (JSON.stringify(todoPhases) !== JSON.stringify(this.#todoPhases)) {
      this.#todoPhases = todoPhases;
      this.#publish();
    }
    // 输入框被提问 / 审批换掉的那几帧（undefined）沿用上一次的值。
    const compaction = deriveContextCompaction(document);
    if (compaction !== undefined && JSON.stringify(compaction) !== JSON.stringify(this.#contextCompaction)) {
      this.#contextCompaction = compaction;
      this.#publish();
    }
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
    // 费用或上下文用量变了 = 又结束了一次请求：会话文件里的 token 分项和请求数也该重读（见 #refreshTotals）。
    // 不能只看费用：费用读不出来（omp 改了写法）或一直是 0 时，token 分项会永远停在 0。
    if (composer.cost !== previous.cost || composer.context?.tokens !== previous.context?.tokens)
      void this.#refreshTotals();
    const sessionUsage = this.#sessionUsageFor(composer.cost);
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
   * 把当前模型和思考强度记进任务记录（下次 `--resume` 起来用）。只记目录里确有、且不会认错的模型：
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

  /** 用量脚注：omp 恢复会话时不重发，从会话文件补（见 tsp/session-extras.ts）。 */
  sessionExtras(): Promise<TspSessionExtras> {
    return readSessionExtras(this.#currentSessionFile());
  }

  /**
   * omp 现算的上下文构成：点输入框上的上下文 meter（action `status.context`），omp 当场按会话现在的状态算一遍并弹出报告
   * （shared/tsp/context-report.ts），读完点报告的 Close。运行中也能读：正在生成的回复按已生成的部分算进 Messages。
   * 渲染进程在调用期间不画 layer（tsp-store 的 drive），报告不会闪一下。
   * 没有进程、输入框被提问 / 审批 / 全屏面板占着（报告会盖住它们）时为 null。
   */
  readContext(): Promise<ContextReport | null> {
    return this.#exclusive(async () => {
      const session = this.#session;
      if (!session) return null;
      const gate = findMessageTarget(session.document);
      if (gate.kind !== "ready" || gate.approval) return null;
      const targets = findComposerTargets(session.document);
      if (targets?.context == null) return null;
      session.sendEvent({ ev: "action", sf: targets.sf, id: targets.context, act: ACTION_CONTEXT_REPORT });
      const shown = await this.#awaitDocument(
        findContextReport,
        PICKER_TIMEOUT_MS,
        "omp did not show its context report",
      );
      if (shown.close === null) throw new Error("omp's context report has no Close button");
      session.sendEvent({ ev: "action", sf: shown.sf, id: shown.close.id, act: shown.close.act });
      await this.#awaitDocument(
        (document) => (findContextReport(document) === null ? true : null),
        CONFIRM_TIMEOUT_MS,
        "omp did not close its context report",
      );
      return shown.report;
    });
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

  /**
   * 把 `/命令` 当普通 `send` 交给 omp（实测:单独的 `/fast`、`/slow`、`/fast on` 在空闲和运行中都当命令执行；`/model <id>`
   * 带参数的当普通消息），等 omp 的状态 toast，返回它的原文。`success` 判定哪条 toast 算成功（返回 true 就返回该 toast）；
   * 没给时，第一条新出现的 toast 就是结果。给了 `success` 而出现新的、不满足它的 toast 就当失败，原文抛出。
   * 局限：和发送前完全相同的 toast 文字认不出是新的（omp 每次复用同一个 toast 节点，只换文字）。
   */
  async #runSlash(text: string, success?: (toast: string) => boolean): Promise<string> {
    await this.start();
    const target = await this.#awaitComposer();
    const session = this.#liveSession();
    const before = statusToastTexts(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
    return this.#awaitDocument(
      (document) => {
        const texts = statusToastTexts(document);
        if (success) {
          const hit = texts.find(success);
          if (hit !== undefined) return hit;
        }
        const fresh = texts.find((toast) => !before.includes(toast));
        if (fresh === undefined) return null;
        if (success) throw new Error(fresh);
        return fresh;
      },
      CONFIRM_TIMEOUT_MS,
      `omp did not confirm ${text}`,
      false,
    );
  }

  /**
   * 会话级斜杠命令（`TaskCommand` 拼出的文本，见 shared/omp-output）：串在界面操作队列里执行，返回 omp 的状态 toast 原文。
   * 只有以 toast 回应的命令用得了；弹窗、main 里加文字的命令（`/jobs`、`/memory`…）等不到 toast，超时报 "omp did not confirm"。
   */
  runSessionCommand(text: string, success?: (toast: string) => boolean): Promise<string> {
    return this.#exclusive(() => this.#runSlash(text, success));
  }

  /**
   * 成功时 omp 不发 toast、出错才发的会话命令（`/jobs kill <id>|all`，实测 18.12.5：成功只是作业卡片变 cancelled，
   * 未知 id 是 `No running background job with id "x".`，缺参数是 `Usage: /jobs kill <id>|all`）。
   * 发出后观察 `QUIET_SETTLE_MS`：出现新 toast 就以原文 reject，没出现算成功，返回 ""。
   */
  runQuietCommand(text: string): Promise<string> {
    return this.#exclusive(async () => {
      await this.start();
      const target = await this.#awaitComposer();
      const session = this.#liveSession();
      const before = statusToastTexts(session.document);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      try {
        return await this.#awaitDocument<string>(
          (document) => {
            const fresh = statusToastTexts(document).find((toast) => !before.includes(toast));
            if (fresh !== undefined) throw new Error(fresh);
            return null;
          },
          QUIET_SETTLE_MS,
          QUIET_SETTLED,
          false,
        );
      } catch (error) {
        if (error instanceof Error && error.message === QUIET_SETTLED) return "";
        throw error;
      }
    });
  }

  /**
   * `/compact`（omp 18.12.5 实测，shared/tsp/compaction.ts）：没有 toast；成功 = main 里新增 `omp.compaction` 分隔，
   * 失败 = main 里新增 "Error: Compaction failed: …"（会话太小）。等到其中之一：成功 resolve，失败以原文 reject。
   * 压缩要调模型，等待上限 5 分钟。
   */
  compact(): Promise<void> {
    return this.#exclusive(() => this.#runCompaction("/compact"));
  }

  /** `/handoff`：总结会话成交接文档并就地压缩，结局的判定和 `/compact` 相同（omp 18.12.6 实测见 docs/architecture/context-compaction.md）。 */
  handoff(): Promise<void> {
    return this.#exclusive(() => this.#runCompaction("/handoff"));
  }

  async #runCompaction(text: "/compact" | "/handoff"): Promise<void> {
    await this.start();
    const target = await this.#awaitComposer();
    const session = this.#liveSession();
    const before = compactionMark(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
    const outcome = await this.#awaitDocument(
      (document) => compactionOutcome(document, before),
      COMPACT_TIMEOUT_MS,
      `omp did not finish ${text}`,
      false,
    );
    if (!outcome.ok) throw new Error(outcome.error);
  }

  /**
   * `/todo <动词>`（omp 18.12.6 实测，docs/architecture/todo-board.md）：成功 = 一条新的状态 toast（`Appended to Alpha: …` /
   * `Started: …` / `Marked completed: …` / `Removed: …` / `Cleared all todos.`），返回它的原文；失败（没匹配到、缺参数）不是 toast，
   * 而是对话里新增一行 `Error: …`（shared/tsp/error-lines.ts），以原文 reject。
   */
  runTodoCommand(text: string): Promise<string> {
    return this.#exclusive(async () => {
      await this.start();
      const target = await this.#awaitComposer();
      const session = this.#liveSession();
      const toastsBefore = statusToastTexts(session.document);
      const errorsBefore = errorLines(session.document);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      return this.#awaitDocument(
        (document) => {
          const error = newErrorLine(document, errorsBefore);
          if (error !== null) throw new Error(error);
          return statusToastTexts(document).find((toast) => !toastsBefore.includes(toast)) ?? null;
        },
        CONFIRM_TIMEOUT_MS,
        `omp did not confirm ${text}`,
        false,
      );
    });
  }

  // ───── 模式（/plan /vibe /loop）和输入框卡片上的事实 ─────

  /** 文档变了：模式、扩展状态、目标都跟着 omp 输入框卡片上的事实行走（shared/tsp/composer-facts.ts）；变了才发布。 */
  #observeFacts(document: TspDocument): void {
    const facts: ComposerFacts = deriveComposerFacts(document);
    this.#goalTracker.observe(facts);
    if (this.#factsTracker.observe(facts)) this.#publish();
  }

  /**
   * 模式命令（`/plan` `/plan-review` `/vibe` `/loop`，shared/tsp/composer-facts.ts 的 `ModeOp`）：它们是切换，所以发之前看当前模式
   * （`modeCommandBlocker`），发出后等模式变成预期的样子或 omp 弹出确认 / 评审弹窗（`modeCommandDone`）。
   * 没生效而 omp 给了状态 toast（"Exit goal mode first."、"Plan mode is disabled. …"）= 被拒，原文 reject；返回生效时的 toast 原文（可能为空串）。
   */
  runModeCommand(op: ModeOp, text: string): Promise<string> {
    return this.#exclusive(async () => {
      await this.start();
      const target = await this.#awaitComposer();
      const session = this.#liveSession();
      const before = deriveComposerFacts(session.document).mode;
      const blocker = modeCommandBlocker(op, before);
      if (blocker !== null) throw new Error(blocker);
      const toastsBefore = statusToastTexts(session.document);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      return this.#awaitDocument(
        (document) => {
          const toast = statusToastTexts(document).find((candidate) => !toastsBefore.includes(candidate));
          // 输入框卡片被弹窗换掉时模式读不到，当作没变。
          const facts = deriveComposerFacts(document);
          const now = facts.composer ? facts.mode : before;
          if (modeCommandDone(op, before, now, deriveTaskStatus(document).modal !== null)) return toast ?? "";
          if (toast !== undefined) throw new Error(toast);
          return null;
        },
        CONFIRM_TIMEOUT_MS,
        `omp did not confirm ${text}`,
        false,
      );
    });
  }

  // ───── 目标模式（/goal） ─────

  /**
   * `/goal` 的四个操作：`get` 读当前目标；`create` 发 `/goal <文字>`（成功时 omp 不发 toast，
   * 输入框卡片上出现"Goal …"事实行；已有目标时 omp 以 toast 拒绝，原文抛出）；`pause` / `resume` 发 `/goal pause|resume`
   * 等 omp 的确认 toast；`drop` 发 `/goal drop`，在 omp 弹出的 "Drop goal?" 选择器里点 Yes。返回操作之后的目标（已放弃 / 没有为 null）。
   * 实测依据见 shared/tsp/goal.ts。
   */
  goal(op: GoalOp, objective?: string): Promise<TaskState["goal"]> {
    if (op === "get") return Promise.resolve(this.#goalTracker.goal);
    if (op === "create") {
      // omp 的输入框一行一条命令：换行折成空格（目标文字本来就是一句话的任务描述）。
      const text = (objective ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
      if (text === "") return Promise.reject(new Error("goal objective is empty"));
      return this.#exclusive(() => this.#createGoal(text));
    }
    if (op === "drop") return this.#exclusive(() => this.#dropGoal());
    return this.#exclusive(async () => {
      await this.#runSlash(`/goal ${op}`, (toast) => GOAL_TOASTS[op].test(toast));
      return this.#goalTracker.goal;
    });
  }

  async #createGoal(objective: string): Promise<TaskState["goal"]> {
    await this.start();
    const target = await this.#awaitComposer();
    const session = this.#liveSession();
    const before = statusToastTexts(session.document);
    const hadGoal = this.#goalTracker.goal !== null;
    this.#goalTracker.expectObjective(objective);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: `/goal ${objective}` });
    try {
      await this.#awaitDocument(
        (document) => {
          const fresh = statusToastTexts(document).find((toast) => !before.includes(toast));
          if (fresh !== undefined) throw new Error(fresh);
          return !hadGoal && this.#goalTracker.goal !== null ? true : null;
        },
        CONFIRM_TIMEOUT_MS,
        "omp did not confirm creating the goal",
      );
    } catch (error) {
      if (!hadGoal) this.#goalTracker.expectObjective("");
      throw error;
    }
    return this.#goalTracker.goal;
  }

  async #dropGoal(): Promise<TaskState["goal"]> {
    await this.start();
    const target = await this.#awaitComposer();
    const session = this.#liveSession();
    const before = statusToastTexts(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: "/goal drop" });
    const prompt = await this.#awaitDocument(
      (document) => {
        const found = findGoalDropPrompt(document);
        if (found !== null) return found;
        const fresh = statusToastTexts(document).find((toast) => !before.includes(toast));
        if (fresh !== undefined) throw new Error(fresh);
        return null;
      },
      PICKER_TIMEOUT_MS,
      "omp did not ask to confirm dropping the goal",
    );
    session.sendEvent({ ev: "activate", sf: prompt.sf, id: prompt.id, item: prompt.yes });
    await this.#awaitDocument(
      (document) => (findGoalDropPrompt(document) === null && this.#goalTracker.goal === null ? true : null),
      CONFIRM_TIMEOUT_MS,
      "omp did not confirm dropping the goal",
    );
    return null;
  }

  get workspaceDirs(): readonly string[] {
    return this.#workspace.dirs;
  }

  /** `/dirs`、`/add-dir`、`/remove-dir` 的 toast → 额外工作区目录（omp 拒绝或 toast 认不出来时以原文抛错）；有变化就发布状态。 */
  applyWorkspaceDirsOutput(text: string): void {
    if (this.#workspace.apply(text)) this.#publish();
  }

  /** `/fast on|off`。模型不支持时 omp 的 toast 原文作为错误抛出。 */
  setFastMode(enabled: boolean): Promise<void> {
    return this.#exclusive(async () => {
      if (enabled && this.#composer.fast) return;
      await this.#runSlash(enabled ? "/fast on" : "/fast off", (toast) =>
        (enabled ? /^Fast mode enabled/ : /^Fast mode disabled/).test(toast),
      );
      const live = this.#session;
      if (live) this.#syncComposer(live.document);
    });
  }

  /** `/slow on|off`。omp 的界面上没有慢速模式的状态节点，状态按它的 toast（"Slow mode on: …" / "Slow mode off: …"）记。 */
  setSlowMode(enabled: boolean): Promise<void> {
    return this.#exclusive(async () => {
      const hit = /^Slow mode (on|off)/.exec(
        await this.#runSlash(enabled ? "/slow on" : "/slow off", (toast) => /^Slow mode (on|off)/.test(toast)),
      );
      this.#slowEnabled = hit?.[1] === "on";
      this.#publish();
    });
  }

  // ───── 会话树、回溯、分叉（docs/architecture/session-tree.md） ─────
  // 树只读会话文件（tsp/session-tree-file.ts）；回溯 = 驱动 omp 自己的 `/tree`：选择器里 activate 那条用户消息。
  // 分叉成新任务由池完成（TaskPool.forkTask）：新任务用 `omp --fork=<会话文件>` 起，起来以后在新进程里同样回溯。

  /** 回溯之后、文件还没有新条目之前的叶子位置（`/tree` 在进程内移动叶子，不写文件）。 */
  #leafOverride: LeafOverride | null = null;

  #currentSessionFile(): string | null {
    return this.#sessionFile === undefined ? this.#record.sessionFile : this.#sessionFile;
  }

  /** 回溯和分叉要求这一轮已经结束：omp 的 `/tree` 在运行中会打断或搅乱这一轮，分叉复制的文件也要写完。 */
  #assertTurnFinished(): void {
    const session = this.#session;
    if (
      this.#machine.working ||
      this.#machine.dialogs.length > 0 ||
      (session !== null && hasRunningWork(session.document))
    )
      throw new Error("the session is busy; wait for the current turn to finish");
  }

  async #readTreeEntries(): Promise<SessionEntry[]> {
    const file = this.#currentSessionFile();
    if (file === null) return [];
    try {
      return await readSessionEntries(file);
    } catch (error) {
      // 会话文件在第一条回复之后才落盘。
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  /** 会话树面板的数据；还没有会话文件时 nodes 为空。 */
  async getSessionTree(): Promise<SessionTreeView> {
    return { nodes: buildTreeFromEntries(await this.#readTreeEntries(), this.#leafOverride) };
  }

  /**
   * 分叉前的检查：这一轮已结束，`entryId`（null = 当前分支最后一条用户消息）是这个会话的用户消息。
   * 返回要分叉的会话文件、那条消息的条目 id 和回溯目标（omp 的 `--fork` 复制整份文件，条目 id 不变，新进程里直接用它回溯）。
   */
  async prepareFork(entryId: string | null): Promise<{ sourceFile: string; entryId: string; target: RewindTarget }> {
    this.#assertTurnFinished();
    const file = this.#currentSessionFile();
    const entries = await this.#readTreeEntries();
    if (file === null || entries.length === 0) throw new Error("this task has no session file yet");
    const id =
      entryId ??
      buildTreeFromEntries(entries, this.#leafOverride).findLast((node) => node.kind === "user" && node.onCurrentBranch)
        ?.entryId;
    if (id === undefined) throw new Error("the session has no user message to fork from");
    const target = findUserEntry(entries, id);
    if (target === null) throw new Error("that is not a user message of this session");
    return { sourceFile: file, entryId: id, target };
  }

  /**
   * 就地回到一条用户消息之前：omp 的 `/tree` → 选择器里 activate 它（同一个会话文件里移动叶子，不新建文件；实测 omp 18.12.5）。
   * omp 会把这条消息填进它自己的输入框；这里把输入框清空（omp 只在输入框为空时才预填，留着会让下一次回溯拿不到文字）
   * 并返回消息的完整文字（取自会话文件），由渲染进程放进 studio 的输入框。
   * `known`：调用方已经从会话文件里查好的目标（新分叉的任务：它的会话文件路径要等 omp 报告，不一定已经到了）；不传就读本任务的会话文件。
   * `summarize`：让 omp 给被放弃的分支写摘要再移动（选择器的 `summarize` 动作 = Shift+Enter，不管 `branchSummary.enabled` 开没开都直接摘要，
   * 会调一次模型，最长等 SUMMARY_TIMEOUT_MS）；不摘要时如果 omp 开着 `branchSummary.enabled` 并弹出"Summarize branch?"，答 No summary。
   */
  rewindTo(entryId: string, known?: RewindTarget, summarize = false): Promise<{ text: string; summarized: boolean }> {
    return this.#exclusive(async () => {
      const target = known ?? findUserEntry(await this.#readTreeEntries(), entryId);
      if (target === null) throw new Error("that is not a user message of this session");
      await this.start();
      this.#assertTurnFinished();
      const composer = await this.#awaitComposer();
      const session = this.#liveSession();
      await this.#takeEditorText(session);
      session.sendEvent({ ev: "send", sf: composer.sf, id: composer.id, text: "/tree" });
      const picker = await this.#awaitDocument(
        (document) => findTreePicker(document),
        PICKER_TIMEOUT_MS,
        "omp's session tree did not open in time",
      );
      if (!picker.items.includes(entryId) || (summarize && !picker.actions.includes("summarize"))) {
        session.sendKeys(ESC_KEY);
        throw new Error("omp's session tree does not offer that");
      }
      if (summarize) {
        session.sendEvent({ ev: "select", sf: picker.sf, id: picker.id, item: entryId });
        session.sendEvent({ ev: "action", sf: picker.sf, id: picker.id, act: "summarize" });
        try {
          await this.#awaitDocument(
            (document) => (findTreePicker(document) === null && findSummaryPicker(document) === null ? true : null),
            SUMMARY_TIMEOUT_MS,
            "omp did not finish summarizing the abandoned branch",
          );
        } catch (error) {
          session.sendKeys(ESC_KEY);
          throw error;
        }
      } else {
        session.sendEvent({ ev: "activate", sf: picker.sf, id: picker.id, item: entryId });
        try {
          const outcome = await this.#awaitDocument(
            (document) =>
              findSummaryPicker(document) ? "prompt" : findTreePicker(document) === null ? "closed" : null,
            CONFIRM_TIMEOUT_MS,
            "omp did not move to that message",
          );
          const prompt = outcome === "prompt" ? findSummaryPicker(session.document) : null;
          if (prompt !== null) {
            session.sendEvent({ ev: "activate", sf: prompt.sf, id: prompt.id, item: SUMMARY_NO });
            await this.#awaitDocument(
              (document) => (findSummaryPicker(document) === null ? true : null),
              CONFIRM_TIMEOUT_MS,
              "omp did not leave its summary prompt",
            );
          }
        } catch (error) {
          session.sendKeys(ESC_KEY);
          throw error;
        }
      }
      // 选择器关了；输入框的预填（或 toast）可能晚一帧到。等不到不算失败：文字取自会话文件。
      await this.#awaitDocument(
        (document) => (hasNavigatedToast(document) || (findComposerEditor(document)?.text ?? "") !== "" ? true : null),
        NAVIGATION_SETTLE_MS,
        "omp did not report the navigation",
      ).catch((error: unknown) => {
        if (this.#session !== session) throw error;
      });
      await this.#takeEditorText(session);
      this.#leafOverride =
        target.lastEntryId === null ? null : { afterEntryId: target.lastEntryId, leafId: target.parentId };
      return { text: target.text, summarized: summarize };
    });
  }

  /**
   * 给会话树里的一个条目打标签 / 清掉标签（`label` 为 null 或空串 = 清除）：omp 的 `/tree` 选择器里 `select` 这个条目 → `action label`（Shift+L）→
   * 选择器预览里出现输入框 → `edit` 填字（整段替换）→ `action label-save`（Enter）→ omp 往会话文件追加一个 `label` 条目 → Esc 关选择器。
   * 标签不动叶子，也不动对话。要求这一轮已结束。条目必须是会话里存在的用户消息 / 压缩点 / 分支摘要，且 omp 的选择器里列着它。
   */
  labelEntry(entryId: string, label: string | null): Promise<void> {
    return this.#exclusive(async () => {
      if (!isLabellableEntry(await this.#readTreeEntries(), entryId)) throw new Error("that entry cannot be labelled");
      const text = label === null ? "" : label.trim();
      await this.start();
      this.#assertTurnFinished();
      const composer = await this.#awaitComposer();
      const session = this.#liveSession();
      await this.#takeEditorText(session);
      session.sendEvent({ ev: "send", sf: composer.sf, id: composer.id, text: "/tree" });
      const picker = await this.#awaitDocument(
        (document) => findTreePicker(document),
        PICKER_TIMEOUT_MS,
        "omp's session tree did not open in time",
      );
      if (!picker.items.includes(entryId) || !picker.actions.includes(TREE_ACT_LABEL)) {
        session.sendKeys(ESC_KEY);
        throw new Error("omp's session tree does not offer labelling that entry");
      }
      try {
        session.sendEvent({ ev: "select", sf: picker.sf, id: picker.id, item: entryId });
        session.sendEvent({ ev: "action", sf: picker.sf, id: picker.id, act: TREE_ACT_LABEL });
        const input = await this.#awaitDocument(
          (document) => findTreeLabelInput(document),
          CONFIRM_TIMEOUT_MS,
          "omp did not open its label box",
        );
        if (input.text !== text) {
          session.sendEvent({
            ev: "edit",
            sf: input.sf,
            id: input.id,
            from: 0,
            to: input.text.length,
            text,
            cursor: text.length,
            len: input.text.length,
          });
          await this.#awaitDocument(
            (document) => (findTreeLabelInput(document)?.text === text ? true : null),
            CONFIRM_TIMEOUT_MS,
            "omp's label box did not take the text",
          );
        }
        session.sendEvent({ ev: "action", sf: input.sf, id: input.pickerId, act: TREE_ACT_LABEL_SAVE });
        await this.#awaitDocument(
          (document) => (findTreeLabelInput(document) === null ? true : null),
          CONFIRM_TIMEOUT_MS,
          "omp did not save the label",
        );
      } finally {
        // 不管成败都把选择器关掉：它是 modal，开着会挡住别的操作。
        session.sendKeys(ESC_KEY);
      }
      await this.#awaitDocument(
        (document) => (findTreePicker(document) === null ? true : null),
        CONFIRM_TIMEOUT_MS,
        "omp did not close its session tree",
      );
    });
  }

  /**
   * 取走 omp 输入框里的文字：读出来、发 `edit` 清空 omp 那边（否则文字一直留在那里，也挡住 omp 的下一次预填）、等清空确认；
   * 本来就空返回 null。studio 的 `send` 从不往那里填字，所以这里出现的文字一定是 omp 自己放的（shared/tsp/editor-prefill.ts）。
   */
  async #takeEditorText(session: TspSession): Promise<string | null> {
    const editor = foreignEditorText(session.document);
    if (editor === null) return null;
    session.sendEvent(clearEditorEvent(editor));
    await this.#awaitDocument(
      (document) => (foreignEditorText(document) === null ? true : null),
      CONFIRM_TIMEOUT_MS,
      "omp's input box did not clear",
    );
    return editor.text;
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
      .then((text) => {
        if (text !== null && this.#session === session) this.#host.onComposerPrefill?.(this.id, text);
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

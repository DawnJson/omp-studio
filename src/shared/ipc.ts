// 渲染进程 ↔ 主进程的全部契约。preload 按 StudioApi 逐个实现；主进程按 InvokeHandlers 注册并校验参数。
// 规则（AGENTS.md "Electron 安全"）：一个函数只做一件事；渲染进程传来的每个参数都当不可信输入；
// 渲染进程不传路径，只传主进程发的 id。协议出处见 docs/architecture/ipc.md。
import type {
  AskAnswer,
  AvailableSlashCommand,
  Effort,
  AskQuestion,
  GoalOp,
  ContextUsage,
  LoginProvider,
  LogoutAccount,
  NotifyType,
  PromptError,
  PromptStatus,
  SessionCredits,
  SlowModeScope,
  ThinkingLevel,
  TodoPhase,
  TokenUsage,
  UsageLimitState,
} from "./omp-wire/rpc-wire.generated.ts";
import type {
  GitCommitResult,
  GitDiffArea,
  GitFileDiff,
  GitHunkRef,
  GitMergeResult,
  GitPullRequestInput,
  GitPullRequestResult,
  GitPushResult,
  GitStatus,
  GitTools,
  ReviewComment,
  TaskWorktreeInfo,
  WorktreeCleanupResult,
  WorktreeSetupInfo,
} from "./git.ts";
import type { Transcript, TranscriptEvent } from "./transcript.ts";
import type {
  CustomModelsFileInfo,
  CustomModelsOutcome,
  CustomProviderInput,
  FetchModelsOutcome,
  FetchModelsRequest,
} from "./custom-models.ts";
import type { SubagentDetail, SubagentLane } from "./subagents.ts";
import type { BtwHistoryRecord, BtwUiEvent } from "./btw.ts";

// ───────── 标识 ─────────

/** 主进程生成的不透明 id。渲染进程只回传，不解析、不拼接。 */
export type TaskId = string & { readonly __brand: "TaskId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type Unsubscribe = () => void;

/** `@` 补全的数据来源：任务目录，或新任务草稿所在的项目目录。 */
export type ProjectFilesTarget = { kind: "task"; taskId: TaskId } | { kind: "project"; projectId: ProjectId };

// ───────── 应用和设置 ─────────

export type Locale = "zh-CN" | "en";
export type LocalePreference = Locale | "system";
export type ThemePreference = "system" | "light" | "dark";
/** omp 的 tools.approvalMode（omp 文档 approval-mode.md）。只存在 omp 的配置里，omp-studio 不另存、启动时不传 --approval-mode。 */
export type ApprovalMode = "always-ask" | "write" | "yolo";

export interface AppInfo {
  version: string;
  platform: "win32" | "darwin" | "linux";
  /** 已按设置和系统语言解析好的界面语言。 */
  locale: Locale;
  isPackaged: boolean;
}

/**
 * omp-studio 自身的更新状态（electron-updater）。只有安装版会检查，免安装目录和开发版是 disabled。
 * 状态机：idle → checking → up-to-date | downloading → downloaded；出错进 error，下一次检查重新开始。
 */
export interface UpdateState {
  /** 当前安装的版本（app.getVersion()）。 */
  currentVersion: string;
  /** 正在下载或已下载的新版本；其余时候是 null。 */
  latestVersion: string | null;
  phase: "disabled" | "idle" | "checking" | "up-to-date" | "downloading" | "downloaded" | "error";
  /** 下载进度 0–100，其余阶段是 0。 */
  percent: number;
  /** 最近一次检查得到结果的时间（毫秒）；还没检查过时为 null。 */
  lastCheckedAt: number | null;
  /** phase = "error" 时的原始信息（界面用 error.generic 翻译后展示）。 */
  error: string | null;
  /** phase = "disabled" 的原因。 */
  disabledReason: "not-packaged" | "no-feed" | null;
}

/** 模型的稳定键，对应 set_model 的 provider + modelId。 */
export interface ModelKey {
  provider: string;
  modelId: string;
}

export interface StudioSettings {
  locale: LocalePreference;
  theme: ThemePreference;
  /** 同时存活的 omp 进程软上限；超过时回收最久未用的空闲任务。 */
  maxLiveProcesses: number;
  /** 减少动效：只能强制开启，系统要求减少动效时始终生效。 */
  reduceMotion: boolean;
  /** 运行中按 Enter：插话（steer）还是稍后（followUp）。 */
  enterWhileRunning: "steer" | "followUp";
  /** 有任务在等你确认时发系统通知（只对"等你确认"生效）。默认开。 */
  notifyOnGate: boolean;
  /** 用户确认过"全部自动"。 */
  yoloConfirmed: boolean;
}

// ───────── 项目 ─────────

export interface Project {
  id: ProjectId;
  /** 绝对路径，只用于显示。 */
  path: string;
  name: string;
}

// ───────── 任务 ─────────

/** 由主进程计算；有未答的对话框时一定是 needs_you。状态机见 docs/architecture/task-model.md。 */
export type TaskStatus = "starting" | "idle" | "running" | "needs_you" | "error" | "stopped";

export interface TaskError {
  kind:
    | "omp_unavailable"
    | "spawn_failed"
    | "handshake_failed"
    | "restore_model_failed"
    | "exited"
    | "protocol"
    | "too_many_tasks"
    /** 任务的 worktree 目录已被删除（和 omp 一致：只能查看记录，不能继续聊）。 */
    | "worktree_missing";
  message: string;
}

/** 最近一条 prompt 的结局（prompt_result）。 */
export interface TurnOutcome {
  status: PromptStatus;
  error?: PromptError;
  endedAt: number;
}

export interface ModelOption {
  key: ModelKey;
  name: string;
  contextWindow: number | null;
  reasoning: boolean;
  acceptsImages: boolean;
  /** 单次输出上限（ModelInfo.maxTokens）；provider 没给时为 null。 */
  maxTokens: number | null;
  /** 模型支持的思考强度（ModelInfo.thinking.efforts，不含 off）；omp 没给这个模型的思考配置时为 null。 */
  thinkingEfforts: Effort[] | null;
  /** 价格，美元 / 百万 token（ModelInfo.cost）；本地模型和未知价格是全 0。 */
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

/** get_session_stats 里界面用得上的部分：本会话累计的 token、费用、请求数。 */
export interface SessionUsage {
  tokens: TokenUsage;
  /** 美元。 */
  cost: number;
  premiumRequests: number;
  /** 订阅计费的会话才有。 */
  credits?: SessionCredits;
}

export interface TaskState {
  id: TaskId;
  projectId: ProjectId;
  title: string;
  status: TaskStatus;
  /** 跑完了但用户还没看过：侧栏的"完成"点。 */
  unread: boolean;
  lastTurn: TurnOutcome | null;
  error: TaskError | null;
  createdAt: number;
  updatedAt: number;
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
  /** get_available_thinking_levels，随模型变化。 */
  thinkingLevels: ThinkingLevel[];
  /** get_state.contextUsage；percent 是 0–100 的百分数。omp 没给时为 null。 */
  contextUsage: ContextUsage | null;
  /** get_session_stats，每轮结束后刷新；还没取到（或 omp 取不到）时为 null。 */
  sessionUsage: SessionUsage | null;
  /** queue_update 的快照；chip 文本原样传给 removeQueuedMessage / promoteQueuedMessage。 */
  queue: { steering: string[]; followUp: string[] };
  /** 未答的对话框，按到达顺序。 */
  dialogs: DialogRequest[];
  /** get_state.todoPhases：omp 的待办阶段。主进程在 todo 工具结束、todo_auto_clear 和每次状态刷新后更新；没有待办时是空数组。 */
  todoPhases: TodoPhase[];
  /** 正在运行的子代理数，用于过程折叠行。 */
  runningSubagents: number;
  /** 任务实际的工作目录（有 worktree 时是 worktree 根，否则是项目目录）；界面把工具参数里的绝对路径换成相对它的路径。 */
  cwd: string;
  /** 这一次 running 开始的时间戳（ms，主进程接收时间）；非 running/needs_you 时为 null。侧栏显示"已运行 N 分钟"。 */
  runStartedAt: number | null;
  /** get_state.fastModeEnabled / fastModeActive：本会话的 `/fast`（实测不落配置，换到不支持的模型就关）。 */
  fastMode: { enabled: boolean; active: boolean };
  /** get_state.slowMode*：`supported` 为 false 时 enabled 恒为 false、scope 为 null。 */
  slowMode: { supported: boolean; enabled: boolean; scope: SlowModeScope | null };
  /** get_state.usageLimit：账号超限后的阶段；没超限时为 null。 */
  usageLimit: UsageLimitState | null;
  /** get_state.tokensPerSecond：最近一条回复的输出速度；omp 没给（流式中、还没有回复）时为 null。 */
  tokensPerSecond: number | null;
  /** get_state.goal / goal_updated：本会话还挂着的目标（active / paused / budget-limited）；没有、已完成、已放弃时为 null。 */
  goal: TaskGoal | null;
}

/** 目标模式的目标（omp goal 模式）：`/goal` 创建，agent 完成或用户放弃后消失。 */
export interface TaskGoal {
  id: string;
  objective: string;
  status: "active" | "paused" | "budget-limited";
  tokensUsed: number;
  /** 创建时给的 token 预算；没有预算为 null。 */
  tokenBudget: number | null;
  timeUsedSeconds: number;
}

export interface CreateTaskInput {
  projectId: ProjectId;
  /** 为这个任务建独立的 git worktree（分支 studio/<slug>），omp 在 worktree 里运行。项目不是 git 仓库时 reject。 */
  worktree?: boolean;
}

export interface PromptImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** base64，不带 data: 前缀。 */
  data: string;
}

export interface PromptInput {
  text: string;
  images?: PromptImage[];
  /** omp 正在跑时这条消息怎么投递；空闲时忽略，直接开新一轮。 */
  whenBusy: "steer" | "followUp";
}

export interface RestoredDraft {
  text: string;
  images?: PromptImage[];
}

/** abort_and_restore_queue 撤回的排队消息，放回输入框。 */
export interface RestoredQueue {
  steering: RestoredDraft[];
  followUp: RestoredDraft[];
  /** 太大放不进一帧，图片被丢掉了。 */
  imagesDropped: boolean;
  /** 连文字都放不下，只返回了最早的几条。 */
  truncated: boolean;
  /** abort 之后 omp 不再流式输出（get_state.isStreaming 为 false）；false 表示这一轮没停下来。 */
  aborted: boolean;
  /** 还有后台任务（转后台的 bash、异步 task）会在完成后唤醒会话；omp 没有取消它们的命令，所以停止管不到。 */
  backgroundWork: boolean;
}

/** 会话树里的一个节点：只列用户消息（分支点），文字是那条消息的第一行。 */
export interface SessionTreeNode {
  /** omp 会话条目 id；branchTask 用它。 */
  entryId: string;
  text: string;
  /** 缩进层级：只在有分叉的地方加一级，一条直线的对话不缩进。 */
  indent: number;
  /** 在当前分支上（从根到叶子的路径上）。 */
  onCurrentBranch: boolean;
  /** 当前分支上最后一条用户消息（叶子在它之下）。 */
  current: boolean;
}

/** getSessionTree 的结果：先序展开的用户消息节点；会话里还没有用户消息时 nodes 为空。 */
export interface SessionTreeView {
  nodes: SessionTreeNode[];
}

/** forkTask / branchTask 的结果：`text` 是被分叉的那条用户消息的文字，放进输入框让用户改后重发。 */
export interface ForkResult {
  task: TaskState;
  text: string;
}

export interface BranchTaskResult {
  text: string;
}

// ───────── 对话框（extension_ui_request） ─────────

export interface SelectOption {
  label: string;
  description?: string;
}

/** 每种请求都带主进程收到它的时间戳，门的倒计时据此计算（组件重挂载、切任务回来都不会重新计时）。 */
export type DialogRequest = (
  | {
      id: string;
      kind: "select";
      title: string;
      options: SelectOption[];
      timeoutMs?: number;
      /** 主进程判断这是工具审批（按标题特征，推测，见 docs/architecture/dialogs.md）。只影响样式。 */
      approval: boolean;
    }
  | { id: string; kind: "confirm"; title: string; message: string; timeoutMs?: number }
  | { id: string; kind: "input"; title: string; placeholder?: string; timeoutMs?: number }
  | { id: string; kind: "editor"; title: string; prefill?: string; promptStyle: boolean }
  | { id: string; kind: "ask"; questions: AskQuestion[]; timeoutMs?: number }
) & { receivedAt?: number };

export type DialogResponse =
  /** select（必须是 options 里的 label 原文）、input、editor。 */
  | { kind: "value"; value: string }
  | { kind: "confirm"; confirmed: boolean }
  /** ask：每题一条，按题目顺序。 */
  | { kind: "answers"; answers: AskAnswer[] }
  | { kind: "cancel" };

/** 不进对话流的一次性提示。 */
export type TaskNotice =
  | { taskId: TaskId; kind: "toast"; level: NotifyType; message: string }
  /** omp 要求把这段文字放进输入框（set_editor_text）。 */
  | { taskId: TaskId; kind: "editor_text"; text: string }
  /** 目标完成（goal_updated 的 status 为 complete）：渲染进程弹一条本地化的 info toast。 */
  | { taskId: TaskId; kind: "goal_complete" };

// ───────── 对话流同步 ─────────

/** 第 i 个事件的序号是 firstSeq + i；渲染进程要求 firstSeq === 本地 seq + 1，否则调 getTranscript 重同步。 */
export interface TranscriptBatch {
  taskId: TaskId;
  firstSeq: number;
  events: TranscriptEvent[];
}

/** seq 是快照里已应用的最后一个事件的序号，0 表示还没有事件。 */
export interface TranscriptSnapshot {
  taskId: TaskId;
  seq: number;
  transcript: Transcript;
}

// ───────── 会话历史 ─────────

export interface SessionSummary {
  /** 会话文件头里的 id；resumeSession 用它，主进程按自己的索引找文件。 */
  id: string;
  title: string | null;
  firstPrompt: string | null;
  cwd: string;
  /** cwd 对应的已加入项目；没有时为 null，恢复时会自动加入。 */
  projectId: ProjectId | null;
  modifiedAt: number;
  /** 已经挂在某个任务上。 */
  taskId: TaskId | null;
}

export interface TaskSessionRef {
  sessionId: string;
  sessionFile: string;
}

// ───────── 登录 ─────────

export type LoginEvent =
  | { type: "open_url"; url: string; launchUrl?: string; instructions?: string }
  | { type: "progress"; level: NotifyType; message: string }
  | { type: "input"; inputId: string; title: string; placeholder?: string };

export type LoginOutcome = { ok: true; providerId: string } | { ok: false; message: string };

// ───────── omp 管理 ─────────

export type OmpSource =
  /** exe 上两级目录有 manager.json（如 Tern），由它更新。 */
  | { kind: "managed_by_other"; managerName: string }
  /** 用户自己装的，且拒绝了接管。 */
  | { kind: "user_installed" }
  | { kind: "studio_managed"; onUserPath: boolean };

export type OmpStatus =
  | { state: "discovering" }
  /** PATH 上的 omp 首次发现，等用户回答是否接管。launchable=false 是 omp.cmd 这类脚本；managerName 不为 null 时它由别的管理者（如 Tern）管理。 */
  | { state: "ask_takeover"; path: string; version: string | null; launchable: boolean; managerName: string | null }
  | { state: "installing"; version: string | null; receivedBytes: number; totalBytes: number | null }
  | {
      state: "ready";
      source: OmpSource;
      path: string;
      version: string;
      /** 低于支持的最低版本，提示升级。 */
      belowMinimum: boolean;
      /** 自管时已下载好、新任务会用到的版本。 */
      stagedUpdate: string | null;
      /** 构建服务上更新的版本；只在非自管（用户自装、他人管理）时由检查写入，用于提示"有新版本"。自管的直接装上，不会有。 */
      availableVersion?: string | null;
    }
  /** 用户拒绝接管，而 PATH 上的是脚本，启动不了。 */
  | { state: "unusable"; path: string; reason: "script_launcher" }
  | { state: "error"; stage: "discover" | "download" | "verify" | "install" | "path"; message: string }
  /** PATH 上没有 omp，等用户点"下载并安装"。version/sizeBytes 来自构建服务，查不到时为 null。 */
  | { state: "missing"; version: string | null; sizeBytes: number | null; source: string };

/** 订阅账号的一个额度窗口（5 小时、每周等）。usedFraction 0..1，超过 1 是超额；provider 没给就是 null。 */
export interface QuotaLimit {
  id: string;
  label: string;
  windowLabel: string | null;
  usedFraction: number | null;
  /** 窗口重置时间（毫秒时间戳）。 */
  resetsAt: number | null;
  status: "ok" | "warning" | "exhausted" | "unknown";
}

export interface QuotaAccount {
  provider: string;
  account: string | null;
  limits: QuotaLimit[];
  notes: string[];
  fetchedAt: number | null;
}

/** `omp usage --json` 的结果；没有登录任何订阅账号时 accounts 为空。 */
export interface QuotaSnapshot {
  generatedAt: number;
  accounts: QuotaAccount[];
}

/** 本地时区的一天；没有用量的日子不出现在 days 里。 */
export interface UsageDay {
  /** YYYY-MM-DD */
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

/** 近 365 天每日消耗（omp 的 stats.db，只读）。hasDatabase=false：omp 还没建过这个库（从没跑过 `omp stats`）。 */
export interface UsageHeatmap {
  from: string;
  to: string;
  days: UsageDay[];
  hasDatabase: boolean;
}

export interface OmpUpgradeResult {
  exitCode: number | null;
  output: string;
}

export type OmpConfigType = "boolean" | "enum" | "number" | "string" | "array" | "record";

/** omp 的一项设置（`omp config list --json` 合并 `omp config list` 文本输出）。 */
export interface OmpConfigItem {
  key: string;
  /** omp 的分组（`[appearance]` 等）。 */
  tab: string;
  type: OmpConfigType;
  /** omp 自带的英文描述；没有时为空串。 */
  description: string;
  /** enum 的可选值。 */
  options: string[] | null;
  /** 当前生效值；凭据（redacted）和未设置的可选项没有值。 */
  value: unknown;
  hasValue: boolean;
  /** 凭据类字段：只知道"已设置"，值不回传，界面也不允许编辑。 */
  redacted: boolean;
  /** omp 自己的默认值（在空的 agent 目录里读出来的）；和 value 不同就是"已修改"。 */
  defaultValue: unknown;
  hasDefault: boolean;
}

export interface OmpConfigSnapshot {
  ompVersion: string;
  /** 分组按 omp 的顺序。 */
  tabs: string[];
  items: OmpConfigItem[];
}

/** omp 给某个项目（或全局）解析出的新任务默认值，来自在项目目录里跑的 `omp config list`。 */
export interface ModelDefaults {
  /** modelRoles.default 原文（可能带 `:high` 这类后缀）；null = 没设置，omp 自己选。 */
  model: string | null;
  thinkingLevel: string | null;
  /** 生效的 modelRoleStorage：project 时选模型写进项目的 .omp/config.yml，和 omp 终端的模型选择器一样。 */
  storage: "global" | "project";
}

export interface DefaultModelInfo {
  key: ModelKey;
  name: string;
  thinkingLevel: ThinkingLevel | null;
}

export interface OmpConfigWriteResult {
  key: string;
  value: unknown;
  hasValue: boolean;
  redacted: boolean;
  /** 写进去了，但生效值仍由别处提供：环境变量名，或 `project`/`overlay`/`runtime`。 */
  overriddenBy?: string;
  /** 已保存的值是空白，正在用的是这个后备环境变量。 */
  fallbackEnv?: string;
}

// ───────── 函数 ─────────

/** 外壳界面状态，主进程持久化；窗口位置/尺寸/最大化由主进程自己记，不经过渲染进程。 */
export interface ShellState {
  /** 侧栏宽度（px），220–360。 */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** 终端面板高度（px），120–4000；实际上限（主区 70%）由界面夹取。 */
  terminalHeight: number;
  /** 侧栏里折叠的项目组（ProjectId）；默认空。 */
  collapsedProjects: string[];
}

/** openTerminal 的结果。 */
export interface TerminalOpenResult {
  /** 终端的工作目录，只用于显示（任务 cwd：worktree 根或项目目录）。 */
  cwd: string;
  /** shell 的可执行文件名，如 `pwsh.exe`。 */
  shell: string;
  /** true = 复用了还活着的终端（面板隐藏后再打开、渲染进程重载）；false = 新起的。 */
  reopened: boolean;
  /** 已有的输出（最近一段），复用时用来还原屏幕；新起的为空串。 */
  backlog: string;
}

export interface StudioInvokeApi {
  // 应用
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<StudioSettings>;
  setLocale(preference: LocalePreference): Promise<void>;
  setTheme(preference: ThemePreference): Promise<void>;
  setMaxLiveProcesses(count: number): Promise<void>;
  /** 用系统浏览器打开链接；只接受 http/https。 */
  openExternal(url: string): Promise<void>;
  /** 退出应用（顶栏菜单"退出"）；走 before-quit，会先关掉所有 omp 子进程。 */
  quitApp(): Promise<void>;
  /** 在资源管理器里打开 userData/logs。 */
  openLogsFolder(): Promise<void>;
  /** 弹保存对话框导出诊断信息（版本、系统、omp 状态、设置、最近日志，已脱敏）；用户取消返回 false。 */
  exportDiagnostics(): Promise<boolean>;
  /** 窗口外壳的界面状态（侧栏宽度/折叠），存在 userData/window-state.json。 */
  getShellState(): Promise<ShellState>;
  setShellState(patch: Partial<ShellState>): Promise<void>;

  // 项目
  listProjects(): Promise<Project[]>;
  /** 主进程弹系统目录选择框；取消时返回 null。 */
  addProject(): Promise<Project | null>;
  /** 只从列表移除，不动磁盘。项目下还有未归档任务时拒绝。 */
  removeProject(projectId: ProjectId): Promise<void>;

  // 任务
  listTasks(): Promise<TaskState[]>;
  createTask(input: CreateTaskInput): Promise<TaskState>;
  /** 切到这个任务：需要时拉起 omp 并恢复会话，返回对话快照，并清除 unread。 */
  openTask(taskId: TaskId): Promise<TranscriptSnapshot>;
  /** 只取快照，不拉起进程；用于丢帧或渲染进程重载后的重同步。 */
  getTranscript(taskId: TaskId): Promise<TranscriptSnapshot>;
  markTaskRead(taskId: TaskId): Promise<void>;
  /** 应答到达（消息被 omp 接收）即 resolve，不等这一轮跑完。 */
  sendPrompt(taskId: TaskId, input: PromptInput): Promise<void>;
  /** 删掉排队中的一条；成功时返回它的草稿以便放回输入框，没删到返回 null。 */
  removeQueuedMessage(taskId: TaskId, text: string, queue: "steering" | "followUp"): Promise<RestoredDraft | null>;
  /** 把一条 follow-up 提前为 steer。 */
  promoteQueuedMessage(taskId: TaskId, text: string): Promise<boolean>;
  /** 停止：撤回排队消息并中止当前一轮。 */
  stopTask(taskId: TaskId): Promise<RestoredQueue>;
  respondDialog(taskId: TaskId, dialogId: string, response: DialogResponse): Promise<void>;
  renameTask(taskId: TaskId, title: string): Promise<void>;
  /** 关掉进程并从侧栏移除；会话文件不动。 */
  archiveTask(taskId: TaskId): Promise<void>;
  /** 出错后重新拉起。 */
  restartTask(taskId: TaskId): Promise<void>;
  listTaskModels(taskId: TaskId): Promise<ModelOption[]>;
  setTaskModel(taskId: TaskId, model: ModelKey): Promise<void>;
  setTaskThinkingLevel(taskId: TaskId, level: ThinkingLevel): Promise<void>;
  /** `/fast`：omp 的 set_fast_mode。模型不支持时 reject（omp 的原文）。 */
  setTaskFastMode(taskId: TaskId, enabled: boolean): Promise<void>;
  /** `/slow`：omp 的 set_slow_mode。模型不支持时 reject（omp 的原文）。 */
  setTaskSlowMode(taskId: TaskId, enabled: boolean): Promise<void>;

  // 内置终端（阶段 6）：每个任务至多一个终端，cwd 由主进程按任务定（worktree 根或项目目录），渲染进程不传路径。
  /** 打开任务的终端：已有活着的就复用（返回 backlog），否则在任务目录新起 shell。目录已不存在时 reject。 */
  openTerminal(taskId: TaskId, cols: number, rows: number): Promise<TerminalOpenResult>;
  /** 把键盘输入写给终端；没有终端时静默忽略。 */
  writeTerminal(taskId: TaskId, data: string): Promise<void>;
  resizeTerminal(taskId: TaskId, cols: number, rows: number): Promise<void>;
  /** 结束任务的终端（整棵进程树）；没有终端时静默成功。 */
  closeTerminal(taskId: TaskId): Promise<void>;

  // 会话历史
  /** projectId 为 null 时列出所有项目的会话。只读 ~/.omp。 */
  listSessions(projectId: ProjectId | null): Promise<SessionSummary[]>;
  /** 以会话自己的 cwd 新建任务并恢复它；已挂在任务上时返回那个任务。 */
  resumeSession(sessionId: string): Promise<TaskState>;
  /** 在系统文件管理器里显示项目目录（主进程用自己记的路径，渲染进程不传路径）。 */
  revealProject(projectId: ProjectId): Promise<void>;
  /** 在系统文件管理器里选中任务的会话文件；任务还没有会话文件时拒绝。 */
  revealTaskSession(taskId: TaskId): Promise<void>;
  /** 任务的会话 id 和文件路径，用于侧栏菜单的"复制"；还没有会话文件时返回 null。 */
  getTaskSessionRef(taskId: TaskId): Promise<TaskSessionRef | null>;
  /** 任务当前可用的斜杠命令（get_available_commands）；任务没有 omp 进程时返回空数组。 */
  listSlashCommands(taskId: TaskId): Promise<AvailableSlashCommand[]>;
  /** 输入框草稿（文字）：key 是任务 id 或 `new:<projectId>`。主进程持久化，重启不丢。 */
  getDrafts(): Promise<Record<string, string>>;
  saveDraft(key: string, text: string): Promise<void>;
  /** 压缩上下文（RPC compact）。任务没有进程时先拉起；运行中拒绝。 */
  compactTask(taskId: TaskId): Promise<void>;
  /**
   * 导出对话为 HTML（RPC export_html）：主进程弹保存对话框（默认桌面、`<标题>-<日期>.html`）并决定路径，渲染进程不传路径。
   * 用户取消返回 null；成功返回写出的文件名。任务没有进程时先拉起。
   */
  exportTaskHtml(taskId: TaskId): Promise<{ fileName: string } | null>;
  /** 在系统文件管理器里选中该任务最近一次导出的文件（只认主进程自己写过的路径）；没导出过时拒绝。 */
  revealTaskExport(taskId: TaskId): Promise<void>;
  /**
   * 输入框里 `!命令`：经 omp 的 bash 命令在任务工作目录执行（和终端版 `!cmd` 同信任级别，命令由用户键入）。
   * 任务没有进程时先拉起；结果由 omp 记进会话，主进程把它作为 bashExecution 消息放进对话流，返回时已在流里。
   * 同时只能有一条在跑；命令限长（limits.bashCommandMaxChars）。
   */
  runBash(taskId: TaskId, command: string): Promise<void>;
  /** 中止正在跑的 `!命令`（RPC abort_bash）；没有在跑的命令时什么也不发生。 */
  abortBash(taskId: TaskId): Promise<void>;
  /**
   * 目标模式（RPC goal）：`create` 带目标文字（1–`limits.goalObjectiveMaxChars` 字符）创建，`pause` / `resume` / `drop` 作用于当前目标，
   * `get` 只读。返回操作后的目标（没有目标为 null）。omp 拒绝时（已有目标、计划模式、没有可恢复的目标…）reject，原文透传。
   */
  taskGoal(taskId: TaskId, op: GoalOp, objective?: string): Promise<TaskGoal | null>;
  /** 用系统默认应用打开任务工作目录里的文件。relPath 相对任务 cwd，主进程校验落在 cwd 之内。 */
  openTaskFile(taskId: TaskId, relPath: string): Promise<void>;
  /** 在系统文件管理器里选中任务工作目录里的文件。校验同 openTaskFile。 */
  revealTaskFile(taskId: TaskId, relPath: string): Promise<void>;
  /** `@` 文件引用补全：目录由主进程按任务（或新任务草稿的项目）查出，只返回相对路径，最多 20 条；query 含绝对路径或 `..` 时 reject。 */
  listProjectFiles(target: ProjectFilesTarget, query: string): Promise<string[]>;

  // 会话树与分叉（docs/architecture/session-tree.md）
  /** 会话里的用户消息树（RPC get_tree）；任务没有进程时先拉起。 */
  getSessionTree(taskId: TaskId): Promise<SessionTreeView>;
  /**
   * 从一条用户消息分叉出新任务（RPC branch，在原任务的进程上做完就切回原会话）：新任务的会话是这条消息之前的历史，
   * 同项目、同工作目录（worktree 任务的分叉共用同一个 worktree）。`userMessageKey` 是对话流里那条用户消息的 key，
   * null 表示最后一条用户消息。只在原任务空闲时可用，原任务的会话和对话流不变。
   */
  forkTask(taskId: TaskId, userMessageKey: string | null): Promise<ForkResult>;
  /**
   * 就地回到树里的一个用户消息节点（RPC branch，任务改用 omp 为它新建的会话文件，原文件留在磁盘上），
   * 对话流重载为该节点之前的历史；返回那条消息的文字。只在任务空闲时可用。
   */
  branchTask(taskId: TaskId, entryId: string): Promise<BranchTaskResult>;

  // 子代理泳道（阶段 5）
  /** 当前泳道快照（含已结束的）；渲染进程打开任务或重载后用它对齐，之后靠 subagents 事件。 */
  getSubagents(taskId: TaskId): Promise<SubagentLane[]>;
  /**
   * 子代理详情：泳道 + get_subagent_messages 读到的记录。主进程按子代理缓存已读部分并按 fromByte 增量读；
   * since 是调用方已有的记录条数（绝对序号），传了就只返回它还没有的部分（见 SubagentDetail.from）。任务没有进程时 messages 为 null。
   */
  getSubagentDetail(taskId: TaskId, subagentId: string, since?: number): Promise<SubagentDetail>;
  /** steer_subagent：给运行中的子代理插一句话。子代理不在运行时 reject。 */
  steerSubagent(taskId: TaskId, subagentId: string, text: string): Promise<void>;
  /** cancel_subagent；返回 omp 说是否真的取消了（已经结束的是 false）。 */
  cancelSubagent(taskId: TaskId, subagentId: string): Promise<boolean>;

  // 旁路提问（/btw）
  /**
   * 发一条旁路提问（RPC btw）：不进主对话流，主轮在跑时也能问。recordId 给了就是对那个话题追问。返回话题 id；答案经 btw 事件流回来。
   * omp 同一时刻只许一条在跑（再问会被拒绝）；问题限长（btwLimits.questionChars）；任务没有进程时先拉起。
   */
  askBtw(taskId: TaskId, question: string, recordId?: string): Promise<string>;
  /** 取消在跑的旁路提问（RPC btw_cancel）；recordId 省略时取消正在跑的那条。返回是否真的取消了。没有进程时返回 false。 */
  cancelBtw(taskId: TaskId, recordId?: string): Promise<boolean>;
  /** 旁路提问记录（新到旧，含追问；get_btw_history，历史随会话落盘）。没有进程时返回主进程已知的部分，不拉起 omp。 */
  getBtw(taskId: TaskId): Promise<BtwHistoryRecord[]>;

  // 账号和模型（走服务进程）
  listModels(): Promise<ModelOption[]>;
  listLoginProviders(): Promise<LoginProvider[]>;
  /** 登录结束（成功、失败或取消）时 resolve；过程中的 URL、进度、输入请求走 onLogin。 */
  startLogin(providerId: string): Promise<LoginOutcome>;
  /** value 为 null 表示取消这个输入。 */
  answerLoginInput(inputId: string, value: string | null): Promise<void>;
  cancelLogin(): Promise<void>;
  listAccounts(providerId: string): Promise<LogoutAccount[]>;
  logout(providerId: string, credentialId: number): Promise<void>;
  /**
   * 设置某个 provider 的 API key（D3）：主进程用 safeStorage 加密存在 userData，启动 omp 时作为环境变量传入；不写 ~/.omp。
   * key 只能从渲染进程发往主进程，主进程永远不回传。providerId 必须是 listLoginProviders 里的 id。
   */
  saveApiKey(providerId: string, key: string): Promise<void>;
  /** 清除 studio 自己存的某个 provider 的 key；没有时静默成功。不影响 omp 里用 OAuth 或终端登录的凭据（那些走 logout）。 */
  clearApiKey(providerId: string): Promise<void>;
  /** 已设置 studio 自存 API key 的 provider id 列表；只有 id，没有 key 的任何内容。 */
  listApiKeyProviders(): Promise<string[]>;

  // 自定义模型：直接读写 omp 的 models.yml（src/main/omp-config/models-file.ts；规则见 src/main/AGENTS.md）
  /** 读 models.yml 里的 providers。key 只有状态，没有内容。文件读不懂时 reject。 */
  listCustomProviders(): Promise<CustomModelsFileInfo>;
  /** 新增（add）或修改（edit）一个 provider；校验不过返回 {ok:false, code}。成功后主进程关掉服务进程，下次读模型列表时 omp 重新加载。 */
  saveCustomProvider(mode: "add" | "edit", input: CustomProviderInput): Promise<CustomModelsOutcome>;
  deleteCustomProvider(providerId: string): Promise<CustomModelsOutcome>;
  /** 一键拉取：主进程 GET <baseUrl>/models。key 为 keep 时用文件里这个 provider 已有的 key。 */
  fetchProviderModels(request: FetchModelsRequest): Promise<FetchModelsOutcome>;
  /** 在文件夹里显示 models.yml（还不存在时打开它所在的目录）。 */
  revealModelsFile(): Promise<void>;

  // omp 管理
  getOmpStatus(): Promise<OmpStatus>;
  answerTakeover(accept: boolean): Promise<void>;
  /** 自管 omp 的 bin 不在用户 PATH 上时，放回最前面。 */
  addManagedOmpToPath(): Promise<void>;
  /** 下载、校验或发现失败后重试。 */
  retryOmpSetup(): Promise<void>;
  /** 只对 PATH 上用户自装的 omp 执行 omp update；自管和他人管理的会拒绝。 */
  upgradePathOmp(): Promise<OmpUpgradeResult>;
  /**
   * 立即向构建服务检查一次。自管的 omp：有新版就下载、校验并替换 bin/omp.exe（新任务用新版本），返回 installedVersion；
   * 用户自装、他人管理的 omp：只比较版本，有新版时返回 availableVersion（状态里也带上），不动文件。已是最新时两个都是 null。
   */
  checkOmpUpdate(): Promise<{ installedVersion: string | null; availableVersion: string | null }>;
  /** PATH 上没有 omp（状态 missing）时，用户点"下载并安装"：下载、校验并装好自管副本，进度走 ompStatus（installing）。 */
  installOmp(): Promise<void>;
  /** 取消正在进行的下载；已下载的部分丢弃，状态回到 missing。 */
  cancelOmpInstall(): Promise<void>;
  /** omp 的全部设置（`omp config list`）：schema 按 omp 版本缓存，值每次现读。 */
  getOmpConfig(): Promise<OmpConfigSnapshot>;
  /** `omp config set <key> <value> --json`。valueJson 是 JSON 文本（字符串值也要带引号）；omp 拒绝时 reject，message 是 omp 的原话。 */
  setOmpConfig(key: string, valueJson: string): Promise<OmpConfigWriteResult>;
  /** `omp config reset <key> --json`：删掉全局配置里的这个键，回到别的层或默认值。 */
  resetOmpConfig(key: string): Promise<OmpConfigWriteResult>;
  /** 订阅账号额度总览：`omp usage --json`，只读。 */
  getUsageQuota(): Promise<QuotaSnapshot>;
  /**
   * 近一年每日消耗，只读 omp 的 stats.db。refresh=true 先让 omp 自己跑一次 `omp stats --json` 同步新会话（首次可能要几分钟），
   * 再读；false 直接读现有的库。
   */
  getUsageHeatmap(refresh: boolean): Promise<UsageHeatmap>;
  setReduceMotion(on: boolean): Promise<void>;
  setEnterWhileRunning(mode: "steer" | "followUp"): Promise<void>;
  setNotifyOnGate(on: boolean): Promise<void>;
  /** 记下用户已经确认过"全部自动"，之后选它不再弹确认。 */
  setYoloConfirmed(): Promise<void>;
  /** 新任务实际会用的默认模型和思考强度：服务进程 get_state 读出的当前值；读不到（没登录、没有可用模型）时为 null。 */
  getDefaultModel(): Promise<DefaultModelInfo | null>;
  /** projectId 为 null 时只看全局配置。 */
  getModelDefaults(projectId: ProjectId | null): Promise<ModelDefaults>;
  /** 设新任务的默认模型（omp 的 modelRoles.default；null = 去掉，让 omp 自己选），写到哪层和 omp 终端一致。 */
  setDefaultModel(projectId: ProjectId | null, model: ModelKey | null): Promise<void>;
  /** omp-studio 自身的更新状态（设置 → 关于）。 */
  getUpdateState(): Promise<UpdateState>;
  /** 手动检查更新；有可用更新时自动开始下载。 */
  checkForUpdate(): Promise<void>;
  /** 安装已下载的更新：先走退出流程关掉所有 omp 子进程，再安装并重新启动。 */
  installUpdate(): Promise<void>;

  // 评审（阶段 3）和 worktree / git（阶段 4）。路径一律相对仓库根；仓库根 = 任务 cwd 所在的 git 仓库（有 worktree 时是 worktree）。
  /** PATH 上的 git 版本和 gh 是否可用（界面据此隐藏"开 PR"等入口）。 */
  getGitTools(): Promise<GitTools>;
  /** 任务 cwd 的 git 状态；不是仓库或没有 git 是正常的类型化结果，不 reject。 */
  getGitStatus(taskId: TaskId): Promise<GitStatus>;
  /** 一个文件一侧的 diff（结构化的 hunk 和新旧行号）；二进制和过大文件有对应的 kind。 */
  getGitFileDiff(taskId: TaskId, path: string, area: GitDiffArea): Promise<GitFileDiff>;
  stageGitFile(taskId: TaskId, path: string): Promise<void>;
  unstageGitFile(taskId: TaskId, path: string): Promise<void>;
  /** 把文件的所有改动退回 HEAD（未跟踪的文件直接删除）。不确认，确认由界面做。 */
  discardGitFile(taskId: TaskId, path: string): Promise<void>;
  /** hunk 用 GitHunkRef 定位；diff 在两次调用之间变过时 reject（请刷新后重试）。 */
  stageGitHunk(taskId: TaskId, path: string, hunk: GitHunkRef): Promise<void>;
  unstageGitHunk(taskId: TaskId, path: string, hunk: GitHunkRef): Promise<void>;
  /** 丢弃一个没暂存的 hunk（area = unstaged 里看到的）。 */
  discardGitHunk(taskId: TaskId, path: string, hunk: GitHunkRef): Promise<void>;
  /** 校验每条评论的文件路径在任务目录内，格式化成一条消息（formatReviewComments）并作为 prompt 发出。 */
  sendReviewComments(taskId: TaskId, comments: ReviewComment[], whenBusy: PromptInput["whenBusy"]): Promise<void>;
  /** 项目仓库里的 setup 脚本（name 相对仓库根，如 `.omp-studio/setup.ps1`）及内容哈希；没有为 null。新建 worktree 任务时会运行它：只运行用户确认过这份内容（approved）的，界面先用 approveWorktreeSetup 征得同意。 */
  getWorktreeSetupScript(projectId: ProjectId): Promise<WorktreeSetupInfo | null>;
  /** 记下用户同意运行这个项目的这份 setup 脚本；sha256 必须是用户看到的那份，脚本此后变了就 reject（重新确认）。 */
  approveWorktreeSetup(projectId: ProjectId, sha256: string): Promise<void>;
  /** 任务的 worktree 信息；任务没有 worktree 返回 null。 */
  getTaskWorktree(taskId: TaskId): Promise<TaskWorktreeInfo | null>;
  /** 把 worktree 分支合进基分支（在主仓库里）。有冲突时不留下半成品，返回 conflict。不删除 worktree。 */
  mergeTaskWorktree(taskId: TaskId): Promise<GitMergeResult>;
  /** 关掉任务进程、移除 worktree 和分支（含未提交和未合并的改动），并归档任务。 */
  discardTaskWorktree(taskId: TaskId): Promise<void>;
  /** 清理这个项目下没有任务记录引用的 worktree；有未提交改动或未合并提交的保留并报告。 */
  cleanupOrphanWorktrees(projectId: ProjectId): Promise<WorktreeCleanupResult>;
  /** stageAll 为 true 时先暂存全部；否则只提交已暂存的。 */
  commitGit(taskId: TaskId, message: string, stageAll: boolean): Promise<GitCommitResult>;
  /** 推送当前分支（需要时设置 upstream），从不强推。 */
  pushGit(taskId: TaskId): Promise<GitPushResult>;
  /** `gh pr create`，基分支是任务的 worktreeBase（没有 worktree 时由 gh 决定）。 */
  createPullRequest(taskId: TaskId, input: GitPullRequestInput): Promise<GitPullRequestResult>;
}

export interface StudioEventPayloads {
  taskState: TaskState;
  taskRemoved: TaskId;
  /** 点了"等你确认"系统通知：主进程已聚焦窗口，渲染进程切到这个任务（selectTask）。 */
  focusTask: TaskId;
  transcript: TranscriptBatch;
  taskNotice: TaskNotice;
  login: LoginEvent;
  ompStatus: OmpStatus;
  settings: StudioSettings;
  /** 用户把文件夹拖进了窗口，主进程已把它加入项目。 */
  projectDropped: Project;
  /** 新任务实际会用的默认模型变了（在 omp 设置里改了 modelRoles、defaultThinkingLevel 等）；null = 读不到。 */
  defaultModel: DefaultModelInfo | null;
  /** omp 的可用斜杠命令变了（available_commands_update）。 */
  slashCommands: { taskId: TaskId; commands: AvailableSlashCommand[] };
  /** 任务的子代理泳道变了（整份快照，主进程合并过高频的 progress 帧）。 */
  subagents: { taskId: TaskId; lanes: SubagentLane[] };
  /** 旁路提问的变化：新记录 / 生命周期变化（整条记录）、流式增量、整份对齐。 */
  btw: { taskId: TaskId; event: BtwUiEvent };
  /** 终端输出（主进程已按 ~16ms 合并）。 */
  terminalData: { taskId: TaskId; data: string };
  /** 终端里的 shell 自己退出了（主动 closeTerminal 不发这个事件）。 */
  terminalExit: { taskId: TaskId; exitCode: number };
  /** omp-studio 自身的更新状态变化。 */
  updateState: UpdateState;
}

export type StudioEventApi = {
  [K in keyof StudioEventPayloads as `on${Capitalize<K>}`]: (
    listener: (payload: StudioEventPayloads[K]) => void,
  ) => Unsubscribe;
};

export type StudioApi = StudioInvokeApi & StudioEventApi;

/** 主进程侧的 handler：参数一律是 unknown，先校验再用。 */
export type InvokeHandlers = {
  [K in keyof StudioInvokeApi]: (...args: unknown[]) => ReturnType<StudioInvokeApi[K]>;
};

/** 一个 *-handlers.ts 负责的那一组 handler；register.ts 把各组拼成完整的 InvokeHandlers。 */
export type HandlerGroup<K extends keyof StudioInvokeApi> = Pick<InvokeHandlers, K>;

export const invokeChannel = <K extends keyof StudioInvokeApi>(name: K) => `studio:${name}` as const;
export const eventChannel = <K extends keyof StudioEventPayloads>(name: K) => `studio:event:${name}` as const;

/**
 * 拖放文件夹：preload 在隔离世界里监听 drop，用 webUtils.getPathForFile 取路径，经这个通道发给主进程（路径不经过渲染进程，
 * 也没有任何渲染进程可调用的"传路径"函数）。主进程校验是目录后加入项目，并推送 projectDropped；不是目录就什么也不发生。
 */
export const dropFolderChannel = "studio:dropFolder";

export const limits = {
  titleMaxChars: 200,
  promptMaxImages: 8,
  apiKeyMaxChars: 4096,
  /** 一次 writeTerminal 的最大字符数（粘贴大段文本时界面分块发）。 */
  terminalInputMaxChars: 65_536,
  terminalSizeRange: [2, 1000],
  terminalHeightRange: [120, 4000],
  urlMaxChars: 8192,
  maxLiveProcessesRange: [2, 16],
  /** 一条 `!命令` 的最大字符数。 */
  bashCommandMaxChars: 16_384,
  /** `/goal` 的目标文字最大字符数。 */
  goalObjectiveMaxChars: 4_096,
} as const;

/**
 * StudioInvokeApi 的全部函数名（运行时可枚举；preload 靠它生成转发）。
 * `satisfies Record<keyof …>` 保证与接口逐个对齐：漏一个或多一个都编译失败。
 */
export const invokeNames = {
  getAppInfo: true,
  getSettings: true,
  setLocale: true,
  setTheme: true,
  setMaxLiveProcesses: true,
  openExternal: true,
  quitApp: true,
  openLogsFolder: true,
  exportDiagnostics: true,
  getShellState: true,
  setShellState: true,
  listProjects: true,
  addProject: true,
  removeProject: true,
  listTasks: true,
  createTask: true,
  openTask: true,
  getTranscript: true,
  markTaskRead: true,
  sendPrompt: true,
  removeQueuedMessage: true,
  promoteQueuedMessage: true,
  stopTask: true,
  respondDialog: true,
  renameTask: true,
  archiveTask: true,
  restartTask: true,
  listTaskModels: true,
  setTaskModel: true,
  setTaskThinkingLevel: true,
  setTaskFastMode: true,
  setTaskSlowMode: true,
  listSessions: true,
  resumeSession: true,
  revealProject: true,
  revealTaskSession: true,
  getTaskSessionRef: true,
  listSlashCommands: true,
  getDrafts: true,
  saveDraft: true,
  compactTask: true,
  exportTaskHtml: true,
  revealTaskExport: true,
  runBash: true,
  abortBash: true,
  taskGoal: true,
  openTaskFile: true,
  revealTaskFile: true,
  listProjectFiles: true,
  getSessionTree: true,
  forkTask: true,
  branchTask: true,
  openTerminal: true,
  writeTerminal: true,
  resizeTerminal: true,
  closeTerminal: true,
  getSubagents: true,
  askBtw: true,
  cancelBtw: true,
  getBtw: true,
  getSubagentDetail: true,
  steerSubagent: true,
  cancelSubagent: true,
  listModels: true,
  listLoginProviders: true,
  startLogin: true,
  answerLoginInput: true,
  cancelLogin: true,
  listAccounts: true,
  logout: true,
  saveApiKey: true,
  clearApiKey: true,
  listApiKeyProviders: true,
  listCustomProviders: true,
  saveCustomProvider: true,
  deleteCustomProvider: true,
  fetchProviderModels: true,
  revealModelsFile: true,
  getOmpStatus: true,
  answerTakeover: true,
  addManagedOmpToPath: true,
  retryOmpSetup: true,
  checkOmpUpdate: true,
  upgradePathOmp: true,
  installOmp: true,
  cancelOmpInstall: true,
  getOmpConfig: true,
  setOmpConfig: true,
  resetOmpConfig: true,
  getUsageQuota: true,
  getUsageHeatmap: true,
  setReduceMotion: true,
  setEnterWhileRunning: true,
  setNotifyOnGate: true,
  setYoloConfirmed: true,
  getDefaultModel: true,
  getModelDefaults: true,
  setDefaultModel: true,
  getUpdateState: true,
  checkForUpdate: true,
  installUpdate: true,
  getGitTools: true,
  getGitStatus: true,
  getGitFileDiff: true,
  stageGitFile: true,
  unstageGitFile: true,
  discardGitFile: true,
  stageGitHunk: true,
  unstageGitHunk: true,
  discardGitHunk: true,
  sendReviewComments: true,
  getWorktreeSetupScript: true,
  approveWorktreeSetup: true,
  getTaskWorktree: true,
  mergeTaskWorktree: true,
  discardTaskWorktree: true,
  cleanupOrphanWorktrees: true,
  commitGit: true,
  pushGit: true,
  createPullRequest: true,
} satisfies Record<keyof StudioInvokeApi, true>;

/** StudioEventPayloads 的全部事件名；订阅函数叫 `on` + 首字母大写的名字。 */
export const eventNames = {
  taskState: true,
  taskRemoved: true,
  focusTask: true,
  transcript: true,
  taskNotice: true,
  login: true,
  ompStatus: true,
  settings: true,
  projectDropped: true,
  defaultModel: true,
  slashCommands: true,
  subagents: true,
  btw: true,
  updateState: true,
  terminalData: true,
  terminalExit: true,
} satisfies Record<keyof StudioEventPayloads, true>;

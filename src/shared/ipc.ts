// 渲染进程 ↔ 主进程的全部契约。preload 按 StudioApi 逐个实现；主进程按 InvokeHandlers 注册并校验参数。
// 规则（AGENTS.md "Electron 安全"）：一个函数只做一件事；渲染进程传来的每个参数都当不可信输入；
// 渲染进程不传路径，只传主进程发的 id。协议出处见 docs/architecture/ipc.md。
import type {
  AskAnswer,
  AvailableSlashCommand,
  AskQuestion,
  ContextUsage,
  LoginProvider,
  LogoutAccount,
  NotifyType,
  PromptError,
  PromptStatus,
  ThinkingLevel,
} from "./omp-wire/rpc-wire.generated.ts";
import type { Transcript, TranscriptEvent } from "./transcript.ts";

// ───────── 标识 ─────────

/** 主进程生成的不透明 id。渲染进程只回传，不解析、不拼接。 */
export type TaskId = string & { readonly __brand: "TaskId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
export type Unsubscribe = () => void;

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
    | "too_many_tasks";
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
  /** queue_update 的快照；chip 文本原样传给 removeQueuedMessage / promoteQueuedMessage。 */
  queue: { steering: string[]; followUp: string[] };
  /** 未答的对话框，按到达顺序。 */
  dialogs: DialogRequest[];
  /** 正在运行的子代理数，用于过程折叠行。 */
  runningSubagents: number;
  /** 这一次 running 开始的时间戳（ms，主进程接收时间）；非 running/needs_you 时为 null。侧栏显示"已运行 N 分钟"。 */
  runStartedAt: number | null;
}

export interface CreateTaskInput {
  projectId: ProjectId;
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
  | { taskId: TaskId; kind: "editor_text"; text: string };

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
    }
  /** 用户拒绝接管，而 PATH 上的是脚本，启动不了。 */
  | { state: "unusable"; path: string; reason: "script_launcher" }
  | { state: "error"; stage: "discover" | "download" | "verify" | "install" | "path"; message: string }
  /** PATH 上没有 omp，等用户点"下载并安装"。version/sizeBytes 来自构建服务，查不到时为 null。 */
  | { state: "missing"; version: string | null; sizeBytes: number | null; source: string };

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
  /** 侧栏里折叠的项目组（ProjectId）；默认空。 */
  collapsedProjects: string[];
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
  /** 用系统默认应用打开任务工作目录里的文件。relPath 相对任务 cwd，主进程校验落在 cwd 之内。 */
  openTaskFile(taskId: TaskId, relPath: string): Promise<void>;
  /** 在系统文件管理器里选中任务工作目录里的文件。校验同 openTaskFile。 */
  revealTaskFile(taskId: TaskId, relPath: string): Promise<void>;

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
   * 自管的 omp：立即向构建服务检查一次，有新版就下载、校验并替换 bin/omp.exe（新任务用新版本）。
   * 返回装上的版本号，已是最新时为 null。非自管时拒绝（用 upgradePathOmp）。
   */
  checkOmpUpdate(): Promise<{ installedVersion: string | null }>;
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
  setReduceMotion(on: boolean): Promise<void>;
  setEnterWhileRunning(mode: "steer" | "followUp"): Promise<void>;
  setNotifyOnGate(on: boolean): Promise<void>;
  /** 记下用户已经确认过"全部自动"，之后选它不再弹确认。 */
  setYoloConfirmed(): Promise<void>;
  /** 新任务实际会用的默认模型和思考强度：服务进程 get_state 读出的当前值；读不到（没登录、没有可用模型）时为 null。 */
  getDefaultModel(): Promise<DefaultModelInfo | null>;
  /** omp-studio 自身的更新状态（设置 → 关于）。 */
  getUpdateState(): Promise<UpdateState>;
  /** 手动检查更新；有可用更新时自动开始下载。 */
  checkForUpdate(): Promise<void>;
  /** 安装已下载的更新：先走退出流程关掉所有 omp 子进程，再安装并重新启动。 */
  installUpdate(): Promise<void>;
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
  urlMaxChars: 8192,
  maxLiveProcessesRange: [2, 16],
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
  listSessions: true,
  resumeSession: true,
  revealProject: true,
  revealTaskSession: true,
  getTaskSessionRef: true,
  listSlashCommands: true,
  getDrafts: true,
  saveDraft: true,
  compactTask: true,
  openTaskFile: true,
  revealTaskFile: true,
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
  setReduceMotion: true,
  setEnterWhileRunning: true,
  setNotifyOnGate: true,
  setYoloConfirmed: true,
  getDefaultModel: true,
  getUpdateState: true,
  checkForUpdate: true,
  installUpdate: true,
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
  updateState: true,
} satisfies Record<keyof StudioEventPayloads, true>;

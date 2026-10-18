// 渲染进程 ↔ 主进程的全部契约。preload 按 StudioApi 逐个实现；主进程按 InvokeHandlers 注册并校验参数。
// 规则（AGENTS.md "Electron 安全"）：一个函数只做一件事；渲染进程传来的每个参数都当不可信输入；
// 渲染进程不传路径，只传主进程发的 id。协议出处见 docs/architecture/ipc.md。
import type {
  AskAnswer,
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
/** omp 的 tools.approvalMode（omp 文档 approval-mode.md）。null = 不传 --approval-mode，跟随 omp 配置（omp 默认 yolo）。 */
export type ApprovalMode = "always-ask" | "write" | "yolo";

export interface AppInfo {
  version: string;
  platform: "win32" | "darwin" | "linux";
  /** 已按设置和系统语言解析好的界面语言。 */
  locale: Locale;
  isPackaged: boolean;
}

/** 模型的稳定键，对应 set_model 的 provider + modelId。 */
export interface ModelKey {
  provider: string;
  modelId: string;
}

export interface StudioSettings {
  locale: LocalePreference;
  theme: ThemePreference;
  /** 新任务的模型，作为 --model provider/id 传给 omp；null = omp 自己的默认。 */
  defaultModel: ModelKey | null;
  defaultThinkingLevel: ThinkingLevel | null;
  defaultApprovalMode: ApprovalMode | null;
  /** 同时存活的 omp 进程软上限；超过时回收最久未用的空闲任务。 */
  maxLiveProcesses: number;
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
  kind: "omp_unavailable" | "spawn_failed" | "handshake_failed" | "restore_model_failed" | "exited" | "protocol";
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
  approvalMode: ApprovalMode | null;
  /** get_state.contextUsage；percent 是 0–100 的百分数。omp 没给时为 null。 */
  contextUsage: ContextUsage | null;
  /** queue_update 的快照；chip 文本原样传给 removeQueuedMessage / promoteQueuedMessage。 */
  queue: { steering: string[]; followUp: string[] };
  /** 未答的对话框，按到达顺序。 */
  dialogs: DialogRequest[];
  /** 正在运行的子代理数，用于过程折叠行。 */
  runningSubagents: number;
}

export interface CreateTaskInput {
  projectId: ProjectId;
  model?: ModelKey;
  thinkingLevel?: ThinkingLevel;
  approvalMode?: ApprovalMode;
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

export type DialogRequest =
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
  | { id: string; kind: "ask"; questions: AskQuestion[]; timeoutMs?: number };

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
  /** 用户自装的 omp，首次发现，等用户回答是否接管。launchable=false 是 omp.cmd 这类脚本。 */
  | { state: "ask_takeover"; path: string; version: string | null; launchable: boolean }
  | { state: "installing"; version: string | null; receivedBytes: number; totalBytes: number | null }
  | {
      state: "ready";
      source: OmpSource;
      path: string;
      version: string;
      /** 低于支持的最低版本，提示升级。 */
      belowMinimum: boolean;
      /** 自管且还没问过要不要加进用户 PATH。 */
      askAddToPath: boolean;
      /** 自管时已下载好、新任务会用到的版本。 */
      stagedUpdate: string | null;
    }
  /** 用户拒绝接管，而 PATH 上的是脚本，启动不了。 */
  | { state: "unusable"; path: string; reason: "script_launcher" }
  | { state: "error"; stage: "discover" | "download" | "verify" | "install" | "path"; message: string };

export interface OmpUpgradeResult {
  exitCode: number | null;
  output: string;
}

// ───────── 函数 ─────────

export interface StudioInvokeApi {
  // 应用
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<StudioSettings>;
  setLocale(preference: LocalePreference): Promise<void>;
  setTheme(preference: ThemePreference): Promise<void>;
  setDefaultModel(model: ModelKey | null): Promise<void>;
  setDefaultThinkingLevel(level: ThinkingLevel | null): Promise<void>;
  setDefaultApprovalMode(mode: ApprovalMode | null): Promise<void>;
  setMaxLiveProcesses(count: number): Promise<void>;
  /** 用系统浏览器打开链接；只接受 http/https。 */
  openExternal(url: string): Promise<void>;

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
  /** 没有对应的 RPC 命令：任务空闲时带新参数重启 omp 并回到同一会话；运行中拒绝。 */
  setTaskApprovalMode(taskId: TaskId, mode: ApprovalMode | null): Promise<void>;

  // 会话历史
  /** projectId 为 null 时列出所有项目的会话。只读 ~/.omp。 */
  listSessions(projectId: ProjectId | null): Promise<SessionSummary[]>;
  /** 以会话自己的 cwd 新建任务并恢复它；已挂在任务上时返回那个任务。 */
  resumeSession(sessionId: string): Promise<TaskState>;

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
  answerAddToPath(accept: boolean): Promise<void>;
  /** 下载、校验或发现失败后重试。 */
  retryOmpSetup(): Promise<void>;
  /** 只对 PATH 上用户自装的 omp 执行 omp update；自管和他人管理的会拒绝。 */
  upgradePathOmp(): Promise<OmpUpgradeResult>;
}

export interface StudioEventPayloads {
  taskState: TaskState;
  taskRemoved: TaskId;
  transcript: TranscriptBatch;
  taskNotice: TaskNotice;
  login: LoginEvent;
  ompStatus: OmpStatus;
  settings: StudioSettings;
}

export type StudioEventApi = {
  [K in keyof StudioEventPayloads as `on${Capitalize<K>}`]: (listener: (payload: StudioEventPayloads[K]) => void) => Unsubscribe;
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
  setDefaultModel: true,
  setDefaultThinkingLevel: true,
  setDefaultApprovalMode: true,
  setMaxLiveProcesses: true,
  openExternal: true,
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
  setTaskApprovalMode: true,
  listSessions: true,
  resumeSession: true,
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
  answerAddToPath: true,
  retryOmpSetup: true,
  upgradePathOmp: true,
} satisfies Record<keyof StudioInvokeApi, true>;

/** StudioEventPayloads 的全部事件名；订阅函数叫 `on` + 首字母大写的名字。 */
export const eventNames = {
  taskState: true,
  taskRemoved: true,
  transcript: true,
  taskNotice: true,
  login: true,
  ompStatus: true,
  settings: true,
} satisfies Record<keyof StudioEventPayloads, true>;

// 渲染进程 ↔ 主进程的全部契约。preload 按 StudioApi 逐个实现；主进程按 InvokeHandlers 注册并校验参数。
// 规则（AGENTS.md "Electron 安全"）：一个函数只做一件事；渲染进程传来的每个参数都当不可信输入；
// 渲染进程不传路径，只传主进程发的 id。
import type {
  AvailableSlashCommand,
  Effort,
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
} from "./omp-wire/rpc-wire.generated.ts";
import type {
  DraftGitInfo,
  GitCommitMessageResult,
  GitCommitResult,
  GitChangeStat,
  GitDiffArea,
  GitDiffContext,
  GitFileDiff,
  GitHunkRef,
  GitLastCommit,
  GitLinesRef,
  GitMergeResult,
  GitPullRequestInput,
  GitPullRequestResult,
  GitPushResult,
  GitStatus,
  ReviewComment,
  TaskWorktreeInfo,
  WorktreeCleanupResult,
  WorktreeSetupInfo,
} from "./git.ts";
import type {
  CustomModelsFileInfo,
  CustomModelsOutcome,
  CustomProviderInput,
  EnvSource,
  FetchModelsOutcome,
  ProviderOverrideInput,
  FetchModelsRequest,
} from "./custom-models.ts";
import type { BuiltinCommand, TaskCommand } from "./omp-output/index.ts";
import type { DiscoverEntry, DoctorCheck, PluginAction, PluginConfig, PluginsSnapshot } from "./omp-output/plugins.ts";
import type { SessionToggles } from "./omp-output/toggles.ts";
import type { SshHost, SshHostInput, SshScope } from "./omp-output/ssh.ts";
import type { SkillCandidate, SkillEntry, SkillScope, SkillTarget } from "./omp-output/skills.ts";
import type { McpEditInput, McpEditOutcome, McpEditScope, McpServerFile } from "./mcp-edit.ts";
import type { AgentMessage } from "./omp-wire/rpc-wire.generated.ts";
import type { BtwHistoryRecord, BtwUiEvent } from "./btw.ts";
import type { DocumentSnapshot, TspDocMessage } from "./tsp/document.ts";
import type { OmpKeybinding } from "./tsp/omp-keybindings.ts";
import type { TspEvent } from "./tsp/tsp.generated.ts";

// ───────── 标识 ─────────

/** 主进程生成的不透明 id。渲染进程只回传，不解析、不拼接。 */
export type TaskId = string & { readonly __brand: "TaskId" };
export type ProjectId = string & { readonly __brand: "ProjectId" };
/**
 * 应用内终端登录（设置 → Provider，docs/architecture/login.md "应用内登录"）的临时 omp 会话用的"任务 id"：它没有任务记录，只是让登录对话框
 * 复用 getTspSnapshot / sendTspEvent / sendTspKeys / tspBatch 这条 TSP 通道；主进程按它路由到登录会话，任务池不认识它。
 */
export const TERMINAL_LOGIN_ID = "terminal-login" as TaskId;

/**
 * 终端的键：任务终端用任务 id；新任务草稿的终端用 `new:<projectId|chats>`（草稿还没有任务 id）。
 * 草稿的目录由主进程按项目解析（无项目时是 chats 目录），渲染进程不传路径。
 */
export type DraftKey = `new:${string}`;
export type TerminalKey = TaskId | DraftKey;

/** 草稿的键：草稿存储（文字、图片）和草稿终端共用。projectId 为 null 表示无项目的"聊天"草稿。 */
export function draftKey(projectId: ProjectId | null): DraftKey {
  return `new:${projectId ?? "chats"}`;
}

/** 键是草稿的键时返回它的项目 id（"chats" 即 null 项目的聊天草稿，返回 null）；任务 id 返回 undefined。 */
export function parseDraftKey(key: string): { projectId: ProjectId | null } | undefined {
  if (!key.startsWith("new:")) return undefined;
  const rest = key.slice(4);
  return { projectId: rest === "chats" ? null : (rest as ProjectId) };
}
type Unsubscribe = () => void;

/** `@` 补全和文件面板的数据来源：任务目录、新任务草稿所在的项目目录，或默认文件夹（`AppInfo.chatsDir`，主进程自己解析，不传路径）。 */
export type ProjectFilesTarget =
  | { kind: "task"; taskId: TaskId; root?: number }
  | { kind: "project"; projectId: ProjectId }
  | { kind: "defaultFolder" };

/** 文件树的一项（目录里的直接子项）；ignored = 被 .gitignore 忽略（界面调暗，不隐藏）。 */
export interface DirEntry {
  name: string;
  kind: "dir" | "file";
  ignored: boolean;
}

/** 文件树的一层：目录在前、文件在后，同类按名字排序；超过主进程上限时 truncated = true。 */
export interface DirListing {
  entries: DirEntry[];
  truncated: boolean;
}

/** 文件预览结果：path 是相对根目录（任务 cwd 或草稿的项目目录）的规范化路径（传入绝对路径但落在根内时会换算）。 */
export interface PreviewFile {
  kind: "text" | "image" | "html" | "binary" | "too_large" | "missing";
  path: string;
  size: number;
  /** text / html 才有。 */
  text?: string;
  /** image 才有（data URL，svg 也走这里，渲染进程只能当图片显示）。 */
  dataUrl?: string;
  /** 能否用系统默认应用直接打开（同 openTaskFile 的白名单）；否则只能在文件夹中显示。 */
  canOpen: boolean;
}

// ───────── 应用和设置 ─────────

export type Locale = "zh-CN" | "en";
export type LocalePreference = Locale | "system";
export type ThemePreference = "system" | "light" | "dark";
/** 字号档位（正文字号，pt；默认 15 = 设计稿正文 --fs-prose）：设置页的下拉和主进程校验共用。整个界面按 字号 / 15 等比缩放。 */
export const fontSizeSteps = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] as const;
export const defaultFontSize = 15;
/** omp 的 tools.approvalMode（omp 文档 approval-mode.md）。只存在 omp 的配置里，omp-studio 不另存、启动时不传 --approval-mode。 */
export type ApprovalMode = "always-ask" | "always-ask-cached" | "write" | "yolo";

/** 审批模式在某个项目目录里的生效值：项目 `.omp/config.yml` 设了就盖过全局（实测 omp 18.12.5）。mode 为 null = omp 给了本版本不认识的值。 */
export interface ApprovalModeInfo {
  mode: ApprovalMode | null;
  source: "project" | "global";
}

export interface AppInfo {
  version: string;
  platform: "win32" | "darwin" | "linux";
  /** 已按设置和系统语言解析好的界面语言。 */
  locale: Locale;
  isPackaged: boolean;
  /** 没有项目时直接发送所用的目录（第一次发送时由 ensureChatsProject 创建并加入项目）。 */
  chatsDir: string;
  /** 升级后第一次启动时的"最近更新"摘要（照 omp 的 What's New）；这次启动不是升级后的第一次时为 null。 */
  whatsNew: WhatsNew | null;
  /** 当前版本在 CHANGELOG.md 里的那一节（设置 → 关于 → 更新日志）；没有这一节（测试用的临时版本）时为 null。 */
  releaseNotes: ReleaseNotes | null;
  /** 运行时版本（process.versions），关于对话框显示。 */
  runtime: { electron: string; chromium: string; node: string };
}

export interface ReleaseNotes {
  version: string;
  /** 标题 `## [<版本>] - <日期>` 里的日期，没有为 null。 */
  date: string | null;
  /** 这一节的 Markdown 正文（`### 新增` 等小标题 + 条目）。 */
  body: string;
}

/** 自上次看过的版本以来的更新摘要：只有统计，不列条目（omp 的 startup.changelogMode = summary）。 */
export interface WhatsNew {
  version: string;
  /** 跨了几个版本（上次看过的版本之后、当前版本为止）。 */
  releases: number;
  added: number;
  changed: number;
  fixed: number;
  total: number;
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
  /** phase = "disabled" 的原因；manual-only = mac 版（不签名装不了更新），请手动下载新版本。 */
  disabledReason: "not-packaged" | "no-feed" | "manual-only" | null;
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
  /** 任务跑完一轮（正常结束）时响一声系统提示音。默认关。 */
  soundOnDone: boolean;
  /** 在对话等处用鼠标选中文字后自动复制到剪贴板（输入框、终端除外）。默认开。 */
  copyOnSelect: boolean;
  /** 整个软件的字号（正文 pt，fontSizeSteps 之一），默认 15；页面缩放 = fontSize / 15。 */
  fontSize: number;
  /** 用户确认过"全自动"。 */
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
  /**
   * omp 模型目录给的智能分（`Model.int`，Tern 里 omp 选择器的 Int 列）；omp 自己按跨 provider 的写法归一补齐，目录没评分为 null。
   * wire 类型的 ModelInfo 没列这一项，实测 omp 18.12.6 的 get_available_models 发的是完整 Model、带着它（docs/architecture/conversation.md）。
   */
  intelligence: number | null;
  /** omp 模型目录给的输出速度（`Model.tps`，t/s；0 和没有都是 null），没有实测时显示它。来源同上。 */
  catalogTps: number | null;
}

/**
 * 不是对话模型的"模型"（omp 的 catalog kind：tiny、search、image、tts、stt、judge…），给搜索、生图、语音等角色选
 * （`omp models --kind all --json` 里 kind 不是 chat 的那些；omp 18.12.6）。
 */
export interface RunnerModel {
  kind: string;
  key: ModelKey;
  name: string;
}

/** get_session_stats 里界面用得上的部分：本会话累计的 token、费用、请求数。 */
interface SessionUsage {
  tokens: TokenUsage;
  /** 美元。 */
  cost: number;
  premiumRequests: number;
  /** 模型请求数（assistant 消息数）：从会话文件数出来。 */
  requests?: number;
  /** 订阅计费的会话才有。 */
  credits?: SessionCredits;
}

/** 会话文件里一个模型的累计用量（assistant 消息的 usage 相加）。 */
export interface ModelUsage {
  provider: string;
  modelId: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  /** 美元。 */
  cost: number;
  /** assistant 消息数（= 模型请求数）。 */
  requests: number;
}

/**
 * 本会话按模型的用量。models 的范围和 get_session_stats 一致：当前分支、最近一次压缩保留下来的部分起；
 * 压缩过时 whole 是当前分支全部（含压缩前）的合计，没压缩过为 null。
 */
export interface SessionModelUsage {
  models: ModelUsage[];
  compactions: number;
  whole: { total: number; cost: number } | null;
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
  /** 当前模型能选的思考强度（模型目录的 thinkingEfforts 加 off），随模型变化。 */
  thinkingLevels: ThinkingLevel[];
  /** 上下文占用（输入框卡片上的 meter）；percent 是 0–100 的百分数。omp 没给时为 null。 */
  contextUsage: ContextUsage | null;
  /** 本会话累计费用等（输入框卡片 + 会话文件）；还没取到时为 null。 */
  sessionUsage: SessionUsage | null;
  /** 未答的门（omp 的提问、审批），按到达顺序。主进程为它们合成，只为让"等你确认"的任务有内容可写（通知、侧栏）。 */
  dialogs: DialogRequest[];
  /** omp 的待办阶段，从 dock 里 HUD 的待办节点换算（shared/tsp/todos.ts）；没有待办时是空数组。 */
  todoPhases: TodoPhase[];
  /** 任务实际的工作目录（有 worktree 时是 worktree 根，否则是项目目录）；界面把工具参数里的绝对路径换成相对它的路径。 */
  cwd: string;
  /** 这一次 running 开始的时间戳（ms，主进程接收时间）；非 running/needs_you 时为 null。侧栏显示"已运行 N 分钟"。 */
  runStartedAt: number | null;
  /** 本会话的 `/fast`（模型名后面的闪电图标，实测不落配置，换到不支持的模型就关）。 */
  fastMode: { enabled: boolean; active: boolean };
  /** 本会话的 `/slow`：omp 没有状态节点，按最后一次 toast 记（TspRunner）。 */
  slowMode: { supported: boolean; enabled: boolean; scope: SlowModeScope | null };
  /** 本会话还挂着的目标（active / paused / budget-limited）；没有、已完成、已放弃时为 null。 */
  goal: TaskGoal | null;
  /** 会话开关（/skillful /extended-context /computer /advisor /browser /prewalk）本会话里被命令改过的值，来自 omp 的状态 toast（omp-output/toggles.ts）；null 项 = 没动过，生效的是配置默认值。 */
  sessionToggles: SessionToggles;
  /**
   * `/add-dir` 加进这个任务会话的额外工作区目录（不含任务自己的 cwd），按 omp 给的顺序；文件面板把它们当额外的根（下标 1…n，0 是 cwd）。
   * 只来自 omp 的输出（`/dirs`、`/add-dir`、`/remove-dir`），只活在 omp 进程里：进程退出后清空。
   */
  workspaceDirs: readonly string[];
  /**
   * 能不能"重开会话"（结束 omp 进程、用 `--resume` 重新起，重新读 skill、MCP、插件和配置）：空闲且没有后台作业、子代理、旁路提问在跑，
   * 或者进程已经不在（stopped / error）。在跑、等你回答、启动中时为 false，界面把重开按钮置灰。
   */
  restartable: boolean;
  /**
   * dock 里 `omp.hud.activity` 下 `omp.loader` 的文字（交接、建 worktree、分支摘要、debug 报告、压缩等"没有 agent 一轮但 omp 在忙"的时候）；没有 loader 为 null，
   * 有 loader 但没有文字为空串。有 loader 时任务算 running（shared/tsp/task-status.ts）。
   */
  loaderText: string | null;
  /** omp 标题后缀 ` · #12` 里的 PR 号（当前分支有 PR）；没有为 null。顶栏分支胶囊旁的 PR 徽标据此显示。 */
  prNumber: number | null;
  /** 输入框卡片上上下文 meter 里 omp 给的自动压缩信息（shared/tsp/context-compaction.ts）；自动压缩关着或 omp 还没给出为 null。 */
  contextCompaction: ContextCompaction | null;
  /**
   * omp 的状态行"模式"片段（Plan / Plan (paused) / Prewalk / Vibe / Loop，不含目标：目标是 `goal`）；没有模式为 null。
   * 输入框卡片被弹窗换掉时沿用上一次的值（shared/tsp/composer-facts.ts）。
   */
  composerMode: TaskMode | null;
  /** 扩展 `ctx.ui.setStatus` 写的状态文字，按 omp 给的顺序；输入框卡片被换掉时沿用上一次的值。 */
  extStatuses: readonly string[];
}

/** omp 的自动压缩（上下文圆环上的刻度和构成浮层里的说明）。百分数都是占上下文窗口的比例（0–100）。 */
export interface ContextCompaction {
  /** 自动压缩触发点。 */
  autoAtPercent: number;
  /** omp 开始预生成压缩摘要的位置；没有开预生成为 null。 */
  summaryStartsAtPercent: number | null;
  /** 压缩摘要：running = 生成中，ready = 已备好（到触发点时直接用）；null = 没在生成（或 omp 没给）。 */
  summary: "running" | "ready" | null;
}

/** omp 的模式（状态行 `mode` 片段）；循环的限制 / 条件只有 omp 画出来的那一部分（条件命令被 omp 截成约 30 个字符）。 */
export type TaskMode =
  | { kind: "plan"; paused: boolean }
  | { kind: "prewalk" }
  | { kind: "vibe" }
  | {
      kind: "loop";
      /** running = 在跑；waiting = 等下一条消息开始重复；paused = 被 Esc 暂停。 */
      state: "running" | "waiting" | "paused";
      limit:
        { kind: "iterations"; remaining: number; initial: number } | { kind: "duration"; secondsLeft: number } | null;
      condition: { until: boolean; command: string } | null;
    };

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
  /** 草稿里"用于此任务"选的模型 / 思考强度：任务以 `--model` / `--thinking` 起进程，只对这个会话生效（omp 不写配置）。不传 = 跟 omp 的默认值。 */
  model?: ModelKey;
  thinkingLevel?: ThinkingLevel;
}

export interface PromptImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** base64，不带 data: 前缀。 */
  data: string;
}

/** 输入框里的文件附件：路径只留在主进程（composer-files.ts），渲染进程只拿到这个不透明的 id 和显示用的名字 / 大小。 */
export interface ComposerFile {
  id: string;
  name: string;
  size: number;
}

export interface PromptInput {
  text: string;
  images?: PromptImage[];
  /** 文字里的 `\uE000file:N\uE001` 占位对应 fileIds[N-1]；主进程换成 omp 的 `@"路径"` 提及。 */
  fileIds?: string[];
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

/**
 * 会话树里的一个节点：用户消息（分支点，文字是那条消息的第一行）和两种分隔 / 摘要节点——`compaction`（omp 压缩过上下文）和
 * `branch_summary`（回溯时给被放弃的分支写的摘要）。只有用户消息能回溯 / 分叉。
 */
export interface SessionTreeNode {
  /** omp 会话条目 id；branchTask 用它。 */
  entryId: string;
  /** `user`：用户消息；`compaction`：压缩点（`text` 为空，`tokensBefore` 是压缩前的 token 数）；`branch_summary`：被放弃分支的摘要（`text` 是摘要的第一行）。 */
  kind: SessionTreeNodeKind;
  text: string;
  /** 压缩点（`compaction`）压缩前的 token 数；omp 没写时没有这个字段。 */
  tokensBefore?: number;
  /** omp 的 `/tree` 里给这个条目打的标签（`label` 条目，最后一次生效；清空 = 没有这个字段）。 */
  label?: string;
  /** 列表里离它最近的上一级节点（用户消息 / 压缩点 / 摘要）；根为 null。算"回溯会丢掉几轮"用。 */
  parent: string | null;
  /** 缩进层级：只在有分叉的地方加一级，一条直线的对话不缩进。 */
  indent: number;
  /** 在当前分支上（从根到叶子的路径上）。 */
  onCurrentBranch: boolean;
  /** 当前分支上最后一个节点（叶子在它之下）。 */
  current: boolean;
}

export type SessionTreeNodeKind = "user" | "compaction" | "branch_summary";

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
  /** 只有 TSP 任务有：这次回溯是否让 omp 给被放弃的分支写了摘要（请求了 `summarize` 且成功）。 */
  summarized?: boolean;
}

// ───────── 等你确认的门 ─────────

/**
 * 主进程为 omp 的提问和审批合成的门（TSP：omp 把它们画在过程区里，studio 不画）：只为让"等你确认"的任务有内容可写（通知的标题、状态）。
 * 提问和审批各一个固定 id（shared/tsp/gate.ts）。每个请求带主进程收到它的时间戳。
 */
export interface DialogRequest {
  id: string;
  kind: "confirm";
  title: string;
  message: string;
  receivedAt?: number;
}

/** 不进对话流的一次性提示。 */
export interface TaskNotice {
  taskId: TaskId;
  /** 目标完成（TSP 里目标条消失且会话文件里最后一条是 complete）：渲染进程弹一条本地化的 info toast。 */
  kind: "goal_complete";
}

// ───────── 节点树同步 ─────────

/**
 * 主进程转发的 TSP 消息（主进程已经应用到自己的文档上）。第 i 条的序号是 firstSeq + i；
 * 渲染进程要求 firstSeq === 本地 seq + 1，否则调 getTspSnapshot 重同步。
 */
export interface TspBatch {
  taskId: TaskId;
  firstSeq: number;
  messages: TspDocMessage[];
}

/** TSP 任务里一个子代理的记录（`getTspSubagentRecord`）。 */
export interface TspSubagentRecord {
  /** 会话文件里的消息（最近的 subagentLimits.detailMessages 条）；读不到为 null。 */
  messages: AgentMessage[] | null;
  truncated: boolean;
  /** `<名字>.md`：子代理的最终输出；没有为 null。 */
  output: string | null;
  unavailable: "no_session" | "no_file" | "error" | null;
  error: string | null;
}

export interface TspSnapshot {
  taskId: TaskId;
  /** 快照包含到这个序号为止的全部消息。 */
  seq: number;
  document: DocumentSnapshot;
}

/** omp `/context` 报告里的一行（shared/tsp/context-report.ts）。 */
export interface ContextReportRow {
  /** omp 的类别 id（systemPrompt / systemTools / systemContext / skills / messages），剩余空间 `free`，自动压缩预留 `buffer`。 */
  key: string;
  /** omp 的英文名称：不认识的类别直接显示它。 */
  label: string;
  tokens: number;
}

/** omp 现算的上下文构成（点输入框上的上下文 meter 弹出的报告），行序照 omp。 */
export interface ContextReport {
  rows: ContextReportRow[];
  /** 已用 = 各类别之和（不含剩余空间和预留）。 */
  used: number;
  /** 窗口 = 所有行之和；用量超出窗口时（剩余和预留都是 0）这个和不是窗口，为 null。 */
  window: number | null;
}

/** 一轮的用量脚注数据（从 omp 会话文件算：一个用户消息到它的最终回复）。 */
export interface TspTurnFooter {
  /** 用户消息到最终回复完成的毫秒数；会话文件里没有时间戳时为 null。 */
  elapsedMs: number | null;
  /** 输入 token（含缓存写入）。 */
  input: number;
  output: number;
  /** 美元。 */
  cost: number;
}

/** 从 omp 会话文件和 history.db 补出来的、omp 恢复会话时不重发的内容。 */
export interface TspSessionExtras {
  /** 每个用户消息一项，从旧到新；那一轮没结束或没有用量时为 null。 */
  turns: (TspTurnFooter | null)[];
  /** 这个会话最新的一条空闲回顾（空白折叠、最长 280 字）和它的位置：`afterTurn` = 回顾之前开始的轮数（放在第 afterTurn 轮之后）；没有回顾时为 null。 */
  recap: { text: string; afterTurn: number } | null;
  /** 最近一条回复的输出速度（token/秒，会话文件里 assistant 消息的 output ÷ (duration − ttft)）；还没有回复时为 null。 */
  tokensPerSecond: number | null;
}

// ───────── 会话历史 ─────────

export interface SessionSummary {
  /** 会话文件头里的 id；resumeSession 用它，主进程按自己的索引找文件。 */
  id: string;
  title: string | null;
  firstPrompt: string | null;
  /**
   * 会话文件最后一条消息给出的状态（只读文件末尾，口径同 omp 的 session-listing）：completed 答完、error 出错、aborted 被用户停止、
   * interrupted 停在工具调用 / 长度上限 / 工具结果上（轮次中途断掉）、pending 最后是用户消息；认不出为 null。
   */
  lastTurn: "completed" | "error" | "aborted" | "interrupted" | "pending" | null;
  cwd: string;
  /** cwd 对应的已加入项目；没有时为 null，恢复时会自动加入。 */
  projectId: ProjectId | null;
  modifiedAt: number;
  /** 已经挂在某个任务上。 */
  taskId: TaskId | null;
  /** 会话在 omp 的 `session-pins.json` 里（置顶）：侧栏历史把它排在前面。 */
  pinned: boolean;
}

interface TaskSessionRef {
  sessionId: string;
  sessionFile: string;
}

// ───────── 会话信息、请求记录、分享（S3） ─────────

/** 会话文件头（`type:"session"` 那一行）里界面用得上的字段。 */
export interface SessionHeaderInfo {
  version: number | null;
  /** ISO 时间。 */
  timestamp: string | null;
  cwd: string;
  title: string | null;
  parentSession: string | null;
  additionalDirectories: string[];
}

export interface TaskSessionInfo {
  /** 任务还没有会话文件时 sessionId / sessionFile / header 都是 null。 */
  sessionId: string | null;
  sessionFile: string | null;
  header: SessionHeaderInfo | null;
  /** 会话 id 在 `session-pins.json` 里。 */
  pinned: boolean;
  /** 项目目录；有 worktree 时 worktree 另给。 */
  projectPath: string;
  worktree: { path: string; branch: string; base: string } | null;
  /** 本会话按模型的用量，从会话文件算（和输入框、`getSessionModelUsage` 同一份口径；不读 stats.db）。 */
  usage: SessionModelUsage;
}

/** 请求记录里的一次工具调用（tool_calls 表）。 */
export interface TraceToolCall {
  name: string;
  isError: boolean | null;
  argsChars: number;
  resultChars: number | null;
}

/** 请求记录里的一次模型请求（messages 表的一行）。 */
export interface TraceRequest {
  entryId: string;
  timestamp: number;
  model: string;
  provider: string;
  agentType: string;
  stopReason: string;
  errorMessage: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  costUsd: number;
  /** 总耗时（ms）、首字耗时（ms）；omp 没记时为 null。 */
  durationMs: number | null;
  ttftMs: number | null;
  serviceTier: string | null;
  tools: TraceToolCall[];
}

export interface SessionTrace {
  hasDatabase: boolean;
  /** 从新到旧；最多 TRACE_LIMIT（session-stats.ts）条，更早的被截掉时 truncated 为 true。 */
  requests: TraceRequest[];
  truncated: boolean;
}

export interface ShareSettings {
  serverUrl: string;
  /** `blob`（share 服务器）或 `gist`；omp 以后可能加别的，原样给。 */
  store: string;
  redactSecrets: boolean;
}

export interface ShareResult {
  /** 分享链接（`Share URL:` 行）；输出里认不出来时为 null，界面显示 text。 */
  url: string | null;
  gistUrl: string | null;
  /** omp 的原始标准输出。 */
  text: string;
}

// ───────── 登录 ─────────

export type LoginEvent =
  | { type: "open_url"; url: string; launchUrl?: string; instructions?: string }
  | { type: "progress"; level: NotifyType; message: string }
  | { type: "input"; inputId: string; title: string; placeholder?: string }
  /** omp 撤销了这个输入（超时或取消）：界面收起输入框。 */
  | { type: "input_closed"; inputId: string };

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

/** 重置券（omp 的 `resetCredits`）：攒着的"重置额度"次数。照 omp usage-display.ts 的 `nM` 归一。 */
export interface QuotaResetCredits {
  bankedCount: number;
  redeemableCount: number;
  /** 最近一张未过期券的到期时间（毫秒时间戳）；都过期了是最近过期的那张；没有到期信息时 null。 */
  soonestExpiryAt: number | null;
  /** 现在用不了的原因（omp 的原文，英文）；能用时 null。 */
  unavailableReason: string | null;
}

export interface QuotaAccount {
  provider: string;
  account: string | null;
  limits: QuotaLimit[];
  notes: string[];
  /** omp 取到这份用量的时间（毫秒时间戳）；omp 有约 5 分钟缓存，所以可能比"刚读"早。 */
  fetchedAt: number | null;
  /** 套餐（`metadata.planType`，目前只有 openai-codex 带）。 */
  planType: string | null;
  /** omp 标成 Daybreak 账号（`metadata.daybreak`）。 */
  daybreak: boolean;
  resetCredits: QuotaResetCredits | null;
}

/** 登录了但 omp 取不到用量的账号（`accountsWithoutUsage`）；label 是 omp 的取名（邮箱 / 账号 id / "API key"）。 */
export interface QuotaUnavailable {
  provider: string;
  label: string;
}

/** `omp usage --json` 的结果；没有登录任何订阅账号时 accounts 为空。 */
export interface QuotaSnapshot {
  generatedAt: number;
  accounts: QuotaAccount[];
  /** 登录了但取不到用量的账号。 */
  unavailable: QuotaUnavailable[];
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
}

/** omp 的压缩触发设置（`omp config list` 里 compaction.* 的生效值），界面按它算每个模型的"压缩于"。 */
export interface CompactionSettings {
  /** > 0 时是固定的触发 token 数。 */
  thresholdTokens: number;
  /** > 0 时是窗口的百分比（omp 夹到 1–99）。 */
  thresholdPercent: number;
  /** 没设置时为 null（omp 用 max(16384, 窗口 15%)）。 */
  reserveTokens: number | null;
  /** `provider/model-id` 或 `provider/前缀*` → 基数（数字）、`"f90000"`（固定）或 `"80%"`。 */
  modelThresholds: Record<string, number | string>;
  modelThresholdsEnabled: boolean;
  /** 上面几项是不是项目配置改过的。 */
  source: "global" | "project";
}

/** omp 记下的实测速度（agent.db 的 model_perf）；只收 samples > 0 的。 */
export interface ModelPerf {
  tokensPerSecond: number | null;
  /** 首字延迟的平均值，毫秒。 */
  ttftMs: number | null;
  samples: number;
}

/** 模型选择对话框的补充参数：键是 `provider/modelId`，没有实测的模型不在表里。 */
export interface ModelInsights {
  perf: Record<string, ModelPerf>;
  /** 读 omp 设置失败时为 null。 */
  compaction: CompactionSettings | null;
}

export interface DefaultModelInfo {
  key: ModelKey;
  name: string;
  thinkingLevel: ThinkingLevel | null;
}

/**
 * 输入框工具行上次读到的数据（主进程存在 userData/startup-cache.json）。这些都要问 omp，冷启动要一两秒；
 * 渲染进程启动时先拿它把工具行画完整，现读的结果到了再替换。缺的项 = 从没读到过。
 */
export interface StartupSnapshot {
  defaultModel?: DefaultModelInfo | null;
  models?: ModelOption[];
  /** 按项目（键是 projectId，不在项目里是 "global"）。 */
  modelDefaults?: Record<string, ModelDefaults>;
  /** provider -> 有没有 OAuth 登录凭据（费用后面的 "(sub)"）。 */
  subscriptions?: Record<string, boolean>;
  approvalMode?: ApprovalMode;
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
  /** 侧栏宽度（px），200–360，默认 240。 */
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  /** 终端面板高度（px），120–4000；实际上限（主区 70%）由界面夹取。 */
  terminalHeight: number;
  /** 侧栏历史会话的排列：按文件夹（cwd）分组，或全部按时间。默认按文件夹。 */
  historyOrder: HistoryOrder;
}

export type HistoryOrder = "folder" | "time";
export const historyOrders: readonly HistoryOrder[] = ["folder", "time"];

/** 输入框右键菜单的编辑命令（editField），名字和 webContents 的方法一致。 */
export const editCommands = ["undo", "cut", "copy", "paste", "selectAll"] as const;
export type EditCommand = (typeof editCommands)[number];

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
  /** 整个软件的字号（正文 pt，fontSizeSteps 之一）：主进程 webContents.setZoomFactor(字号 / 15)。 */
  setFontSize(size: number): Promise<void>;
  /** 用系统浏览器打开链接；只接受 http/https。 */
  openExternal(url: string): Promise<void>;
  /** 在资源管理器里打开 userData/logs。 */
  openLogsFolder(): Promise<void>;
  /** 弹保存对话框导出诊断信息（版本、系统、omp 状态、设置、最近日志，已脱敏）；用户取消返回 false。 */
  exportDiagnostics(): Promise<boolean>;
  /** 窗口外壳的界面状态（侧栏宽度/折叠），存在 userData/window-state.json。 */
  getShellState(): Promise<ShellState>;
  setShellState(patch: Partial<ShellState>): Promise<void>;
  /** 有遮罩的弹窗（模型选择、命令面板、确认框等）打开/全部关闭时调用：系统三键（titleBarOverlay）的颜色跟着遮罩一起变暗/恢复。 */
  setTitleBarDimmed(dimmed: boolean): Promise<void>;
  /** 输入框右键菜单：对当前获得焦点的输入框执行编辑命令（主进程调 webContents 的同名方法；粘贴不经过渲染进程读剪贴板）。 */
  editField(command: EditCommand): Promise<void>;

  // 项目
  listProjects(): Promise<Project[]>;
  /** 主进程弹系统目录选择框；取消时返回 null。 */
  addProject(): Promise<Project | null>;
  /** 创建（已存在则复用）AppInfo.chatsDir 并加入项目；没有项目时直接发送用。 */
  ensureChatsProject(): Promise<Project>;
  /** 只从列表移除，不动磁盘。项目下还有未归档任务时拒绝。 */
  removeProject(projectId: ProjectId): Promise<void>;

  // 任务
  listTasks(): Promise<TaskState[]>;
  createTask(input: CreateTaskInput): Promise<TaskState>;
  /** 切到这个任务：需要时拉起 omp 并恢复会话，并清除 unread。启动失败不 reject，状态里有 error。 */
  openTask(taskId: TaskId): Promise<void>;
  /** 任务的节点树快照（不拉起进程）；用于丢帧或渲染进程重载后的重同步。 */
  getTspSnapshot(taskId: TaskId): Promise<TspSnapshot>;
  /**
   * 主进程已发出的最后一条 TSP 消息的序号（先把攒着的批次发出去）。结束一次"驱动"（聚焦子代理、读上下文报告）前，
   * 渲染进程等自己的镜像追上它：IPC 回复可能比之前发出的批次先到，不等就会把 omp 已经关掉的弹窗再画一帧。
   */
  getTspSeq(taskId: TaskId): Promise<number>;
  /** 用量脚注和空闲回顾（omp 恢复会话时不重发这两样，从会话文件和 history.db 补）；读不到时 `{ turns: [], recap: null }`，不抛错。 */
  getTspSessionExtras(taskId: TaskId): Promise<TspSessionExtras>;
  /**
   * omp 现算的上下文构成：主进程点 omp 输入框上的上下文 meter，读它弹出的报告再关掉（运行中也能读）。
   * 没有 omp 进程、输入框被提问 / 审批 / 全屏面板占着时为 null。
   */
  readTspContext(taskId: TaskId): Promise<ContextReport | null>;
  /** 把一个终端 → 程序事件（action / select / activate / toggle / change / edit / undo / send / focus）发给 omp。 */
  sendTspEvent(taskId: TaskId, event: TspEvent): Promise<void>;
  /** 按键字节（xterm 序列）原样写进伪终端。 */
  sendTspKeys(taskId: TaskId, data: string): Promise<void>;
  /** 对话区按等宽字符算出的列数变了（omp 用它决定 ansi / rows 的宽度）。 */
  resizeTsp(taskId: TaskId, cols: number): Promise<void>;
  /** 应答到达（消息被 omp 接收）即 resolve，不等这一轮跑完。 */
  sendPrompt(taskId: TaskId, input: PromptInput): Promise<void>;
  /** 停止：撤回排队消息并中止当前一轮。 */
  stopTask(taskId: TaskId): Promise<RestoredQueue>;
  renameTask(taskId: TaskId, title: string): Promise<void>;
  /** 关掉进程并从侧栏移除；会话文件不动。 */
  archiveTask(taskId: TaskId): Promise<void>;
  listTaskModels(taskId: TaskId): Promise<ModelOption[]>;
  setTaskModel(taskId: TaskId, model: ModelKey): Promise<void>;
  setTaskThinkingLevel(taskId: TaskId, level: ThinkingLevel): Promise<void>;
  /** `/fast`：模型不支持时 reject（omp 的 toast 原文）。 */
  setTaskFastMode(taskId: TaskId, enabled: boolean): Promise<void>;
  /** `/slow`：模型不支持时 reject（omp 的 toast 原文）。 */
  setTaskSlowMode(taskId: TaskId, enabled: boolean): Promise<void>;

  // 内置终端（阶段 6）：每个任务至多一个终端，cwd 由主进程按任务定（worktree 根或项目目录），渲染进程不传路径。
  /** 打开终端：已有活着的就复用（返回 backlog），否则在目录里新起 shell（任务的有效目录；草稿的项目目录，无项目时是 chats 目录）。目录已不存在时 reject。 */
  openTerminal(key: TerminalKey, cols: number, rows: number): Promise<TerminalOpenResult>;
  /** 把键盘输入写给终端；没有终端时静默忽略。 */
  writeTerminal(key: TerminalKey, data: string): Promise<void>;
  resizeTerminal(key: TerminalKey, cols: number, rows: number): Promise<void>;
  /** 结束终端（整棵进程树）；没有终端时静默成功。 */
  closeTerminal(key: TerminalKey): Promise<void>;
  /** 草稿建出任务后把草稿的终端交给任务（同一个 shell、同一份 backlog）；草稿没有终端时返回 false。任务已有终端时不动草稿的。 */
  rekeyTerminal(from: DraftKey, to: TaskId): Promise<boolean>;

  // 会话历史
  /** projectId 为 null 时列出所有项目的会话。只读 ~/.omp。 */
  listSessions(projectId: ProjectId | null): Promise<SessionSummary[]>;
  /** 以会话自己的 cwd 新建任务并恢复它；已挂在任务上时返回那个任务。 */
  resumeSession(sessionId: string): Promise<TaskState>;
  /** 把会话的 cwd 加入项目（已存在则复用）但不创建任务；侧栏里只有历史会话的文件夹点"+"时用。目录已不存在时拒绝。 */
  ensureSessionProject(sessionId: string): Promise<Project>;
  /** 在系统文件管理器里显示项目目录（主进程用自己记的路径，渲染进程不传路径）。 */
  revealProject(projectId: ProjectId): Promise<void>;
  /** 在系统文件管理器里选中任务的会话文件；任务还没有会话文件时拒绝。 */
  revealTaskSession(taskId: TaskId): Promise<void>;
  /** 任务的会话 id 和文件路径，用于侧栏菜单的"复制"；还没有会话文件时返回 null。 */
  getTaskSessionRef(taskId: TaskId): Promise<TaskSessionRef | null>;
  /** 本会话按模型的 token 和费用：读任务的会话文件（只读）；还没有会话文件时 models 为空。 */
  getSessionModelUsage(taskId: TaskId): Promise<SessionModelUsage>;
  /** 会话信息对话框的数据：会话文件头、置顶（只读 `<agentDir>/session-pins.json`）、按模型的用量（会话文件，和输入框同口径）。不碰 stats.db。 */
  getTaskSessionInfo(taskId: TaskId): Promise<TaskSessionInfo>;
  /** 请求记录：`stats.db` 的 messages + tool_calls，按时间从新到旧；`refresh` = 先让 omp 自己跑一次 `omp stats --json` 同步 stats.db 再读（它只在 omp stats 运行时同步，见 omp-usage.md）。表结构对不上时 reject（StatsSchemaError）。 */
  getTaskSessionTrace(taskId: TaskId, refresh: boolean): Promise<SessionTrace>;
  /** 分享确认框要说明的设置：`omp config list --json` 在任务目录下的 share.serverUrl / share.store / share.redactSecrets。 */
  getShareSettings(taskId: TaskId): Promise<ShareSettings>;
  /**
   * 分享：`omp share <会话文件> [--gist]`，把加密快照上传到 share.serverUrl（或 gist）。**会上传会话内容**，界面必须先经确认框。
   * 会话文件还没有时 reject；omp 非 0 退出时 reject（带 omp 的错误行）。
   */
  shareTask(taskId: TaskId, gist: boolean): Promise<ShareResult>;
  /** 任务当前可用的斜杠命令（get_available_commands）；`null` = 草稿页（还没有任务），用服务进程的列表。没有可用的 omp 进程时返回空数组。 */
  listSlashCommands(taskId: TaskId | null): Promise<AvailableSlashCommand[]>;
  /** 输入框草稿（文字）：key 是任务 id 或 `new:<projectId>`。主进程持久化，重启不丢。 */
  getDrafts(): Promise<Record<string, string>>;
  saveDraft(key: string, text: string): Promise<void>;
  /** 这个项目发过的消息（studio 自己存在 userData/input-history.json，从旧到新，最多 200 条）：输入框 ↑ 翻看和 Ctrl+R 搜索用。 */
  getInputHistory(projectId: ProjectId): Promise<string[]>;
  /** 记一条发出去的消息（只存文字；空的、太长的、和上一条相同的不记）。 */
  recordInputHistory(projectId: ProjectId, text: string): Promise<void>;
  /** 压缩上下文：发 `/compact`，等 omp 画出压缩分隔；失败（会话太小等）以 omp 的原文 reject。任务没有进程时先拉起。 */
  compactTask(taskId: TaskId): Promise<void>;
  /** 重开会话：结束这个任务的 omp 进程，再用 `--resume` 恢复同一个会话文件（等于终端里退出再进）。`restartable` 为 false 时 reject。 */
  restartTask(taskId: TaskId): Promise<void>;
  /**
   * 会话级斜杠命令（native-ui-plan I1）：封闭联合类型，主进程拼命令文本，在该任务自己的 omp 里执行；返回 omp 的状态 toast 原文。
   * 任务没有进程时先拉起；omp 报错（别的 toast）时以原文 reject。渲染进程不传自由文本。
   */
  runTaskCommand(taskId: TaskId, cmd: TaskCommand): Promise<{ text: string }>;
  /**
   * 和会话无关的内置命令（native-ui-plan I2）：scope=null 在服务进程（用户范围）执行；`{ projectId }` 在该项目目录里的短命 rpc-ui 执行。
   * 只放行 get_available_commands 里 source 为 builtin 的命令；omp 应答 agentInvoked:true（会调模型）视为失败。
   */
  runBuiltin(cmd: BuiltinCommand, scope: { projectId: ProjectId } | null): Promise<{ text: string }>;
  /**
   * 导出对话为 HTML（对会话文件跑 `omp --export`）：主进程弹保存对话框（默认桌面、`<标题>-<日期>.html`）并决定路径，渲染进程不传路径。
   * 用户取消返回 null；成功返回写出的文件名。还没有会话文件时 reject。
   */
  exportTaskHtml(taskId: TaskId): Promise<{ fileName: string } | null>;
  /** 在系统文件管理器里选中该任务最近一次导出的文件（只认主进程自己写过的路径）；没导出过时拒绝。 */
  revealTaskExport(taskId: TaskId): Promise<void>;
  /**
   * 目标模式（`/goal`）：`create` 带目标文字（1–`limits.goalObjectiveMaxChars` 字符）创建，`pause` / `resume` / `drop` 作用于当前目标，
   * `get` 只读。返回操作后的目标（没有目标为 null）。omp 拒绝时（已有目标、计划模式、没有可恢复的目标…）reject，原文透传。
   */
  taskGoal(taskId: TaskId, op: GoalOp, objective?: string): Promise<TaskGoal | null>;
  /**
   * 用系统默认应用打开任务工作目录里的文件。relPath 相对根目录，主进程校验落在根之内；`root` 缺省 / 0 = 任务 cwd，
   * 1…n = 第 n 个额外工作区目录（`TaskState.workspaceDirs`，主进程按自己记的列表取，渲染进程不传绝对路径）。
   */
  openTaskFile(taskId: TaskId, relPath: string, root?: number): Promise<void>;
  /** 在系统文件管理器里选中任务根目录里的文件。校验同 openTaskFile。 */
  revealTaskFile(taskId: TaskId, relPath: string, root?: number): Promise<void>;
  /** 弹系统文件夹选择框（主进程），选中后在这个任务里执行 `/add-dir`；返回 omp 的输出，取消返回 null。omp 拒绝时以原文 reject。 */
  addWorkspaceDir(taskId: TaskId): Promise<{ text: string } | null>;
  /** 移除第 `root`（1…n，同 ProjectFilesTarget.root）个额外工作区目录：主进程按它自己记的列表取路径执行 `/remove-dir`。 */
  removeWorkspaceDir(taskId: TaskId, root: number): Promise<{ text: string }>;
  /** 向 omp 重新问一次 `/dirs`，更新 TaskState.workspaceDirs（任务没有进程时什么都不做，列表本来就是空的）。 */
  refreshWorkspaceDirs(taskId: TaskId): Promise<void>;
  /** 在系统文件管理器里打开任务的工作目录（项目目录，或开了工作树时的 worktree 根）；不是会话文件所在的 ~/.omp 目录。 */
  openTaskFolder(taskId: TaskId): Promise<void>;
  /**
   * 读根目录（任务工作目录，或草稿的项目目录）里的文件供右侧预览：relPath 相对根目录（落在根内的绝对路径会换算），越界 reject。
   * 文本 > 2 MB、图片 > 20 MB 返回 too_large；文件不存在返回 missing（不 reject）。
   */
  readPreviewFile(target: ProjectFilesTarget, relPath: string): Promise<PreviewFile>;
  /**
   * 文件面板的文件树：列根目录（任务 cwd，开了工作树就是工作树目录；或草稿的项目目录）下 relDir 这一层（"" = 根）。
   * 目录在前、文件在后按名字排序，`.git` 不列出，被 .gitignore 忽略的条目带 ignored 标记；
   * relDir 越界（绝对路径、`..`、符号链接指到根外）reject；目录不存在返回空列表；符号链接指到根外的条目不列出。
   */
  listDirectory(target: ProjectFilesTarget, relDir: string): Promise<DirListing>;
  /** `@` 文件引用补全：目录由主进程按任务（或新任务草稿的项目）查出，只返回相对路径，最多 20 条；query 含绝对路径或 `..` 时 reject。 */
  listProjectFiles(target: ProjectFilesTarget, query: string): Promise<string[]>;

  // 会话树与分叉（docs/architecture/session-tree.md）
  /**
   * 给会话树里的条目（用户消息 / 压缩点 / 分支摘要）打标签；`label` 为 null 或空串 = 清除。由 omp 的 `/tree` 选择器（Shift+L）完成，
   * 要求这一轮已结束；标签写进会话文件的 `label` 条目，下次读树时带出。
   */
  labelTreeEntry(taskId: TaskId, entryId: string, label: string | null): Promise<void>;
  /** 会话里的用户消息树：只读会话文件（不拉起进程，还没有会话文件时 nodes 为空）。 */
  getSessionTree(taskId: TaskId): Promise<SessionTreeView>;
  /**
   * 从一条用户消息分叉出新任务：新任务的会话是这条消息之前的历史，同项目、同工作目录（worktree 任务的分叉共用同一个 worktree）。
   * `entryId` 是会话条目 id（会话树面板的节点 `SessionTreeNode.entryId`），null 表示当前分支最后一条用户消息。
   * 新任务用 `omp --fork=<原会话文件>` 起（omp 自己复制会话文件），在新进程里用 `/tree` 回到那条消息之前；原任务不动。
   */
  forkTask(taskId: TaskId, entryId: string | null): Promise<ForkResult>;
  /**
   * 就地回到树里的一个用户消息节点：驱动 omp 自己的 `/tree`（同一个会话文件里移动叶子，不新建文件，原来的分支留在文件里），节点树由 omp 自己重画；
   * 返回那条消息的文字。只在任务空闲时可用。`summarize` 为真时让 omp 给被放弃的分支写摘要（调一次模型，写进会话文件一个 branch_summary 条目）。
   */
  branchTask(taskId: TaskId, entryId: string, summarize?: boolean): Promise<BranchTaskResult>;

  // 子代理面板（S1，spec §4.28）：omp 只在 Agent Hub 里提供插话 / 结束 / 恢复，主进程在后台驱动它再恢复（tasks/tsp-hub-driver.ts）。
  /** 子代理的记录（会话文件）和最终输出（`.md`），只读 omp 存档；读不到时 `unavailable` + 原因，不抛错。 */
  getTspSubagentRecord(taskId: TaskId, name: string): Promise<TspSubagentRecord>;
  /** 聚焦一个子代理（omp 里 Hub 的 Enter；parked / aborted 的先复活）：成功后 omp 留在聚焦模式，输入框的话到子代理。名字必须是文档里确有的子代理。 */
  focusTspSubagent(taskId: TaskId, name: string): Promise<void>;
  /** 给子代理插一句话（Hub → 聚焦 → send → 退出聚焦）；名字必须是文档里确有的子代理，文字限长 subagentLimits.steerChars。 */
  steerTspSubagent(taskId: TaskId, name: string, text: string): Promise<void>;
  /** 结束（kill）一个子代理；已经结束时什么也不做。 */
  killTspSubagent(taskId: TaskId, name: string): Promise<void>;
  /** 恢复被结束或挂起的子代理；omp 不允许时以它给的原因 reject。 */
  reviveTspSubagent(taskId: TaskId, name: string): Promise<void>;

  // 旁路提问（/btw）
  /**
   * 发一条旁路提问（`/btw`）：不进主对话流，主轮在跑时也能问。recordId 给了就是对那个话题追问。返回话题 id；答案经 btw 事件流回来。
   * omp 同一时刻只许一条在跑（再问会被拒绝）；问题限长（btwLimits.questionChars）；任务没有进程时先拉起。
   */
  askBtw(taskId: TaskId, question: string, recordId?: string): Promise<string>;
  /** 取消在跑的旁路提问；recordId 省略时取消正在跑的那条。返回是否真的取消了。没有进程时返回 false。 */
  cancelBtw(taskId: TaskId, recordId?: string): Promise<boolean>;
  /** 旁路提问记录（新到旧，含追问；历史随会话落盘）。没有进程时返回主进程已知的部分，不拉起 omp。 */
  getBtw(taskId: TaskId): Promise<BtwHistoryRecord[]>;

  // 账号和模型（走服务进程）
  listModels(): Promise<ModelOption[]>;
  /** 非对话模型（见 RunnerModel）；跑一次 `omp models --kind all --json`，几秒内返回。 */
  listRunnerModels(): Promise<RunnerModel[]>;
  listLoginProviders(): Promise<LoginProvider[]>;
  /** 登录结束（成功、失败或取消）时 resolve；过程中的 URL、进度、输入请求走 onLogin。 */
  startLogin(providerId: string): Promise<LoginOutcome>;
  /** value 为 null 表示取消这个输入。 */
  answerLoginInput(inputId: string, value: string | null): Promise<void>;
  cancelLogin(): Promise<void>;
  /**
   * 应用内登录那些只能在终端里走完的 provider（`loginKind` = terminal）：主进程起一个临时的交互式 omp 跑 `/login <providerId>`，
   * 界面经 TERMINAL_LOGIN_ID 的 TSP 通道画 omp 的登录窗。登录结束（成功、失败、取消）时 resolve，进程已关；取消的 `message` 是 "cancelled"。
   * providerId 必须是 omp 登录 provider 列表里的 id，否则 reject；已有一个在进行时先结束它。
   */
  startTerminalLogin(providerId: string): Promise<LoginOutcome>;
  /** 结束正在进行的终端登录（关临时 omp）；没有时什么都不做。 */
  cancelTerminalLogin(): Promise<void>;
  listAccounts(providerId: string): Promise<LogoutAccount[]>;
  logout(providerId: string, credentialId: number): Promise<void>;
  /**
   * 设置某个 provider 的 API key：主进程经 `omp auth import` 存进 omp 自己的凭据库（和终端版共用），替换这个 provider 已有的 key，
   * OAuth 凭据不动。之后它是一条 `type: "api_key"` 的账号（listAccounts），清除走 logout。
   * key 只能从渲染进程发往主进程，主进程永远不回传。providerId 必须是能填 key 的 provider（shared/provider-keys.ts 的 acceptsApiKey）。
   */
  saveApiKey(providerId: string, key: string): Promise<void>;

  // 自定义模型：直接读写 omp 的 models.yml（src/main/omp-config/models-file.ts；规则见 AGENTS.md）
  /** 读 models.yml 里的 providers。key 只有状态，没有内容。文件读不懂时 reject。 */
  listCustomProviders(): Promise<CustomModelsFileInfo>;
  /** 新增（add）或修改（edit）一个 provider；校验不过返回 {ok:false, code}。成功后主进程关掉服务进程，下次读模型列表时 omp 重新加载。 */
  saveCustomProvider(mode: "add" | "edit", input: CustomProviderInput): Promise<CustomModelsOutcome>;
  deleteCustomProvider(providerId: string): Promise<CustomModelsOutcome>;
  /**
   * 改只覆盖 omp 内置 provider 的条目（比如 `anthropic` 下只有 `modelOverrides`）：`apiKey` 和 `modelOverrides` 里各模型的
   * 能力参数，条目里别的键不动；条目因此空了就删掉条目。key 只进不出。
   */
  saveProviderOverride(providerId: string, input: ProviderOverrideInput): Promise<CustomModelsOutcome>;
  /** 一键拉取：主进程 GET <baseUrl>/models。key 为 keep 时用文件里这个 provider 已有的 key。 */
  fetchProviderModels(request: FetchModelsRequest): Promise<FetchModelsOutcome>;
  /** 用系统默认程序打开 models.yml（还不存在时打开它所在的目录）。 */
  openModelsFile(): Promise<void>;
  /** 用系统默认程序打开 omp agent 目录的 `.env`（omp 启动时读它，环境变量形式的 key 常写在这里；还不存在时打开目录）。 */
  openEnvFile(): Promise<void>;
  /** 环境变量形式的 key：这个变量名现在设在哪（系统 / agent 目录的 `.env` / 都没有）。只回位置，不回值。 */
  envKeySource(name: string): Promise<EnvSource>;
  /** 跑 `omp models refresh`（强制重新拉各 provider 的模型目录，自动发现的模型也在内），完成后关掉服务进程，下次读模型列表时重新加载。omp 报错时抛出它的原话。 */
  refreshModels(): Promise<void>;

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
  /** 订阅账号额度总览：`omp usage --json`，只读。refresh=true 先 `omp usage invalidate` 清掉 omp 约 5 分钟的缓存再取。 */
  getUsageQuota(refresh: boolean): Promise<QuotaSnapshot>;
  /**
   * 近一年每日消耗，只读 omp 的 stats.db。refresh=true 先让 omp 自己跑一次 `omp stats --json` 同步新会话（首次可能要几分钟），
   * 再读；false 直接读现有的库。
   */
  getUsageHeatmap(refresh: boolean): Promise<UsageHeatmap>;
  // 插件和市场：`omp plugin …` CLI（src/main/plugins/plugin-cli.ts）。动作是封闭联合，渲染进程不传命令文本。
  /** 已装插件（npm / link / 市场）和已配置的市场。projectId 非空时在该项目目录里读，列表里多出该项目范围的安装。 */
  listPlugins(projectId: ProjectId | null): Promise<PluginsSnapshot>;
  /** 某个市场里可装的插件。 */
  discoverPlugins(marketplace: string): Promise<DiscoverEntry[]>;
  /** npm / link 插件的设置值和设置项（市场插件没有，会 reject）。 */
  getPluginConfig(plugin: string): Promise<PluginConfig>;
  /**
   * 安装 / 卸载 / 升级 / 启停 / 功能 / 设置 / 市场增删 / 诊断；text 是 omp 的结果句，doctor 时 checks 有内容。失败 reject，message 是 omp 的原话。
   * `action.scope === "project"` 时 projectId 必须非空：主进程用项目记录里的目录当 cwd 跑 `omp plugin … --scope project`。
   */
  runPluginAction(
    action: PluginAction,
    projectId: ProjectId | null,
  ): Promise<{ text: string; checks: DoctorCheck[] | null }>;
  // 设置 → 集成 → SSH 主机：`omp ssh … --json`（src/main/integrations/ssh.ts）。projectId 非空时在该项目目录里跑（项目范围的主机在 `.omp/ssh.json`）。
  /** 用户范围的主机；projectId 非空时再加上该项目的主机。 */
  listSshHosts(projectId: ProjectId | null): Promise<SshHost[]>;
  /** 添加一台主机；scope 为 project 时 projectId 必须非空。返回 omp 的结果句；omp 拒绝时 reject，message 是它的原话。 */
  addSshHost(input: SshHostInput, projectId: ProjectId | null): Promise<{ text: string }>;
  removeSshHost(name: string, scope: SshScope, projectId: ProjectId | null): Promise<{ text: string }>;
  /**
   * `omp skill list --json` 的结果（src/main/integrations/skills.ts）：projectId 为 null 是用户级，非空时再加上该项目目录里的；
   * 被 `disabledExtensions` 停用的 skill 补成"已停用"行。
   */
  listSkills(projectId: ProjectId | null): Promise<SkillEntry[]>;
  /** 停用 / 启用：经 `omp config get|set disabledExtensions` 只加减 `skill:<name>`（用户配置，对新任务生效）。 */
  setSkillEnabled(name: string, enabled: boolean): Promise<void>;
  /** 把 skill 文件夹移进回收站：主进程按名字和范围重新取 `baseDir` 并校验（插件带的 skill 会 reject）；scope 为 project 时 projectId 必须非空。 */
  removeSkill(name: string, scope: SkillScope, projectId: ProjectId | null): Promise<void>;
  /** 弹出选文件夹对话框并校验 SKILL.md；取消返回 null，不合法 reject（message 是原因）。路径留在主进程。 */
  pickSkillFolder(): Promise<SkillCandidate | null>;
  /** 把 `pickSkillFolder` 选中的文件夹复制到目标；scope 为 project 时 projectId 必须非空。同名文件夹已存在会 reject。返回 skill 名字。 */
  addSkill(
    token: string,
    target: SkillTarget,
    scope: SkillScope,
    projectId: ProjectId | null,
  ): Promise<{ name: string }>;
  // 设置 → 集成 → MCP 编辑：主进程直接读写 omp 自己的 mcp.json（用户级 agent 目录、项目 `.omp/`）里的 `mcpServers.<name>`（src/main/integrations/mcp-file.ts）。
  // 文件路径由主进程按范围算；scope 为 project 时 projectId 必须非空。token 的值不返回，只给"有没有"。
  /** 编辑表单的初值。 */
  getMcpServerFile(
    name: string,
    scope: McpEditScope,
    projectId: ProjectId | null,
  ): Promise<McpEditOutcome<McpServerFile>>;
  /** 只改表单管的字段；解析不了的文件、找不到的服务器不写，返回错误码。 */
  saveMcpServerFile(input: McpEditInput, projectId: ProjectId | null): Promise<McpEditOutcome<null>>;
  setReduceMotion(on: boolean): Promise<void>;
  setEnterWhileRunning(mode: "steer" | "followUp"): Promise<void>;
  setSoundOnDone(on: boolean): Promise<void>;
  setCopyOnSelect(on: boolean): Promise<void>;
  /** 记下用户已经确认过"全自动"，之后选它不再弹确认。 */
  setYoloConfirmed(): Promise<void>;
  /** 新任务实际会用的默认模型和思考强度：服务进程 get_state 读出的当前值；读不到（没登录、没有可用模型）时为 null。 */
  getDefaultModel(): Promise<DefaultModelInfo | null>;
  /** 工具行上次读到的数据（见 StartupSnapshot），只读文件，不问 omp。 */
  getStartupSnapshot(): Promise<StartupSnapshot>;
  /** projectId 为 null 时只看全局配置。 */
  getModelDefaults(projectId: ProjectId | null): Promise<ModelDefaults>;
  /** 项目目录里生效的 modelRoles（角色 → `provider/model[:thinking]` 原文）；projectId 为 null 时只看全局。 */
  getModelRoles(projectId: ProjectId | null): Promise<Record<string, string>>;
  /** 项目目录里生效的审批模式和来源；projectId 为 null 时只看全局配置。 */
  getApprovalMode(projectId: ProjectId | null): Promise<ApprovalModeInfo>;
  /**
   * 给某个角色（default、smol、task…）指定模型和思考强度（null = 不带强度后缀）；model 为 null = 去掉角色；default 即新任务的默认模型。
   * 一律写全局（`omp config set modelRoles`，值是 `provider/model[:thinking]`）。
   */
  setModelRole(role: string, model: ModelKey | null, thinking: string | null): Promise<void>;
  /** 模型选择对话框右栏的速度、智能分和压缩设置；只读 omp 的 agent.db / models.db / `omp config list`。 */
  getModelInsights(projectId: ProjectId | null, keys: ModelKey[]): Promise<ModelInsights>;
  /** 转发给 omp 的键位：默认键位加 `<agent 目录>/keybindings.yml` 的覆盖（只读），已去掉 studio 占用的键。 */
  getOmpKeybindings(): Promise<OmpKeybinding[]>;
  /** omp-studio 自身的更新状态（设置 → 关于）。 */
  getUpdateState(): Promise<UpdateState>;
  /** 手动检查更新；有可用更新时自动开始下载。 */
  checkForUpdate(): Promise<void>;
  /** 安装已下载的更新：先走退出流程关掉所有 omp 子进程，再安装并重新启动。 */
  installUpdate(): Promise<void>;

  // 评审（阶段 3）和 worktree / git（阶段 4）。路径一律相对仓库根；仓库根 = 任务 cwd 所在的 git 仓库（有 worktree 时是 worktree）。
  /** 任务 cwd 的 git 状态；不是仓库或没有 git 是正常的类型化结果，不 reject。 */
  getGitStatus(taskId: TaskId): Promise<GitStatus>;
  /** 一个文件一侧的 diff（结构化的 hunk 和新旧行号）；二进制和过大文件有对应的 kind。context = file 时整个文件连成一个 hunk（评审的"文件"视图），hunk 级操作只认 hunks。ignoreWhitespace = `git diff -w`，只影响显示，hunk / 行级操作不认。 */
  getGitFileDiff(
    taskId: TaskId,
    path: string,
    area: GitDiffArea,
    context: GitDiffContext,
    ignoreWhitespace: boolean,
  ): Promise<GitFileDiff>;
  /** 所有改动文件每一侧的 `+a −d`（评审文件树）；二进制、过大的文件没有这一项。 */
  getGitChangeStats(taskId: TaskId): Promise<GitChangeStat[]>;
  stageGitFile(taskId: TaskId, path: string): Promise<void>;
  unstageGitFile(taskId: TaskId, path: string): Promise<void>;
  /** 把文件的所有改动退回 HEAD（未跟踪的文件直接删除）。不确认，确认由界面做。 */
  discardGitFile(taskId: TaskId, path: string): Promise<void>;
  /** hunk 用 GitHunkRef 定位；diff 在两次调用之间变过时 reject（请刷新后重试）。 */
  stageGitHunk(taskId: TaskId, path: string, hunk: GitHunkRef): Promise<void>;
  unstageGitHunk(taskId: TaskId, path: string, hunk: GitHunkRef): Promise<void>;
  /** 丢弃一个没暂存的 hunk（area = unstaged 里看到的）。 */
  discardGitHunk(taskId: TaskId, path: string, hunk: GitHunkRef): Promise<void>;
  /** 暂存 / 取消暂存 / 丢弃 hunk 里选中的行（lines 是 hunk.lines 的下标）；hunk 变过时 reject。丢弃只针对没暂存的那一侧。 */
  stageGitLines(taskId: TaskId, path: string, ref: GitLinesRef): Promise<void>;
  unstageGitLines(taskId: TaskId, path: string, ref: GitLinesRef): Promise<void>;
  discardGitLines(taskId: TaskId, path: string, ref: GitLinesRef): Promise<void>;
  /** 校验每条评论的文件路径在任务目录内，格式化成一条消息（formatReviewComments）并作为 prompt 发出。 */
  sendReviewComments(taskId: TaskId, comments: ReviewComment[], whenBusy: PromptInput["whenBusy"]): Promise<void>;
  /** 草稿项目能不能开 worktree 任务（git 可用且目录正好是仓库根）及当前分支；不能为 null，顶栏就不显示草稿的分支胶囊。 */
  getDraftGit(projectId: ProjectId): Promise<DraftGitInfo | null>;
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
  /** stageAll 为 true 时先暂存全部；否则只提交已暂存的。amend 为 true 时改写上一次提交（不要求有暂存内容）；已推送的提交由界面先确认。 */
  commitGit(taskId: TaskId, message: string, stageAll: boolean, amend: boolean): Promise<GitCommitResult>;
  /** HEAD 的完整提交信息和是否已推送（提交框"修改上一次提交"）；还没有提交为 null。 */
  getLastCommit(taskId: TaskId): Promise<GitLastCommit | null>;
  /**
   * 用 omp 为已暂存的改动生成提交信息（`omp commit --dry-run`，模型是 omp 的 commit 角色）：不提交、不改文件。
   * 每个任务同时只有一次；没有暂存内容时不运行 omp（返回 nothing_staged）。
   */
  generateCommitMessage(taskId: TaskId): Promise<GitCommitMessageResult>;
  /** 取消这个任务正在进行的"生成提交信息"；没有进行中的就什么也不做。 */
  cancelCommitMessage(taskId: TaskId): Promise<void>;
  /** 推送当前分支（需要时设置 upstream），从不强推。 */
  pushGit(taskId: TaskId): Promise<GitPushResult>;
  /** `gh pr create`，基分支是任务的 worktreeBase（没有 worktree 时由 gh 决定）。 */
  createPullRequest(taskId: TaskId, input: GitPullRequestInput): Promise<GitPullRequestResult>;
  /** 用系统浏览器打开任务当前分支的 PR 页面（PR 号来自 omp 标题后缀 `TaskState.prNumber`，地址由分支的 remote 推出，只开 https）；没有 PR 或推不出地址时 reject。 */
  openTaskPullRequest(taskId: TaskId): Promise<void>;
}

export interface StudioEventPayloads {
  taskState: TaskState;
  taskRemoved: TaskId;
  /** 点了"等你确认"系统通知：主进程已聚焦窗口，渲染进程切到这个任务（selectTask）。 */
  focusTask: TaskId;
  tspBatch: TspBatch;
  taskNotice: TaskNotice;
  login: LoginEvent;
  ompStatus: OmpStatus;
  settings: StudioSettings;
  /** 用户把文件夹拖进了窗口，主进程已把它加入项目。 */
  projectDropped: Project;
  /** 用户把文件拖进了输入框 / 粘贴了文件：preload 取到路径交给主进程，主进程校验是普通文件后登记并推送（渲染进程拿不到路径）。 */
  composerFilesAdded: ComposerFile[];
  /** 新任务实际会用的默认模型变了（在 omp 设置里改了 modelRoles、defaultThinkingLevel 等）；null = 读不到。 */
  defaultModel: DefaultModelInfo | null;
  /** 主进程自己改了 omp 的设置（启动时 goal.continuationModes 的默认值）；设置页静默重读。 */
  ompConfigChanged: { key: string };
  /** 旁路提问的变化：新记录 / 生命周期变化（整条记录）、流式增量、整份对齐。 */
  btw: { taskId: TaskId; event: BtwUiEvent };
  /** 任务目录的项目 rpc-ui 主动推来的命令列表（`available_commands_update`：技能 / 扩展加载完、重新加载插件之后）。只含 omp 的列表，TUI 才有的命令由渲染进程合并。 */
  slashCommands: { taskId: TaskId; commands: AvailableSlashCommand[] };
  /** omp 往它自己的输入框里写了 studio 没发的文字（Ctrl+R 选中的历史、`/annotate`、`/plan` 预填）：主进程已清空 omp 那边，渲染进程把文字放进这个任务的草稿。 */
  composerPrefill: { taskId: TaskId; text: string };
  /** 终端输出（主进程已按 ~16ms 合并）。 */
  terminalData: { key: TerminalKey; data: string };
  /** 终端里的 shell 自己退出了（主动 closeTerminal 不发这个事件）。 */
  terminalExit: { key: TerminalKey; exitCode: number };
  /** omp-studio 自身的更新状态变化。 */
  updateState: UpdateState;
}

type StudioEventApi = {
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

/**
 * 拖入 / 粘贴到输入框的文件：同 dropFolderChannel，路径只在 preload 里取。载荷 `{ paths, paste }`；主进程把普通文件登记成 ComposerFile 并推送
 * composerFilesAdded，返回其余路径（目录等，只有粘贴时用得上：preload 把它们当文字插进输入框，和终端一样）。
 */
export const composerFilesChannel = "studio:composerFiles";

export const limits = {
  titleMaxChars: 200,
  promptMaxImages: 8,
  promptMaxFiles: 20,
  apiKeyMaxChars: 4096,
  /** 一次 writeTerminal 的最大字符数（粘贴大段文本时界面分块发）。 */
  terminalInputMaxChars: 65_536,
  terminalSizeRange: [2, 1000],
  terminalHeightRange: [120, 4000],
  urlMaxChars: 8192,
  maxLiveProcessesRange: [2, 16],
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
  setFontSize: true,
  openExternal: true,
  openLogsFolder: true,
  exportDiagnostics: true,
  getShellState: true,
  setShellState: true,
  setTitleBarDimmed: true,
  editField: true,
  listProjects: true,
  addProject: true,
  ensureChatsProject: true,
  removeProject: true,
  listTasks: true,
  createTask: true,
  openTask: true,
  getTspSnapshot: true,
  getTspSeq: true,
  getTspSessionExtras: true,
  readTspContext: true,
  sendTspEvent: true,
  sendTspKeys: true,
  resizeTsp: true,
  sendPrompt: true,
  stopTask: true,
  renameTask: true,
  archiveTask: true,
  listTaskModels: true,
  setTaskModel: true,
  setTaskThinkingLevel: true,
  setTaskFastMode: true,
  setTaskSlowMode: true,
  listSessions: true,
  resumeSession: true,
  ensureSessionProject: true,
  revealProject: true,
  revealTaskSession: true,
  getTaskSessionRef: true,
  getSessionModelUsage: true,
  // 会话信息、请求记录、分享（S3，docs/architecture/session-history.md）
  getTaskSessionInfo: true,
  getTaskSessionTrace: true,
  getShareSettings: true,
  shareTask: true,
  listSlashCommands: true,
  getDrafts: true,
  saveDraft: true,
  getInputHistory: true,
  recordInputHistory: true,
  compactTask: true,
  restartTask: true,
  runTaskCommand: true,
  runBuiltin: true,
  exportTaskHtml: true,
  revealTaskExport: true,
  taskGoal: true,
  openTaskFile: true,
  revealTaskFile: true,
  addWorkspaceDir: true,
  removeWorkspaceDir: true,
  refreshWorkspaceDirs: true,
  openTaskFolder: true,
  readPreviewFile: true,
  listDirectory: true,
  listProjectFiles: true,
  getSessionTree: true,
  forkTask: true,
  branchTask: true,
  labelTreeEntry: true,
  openTerminal: true,
  writeTerminal: true,
  resizeTerminal: true,
  closeTerminal: true,
  rekeyTerminal: true,
  askBtw: true,
  cancelBtw: true,
  getBtw: true,
  getTspSubagentRecord: true,
  focusTspSubagent: true,
  steerTspSubagent: true,
  killTspSubagent: true,
  reviveTspSubagent: true,
  listModels: true,
  listRunnerModels: true,
  listLoginProviders: true,
  startLogin: true,
  answerLoginInput: true,
  cancelLogin: true,
  startTerminalLogin: true,
  cancelTerminalLogin: true,
  listAccounts: true,
  logout: true,
  saveApiKey: true,
  listCustomProviders: true,
  saveCustomProvider: true,
  deleteCustomProvider: true,
  saveProviderOverride: true,
  fetchProviderModels: true,
  openModelsFile: true,
  openEnvFile: true,
  envKeySource: true,
  refreshModels: true,
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
  listPlugins: true,
  discoverPlugins: true,
  getPluginConfig: true,
  runPluginAction: true,
  listSshHosts: true,
  addSshHost: true,
  removeSshHost: true,
  listSkills: true,
  setSkillEnabled: true,
  removeSkill: true,
  pickSkillFolder: true,
  addSkill: true,
  getMcpServerFile: true,
  saveMcpServerFile: true,
  setReduceMotion: true,
  setEnterWhileRunning: true,
  setSoundOnDone: true,
  setCopyOnSelect: true,
  setYoloConfirmed: true,
  getDefaultModel: true,
  getStartupSnapshot: true,
  getModelDefaults: true,
  getModelRoles: true,
  setModelRole: true,
  getApprovalMode: true,
  getModelInsights: true,
  getOmpKeybindings: true,
  getUpdateState: true,
  checkForUpdate: true,
  installUpdate: true,
  getGitStatus: true,
  getGitFileDiff: true,
  getGitChangeStats: true,
  stageGitFile: true,
  unstageGitFile: true,
  discardGitFile: true,
  stageGitHunk: true,
  unstageGitHunk: true,
  discardGitHunk: true,
  stageGitLines: true,
  unstageGitLines: true,
  discardGitLines: true,
  sendReviewComments: true,
  getDraftGit: true,
  getWorktreeSetupScript: true,
  approveWorktreeSetup: true,
  getTaskWorktree: true,
  mergeTaskWorktree: true,
  discardTaskWorktree: true,
  cleanupOrphanWorktrees: true,
  commitGit: true,
  getLastCommit: true,
  generateCommitMessage: true,
  cancelCommitMessage: true,
  pushGit: true,
  createPullRequest: true,
  openTaskPullRequest: true,
} satisfies Record<keyof StudioInvokeApi, true>;

/** StudioEventPayloads 的全部事件名；订阅函数叫 `on` + 首字母大写的名字。 */
export const eventNames = {
  taskState: true,
  taskRemoved: true,
  focusTask: true,
  tspBatch: true,
  taskNotice: true,
  login: true,
  ompStatus: true,
  settings: true,
  projectDropped: true,
  composerFilesAdded: true,
  defaultModel: true,
  ompConfigChanged: true,
  btw: true,
  slashCommands: true,
  composerPrefill: true,
  updateState: true,
  terminalData: true,
  terminalExit: true,
} satisfies Record<keyof StudioEventPayloads, true>;

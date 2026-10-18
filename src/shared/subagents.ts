// 子代理泳道的数据类型。主进程的 SubagentTracker（src/main/tasks/subagent-tracker.ts）从 subagent_lifecycle / subagent_progress 帧聚合出来，
// 渲染进程只读。帧没有时间戳，所有 at / startedAt / endedAt 都是主进程接收时间（docs/architecture/subagents.md）。
import type { AgentMessage } from "./omp-wire/rpc-wire.generated.ts";

export type SubagentStatus = "running" | "completed" | "failed" | "aborted";

/** progress.recentTools 里的一条已结束的工具调用。 */
export interface SubagentTool {
  tool: string;
  /** progress 里的参数摘要（路径、命令……），不是完整参数。 */
  target: string | null;
  /** 参数摘要来自哪个字段（`path`、`command`……）。 */
  targetKey: string | null;
  intent: string | null;
  isError: boolean;
  /** 工具结束的时间（ms）：帧里有 endMs 用它，否则是主进程接收时间。 */
  at: number;
}

export interface SubagentLane {
  /** omp 给的名字，同时是泳道的键（`index` 不是全局序号）。 */
  id: string;
  /** 嵌套时父子代理的 id（按 `Parent.Child` 的点号规则，且父确实存在）；顶层为 null。 */
  parentId: string | null;
  /** 代理类型（`task` 等），不是名字。 */
  agent: string;
  description: string | null;
  /** 每次变化加一：渲染进程据此复用没变的泳道对象（IPC 反序列化每次都是新对象）。 */
  rev: number;
  /** progress.task：派活时的一句话。 */
  task: string | null;
  /** progress.assignment：完整任务说明（截断到 limits.assignmentChars）。 */
  assignment: string | null;
  detached: boolean | null;
  status: SubagentStatus;
  startedAt: number;
  endedAt: number | null;
  /** progress.resolvedModel 的模型部分和思考强度（`provider/model:high` 拆开）；还没有 progress 时为 null。 */
  model: string | null;
  thinkingLevel: string | null;
  modelIsFallback: boolean;
  lastIntent: string | null;
  toolCount: number;
  requests: number;
  /** 各次请求 input + output 之和，不含 cacheRead。 */
  tokens: number;
  cost: number;
  /** progress.durationMs（omp 自己量的时长）；还没有时为 null。 */
  durationMs: number | null;
  contextTokens: number | null;
  contextWindow: number | null;
  /** 已结束的工具调用，按时间升序，有上限（只保留最近的）。 */
  tools: SubagentTool[];
  /** tools 里成功的 edit / write / ast_edit 的路径（去重，保持首次出现的顺序）。完整改动以详情里的完整记录为准。 */
  touched: string[];
}

export interface SubagentDetail {
  lane: SubagentLane;
  /** get_subagent_messages 读到的完整记录（过长时只保留最近的）；读不到时为 null。 */
  messages: AgentMessage[] | null;
  /** messages 被截掉了更早的部分。 */
  truncated: boolean;
  /** messages 为 null 的原因：任务没有 omp 进程，或读取失败。 */
  unavailable: "no_process" | "error" | null;
  error: string | null;
}

export const subagentLimits = {
  /** 每个子代理保留的工具调用数。 */
  toolsPerLane: 200,
  /** 每个任务保留的泳道数；超出时先丢最早结束的。 */
  lanesPerTask: 100,
  assignmentChars: 4000,
  /** 详情里完整记录的消息条数上限。 */
  detailMessages: 300,
  /** 详情里完整记录的序列化大小上限（字节，近似）。 */
  detailBytes: 8 * 1024 * 1024,
  /** steer 消息的字符上限。 */
  steerChars: 20_000,
} as const;

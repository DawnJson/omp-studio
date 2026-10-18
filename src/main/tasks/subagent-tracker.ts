// 一个任务的子代理聚合：subagent_lifecycle + subagent_progress 帧 → SubagentLane 列表。纯逻辑，不碰 IO。
// 订阅级别是 `progress`（不开 `events`：两个只读一个文件的子代理 11 秒就 2.27 MB，见 docs/architecture/subagents.md）。
// 内存有界：每个子代理最多保留 toolsPerLane 条工具调用，每个任务最多 lanesPerTask 条泳道。
import type { SubagentLifecyclePayload, SubagentProgressPayload } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { subagentLimits, type SubagentLane, type SubagentStatus, type SubagentTool } from "../../shared/subagents.ts";

const editTools = new Set(["edit", "write", "ast_edit"]);
const pathKeys = new Set(["path", "file", "file_path"]);

interface Entry {
  lane: SubagentLane;
  sessionFile: string | null;
  /** 与 lane.tools 一一对应的去重键（progress 是累计快照，recentTools 在帧之间重叠）。 */
  keys: string[];
}

type Rec = Record<string, unknown>;

const str = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function progressStatus(value: unknown): SubagentStatus | null {
  switch (value) {
    case "completed":
    case "failed":
    case "aborted":
      return value;
    case "running":
    case "pending":
    case "started":
      return "running";
    default:
      return null;
  }
}

/** `deepseek/deepseek-v4-flash:high` → 模型 + 思考强度。冒号后不是思考强度的（模型名里本来就有冒号）不拆。 */
export function splitResolvedModel(
  resolved: string,
  thinking: string | null,
): { model: string; thinkingLevel: string | null } {
  if (thinking !== null && resolved.endsWith(`:${thinking}`))
    return { model: resolved.slice(0, -thinking.length - 1), thinkingLevel: thinking };
  return { model: resolved, thinkingLevel: thinking };
}

/** endMs 是 omp 所在机器的时钟；落在 [子代理开始 - 容差, 接收时间 + 容差] 之外的（录制回放、时钟不一致）改用接收时间。 */
const CLOCK_TOLERANCE_MS = 5_000;

function toolFrom(raw: unknown, at: number, startedAt: number): { key: string; tool: SubagentTool } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Rec;
  const name = str(record["tool"]);
  if (name === null) return null;
  const target = str(record["args"]);
  const endMs = num(record["endMs"]);
  const tool: SubagentTool = {
    tool: name,
    target,
    targetKey: str(record["argsKey"]),
    intent: str(record["intent"]),
    isError: record["isError"] === true,
    at: endMs !== null && endMs >= startedAt - CLOCK_TOLERANCE_MS && endMs <= at + CLOCK_TOLERANCE_MS ? endMs : at,
  };
  return { key: `${endMs ?? "-"}|${name}|${target ?? ""}|${tool.isError}`, tool };
}

function parentOf(id: string, known: ReadonlyMap<string, Entry>): string | null {
  for (let dot = id.lastIndexOf("."); dot > 0; dot = id.lastIndexOf(".", dot - 1)) {
    const candidate = id.slice(0, dot);
    if (known.has(candidate)) return candidate;
  }
  return null;
}

export class SubagentTracker {
  readonly #entries = new Map<string, Entry>();

  /** 泳道，按开始时间升序（Map 的插入顺序）。每次状态变化后返回新的数组，泳道对象本身不可变。 */
  lanes(): SubagentLane[] {
    return [...this.#entries.values()].map((entry) => entry.lane);
  }

  lane(id: string): SubagentLane | null {
    return this.#entries.get(id)?.lane ?? null;
  }

  sessionFile(id: string): string | null {
    return this.#entries.get(id)?.sessionFile ?? null;
  }

  get runningCount(): number {
    let count = 0;
    for (const entry of this.#entries.values()) if (entry.lane.status === "running") count++;
    return count;
  }

  /** 返回泳道是否有变化。 */
  lifecycle(payload: SubagentLifecyclePayload, at: number): boolean {
    let entry = this.#entries.get(payload.id);
    if (payload.status === "started") {
      // 同名且已结束的重新开始（omp 一般会换 -2 -3 后缀，防御一下）：整条换新。
      if (entry && entry.lane.status !== "running") {
        this.#entries.delete(payload.id);
        entry = undefined;
      }
    }
    if (!entry) {
      entry = this.#create(payload.id, payload.agent, at);
    }
    const lane = entry.lane;
    const status: SubagentStatus = payload.status === "started" ? "running" : payload.status;
    // 终态不会被迟到的 started 帧改回去。
    const nextStatus = lane.status !== "running" && status === "running" ? lane.status : status;
    entry.sessionFile = payload.sessionFile ?? entry.sessionFile;
    entry.lane = {
      ...lane,
      rev: lane.rev + 1,
      agent: payload.agent,
      description: payload.description ?? lane.description,
      detached: payload.detached ?? lane.detached,
      status: nextStatus,
      endedAt: nextStatus === "running" ? null : (lane.endedAt ?? at),
      parentId: lane.parentId ?? parentOf(payload.id, this.#entries),
    };
    this.#trim();
    return true;
  }

  progress(payload: SubagentProgressPayload, at: number): boolean {
    const raw = payload.progress;
    const id = str(raw["id"]);
    if (id === null) return false;
    let entry = this.#entries.get(id);
    if (!entry) entry = this.#create(id, payload.agent, at);
    entry.sessionFile = payload.sessionFile ?? entry.sessionFile;
    const lane = entry.lane;

    const tools = [...lane.tools];
    let touched = lane.touched;
    const recent = Array.isArray(raw["recentTools"]) ? (raw["recentTools"] as unknown[]) : [];
    for (const item of recent) {
      const parsed = toolFrom(item, at, lane.startedAt);
      if (!parsed || entry.keys.includes(parsed.key)) continue;
      entry.keys.push(parsed.key);
      tools.push(parsed.tool);
      const t = parsed.tool;
      if (
        editTools.has(t.tool) &&
        !t.isError &&
        t.target !== null &&
        t.targetKey !== null &&
        pathKeys.has(t.targetKey) &&
        !touched.includes(t.target)
      )
        touched = [...touched, t.target];
    }
    if (tools.length > subagentLimits.toolsPerLane) {
      const excess = tools.length - subagentLimits.toolsPerLane;
      tools.splice(0, excess);
      entry.keys.splice(0, excess);
    }

    const resolved = str(raw["resolvedModel"]);
    const thinking = str(raw["resolvedThinkingLevel"]);
    const model = resolved
      ? splitResolvedModel(resolved, thinking)
      : lane.model !== null
        ? { model: lane.model, thinkingLevel: lane.thinkingLevel }
        : null;
    const reported = progressStatus(raw["status"]);
    // lifecycle 帧是起止的权威；progress 只在泳道还在跑时推进状态（它可能先于 lifecycle 的终态帧到达，也可能带终态）。
    const status = lane.status === "running" && reported !== null ? reported : lane.status;
    const assignment = str(payload.assignment);
    entry.lane = {
      ...lane,
      rev: lane.rev + 1,
      agent: payload.agent,
      task: str(payload.task) ?? lane.task,
      assignment: assignment !== null ? assignment.slice(0, subagentLimits.assignmentChars) : lane.assignment,
      detached: payload.detached ?? lane.detached,
      status,
      endedAt: status === "running" ? null : (lane.endedAt ?? at),
      model: model?.model ?? null,
      thinkingLevel: model?.thinkingLevel ?? null,
      modelIsFallback: raw["resolvedModelIsFallback"] === true,
      lastIntent: str(raw["lastIntent"]) ?? lane.lastIntent,
      toolCount: num(raw["toolCount"]) ?? lane.toolCount,
      requests: num(raw["requests"]) ?? lane.requests,
      tokens: num(raw["tokens"]) ?? lane.tokens,
      cost: num(raw["cost"]) ?? lane.cost,
      durationMs: num(raw["durationMs"]) ?? lane.durationMs,
      contextTokens: num(raw["contextTokens"]) ?? lane.contextTokens,
      contextWindow: num(raw["contextWindow"]) ?? lane.contextWindow,
      tools,
      touched,
      parentId: lane.parentId ?? parentOf(id, this.#entries),
    };
    return true;
  }

  /** omp 进程退出：还在跑的子代理跟着没了。返回是否有变化。 */
  abortRunning(at: number): boolean {
    let changed = false;
    for (const entry of this.#entries.values()) {
      if (entry.lane.status !== "running") continue;
      entry.lane = { ...entry.lane, rev: entry.lane.rev + 1, status: "aborted", endedAt: at };
      changed = true;
    }
    return changed;
  }

  #create(id: string, agent: string, at: number): Entry {
    const entry: Entry = {
      lane: {
        id,
        parentId: parentOf(id, this.#entries),
        agent,
        description: null,
        task: null,
        assignment: null,
        detached: null,
        status: "running",
        startedAt: at,
        endedAt: null,
        model: null,
        thinkingLevel: null,
        modelIsFallback: false,
        lastIntent: null,
        toolCount: 0,
        requests: 0,
        tokens: 0,
        cost: 0,
        durationMs: null,
        contextTokens: null,
        contextWindow: null,
        tools: [],
        touched: [],
        rev: 0,
      },
      sessionFile: null,
      keys: [],
    };
    this.#entries.set(id, entry);
    return entry;
  }

  /** 超过上限时先丢最早结束的泳道；全都在跑就不丢。 */
  #trim(): void {
    while (this.#entries.size > subagentLimits.lanesPerTask) {
      let oldest: Entry | null = null;
      for (const entry of this.#entries.values()) {
        if (entry.lane.endedAt === null) continue;
        if (oldest === null || entry.lane.endedAt < (oldest.lane.endedAt ?? Infinity)) oldest = entry;
      }
      if (!oldest) return;
      this.#entries.delete(oldest.lane.id);
    }
  }
}

/** 详情里的完整记录：保留最近的 detailMessages 条，且序列化后不超过 detailBytes。 */
export function trimSubagentMessages<T>(messages: T[]): { messages: T[]; truncated: boolean } {
  let start = Math.max(0, messages.length - subagentLimits.detailMessages);
  let bytes = 0;
  for (let index = messages.length - 1; index >= start; index--) {
    bytes += JSON.stringify(messages[index]).length;
    if (bytes > subagentLimits.detailBytes) {
      start = index + 1;
      break;
    }
  }
  return start === 0 ? { messages, truncated: false } : { messages: messages.slice(start), truncated: true };
}

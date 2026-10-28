// TSP 任务的输入框卡片派生状态：模型、思考强度、上下文、费用、待办阶段、自动压缩信息、会话开关和 `/slow`，
// 都从 omp 发来的文档里读（composer-state.ts、toggles.ts 等），换算成 TaskState 的字段；变了才请宿主发布。
// 任务运行时（tsp-runner.ts）每次文档变化调用 `observe`。
import type { ModelKey, ModelOption, TaskId, TaskState } from "../../shared/ipc.ts";
import type { TspDocument } from "../../shared/tsp/document.ts";
import type { StatusNote } from "../../shared/tsp/status-notes.ts";
import { deriveComposerInfo, isShownModelName, type TspComposerInfo } from "../../shared/tsp/composer-state.ts";
import { deriveContextCompaction } from "../../shared/tsp/context-compaction.ts";
import {
  applyToggleObservation,
  emptySessionToggles,
  freshToasts,
  parseToggleToast,
  type SessionToggles,
} from "../../shared/omp-output/toggles.ts";
import type { ThinkingLevel } from "../../shared/omp-wire/rpc-wire.generated.ts";
import { log } from "../log/log.ts";
import { totalUsage, type SessionTotals, type SessionUsageAccumulator } from "../history/session-usage.ts";
import type { TaskRecord } from "./task-registry.ts";
import type { TspDocScans } from "./tsp-doc-scans.ts";

export interface TspComposerObserverHost {
  readonly taskId: TaskId;
  /** 任务记录（当前值）。 */
  record(): TaskRecord;
  /** 记进任务记录（宿主同时换掉它手里的记录）。 */
  persistRecord(patch: Partial<Omit<TaskRecord, "id">>): Promise<void>;
  /** 任务记录里的模型（构造时按目录解析好的）；没有为 null。 */
  ownModel(): ModelOption | null;
  /** 上次读到的模型目录。 */
  catalog(): ModelOption[];
  /** 启动缓存里上次的模型目录（只用来显示）：`catalog()` 还空着时按它认模型。 */
  knownModels(): ModelOption[];
  disposed(): boolean;
  /** 文档的扫描缓存（tsp-doc-scans.ts）。 */
  scans(document: TspDocument): TspDocScans;
  /** 当前会话文件的增量读取；还没有会话文件时为 null。 */
  readSessionFile(): Promise<{ usage: SessionUsageAccumulator } | null>;
  /** 状态变了，请发布。 */
  publish(): void;
}

export interface DerivedComposerState {
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

export class TspComposerObserver {
  readonly #host: TspComposerObserverHost;
  /** 输入框卡片上最后一次读到的值（输入框被提问/审批换掉的那几帧沿用）。 */
  #composer: TspComposerInfo = {
    modelName: null,
    effort: null,
    context: null,
    cost: null,
    subagentCost: null,
    fast: false,
  };
  #derived: DerivedComposerState = {
    model: null,
    thinkingLevel: null,
    thinkingLevels: [],
    contextUsage: null,
    sessionUsage: null,
    fastEnabled: false,
  };
  /** 刚在选择器里选的模型：目录里有重名的显示名时以它为准。 */
  chosenKey: ModelKey | null = null;
  /** 会话文件里当前分支上最后切到的模型（`#readTotals` 读）：没有刚选的时，重名靠它认 provider。 */
  #sessionModel: ModelKey | null = null;
  #persistingChoice = false;
  /** `/slow` 的状态：omp 没有状态节点，按 toast 记；一开始未知，当关。 */
  #slowEnabled = false;
  /** 会话开关（/skillful 等）：按 omp 的状态 toast 记（parseToggleToast），用户在输入框里自己敲的命令也同步；null 项 = 本会话没动过。 */
  #toggles: SessionToggles = emptySessionToggles();
  /** 上一次文档里的状态 toast 文字：只读新出现的那些（freshToasts）。 */
  #toastTexts: string[] = [];
  /** 已读过的状态行（`DocSurface.statusNotes` 里的对象；omp 原地换文字时那一条换成新对象，也算新的；toast 节点下一帧就没了，所以两条路都读）。 */
  #seenNotes = new WeakSet<StatusNote>();
  /** 文档里 HUD 待办节点换算出的阶段（todos.ts）；变了才发布。 */
  #todoPhases: TaskState["todoPhases"] = [];
  /** 输入框卡片上上下文 meter 里 omp 给的自动压缩信息（context-compaction.ts）；变了才发布。 */
  #contextCompaction: TaskState["contextCompaction"] = null;
  /** 会话文件里的 token 分项和请求数（见 #sessionUsageFor）。 */
  #totals: SessionTotals | null = null;
  /** `#refreshTotals` 的合并状态：正在读、读的时候是否又来了请求。 */
  #totalsReading = false;
  #totalsDirty = false;

  constructor(host: TspComposerObserverHost) {
    this.#host = host;
  }

  /** 输入框卡片上最后一次读到的值。 */
  get info(): TspComposerInfo {
    return this.#composer;
  }

  get derived(): DerivedComposerState {
    return this.#derived;
  }

  get todoPhases(): TaskState["todoPhases"] {
    return this.#todoPhases;
  }

  get contextCompaction(): TaskState["contextCompaction"] {
    return this.#contextCompaction;
  }

  get toggles(): SessionToggles {
    return this.#toggles;
  }

  get slowEnabled(): boolean {
    return this.#slowEnabled;
  }

  /** `/slow on|off` 的 toast 确认之后记下状态（发布由调用方做）。 */
  setSlowEnabled(enabled: boolean): void {
    this.#slowEnabled = enabled;
  }

  /** 新进程：开关是会话（进程）级的，从配置默认值开始。 */
  resetSession(): void {
    this.#toggles = emptySessionToggles();
    this.#toastTexts = [];
    this.#seenNotes = new WeakSet();
  }

  /** 文档变化：先读输入框卡片（`syncComposer`），再读新出现的状态 toast（`#syncToggles`）。 */
  observe(document: TspDocument): void {
    this.syncComposer(document);
    this.#syncToggles(document);
  }

  /**
   * omp 显示的模型名 → 模型：重名时先取刚选的、再取会话文件里当前的、再取记录里的，最后取目录里第一个；
   * 目录里没有时用名字造一个只显示用的。
   * 目录还没读到（任务刚起来，服务进程的目录要一两秒）时先按启动缓存里上次的目录认，不然这段时间胶囊上没有思考档位。
   */
  #resolveModel(name: string): ModelOption {
    const live = this.#host.catalog();
    const catalog = live.length > 0 ? live : this.#host.knownModels();
    const candidates = catalog.filter((option) => isShownModelName(option.name, name));
    const own = this.#host.ownModel();
    if (own && isShownModelName(own.name, name) && !candidates.some((option) => sameKey(option.key, own.key)))
      candidates.push(own);
    const preferred = [this.chosenKey, this.#sessionModel, this.#host.record().model];
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
    const texts = this.#host.scans(document).toastTexts;
    const notes = [...document.live].flatMap((sf) => document.surfaces.get(sf)?.statusNotes ?? []);
    const freshNotes = notes.filter((note) => !this.#seenNotes.has(note));
    for (const note of freshNotes) this.#seenNotes.add(note);
    const fresh = [...freshNotes.map((note) => note.text), ...freshToasts(this.#toastTexts, texts)];
    this.#toastTexts = texts;
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
    if (changed) this.#host.publish();
  }

  /**
   * 本会话用量：费用是 omp 输入框卡片上的值；token 分项和请求数 omp 的 TSP 卡片不给，从会话文件读（`#refreshTotals`）。
   * 读到之前 token 是 0。不用 stats.db 的 session_rollup：它只在 `omp stats` 运行时才同步，
   * 对正在进行的会话是旧的；会话信息对话框里才用它（session-info/session-stats.ts）。
   */
  #sessionUsageFor({ cost, subagentCost }: TspComposerInfo): TaskState["sessionUsage"] {
    if (cost === null) return null;
    const totals = this.#totals;
    return {
      tokens: totals?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost,
      subagentCost: subagentCost ?? 0,
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
      } while (this.#totalsDirty && !this.#host.disposed());
    } finally {
      this.#totalsReading = false;
    }
  }

  async #readTotals(): Promise<void> {
    try {
      const session = await this.#host.readSessionFile();
      if (session === null || this.#host.disposed()) return;
      const totals = totalUsage(session.usage.summary().models);
      const sessionModel = session.usage.currentModel();
      const sameModel =
        sessionModel === null || this.#sessionModel === null
          ? sessionModel === this.#sessionModel
          : sameKey(sessionModel, this.#sessionModel);
      if (sameModel && JSON.stringify(totals) === JSON.stringify(this.#totals)) return;
      this.#totals = totals;
      this.#sessionModel = sessionModel;
      this.#derive();
    } catch (error) {
      log.warn("reading the session file for token totals failed", {
        taskId: this.#host.taskId,
        message: String(error),
      });
    }
  }

  /** 文档变化时调用：把输入框卡片上的模型名、思考强度、上下文、费用换算成 TaskState 的字段；变了才发布。 */
  syncComposer(document: TspDocument): void {
    // 待办 HUD 没变时缓存给同一个数组，不用再比内容。
    const todoPhases = this.#host.scans(document).todoPhases;
    if (todoPhases !== this.#todoPhases) {
      const changed = JSON.stringify(todoPhases) !== JSON.stringify(this.#todoPhases);
      this.#todoPhases = todoPhases;
      if (changed) this.#host.publish();
    }
    // 输入框被提问 / 审批换掉的那几帧（undefined）沿用上一次的值。
    const compaction = deriveContextCompaction(document);
    if (compaction !== undefined && JSON.stringify(compaction) !== JSON.stringify(this.#contextCompaction)) {
      this.#contextCompaction = compaction;
      this.#host.publish();
    }
    const info = deriveComposerInfo(document);
    if (!info) return; // 输入框被提问/审批换掉的那几帧：保留上一次的值
    const previous = this.#composer;
    const composer: TspComposerInfo = {
      modelName: info.modelName ?? previous.modelName,
      effort: info.effort ?? previous.effort,
      context: info.context ?? previous.context,
      cost: info.cost ?? previous.cost,
      subagentCost: info.subagentCost ?? previous.subagentCost,
      fast: info.fast,
    };
    this.#composer = composer;
    // 费用或上下文用量变了 = 又结束了一次请求：会话文件里的 token 分项和请求数也该重读（见 #refreshTotals）。
    // 不能只看费用：费用读不出来（omp 改了写法）或一直是 0 时，token 分项会永远停在 0。
    // 模型名变了 = 切了模型（omp 往会话文件记了 model_change）：重读认出是哪一家。
    if (
      composer.cost !== previous.cost ||
      composer.context?.tokens !== previous.context?.tokens ||
      composer.modelName !== previous.modelName
    )
      void this.#refreshTotals();
    this.#derive();
  }

  /** 按输入框卡片上最后读到的值、会话文件里的用量和模型算 TaskState 的字段；变了才发布。 */
  #derive(): void {
    const composer = this.#composer;
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
    const next: DerivedComposerState = {
      model,
      thinkingLevel,
      thinkingLevels: thinkingLevelsOf(model),
      contextUsage,
      sessionUsage: this.#sessionUsageFor(composer),
      fastEnabled: composer.fast,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(this.#derived);
    this.#derived = next;
    if (changed) this.#host.publish();
    void this.#persistModelChoice(model, thinkingLevel);
  }

  /**
   * 把当前模型和思考强度记进任务记录（下次 `--resume` 起来用）。只记目录里确有、且不会认错的模型：
   * 显示用的占位（provider 为空）和目录里重名、又没有明确选择或会话文件佐证的不记（记错 provider 会让下次 `--model` 指到别家）。
   */
  async #persistModelChoice(model: ModelOption | null, thinkingLevel: ThinkingLevel | null): Promise<void> {
    if (this.#persistingChoice || this.#host.disposed()) return;
    const record = this.#host.record();
    const patch: Partial<Omit<TaskRecord, "id">> = {};
    // 先做便宜的比较：模型和记录里的一样（绝大多数消息）就不用去目录里数重名。
    if (
      model !== null &&
      model.key.provider !== "" &&
      !(record.model && sameKey(model.key, record.model)) &&
      ((this.chosenKey !== null && sameKey(model.key, this.chosenKey)) ||
        (this.#sessionModel !== null && sameKey(model.key, this.#sessionModel)) ||
        this.#host.catalog().filter((option) => option.name === model.name).length === 1)
    )
      patch.model = model.key;
    if (thinkingLevel !== null && thinkingLevel !== record.thinkingLevel) patch.thinkingLevel = thinkingLevel;
    if (Object.keys(patch).length === 0) return;
    this.#persistingChoice = true;
    try {
      await this.#host.persistRecord(patch);
    } catch (error) {
      log.warn(`task ${this.#host.taskId} persisting the model choice failed`, { message: String(error) });
    } finally {
      this.#persistingChoice = false;
    }
  }
}

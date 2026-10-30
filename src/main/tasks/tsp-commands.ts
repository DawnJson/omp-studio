// TSP 任务的会话命令：切模型 / 思考强度、读上下文报告、斜杠命令（`/compact` `/handoff` `/todo` 模式命令、`/goal`、`/fast` `/slow`）。
// 都是往 omp 的输入框发命令（或点输入框卡片上的控件）再等 omp 的回应；一律串在任务的界面操作队列里（宿主的 `exclusive`）。
import type { ContextReport, ModelKey, TaskState } from "../../shared/ipc.ts";
import type { TspDocument } from "../../shared/tsp/document.ts";
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
import { compactionMark, compactionOutcome } from "../../shared/tsp/compaction.ts";
import { errorLines, newErrorLine } from "../../shared/tsp/error-lines.ts";
import { ACTION_CONTEXT_REPORT, findContextReport } from "../../shared/tsp/context-report.ts";
import { deriveTaskStatus } from "../../shared/tsp/task-status.ts";
import { findMessageTarget } from "../../shared/tsp/gate.ts";
import { GOAL_TOASTS, findGoalDropPrompt } from "../../shared/tsp/goal.ts";
import {
  deriveComposerFacts,
  modeCommandBlocker,
  modeCommandDone,
  type ModeOp,
} from "../../shared/tsp/composer-facts.ts";
import type { ThinkingLevel, GoalOp } from "../../shared/omp-wire/rpc-wire.generated.ts";
import type { TspSession } from "../tsp/tsp-session.ts";
import type { TspGoalTracker } from "./tsp-goal.ts";

/** 切模型、切思考强度时等 omp 响应的上限：选择器（要读模型目录）打开、确认提示出现。 */
export const PICKER_TIMEOUT_MS = 8_000;
export const CONFIRM_TIMEOUT_MS = 5_000;
export const ESC_KEY = "\x1b";
/** `runQuietCommand` 观察 toast 的时长；到点没有 toast 就算成功。 */
const QUIET_SETTLE_MS = 1_500;
/** `/compact` 要调模型：等压缩结局的上限。 */
const COMPACT_TIMEOUT_MS = 5 * 60_000;
const QUIET_SETTLED = "quiet-settled";
/** 思考强度循环的最多步数（omp 最多 8 个级别，转满一圈就不会再有新的）。 */
const MAX_THINKING_CYCLES = 10;

export interface TspCommandsHost {
  /** 起进程并等握手完成（已在运行时立即返回）。 */
  start(): Promise<void>;
  /** 当前会话；没有进程为 null。 */
  session(): TspSession | null;
  /** 当前会话；没有进程时抛错。 */
  liveSession(): TspSession;
  /** 等输入框就绪（不往审批里发）。 */
  awaitComposer(): Promise<{ sf: string; id: string }>;
  awaitDocument<T>(
    check: (document: TspDocument) => T | null,
    timeoutMs: number,
    timeoutMessage: string,
    checkNow?: boolean,
  ): Promise<T>;
  /** 任务的界面操作队列（一次只做一个）。 */
  exclusive<T>(job: () => Promise<T>): Promise<T>;
  /** 输入框卡片上最后一次读到的值。 */
  composerInfo(): TspComposerInfo;
  /** 刚在选择器里选的模型（读 / 写）。 */
  chosenKey(): ModelKey | null;
  setChosenKey(key: ModelKey | null): void;
  /** 按当前文档重读输入框卡片（没有进程时什么也不做）。 */
  syncComposer(): void;
  /** `/slow` 确认之后：记下状态并发布。 */
  setSlowEnabled(enabled: boolean): void;
  goal: Pick<TspGoalTracker, "goal" | "expectObjective">;
}

export class TspCommands {
  readonly #host: TspCommandsHost;

  constructor(host: TspCommandsHost) {
    this.#host = host;
  }

  async #composerTargets(): Promise<TspComposerTargets & { session: TspSession }> {
    await this.#host.start();
    await this.#host.awaitComposer();
    const session = this.#host.session();
    if (!session) throw new Error("the omp process exited");
    const targets = findComposerTargets(session.document);
    if (!targets) throw new Error(TSP_COMPOSER_UNAVAILABLE);
    return { ...targets, session };
  }

  /**
   * 切模型：点 omp 输入框上的模型胶囊（action `status.model` = Alt+P）打开选择器，在选择器里 `activate` 那一项
   * （item id 就是 `provider/model`）；omp 关掉选择器并给出 "Session-only model: <id>" 的提示（或输入框的模型名变了）才算完成。
   * 会话上下文比目标模型的窗口大时，omp 先用当前模型压缩、压缩完才切（omp 18.14.0 实测，fixtures/tsp/switch-compact*.jsonl）：
   * 选择器当场关掉、dock 里出现压缩行，这时改按压缩的上限等。omp 写出的错误行（如压缩失败）原文抛出，模型没换。
   */
  setModel(key: ModelKey): Promise<void> {
    return this.#host.exclusive(async () => {
      const id = `${key.provider}/${key.modelId}`;
      const { sf, model, session } = await this.#composerTargets();
      if (model === null) throw new Error("omp's model switcher is not available");
      const nameBefore = this.#host.composerInfo().modelName;
      session.sendEvent({ ev: "action", sf, id: model, act: ACTION_PICK_MODEL });
      const picker = await this.#host.awaitDocument(
        (document) => findPicker(document),
        PICKER_TIMEOUT_MS,
        "omp's model picker did not open in time",
      );
      if (!picker.items.includes(id)) {
        session.sendKeys(ESC_KEY);
        throw new Error(`model ${id} is not available in omp`);
      }
      const previousChoice = this.#host.chosenKey();
      this.#host.setChosenKey(key);
      const errorsBefore = errorLines(session.document);
      session.sendEvent({ ev: "activate", sf: picker.sf, id: picker.id, item: id });
      /** 这次切换的结局：切过去了 error 为 null，omp 报了错是它的原文；还没有结局为 null。 */
      const outcome = (document: TspDocument): { error: string | null } | null => {
        const error = newErrorLine(document, errorsBefore);
        if (error !== null) return { error };
        if (findPicker(document) !== null) return null;
        const confirmed = statusToastTexts(document).some((text) => text.includes(`Session-only model: ${id}`));
        const renamed = deriveComposerInfo(document)?.modelName;
        return confirmed || (renamed !== undefined && renamed !== null && renamed !== nameBefore)
          ? { error: null }
          : null;
      };
      try {
        let result = await this.#host.awaitDocument(
          (document) =>
            outcome(document) ??
            (findPicker(document) === null && deriveComposerFacts(document).compaction !== null
              ? ("compacting" as const)
              : null),
          CONFIRM_TIMEOUT_MS,
          `omp did not confirm switching to ${id}`,
        );
        if (result === "compacting")
          result = await this.#host.awaitDocument(
            outcome,
            COMPACT_TIMEOUT_MS,
            `omp did not finish compacting before switching to ${id}`,
          );
        if (result.error !== null) {
          // 别的错误（没有 key 等，未实测）选择器可能还开着：关掉它，别挡着输入框。
          if (findPicker(session.document) !== null) session.sendKeys(ESC_KEY);
          throw new Error(result.error);
        }
      } catch (error) {
        this.#host.setChosenKey(previousChoice);
        throw error;
      }
      this.#host.syncComposer();
    });
  }

  /**
   * 切思考强度：反复点 omp 的思考强度节点（action `thinking.cycle` = ⇧⇥）直到显示目标级别。omp 按模型支持的级别循环
   * （实测 deepseek-v4-pro：high → max → off → auto → low → high…），转满一圈还没有就是这个模型不支持。
   */
  setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return this.#host.exclusive(async () => {
      const { sf, effort, session } = await this.#composerTargets();
      if (effort === null) throw new Error("omp's thinking effort control is not available");
      const start = deriveComposerInfo(session.document)?.effort ?? null;
      if (start === level) return;
      let shown = start;
      for (let step = 0; step < MAX_THINKING_CYCLES; step += 1) {
        const before = shown;
        session.sendEvent({ ev: "action", sf, id: effort, act: ACTION_CYCLE_THINKING });
        shown = await this.#host.awaitDocument(
          (document) => {
            const current = deriveComposerInfo(document)?.effort ?? null;
            return current !== null && current !== before ? current : null;
          },
          CONFIRM_TIMEOUT_MS,
          "omp did not change the thinking effort",
        );
        if (shown === level) {
          this.#host.syncComposer();
          return;
        }
        if (shown === start) break;
      }
      throw new Error(`thinking level ${level} is not available for this model`);
    });
  }

  /**
   * omp 现算的上下文构成：点输入框上的上下文 meter（action `status.context`），omp 当场按会话现在的状态算一遍并弹出报告
   * （shared/tsp/context-report.ts），读完点报告的 Close。运行中也能读：正在生成的回复按已生成的部分算进 Messages。
   * 渲染进程在调用期间不画 layer（tsp-store 的 drive），报告不会闪一下。
   * 没有进程、输入框被提问 / 审批 / 全屏面板占着（报告会盖住它们）时为 null。
   */
  readContext(): Promise<ContextReport | null> {
    return this.#host.exclusive(async () => {
      const session = this.#host.session();
      if (!session) return null;
      const gate = findMessageTarget(session.document);
      if (gate.kind !== "ready" || gate.approval) return null;
      const targets = findComposerTargets(session.document);
      if (targets?.context == null) return null;
      session.sendEvent({ ev: "action", sf: targets.sf, id: targets.context, act: ACTION_CONTEXT_REPORT });
      const shown = await this.#host.awaitDocument(
        findContextReport,
        PICKER_TIMEOUT_MS,
        "omp did not show its context report",
      );
      if (shown.close === null) throw new Error("omp's context report has no Close button");
      session.sendEvent({ ev: "action", sf: shown.sf, id: shown.close.id, act: shown.close.act });
      await this.#host.awaitDocument(
        (document) => (findContextReport(document) === null ? true : null),
        CONFIRM_TIMEOUT_MS,
        "omp did not close its context report",
      );
      return shown.report;
    });
  }

  /**
   * 把 `/命令` 当普通 `send` 交给 omp（实测:单独的 `/fast`、`/slow`、`/fast on` 在空闲和运行中都当命令执行；`/model <id>`
   * 带参数的当普通消息），等 omp 的状态 toast，返回它的原文。`success` 判定哪条 toast 算成功（返回 true 就返回该 toast）；
   * 没给时，第一条新出现的 toast 就是结果。给了 `success` 而出现新的、不满足它的 toast 就当失败，原文抛出。
   * 局限：和发送前完全相同的 toast 文字认不出是新的（omp 每次复用同一个 toast 节点，只换文字）。
   */
  async #runSlash(text: string, success?: (toast: string) => boolean): Promise<string> {
    await this.#host.start();
    const target = await this.#host.awaitComposer();
    const session = this.#host.liveSession();
    const before = statusToastTexts(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
    return this.#host.awaitDocument(
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
    return this.#host.exclusive(() => this.#runSlash(text, success));
  }

  /**
   * 成功时 omp 不发 toast、出错才发的会话命令（`/jobs kill <id>|all`，实测 18.12.5：成功只是作业卡片变 cancelled，
   * 未知 id 是 `No running background job with id "x".`，缺参数是 `Usage: /jobs kill <id>|all`）。
   * 发出后观察 `QUIET_SETTLE_MS`：出现新 toast 就以原文 reject，没出现算成功，返回 ""。
   */
  runQuietCommand(text: string): Promise<string> {
    return this.#host.exclusive(async () => {
      await this.#host.start();
      const target = await this.#host.awaitComposer();
      const session = this.#host.liveSession();
      const before = statusToastTexts(session.document);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      try {
        return await this.#host.awaitDocument<string>(
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
    return this.#host.exclusive(() => this.#runCompaction("/compact"));
  }

  /** `/handoff`：总结会话成交接文档并就地压缩，结局的判定和 `/compact` 相同（omp 18.12.6 实测见 docs/architecture/context-compaction.md）。 */
  handoff(): Promise<void> {
    return this.#host.exclusive(() => this.#runCompaction("/handoff"));
  }

  async #runCompaction(text: "/compact" | "/handoff"): Promise<void> {
    await this.#host.start();
    const target = await this.#host.awaitComposer();
    const session = this.#host.liveSession();
    const before = compactionMark(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
    const outcome = await this.#host.awaitDocument(
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
    return this.#host.exclusive(async () => {
      await this.#host.start();
      const target = await this.#host.awaitComposer();
      const session = this.#host.liveSession();
      const toastsBefore = statusToastTexts(session.document);
      const errorsBefore = errorLines(session.document);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      return this.#host.awaitDocument(
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

  // ───── 模式（/plan /vibe /loop） ─────

  /**
   * 模式命令（`/plan` `/plan-review` `/vibe` `/loop`，shared/tsp/composer-facts.ts 的 `ModeOp`）：它们是切换，所以发之前看当前模式
   * （`modeCommandBlocker`），发出后等模式变成预期的样子或 omp 弹出确认 / 评审弹窗（`modeCommandDone`）。
   * 没生效而 omp 给了状态 toast（"Exit goal mode first."、"Plan mode is disabled. …"）= 被拒，原文 reject；返回生效时的 toast 原文（可能为空串）。
   */
  runModeCommand(op: ModeOp, text: string): Promise<string> {
    return this.#host.exclusive(async () => {
      await this.#host.start();
      const target = await this.#host.awaitComposer();
      const session = this.#host.liveSession();
      const before = deriveComposerFacts(session.document).mode;
      const blocker = modeCommandBlocker(op, before);
      if (blocker !== null) throw new Error(blocker);
      const toastsBefore = statusToastTexts(session.document);
      session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text });
      return this.#host.awaitDocument(
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
    if (op === "get") return Promise.resolve(this.#host.goal.goal);
    if (op === "create") {
      // omp 的输入框一行一条命令：换行折成空格（目标文字本来就是一句话的任务描述）。
      const text = (objective ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
      if (text === "") return Promise.reject(new Error("goal objective is empty"));
      return this.#host.exclusive(() => this.#createGoal(text));
    }
    if (op === "drop") return this.#host.exclusive(() => this.#dropGoal());
    return this.#host.exclusive(async () => {
      await this.#runSlash(`/goal ${op}`, (toast) => GOAL_TOASTS[op].test(toast));
      return this.#host.goal.goal;
    });
  }

  async #createGoal(objective: string): Promise<TaskState["goal"]> {
    await this.#host.start();
    const target = await this.#host.awaitComposer();
    const session = this.#host.liveSession();
    const before = statusToastTexts(session.document);
    const tracker = this.#host.goal;
    const hadGoal = tracker.goal !== null;
    tracker.expectObjective(objective);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: `/goal ${objective}` });
    try {
      await this.#host.awaitDocument(
        (document) => {
          const fresh = statusToastTexts(document).find((toast) => !before.includes(toast));
          if (fresh !== undefined) throw new Error(fresh);
          return !hadGoal && tracker.goal !== null ? true : null;
        },
        CONFIRM_TIMEOUT_MS,
        "omp did not confirm creating the goal",
      );
    } catch (error) {
      if (!hadGoal) tracker.expectObjective("");
      throw error;
    }
    return tracker.goal;
  }

  async #dropGoal(): Promise<TaskState["goal"]> {
    await this.#host.start();
    const target = await this.#host.awaitComposer();
    const session = this.#host.liveSession();
    const before = statusToastTexts(session.document);
    session.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: "/goal drop" });
    const prompt = await this.#host.awaitDocument(
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
    await this.#host.awaitDocument(
      (document) => (findGoalDropPrompt(document) === null && this.#host.goal.goal === null ? true : null),
      CONFIRM_TIMEOUT_MS,
      "omp did not confirm dropping the goal",
    );
    return null;
  }

  // ───── 快速/慢速模式 ─────

  /** `/fast on|off`。模型不支持时 omp 的 toast 原文作为错误抛出。 */
  setFastMode(enabled: boolean): Promise<void> {
    return this.#host.exclusive(async () => {
      if (enabled && this.#host.composerInfo().fast) return;
      await this.#runSlash(enabled ? "/fast on" : "/fast off", (toast) =>
        (enabled ? /^Fast mode enabled/ : /^Fast mode disabled/).test(toast),
      );
      this.#host.syncComposer();
    });
  }

  /** `/slow on|off`。omp 的界面上没有慢速模式的状态节点，状态按它的 toast（"Slow mode on: …" / "Slow mode off: …"）记。 */
  setSlowMode(enabled: boolean): Promise<void> {
    return this.#host.exclusive(async () => {
      const hit = /^Slow mode (on|off)/.exec(
        await this.#runSlash(enabled ? "/slow on" : "/slow off", (toast) => /^Slow mode (on|off)/.test(toast)),
      );
      this.#host.setSlowEnabled(hit?.[1] === "on");
    });
  }
}

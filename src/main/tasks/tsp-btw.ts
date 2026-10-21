// TSP 任务的旁路提问（`/btw`，docs/architecture/tsp-btw.md）：omp 在 TSP 下把它画成 layer 里的 modal 弹窗（role omp.overlay.btwHistory），
// 不碰主对话。studio 自己的面板（features/btw）显示它，所以这里把弹窗里的问答读成和 rpc 一样的 BtwHistoryRecord 镜像（`#records`），
// 用同一组 BtwUiEvent 推给渲染进程；渲染进程不画 omp 的弹窗（shared/tsp/btw.ts isBtwOverlayNode）。
//
// 数据来源：
//  - 实时：文档里的弹窗（shared/tsp/btw.ts findBtwView），每次文档变化时 `sync`；答案流式追加 → delta 事件。
//  - 历史和话题 id：会话旁边的 btw-history/ 目录（main/tsp/btw-history.ts）。只有一个话题时弹窗里没有话题 id，所以先用临时 id
//    （live:N），读到磁盘记录后换成真 id（mergeBtwDisk）；`ask` 返回前会等一小会儿让它换好，面板选中的就是真 id。
// 动作（事件序列依据 omp 18.12.5 录制 fixtures/tsp/btw.jsonl）：
//    提问  `send "/btw <问题>"`（主输入框）→ 弹窗出现（新的 overlayId，第一问 = 问题）
//    追问  [`/btw` 打开历史] → [`select` 话题] → `action follow-up` → 追问输入框出现 → `edit` 填字 → `action send` → 新的一问出现
//    取消  `action stop`
//    收尾  回答结束（不再有 running 的一问）、没有在写追问时 `action close`：弹窗是 modal，不关会一直开着（主输入框照常能发，
//          但 Esc 会落在它上面）；关掉之前答案已经在镜像里。
// 提问 / 追问在任务的界面操作队列里（#exclusive）做，期间 `setDriving(true)`：TspRunner 不往主会话发别的消息（追问输入框打开时
// 主输入框的 `send` 会被 omp 吞掉，实测）。
import { setTimeout as sleep } from "node:timers/promises";
import { btwLimits, interruptBtw, isBtwRunning, type BtwHistoryRecord, type BtwUiEvent } from "../../shared/btw.ts";
import {
  btwButtonEvent,
  btwEventsFor,
  btwFillEvent,
  btwSelectEvent,
  btwViewRunning,
  findBtwView,
  mergeBtwDisk,
  normalizeBtwQuestion,
  PROVISIONAL_BTW_PREFIX,
  resolveViewRecordId,
  viewToRecord,
  isProvisionalBtwId,
  type BtwAct,
  type BtwView,
} from "../../shared/tsp/btw.ts";
import type { TspDocument } from "../../shared/tsp/document.ts";
import type { TspEvent } from "../../shared/tsp/tsp.generated.ts";
import { log } from "../log/log.ts";
import { readBtwHistory } from "../tsp/btw-history.ts";

/** 弹窗出现、追问输入框出现、新的一问出现各自等 omp 的上限。 */
export const BTW_OPEN_TIMEOUT_MS = 8_000;
export const BTW_STEP_TIMEOUT_MS = 6_000;
/** 提问后等磁盘记录落下来（换真 id）：次数 × 间隔；等不到就用临时 id，之后读到再换。 */
const ID_POLLS = 6;
const ID_POLL_MS = 150;

/** 和 rpc 的 omp 一致的拒绝文案（面板据此提示）。 */
export const BTW_STILL_RUNNING = "A /btw question is still running; cancel it first";

export interface BtwHost {
  /** 当前文档（原地更新）；没有进程为 null。 */
  document(): TspDocument | null;
  sendEvent(event: TspEvent): void;
  awaitDocument<T>(check: (document: TspDocument) => T | null, timeoutMs: number, timeoutMessage: string): Promise<T>;
  /** 起进程并等主输入框就绪（有提问 / 审批 / 全屏面板时 reject，同 sendPrompt 之外的命令）。 */
  composer(): Promise<{ sf: string; id: string }>;
  /** 任务的界面操作队列（一次只做一个）。 */
  exclusive<T>(job: () => Promise<T>): Promise<T>;
  /** omp 报告的会话文件；还没有为 null。 */
  sessionFile(): string | null;
  emit(event: BtwUiEvent): void;
  /** 驱动期间为 true：宿主不往主会话发别的消息；变回 false 时唤醒它们。 */
  setDriving(on: boolean): void;
}

export class TspBtw {
  readonly #host: BtwHost;
  #records: readonly BtwHistoryRecord[] = [];
  #file: string | null = null;
  #provisionalSeq = 0;
  #driving = false;
  /** 已经发过 close 的弹窗（overlayId）：同一个弹窗不重复发。 */
  #closedOverlay: string | null = null;
  #reloading: Promise<void> = Promise.resolve();

  constructor(host: BtwHost) {
    this.#host = host;
  }

  get records(): readonly BtwHistoryRecord[] {
    return this.#records;
  }

  // ───── 镜像 ─────

  #setRecords(records: readonly BtwHistoryRecord[]): void {
    this.#records = records.length > btwLimits.records ? records.slice(0, btwLimits.records) : records;
    this.#host.emit({ type: "records", records: [...this.#records] });
  }

  #upsert(record: BtwHistoryRecord): void {
    const index = this.#records.findIndex((candidate) => candidate.id === record.id);
    const prev = index === -1 ? undefined : this.#records[index];
    const events = btwEventsFor(prev, record);
    if (events.length === 0) return;
    if (index === -1) {
      this.#records = [record, ...this.#records].sort((a, b) => b.createdAt - a.createdAt).slice(0, btwLimits.records);
    } else {
      this.#records = this.#records.map((candidate, i) => (i === index ? record : candidate));
    }
    for (const event of events) this.#host.emit(event);
  }

  /** 文档每次变化时调用：把弹窗里的问答并进镜像；没有人在驱动、一问已经收尾就把弹窗关掉。 */
  sync(document: TspDocument): void {
    const view = findBtwView(document);
    if (view === null) {
      this.#closedOverlay = null;
      return;
    }
    if (view.turns.length > 0) {
      const id = resolveViewRecordId(view, this.#records) ?? `${PROVISIONAL_BTW_PREFIX}${++this.#provisionalSeq}`;
      const base = this.#records.find((record) => record.id === id);
      const record = viewToRecord(view, id, base, Date.now());
      if (record) this.#upsert(record);
    }
    if (!this.#driving) this.#closeIfDone(view);
  }

  #closeIfDone(view: BtwView): void {
    if (view.turns.length === 0 || btwViewRunning(view) || view.composer !== null) return;
    if (this.#closedOverlay === view.overlayId) return;
    const close = btwButtonEvent(view, "close");
    if (!close) return;
    this.#closedOverlay = view.overlayId;
    this.#host.sendEvent(close);
  }

  /** 进程退出：还在回答的一问标成 interrupted（omp 重读历史时也这么标）。 */
  reset(): void {
    this.#closedOverlay = null;
    if (!isBtwRunning(this.#records)) return;
    this.#setRecords(interruptBtw(this.#records, Date.now()));
  }

  // ───── 历史 ─────

  /** 读磁盘上的话题并进镜像（串行；会话文件换了就丢掉旧会话的镜像）。没有会话文件时什么也不做。 */
  reload(): Promise<void> {
    const run = this.#reloading.then(() => this.#reload());
    this.#reloading = run.catch(() => undefined);
    return run;
  }

  async #reload(): Promise<void> {
    const file = this.#host.sessionFile();
    if (file === null) return;
    if (this.#file !== null && this.#file !== file) this.#records = [];
    this.#file = file;
    const disk = await readBtwHistory(file);
    const merged = mergeBtwDisk(this.#records, disk);
    if (JSON.stringify(merged.records) === JSON.stringify(this.#records)) return;
    this.#setRecords(merged.records);
  }

  /** getBtw：先对齐磁盘，再给镜像。读不了磁盘时给镜像现状并记日志（不为它起进程）。 */
  async history(): Promise<BtwHistoryRecord[]> {
    await this.reload().catch((error: unknown) => log.warn("reading btw history failed", { message: String(error) }));
    return [...this.#records];
  }

  // ───── 动作 ─────

  /** 提问（recordId 为 undefined 开新话题，否则追问）；返回话题 id（omp 开始回答之后）。 */
  async ask(question: string, recordId: string | undefined): Promise<string> {
    const text = question.trim();
    if (text === "") throw new Error("btw requires a non-empty question");
    await this.reload().catch((error: unknown) => log.warn("reading btw history failed", { message: String(error) }));
    if (isBtwRunning(this.#records)) throw new Error(BTW_STILL_RUNNING);
    if (recordId !== undefined && !this.#records.some((record) => record.id === recordId))
      throw new Error(`Unknown /btw topic: ${recordId}`);
    return this.#host.exclusive(async () => {
      const target = await this.#host.composer();
      this.#driving = true;
      this.#host.setDriving(true);
      try {
        return recordId === undefined
          ? await this.#askNew(target, text)
          : await this.#askFollowUp(target, text, recordId);
      } finally {
        this.#driving = false;
        this.#host.setDriving(false);
        const document = this.#host.document();
        if (document) this.sync(document);
      }
    });
  }

  #view(): BtwView | null {
    const document = this.#host.document();
    return document ? findBtwView(document) : null;
  }

  #click(view: BtwView, act: BtwAct): void {
    const event = btwButtonEvent(view, act);
    if (!event) throw new Error(`omp's side-question window has no ${act} button`);
    this.#host.sendEvent(event);
  }

  async #askNew(target: { sf: string; id: string }, question: string): Promise<string> {
    const prior = this.#view()?.overlayId ?? null;
    const wanted = normalizeBtwQuestion(question);
    this.#host.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: `/btw ${question}` });
    await this.#host.awaitDocument(
      (document) => {
        const view = findBtwView(document);
        const first = view?.turns[0];
        return view && view.overlayId !== prior && first && normalizeBtwQuestion(first.question) === wanted
          ? view
          : null;
      },
      BTW_OPEN_TIMEOUT_MS,
      "omp did not open the side question (is a /btw question already running?)",
    );
    const document = this.#host.document();
    if (document) this.sync(document);
    return this.#realId(wanted);
  }

  /** 镜像里这条问题的话题 id；临时 id 的等磁盘记录落下来换成真的（等不到就先用临时的）。 */
  async #realId(wanted: string): Promise<string> {
    for (let attempt = 0; ; attempt += 1) {
      const record = this.#records.find((candidate) => normalizeBtwQuestion(candidate.question) === wanted);
      if (record && (!isProvisionalBtwId(record.id) || attempt >= ID_POLLS || this.#host.sessionFile() === null))
        return record.id;
      if (!record && attempt >= ID_POLLS) throw new Error("omp did not record the side question");
      await this.reload().catch(() => undefined);
      await sleep(ID_POLL_MS);
    }
  }

  async #askFollowUp(target: { sf: string; id: string }, question: string, recordId: string): Promise<string> {
    let view = this.#view();
    if (view !== null && view.overlayId === this.#closedOverlay) {
      // 刚发了 close（上一问收尾后自动关的），omp 还没撤掉弹窗：等它撤掉再开历史，不在要关的弹窗里操作。
      await this.#host.awaitDocument(
        (document) => (findBtwView(document) === null ? true : null),
        BTW_STEP_TIMEOUT_MS,
        "omp did not close the side-question window",
      );
      view = null;
    }
    if (view?.composer) {
      this.#click(view, "discard");
      view = await this.#awaitView((candidate) => candidate.composer === null, "omp did not close the follow-up box");
    }
    if (view === null) {
      this.#host.sendEvent({ ev: "send", sf: target.sf, id: target.id, text: "/btw" });
      view = await this.#awaitView(() => true, "omp did not open the side-question history", BTW_OPEN_TIMEOUT_MS);
    }
    if (resolveViewRecordId(view, this.#records) !== recordId) {
      const select = btwSelectEvent(view, recordId);
      if (!select) throw new Error(`Unknown /btw topic: ${recordId}`);
      this.#host.sendEvent(select);
      view = await this.#awaitView(
        (candidate) => candidate.list?.selected === recordId,
        "omp did not select the side-question topic",
      );
    }
    view = await this.#awaitView(
      (candidate) => candidate.buttons["follow-up"] !== undefined,
      "omp offers no follow-up on this topic",
    );
    this.#click(view, "follow-up");
    view = await this.#awaitView((candidate) => candidate.composer !== null, "omp did not open the follow-up box");
    const turnsBefore = view.turns.length;
    const fill = btwFillEvent(view, question);
    if (!fill) throw new Error("omp's follow-up box is gone");
    this.#host.sendEvent(fill);
    view = await this.#awaitView(
      (candidate) => candidate.composer?.text === question,
      "omp did not take the follow-up text",
    );
    this.#click(view, "send");
    await this.#awaitView(
      (candidate) => candidate.turns.length > turnsBefore && candidate.composer === null,
      "omp did not start the follow-up",
    );
    return recordId;
  }

  async #awaitView(
    check: (view: BtwView) => boolean,
    message: string,
    timeoutMs = BTW_STEP_TIMEOUT_MS,
  ): Promise<BtwView> {
    return this.#host.awaitDocument(
      (document) => {
        const view = findBtwView(document);
        return view !== null && check(view) ? view : null;
      },
      timeoutMs,
      message,
    );
  }

  /**
   * 停止主轮之前先让开 omp 的旁路提问弹窗：弹窗开着时 Esc 会落在它上面（取消旁路提问），不会停主轮。
   * 回答中先 stop，再 close，等弹窗撤掉；没有弹窗什么也不做。让不开时记日志、照常往下走（调用方接着发 Esc）。
   */
  async yieldToMain(): Promise<void> {
    let view = this.#view();
    if (view === null) return;
    try {
      if (view.composer) {
        this.#click(view, "discard");
        view = await this.#awaitView((candidate) => candidate.composer === null, "omp did not close the follow-up box");
      }
      if (btwViewRunning(view)) {
        this.#click(view, "stop");
        const settled = await this.#host.awaitDocument(
          (document) => {
            const current = findBtwView(document);
            return current === null || !btwViewRunning(current) ? { view: current } : null;
          },
          BTW_STEP_TIMEOUT_MS,
          "omp did not stop the side question",
        );
        if (settled.view === null) return;
        view = settled.view;
      }
      // 收尾后 sync 可能已经自动发了 close（#closedOverlay）；没发过才发。
      if (this.#closedOverlay !== view.overlayId) {
        this.#closedOverlay = view.overlayId;
        this.#click(view, "close");
      }
      await this.#host.awaitDocument(
        (document) => (findBtwView(document) === null ? true : null),
        BTW_STEP_TIMEOUT_MS,
        "omp did not close the side-question window",
      );
    } catch (error) {
      log.warn("clearing the side-question window before stop failed", { message: String(error) });
    }
  }

  /** 取消在跑的一问（面板的取消按钮、Esc）；没有在跑的、或 recordId 不是它：false。 */
  cancel(recordId: string | undefined): boolean {
    const view = this.#view();
    if (view === null || !btwViewRunning(view)) return false;
    if (recordId !== undefined && resolveViewRecordId(view, this.#records) !== recordId) return false;
    this.#click(view, "stop");
    return true;
  }
}

// 推给渲染进程的 TSP 批次（`tspBatch` 事件）：只推渲染进程有镜像的任务（拉快照时登记、镜像释放时注销），blob 消息只带 id
// （字节按需 getTspBlob 取）。窗口藏着（托盘里、最小化）时一条也不推，只记下压下的序号；窗口出来时给这些任务各补一个越过空档的空批次，
// 渲染进程按丢帧重拉快照（renderer tsp-sync.ts 的 resync），画面直接到最新。
// 不 import electron：窗口状态由 tsp-feed-instance.ts 接进来，单元测试直接实例化。
import type { TaskId, TspBatch, TspFeedBatch, TspFeedMessage } from "../../shared/ipc.ts";

export class TspFeed {
  readonly #emit: (batch: TspFeedBatch) => void;
  readonly #mirrored = new Set<TaskId>();
  /** 窗口藏着时压下的批次：任务 → 压下的第一条和最后一条消息的序号。 */
  readonly #held = new Map<TaskId, { first: number; last: number }>();
  #hidden = false;

  constructor(emit: (batch: TspFeedBatch) => void) {
    this.#emit = emit;
  }

  /** 渲染进程要拉这个任务的快照（在取快照之前调）：之后的批次推给它。 */
  mirror(taskId: TaskId): void {
    this.#mirrored.add(taskId);
  }

  /** 渲染进程丢掉了这个任务的镜像。 */
  release(taskId: TaskId): void {
    this.#mirrored.delete(taskId);
    this.#held.delete(taskId);
  }

  /** 渲染进程换了（页面重载、窗口重建）：它的镜像全没了。 */
  reset(): void {
    this.#mirrored.clear();
    this.#held.clear();
  }

  /** 窗口看不看得见；变成看得见时，压下过批次的任务各收到一个空批次，firstSeq 在压下的最后一条之后，渲染进程据此重拉快照。 */
  setHidden(hidden: boolean): void {
    if (hidden === this.#hidden) return;
    this.#hidden = hidden;
    if (hidden) return;
    for (const [taskId, { last }] of this.#held) this.#emit({ taskId, firstSeq: last + 1, messages: [] });
    this.#held.clear();
  }

  push(batch: TspBatch): void {
    if (!this.#mirrored.has(batch.taskId)) return;
    if (this.#hidden) {
      const held = this.#held.get(batch.taskId);
      this.#held.set(batch.taskId, {
        first: held?.first ?? batch.firstSeq,
        last: batch.firstSeq + batch.messages.length - 1,
      });
      return;
    }
    this.#emit({
      taskId: batch.taskId,
      firstSeq: batch.firstSeq,
      messages: batch.messages.map((message): TspFeedMessage =>
        message.verb === "b" ? { verb: "b", id: message.id.toLowerCase() } : message,
      ),
    });
  }

  /**
   * getTspSeq 的结果：主进程的序号 `seq`；压着这个任务的批次时是压下之前推出去的最后一条——
   * 渲染进程等镜像追上它（endTspDrive），不能让它等到窗口出来。
   */
  delivered(taskId: TaskId, seq: number): number {
    const held = this.#held.get(taskId);
    return held === undefined ? seq : held.first - 1;
  }
}

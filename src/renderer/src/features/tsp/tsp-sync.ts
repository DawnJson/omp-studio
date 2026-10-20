// TSP 文档镜像的同步规则（纯函数，不碰 window）：批次的 firstSeq 必须不超过本地 seq + 1；
// 超过说明丢了帧，要重新拉快照；已应用过的前缀跳过。同 transcript-sync.ts 的做法。
import type { TspBatch } from "../../../../shared/ipc.ts";

export type TspBatchPlan =
  /** 还没有镜像（任务没打开过）：不接收，打开时拉快照。 */
  | { kind: "ignore" }
  | { kind: "resync" }
  /** 从 batch.messages 的第 skip 条开始应用。 */
  | { kind: "apply"; skip: number };

export function planTspBatch(seq: number | undefined, batch: Pick<TspBatch, "firstSeq" | "messages">): TspBatchPlan {
  if (seq === undefined) return { kind: "ignore" };
  if (batch.firstSeq > seq + 1) return { kind: "resync" };
  const skip = seq + 1 - batch.firstSeq;
  if (skip >= batch.messages.length) return { kind: "ignore" };
  return { kind: "apply", skip };
}

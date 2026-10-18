// 对话流镜像的同步规则（纯函数，不碰 window）：批次的 firstSeq 必须不超过本地 seq + 1；
// 超过说明丢了帧要重新拉快照；已应用过的前缀跳过。transcript-store 只负责把结果落到 store。
import type { TranscriptBatch } from "../../../shared/ipc.ts";
import { applyTranscriptEvent, type Transcript } from "../../../shared/transcript.ts";

export interface Mirror {
  seq: number;
  transcript: Transcript;
}

export type BatchOutcome = { kind: "ignore" } | { kind: "resync" } | { kind: "apply"; mirror: Mirror };

export function planBatch(mirror: Mirror | undefined, batch: TranscriptBatch): BatchOutcome {
  // 还没有快照的任务（没打开过）不接收事件；打开时 openTask 会带回完整快照。
  if (!mirror) return { kind: "ignore" };
  if (batch.firstSeq > mirror.seq + 1) return { kind: "resync" };
  const fresh = batch.events.slice(mirror.seq + 1 - batch.firstSeq);
  if (fresh.length === 0) return { kind: "ignore" };
  return {
    kind: "apply",
    mirror: { seq: mirror.seq + fresh.length, transcript: fresh.reduce(applyTranscriptEvent, mirror.transcript) },
  };
}

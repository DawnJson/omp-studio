// 对话流镜像：每个任务一份 { seq, transcript }。
// 同步协议（ipc.ts TranscriptBatch）：批次的 firstSeq 必须不超过本地 seq + 1；超过说明丢了帧，调 getTranscript 重新拉快照。
// 已经应用过的前缀（firstSeq 小于等于 seq）跳过，所以快照和事件批次的重叠、重复推送都是安全的。
import type { TaskId, TranscriptBatch, TranscriptSnapshot } from "../../../shared/ipc.ts";
import { applyTranscriptEvent, type Transcript } from "../../../shared/transcript.ts";
import { createStore, useStoreValue } from "./create-store.ts";

interface Mirror {
  seq: number;
  transcript: Transcript;
}

const mirrors = createStore<Readonly<Record<string, Mirror>>>({});
const resyncing = new Set<string>();

export function applyTranscriptSnapshot(snapshot: TranscriptSnapshot): void {
  mirrors.set({ ...mirrors.get(), [snapshot.taskId]: { seq: snapshot.seq, transcript: snapshot.transcript } });
}

function resync(taskId: TaskId): void {
  if (resyncing.has(taskId)) return;
  resyncing.add(taskId);
  window.studio.getTranscript(taskId).then(
    (snapshot) => {
      resyncing.delete(taskId);
      applyTranscriptSnapshot(snapshot);
    },
    (error: unknown) => {
      resyncing.delete(taskId);
      console.error("getTranscript 失败", error);
    },
  );
}

function applyBatch(batch: TranscriptBatch): void {
  const mirror = mirrors.get()[batch.taskId];
  // 还没有快照的任务（没打开过）不接收事件；打开时 openTask 会带回完整快照。
  if (!mirror) return;
  if (batch.firstSeq > mirror.seq + 1) {
    resync(batch.taskId);
    return;
  }
  const skip = mirror.seq + 1 - batch.firstSeq;
  const fresh = batch.events.slice(skip);
  if (fresh.length === 0) return;
  const transcript = fresh.reduce(applyTranscriptEvent, mirror.transcript);
  mirrors.set({ ...mirrors.get(), [batch.taskId]: { seq: mirror.seq + fresh.length, transcript } });
}

export function startTranscriptStore(): void {
  window.studio.onTranscript(applyBatch);
  window.studio.onTaskRemoved((taskId) => {
    const { [taskId]: _removed, ...rest } = mirrors.get();
    mirrors.set(rest);
  });
}

/** 任务的对话流；还没拿到快照（任务没打开过）时为 null。 */
export function useTranscript(taskId: TaskId | null): Transcript | null {
  return useStoreValue(mirrors, (state) => (taskId === null ? null : (state[taskId]?.transcript ?? null)));
}

// TSP 任务的后台作业（S2Jobs，推导见 shared/tsp/jobs.ts）：每个任务一份已知作业，TSP 文档每应用一批消息、且作业相关的节点（JOBS_NODES）变了，就并一次快照。
// 动作也在这里：结束作业（`/jobs kill`，主进程拼命令）、打开 omp 自己的作业弹窗（作业列表、输出和取消都在那里，
// omp 没有别的通道；由 studio 的 TspView 渲染，再把选中项切到指定的作业）。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import {
  agentStatuses,
  deriveTspJobs,
  findJobsHudSeg,
  findJobsOverlayItem,
  JOBS_NODES,
  markJobsCancelled,
  mergeTspJobs,
  sameJobs,
} from "../../../../shared/tsp/jobs.ts";
import type { TspDocument } from "../../../../shared/tsp/document.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { peekTspDocument, peekTspWatched, subscribeTspBatches } from "../tsp/tsp-store.ts";

const NO_JOBS: readonly Job[] = [];
const states = new Map<TaskId, Job[]>();
const listeners = new Map<TaskId, Set<() => void>>();
const detach = new Map<TaskId, () => void>();
/** 上次并快照时的文档和 JOBS_NODES 的 version：都没变就跳过（纯文字流式输出的批次不再整篇扫描）。 */
const merged = new Map<TaskId, { doc: TspDocument; version: number }>();

function notify(taskId: TaskId): void {
  for (const listener of listeners.get(taskId) ?? []) listener();
}

function set(taskId: TaskId, next: Job[]): void {
  if (sameJobs(states.get(taskId) ?? NO_JOBS, next)) return;
  states.set(taskId, next);
  notify(taskId);
}

// 任务被移除：丢掉它的作业快照。
window.studio.onTaskRemoved((taskId) => {
  states.delete(taskId);
  merged.delete(taskId);
});

function refresh(taskId: TaskId): void {
  const watched = peekTspWatched(taskId, JOBS_NODES);
  if (!watched) return;
  const last = merged.get(taskId);
  if (last?.doc === watched.doc && last.version === watched.version) return;
  merged.set(taskId, watched);
  const { doc } = watched;
  const now = Date.now();
  const agents = agentStatuses(doc);
  set(taskId, mergeTspJobs(states.get(taskId) ?? NO_JOBS, deriveTspJobs(doc, agents, now), agents, now));
}

function subscribe(taskId: TaskId, listener: () => void): () => void {
  let set_ = listeners.get(taskId);
  if (!set_) listeners.set(taskId, (set_ = new Set()));
  set_.add(listener);
  if (!detach.has(taskId)) {
    detach.set(
      taskId,
      subscribeTspBatches(taskId, () => refresh(taskId)),
    );
    refresh(taskId);
  }
  return () => {
    set_.delete(listener);
    if (set_.size === 0) {
      listeners.delete(taskId);
      detach.get(taskId)?.();
      detach.delete(taskId);
    }
  };
}

/** 本任务已知的后台作业（TSP）。 */
export function useTspJobs(taskId: TaskId): readonly Job[] {
  const sub = useMemo(() => (listener: () => void) => subscribe(taskId, listener), [taskId]);
  return useSyncExternalStore(sub, () => states.get(taskId) ?? NO_JOBS);
}

/** 本任务已知的后台作业，不订阅（斜杠命令用；输入框上方的 ComposerTop 一直订阅着，所以是新的）。 */
export function peekTspJobs(taskId: TaskId): readonly Job[] {
  return states.get(taskId) ?? NO_JOBS;
}

/** 结束作业（`id` 或 "all"）：主进程拼 `/jobs kill <id>`；成功后把运行中的记为已取消（omp 成功时没有任何回应，实测 18.12.5）。出错抛 omp 的 toast 原文。 */
export async function killTspJob(taskId: TaskId, id: string): Promise<void> {
  await window.studio.runTaskCommand(taskId, { kind: "jobsKill", id });
  set(taskId, markJobsCancelled(states.get(taskId) ?? NO_JOBS, id, Date.now()));
}

const OPEN_TIMEOUT_MS = 4000;

/**
 * 打开 omp 的作业弹窗并选中这个作业：hud 上有作业胶囊就点它（动作 `jobs.open`），没有就发 `/jobs`（经 sendPrompt 直达 omp，
 * 不走 studio 的斜杠拦截）；弹窗出现后发 `select` 把右边的详情切到这个作业。弹窗里没有这个作业（omp 已经不列了）时停在弹窗上。
 */
export async function openTspJobs(taskId: TaskId, jobId: string): Promise<void> {
  const selectIn = (): boolean => {
    const doc = peekTspDocument(taskId);
    const target = doc ? findJobsOverlayItem(doc, jobId) : null;
    if (!target) return false;
    void window.studio.sendTspEvent(taskId, { ev: "select", sf: target.sf, id: target.list, item: target.item });
    return true;
  };
  if (selectIn()) return;
  const doc = peekTspDocument(taskId);
  const seg = doc ? findJobsHudSeg(doc) : null;
  const { promise: opened, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(() => {
    stop();
    resolve();
  }, OPEN_TIMEOUT_MS);
  const stop = subscribeTspBatches(taskId, () => {
    if (!selectIn()) return;
    clearTimeout(timer);
    stop();
    resolve();
  });
  if (seg) await window.studio.sendTspEvent(taskId, { ev: "action", sf: seg.sf, id: seg.id, act: "jobs.open" });
  else await window.studio.sendPrompt(taskId, { text: "/jobs", whenBusy: "steer" });
  await opened;
}

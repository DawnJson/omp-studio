// TSP 任务的后台作业（S2Jobs，推导见 shared/tsp/jobs.ts）：每个任务一份已知作业，TSP 文档每应用一批消息就并一次快照。
// 弹层里的动作也在这里：结束作业（`/jobs kill`，主进程拼命令）、查看 bash 输出（omp 只有 `/jobs` 弹窗里有输出，
// 没有别的通道，所以让 omp 打开它自己的弹窗，由 studio 的 TspView 渲染，再把选中项切到这个作业）。
// 另有一个"打开作业弹层"的请求计数（`/jobs` 斜杠命令用）。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import {
  deriveTspJobs,
  findJobsHudSeg,
  findJobsOverlayItem,
  markJobsCancelled,
  mergeTspJobs,
  sameJobs,
} from "../../../../shared/tsp/jobs.ts";
import type { Job } from "../../../../shared/ui/jobs.ts";
import { peekTspDocument, subscribeTspBatches } from "../tsp/tsp-store.ts";

const NO_JOBS: readonly Job[] = [];
const states = new Map<TaskId, Job[]>();
const listeners = new Map<TaskId, Set<() => void>>();
const detach = new Map<TaskId, () => void>();

function notify(taskId: TaskId): void {
  for (const listener of listeners.get(taskId) ?? []) listener();
}

function set(taskId: TaskId, next: Job[]): void {
  if (sameJobs(states.get(taskId) ?? NO_JOBS, next)) return;
  states.set(taskId, next);
  notify(taskId);
}

function refresh(taskId: TaskId): void {
  const doc = peekTspDocument(taskId);
  if (!doc) return;
  const now = Date.now();
  set(taskId, mergeTspJobs(states.get(taskId) ?? NO_JOBS, deriveTspJobs(doc, now), doc, now));
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

/** 本任务已知的后台作业（TSP）；`enabled` 为 false（rpc 任务）时不订阅，返回空。 */
export function useTspJobs(taskId: TaskId, enabled: boolean): readonly Job[] {
  const sub = useMemo(
    () => (listener: () => void) => (enabled ? subscribe(taskId, listener) : () => undefined),
    [taskId, enabled],
  );
  return useSyncExternalStore(sub, () => (enabled ? (states.get(taskId) ?? NO_JOBS) : NO_JOBS));
}

/** 结束作业（`id` 或 "all"）：主进程拼 `/jobs kill <id>`；成功后把运行中的记为已取消（omp 成功时没有任何回应，实测 18.12.5）。出错抛 omp 的 toast 原文。 */
export async function killTspJob(taskId: TaskId, id: string): Promise<void> {
  await window.studio.runTaskCommand(taskId, { kind: "jobsKill", id });
  set(taskId, markJobsCancelled(states.get(taskId) ?? NO_JOBS, id, Date.now()));
}

const OPEN_TIMEOUT_MS = 4000;

/**
 * 查看 bash 作业的输出：让 omp 打开 `/jobs` 弹窗（hud 上有作业胶囊就点它——动作 `jobs.open`；没有就发 `/jobs`，经 sendPrompt 直达 omp，
 * 不走 studio 的斜杠拦截），弹窗出现后发 `select` 把右边的详情切到这个作业。弹窗里没有这个作业（omp 已经不列了）时停在弹窗上。
 */
export async function viewTspJobOutput(taskId: TaskId, jobId: string): Promise<void> {
  const selectIn = (): boolean => {
    const doc = peekTspDocument(taskId);
    const item = doc ? findJobsOverlayItem(doc, jobId) : null;
    if (!item) return false;
    void window.studio.sendTspEvent(taskId, { ev: "select", sf: item.sf, id: item.id, item: item.id });
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

// ───────── "打开作业弹层"请求（`/jobs`） ─────────

const requests = new Map<TaskId, number>();
const requestListeners = new Set<() => void>();

export function requestOpenJobs(taskId: TaskId): void {
  requests.set(taskId, (requests.get(taskId) ?? 0) + 1);
  for (const listener of requestListeners) listener();
}

/** 这个任务收到过几次"打开作业弹层"请求；组件挂载时记下当前值，之后变大才是新请求。 */
export function useJobsOpenRequests(taskId: TaskId): number {
  const sub = useMemo(
    () => (listener: () => void) => {
      requestListeners.add(listener);
      return () => requestListeners.delete(listener);
    },
    [],
  );
  return useSyncExternalStore(sub, () => requests.get(taskId) ?? 0);
}

/** 非 hook：现在有没有已知作业（`/jobs` 在 TSP 任务里决定是开弹层还是提示没有）。 */
export function peekTspJobCount(taskId: TaskId): number {
  return (states.get(taskId) ?? NO_JOBS).length;
}

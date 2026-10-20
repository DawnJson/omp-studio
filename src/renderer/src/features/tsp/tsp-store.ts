// TSP 文档的渲染进程镜像：每个任务一份 { seq, doc }。
// 同步协议（ipc.ts TspBatch）：批次的 firstSeq 必须不超过本地 seq + 1，超过说明丢了帧，调 getTspSnapshot 重新拉；
// 拉快照期间到达的批次先攒着，快照落地后接着应用，所以快照和事件批次的重叠、乱序都是安全的（规则见 tsp-sync.ts）。
//
// 文档（Map）原地改，节点记录不可变：订阅按 (任务, surface, 节点 id) 登记，应用一批消息后只通知 `changed` 里出现的节点，
// 组件用 useTspNode 拿到的记录引用没变就不会重画。
import { useMemo, useSyncExternalStore } from "react";
import type { TaskId, TspBatch } from "../../../../shared/ipc.ts";
import {
  applyMessage,
  restoreDocument,
  type DocBlob,
  type DocNode,
  type DocSurface,
  type TspDocMessage,
  type TspDocument,
} from "../../../../shared/tsp/document.ts";
import { planTspBatch } from "./tsp-sync.ts";

interface Mirror {
  seq: number;
  doc: TspDocument;
}

const SEP = "\u0000";
const mirrors = new Map<TaskId, Mirror>();
/** 正在拉快照的任务：期间到达的批次先攒在这里。 */
const fetching = new Map<TaskId, TspBatch[]>();
const listeners = new Map<string, Set<() => void>>();
let started = false;

const nodeKey = (taskId: TaskId, sf: string, id: string): string => `n${SEP}${taskId}${SEP}${sf}${SEP}${id}`;
const surfaceKey = (taskId: TaskId, sf: string): string => `s${SEP}${taskId}${SEP}${sf}`;
const surfacesKey = (taskId: TaskId): string => `l${SEP}${taskId}`;
const blobKey = (taskId: TaskId, id: string): string => `b${SEP}${taskId}${SEP}${id}`;
const readyKey = (taskId: TaskId): string => `r${SEP}${taskId}`;
const roleKey = (taskId: TaskId, sf: string): string => `u${SEP}${taskId}${SEP}${sf}`;

/** omp 每轮末尾的用量行。 */
const USAGE_ROLE = "omp.turn.usage";
const USER_ROLE = "omp.user";
const TRACKED_ROLES: readonly string[] = [USAGE_ROLE, USER_ROLE];
const NO_IDS: readonly string[] = [];
/** main 区里 TRACKED_ROLES 节点的 id（文档顺序），按 (任务, surface) 缓存；镜像换了（快照）或有节点变了就作废。 */
const roleIndexes = new Map<string, { mirror: Mirror; byRole: Map<string, string[]> }>();

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

function notify(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const listener of set) listener();
}

/** 通知这个任务的全部订阅（快照整体替换、任务被移除）。 */
function notifyTask(taskId: TaskId): void {
  for (const key of listeners.keys()) {
    const parts = key.split(SEP);
    if (parts[1] === taskId) notify(key);
  }
}

// ───────── 应用 ─────────

const warned = new Set<string>();

function applyMessages(taskId: TaskId, mirror: Mirror, messages: readonly TspDocMessage[]): void {
  const changed = new Map<string, Set<string>>();
  const touchedSurfaces = new Set<string>();
  const touchedBlobs = new Set<string>();
  let structural = false;
  for (const message of messages) {
    const result = applyMessage(mirror.doc, message);
    for (const error of result.errors) {
      const text = `${message.verb}: ${error.msg}`;
      if (!warned.has(text)) {
        warned.add(text);
        console.warn("TSP 消息应用出错（主进程已应用同一条）", text);
      }
    }
    for (const [sf, ids] of result.changed) {
      let set = changed.get(sf);
      if (!set) changed.set(sf, (set = new Set()));
      for (const id of ids) set.add(id);
    }
    switch (message.verb) {
      case "o":
      case "x":
        structural = true;
        touchedSurfaces.add(message.body.id);
        break;
      case "f":
      case "t":
        touchedSurfaces.add(message.body.sf);
        break;
      case "b":
        touchedBlobs.add(message.id.toLowerCase());
        break;
    }
  }
  mirror.seq += messages.length;
  for (const [sf, ids] of changed) {
    touchedSurfaces.add(sf);
    roleIndexes.delete(`${taskId}${SEP}${sf}`);
    const nodes = mirror.doc.surfaces.get(sf)?.nodes;
    let roleChanged = false;
    for (const id of ids) {
      notify(nodeKey(taskId, sf, id));
      const node = nodes?.get(id);
      const nodeRole = node?.p["role"];
      if (!node || (typeof nodeRole === "string" && TRACKED_ROLES.includes(nodeRole))) roleChanged = true;
    }
    if (roleChanged) notify(roleKey(taskId, sf));
  }
  for (const sf of touchedSurfaces) notify(surfaceKey(taskId, sf));
  for (const id of touchedBlobs) notify(blobKey(taskId, id));
  if (structural) notify(surfacesKey(taskId));
}

function replay(taskId: TaskId, mirror: Mirror, batches: readonly TspBatch[]): boolean {
  for (const batch of batches) {
    const plan = planTspBatch(mirror.seq, batch);
    if (plan.kind === "resync") return false;
    if (plan.kind === "apply") applyMessages(taskId, mirror, batch.messages.slice(plan.skip));
  }
  return true;
}

function fetchSnapshot(taskId: TaskId): void {
  if (fetching.has(taskId)) return;
  fetching.set(taskId, []);
  window.studio.getTspSnapshot(taskId).then(
    (snapshot) => {
      const pending = fetching.get(taskId) ?? [];
      fetching.delete(taskId);
      const mirror: Mirror = { seq: snapshot.seq, doc: restoreDocument(snapshot.document) };
      mirrors.set(taskId, mirror);
      cachedSurfaces.delete(taskId);
      for (const key of cachedViews.keys()) if (key.startsWith(`${taskId}${SEP}`)) cachedViews.delete(key);
      notifyTask(taskId);
      if (!replay(taskId, mirror, pending)) fetchSnapshot(taskId);
    },
    (error: unknown) => {
      fetching.delete(taskId);
      console.error("getTspSnapshot 失败", error);
    },
  );
}

function onBatch(batch: TspBatch): void {
  const pending = fetching.get(batch.taskId);
  if (pending) {
    pending.push(batch);
    return;
  }
  const mirror = mirrors.get(batch.taskId);
  const plan = planTspBatch(mirror?.seq, batch);
  if (plan.kind === "resync") fetchSnapshot(batch.taskId);
  else if (plan.kind === "apply" && mirror) applyMessages(batch.taskId, mirror, batch.messages.slice(plan.skip));
}

function start(): void {
  if (started) return;
  started = true;
  window.studio.onTspBatch(onBatch);
  window.studio.onTaskRemoved((taskId) => {
    mirrors.delete(taskId);
    fetching.delete(taskId);
    cachedSurfaces.delete(taskId);
    notifyTask(taskId);
  });
}

/** 打开一个 TSP 任务的画面时调用：订阅事件，没有镜像就拉快照。可重复调用。 */
export function ensureTspDocument(taskId: TaskId): void {
  start();
  if (!mirrors.has(taskId)) fetchSnapshot(taskId);
}

// ───────── 读取 ─────────

/** 非 hook 读取（事件处理里用）。 */
export function peekTspNode(taskId: TaskId, sf: string, id: string): DocNode | null {
  return mirrors.get(taskId)?.doc.surfaces.get(sf)?.nodes.get(id) ?? null;
}

export function peekTspBlob(taskId: TaskId, id: string | undefined): DocBlob | null {
  return id === undefined ? null : (mirrors.get(taskId)?.doc.blobs.get(id.toLowerCase()) ?? null);
}

export function useTspReady(taskId: TaskId): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(readyKey(taskId), l), [taskId]);
  // 镜像出现的那一刻 notifyTask 会通知 readyKey（key 的第二段是 taskId）。
  return useSyncExternalStore(sub, () => mirrors.has(taskId));
}

/** 按 id 订阅一个节点：只有这个节点的记录换了才重画；节点不存在返回 null。 */
export function useTspNode(taskId: TaskId, sf: string, id: string): DocNode | null {
  const sub = useMemo(() => (l: () => void) => subscribe(nodeKey(taskId, sf, id), l), [taskId, sf, id]);
  return useSyncExternalStore(sub, () => peekTspNode(taskId, sf, id));
}

export function useTspBlob(taskId: TaskId, id: string | undefined): DocBlob | null {
  const key = id?.toLowerCase();
  const sub = useMemo(
    () => (l: () => void) => (key === undefined ? () => undefined : subscribe(blobKey(taskId, key), l)),
    [taskId, key],
  );
  return useSyncExternalStore(sub, () =>
    key === undefined ? null : (mirrors.get(taskId)?.doc.blobs.get(key) ?? null),
  );
}

export interface TspSurfaceInfo {
  id: string;
  mode: DocSurface["mode"];
  role: string | null;
  title: string | null;
  /** 没收到 x（仍然是活的）。 */
  live: boolean;
}

const cachedSurfaces = new Map<TaskId, readonly TspSurfaceInfo[]>();

function sameInfo(a: TspSurfaceInfo, b: TspSurfaceInfo): boolean {
  return a.id === b.id && a.mode === b.mode && a.role === b.role && a.title === b.title && a.live === b.live;
}

function readSurfaces(taskId: TaskId): readonly TspSurfaceInfo[] {
  const doc = mirrors.get(taskId)?.doc;
  const previous = cachedSurfaces.get(taskId) ?? EMPTY_SURFACES;
  if (!doc) return previous.length === 0 ? EMPTY_SURFACES : previous;
  const next = [...doc.surfaces.values()].map((s) => ({
    id: s.id,
    mode: s.mode,
    role: s.role,
    title: s.title,
    live: doc.live.has(s.id),
  }));
  if (next.length === previous.length && next.every((info, i) => sameInfo(info, previous[i]!))) return previous;
  cachedSurfaces.set(taskId, next);
  return next;
}

const EMPTY_SURFACES: readonly TspSurfaceInfo[] = [];

/** 任务的 surface 列表（按打开顺序，含已关闭但还留着的）。 */
export function useTspSurfaces(taskId: TaskId): readonly TspSurfaceInfo[] {
  const sub = useMemo(() => (l: () => void) => subscribe(surfacesKey(taskId), l), [taskId]);
  return useSyncExternalStore(sub, () => readSurfaces(taskId));
}

export interface TspSurfaceView extends TspSurfaceInfo {
  /** 拿着光标的 editor / input 的节点 id。 */
  focus: string | null;
  /** 最近一次 reveal；靠 seq 判断是不是新的。 */
  reveal: DocSurface["reveal"];
  suspended: boolean;
}

const cachedViews = new Map<string, TspSurfaceView>();

function readSurface(taskId: TaskId, sf: string): TspSurfaceView | null {
  const doc = mirrors.get(taskId)?.doc;
  const surface = doc?.surfaces.get(sf);
  const cacheKey = `${taskId}${SEP}${sf}`;
  if (!doc || !surface) {
    cachedViews.delete(cacheKey);
    return null;
  }
  const previous = cachedViews.get(cacheKey);
  const live = doc.live.has(sf);
  if (
    previous &&
    previous.mode === surface.mode &&
    previous.role === surface.role &&
    previous.title === surface.title &&
    previous.live === live &&
    previous.focus === surface.focus &&
    previous.reveal?.seq === surface.reveal?.seq &&
    previous.suspended === surface.suspended
  ) {
    return previous;
  }
  const next: TspSurfaceView = {
    id: sf,
    mode: surface.mode,
    role: surface.role,
    title: surface.title,
    live,
    focus: surface.focus,
    reveal: surface.reveal,
    suspended: surface.suspended,
  };
  cachedViews.set(cacheKey, next);
  return next;
}

/** 一个 surface 的元信息、光标所在节点和最近一次 reveal；surface 不存在返回 null。 */
export function useTspSurface(taskId: TaskId, sf: string): TspSurfaceView | null {
  const sub = useMemo(() => (l: () => void) => subscribe(surfaceKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => readSurface(taskId, sf));
}

// ───────── main 区里按 role 找节点（用量行的位置、用户消息有没有） ─────────

function roleIds(taskId: TaskId, sf: string, role: string): readonly string[] {
  const mirror = mirrors.get(taskId);
  if (!mirror) return NO_IDS;
  const cacheKey = `${taskId}${SEP}${sf}`;
  let cached = roleIndexes.get(cacheKey);
  if (!cached || cached.mirror !== mirror) {
    const nodes = mirror.doc.surfaces.get(sf)?.nodes;
    const byRole = new Map<string, string[]>(TRACKED_ROLES.map((r) => [r, []]));
    const walk = (id: string): void => {
      const node = nodes?.get(id);
      if (!node) return;
      const nodeRole = node.p["role"];
      if (typeof nodeRole === "string") byRole.get(nodeRole)?.push(id);
      for (const child of node.c) walk(child);
    };
    walk("main");
    cached = { mirror, byRole };
    roleIndexes.set(cacheKey, cached);
  }
  return cached.byRole.get(role) ?? NO_IDS;
}

/** 这个用量行是 main 区里从末尾数第几个（0 = 最后一个）；不在 main 里返回 -1。 */
export function useUsageRowFromEnd(taskId: TaskId, sf: string, id: string): number {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => {
    const ids = roleIds(taskId, sf, USAGE_ROLE);
    const index = ids.indexOf(id);
    return index < 0 ? -1 : ids.length - 1 - index;
  });
}

/** main 区里有没有 omp 的用户消息（omp.user）。 */
export function useTspHasUserMessage(taskId: TaskId, sf: string): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => roleIds(taskId, sf, USER_ROLE).length > 0);
}

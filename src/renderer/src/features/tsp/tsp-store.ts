// TSP 文档的渲染进程镜像：每个任务一份 { seq, doc }，外加推导用的节点追踪（shared/tsp/node-watch.ts）。
// 同步协议（ipc.ts TspBatch）：批次的 firstSeq 必须不超过本地 seq + 1，超过说明丢了帧，调 getTspSnapshot 重新拉；
// 拉快照期间到达的批次先攒着，快照落地后接着应用，所以快照和事件批次的重叠、乱序都是安全的（规则见 tsp-sync.ts）。
//
// 文档（Map）原地改，节点记录不可变：订阅按 (任务, surface, 节点 id) 登记，应用一批消息后只通知 `changed` 里出现的节点，
// 组件用 useTspNode 拿到的记录引用没变就不会重画。role 索引和声明了 NodeDeps 的 useTspDerived 只在它们读的节点变了时重算。
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
import { NodeWatch, type NodeDeps } from "../../../../shared/tsp/node-watch.ts";
import { findGateButton, hasBlockingPanel } from "../../../../shared/tsp/gate.ts";
import type { StatusNote } from "../../../../shared/tsp/status-notes.ts";
import { forgetBirths, markKnown, recordBirths, type BirthCounter } from "./entrance.ts";
import { dependsOnRoles, hasNoVisibleChild, RECAP_ROLE, type DrawEnv } from "./node-blank.ts";
import { buildRoleIndex, ROLE_INDEX_NODES, USER_ROLE, type RoleIndex } from "./role-index.ts";
import { planTspBatch } from "./tsp-sync.ts";

interface Mirror {
  seq: number;
  doc: TspDocument;
  /** role 索引读的节点（ROLE_INDEX_NODES）。 */
  roles: NodeWatch;
  /** useTspDerived 的推导读的节点：NodeDeps → 追踪，第一次用到时建。 */
  watches: Map<NodeDeps, NodeWatch>;
  /** 快照里列出、字节还没取到的 blob id（快照不带字节，见 DocumentSnapshot.blobIds）：有组件订阅时才 `getTspBlob` 取。 */
  remoteBlobs: Set<string>;
}

const SEP = "\u0000";
const mirrors = new Map<TaskId, Mirror>();
/** 正在拉快照的任务：期间到达的批次先攒在这里。 */
const fetching = new Map<TaskId, TspBatch[]>();
/** 等镜像追上某个序号的（endTspDrive）：镜像每次前进、被丢掉或拉快照失败时检查。 */
const seqWaiters = new Map<TaskId, { seq: number; resolve: () => void }[]>();
const listeners = new Map<string, Set<() => void>>();
/** 正在取字节的 blob（blobKey）。 */
const blobRequests = new Set<string>();
let started = false;

const nodeKey = (taskId: TaskId, sf: string, id: string): string => `n${SEP}${taskId}${SEP}${sf}${SEP}${id}`;
const surfaceKey = (taskId: TaskId, sf: string): string => `s${SEP}${taskId}${SEP}${sf}`;
const surfacesKey = (taskId: TaskId): string => `l${SEP}${taskId}`;
const blobKey = (taskId: TaskId, id: string): string => `b${SEP}${taskId}${SEP}${id}`;
const panelKey = (taskId: TaskId): string => `p${SEP}${taskId}`;
const roleKey = (taskId: TaskId, sf: string): string => `u${SEP}${taskId}${SEP}${sf}`;

const NO_IDS: readonly string[] = [];
/** main 区的 role 索引（role-index.ts），按 (任务, surface) 缓存；镜像换了（快照）或 ROLE_INDEX_NODES 里的节点变了就作废。 */
const roleIndexes = new Map<string, { mirror: Mirror; index: RoleIndex }>();

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
  /** 祖先换位置会改变子树的文档顺序，changed 里看不出来：这批的 NodeWatch 整份重扫（见 node-watch.ts）。 */
  let moved = false;
  const births: BirthCounter = new Map();
  for (const message of messages) {
    if (message.verb === "f") {
      for (const op of message.body.ops) {
        if (op[0] === "add") recordBirths(taskId, message.body.sf, op[2], op[4], births);
        else if (op[0] === "move") moved = true;
      }
    }
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
  // o / x 换掉或删掉整份节点表，changed 里只有根：同样重扫。
  const reset = structural || moved;
  for (const sf of mirror.roles.update(mirror.doc, changed, reset)) {
    roleIndexes.delete(`${taskId}${SEP}${sf}`);
    notify(roleKey(taskId, sf));
  }
  for (const watch of mirror.watches.values()) watch.update(mirror.doc, changed, reset);
  for (const [sf, ids] of changed) {
    touchedSurfaces.add(sf);
    for (const id of ids) notify(nodeKey(taskId, sf, id));
  }
  for (const sf of touchedSurfaces) notify(surfaceKey(taskId, sf));
  for (const id of touchedBlobs) notify(blobKey(taskId, id));
  notify(panelKey(taskId));
  if (structural) notify(surfacesKey(taskId));
  releaseSeqWaiters(taskId);
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
      const doc = restoreDocument(snapshot.document);
      // blob 按内容寻址：旧镜像里已有字节的直接沿用（丢帧重拉不重新取），其余等有组件要时再取。
      const previous = mirrors.get(taskId)?.doc.blobs;
      const remoteBlobs = new Set<string>();
      for (const id of snapshot.document.blobIds) {
        const kept = previous?.get(id);
        if (kept) doc.blobs.set(id, kept);
        else remoteBlobs.add(id);
      }
      const mirror: Mirror = {
        seq: snapshot.seq,
        doc,
        roles: new NodeWatch(doc, ROLE_INDEX_NODES),
        watches: new Map(),
        remoteBlobs,
      };
      for (const surface of mirror.doc.surfaces.values()) markKnown(taskId, surface.id, surface.nodes.values());
      mirrors.set(taskId, mirror);
      cachedSurfaces.delete(taskId);
      for (const key of cachedViews.keys()) if (key.startsWith(`${taskId}${SEP}`)) cachedViews.delete(key);
      notifyTask(taskId);
      if (!replay(taskId, mirror, pending)) fetchSnapshot(taskId);
      // 已经挂着的图片（镜像换了、组件没重新订阅）：现在就取（攒着的批次里刚送到的不用取）。
      for (const id of remoteBlobs) if (listeners.has(blobKey(taskId, id))) requestBlob(taskId, id);
      releaseSeqWaiters(taskId);
    },
    (error: unknown) => {
      fetching.delete(taskId);
      console.error("getTspSnapshot 失败", error);
      // 追不上了：不让等它的驱动一直挂着。
      releaseSeqWaiters(taskId, true);
    },
  );
}

/** 取一个快照里列出、本地还没有字节的 blob；取到后通知订阅它的组件。取不到（进程换了）就当它不在了。 */
function requestBlob(taskId: TaskId, id: string): void {
  const mirror = mirrors.get(taskId);
  const key = blobKey(taskId, id);
  if (!mirror?.remoteBlobs.has(id) || mirror.doc.blobs.has(id) || blobRequests.has(key)) return;
  blobRequests.add(key);
  window.studio.getTspBlob(taskId, id).then(
    (blob) => {
      blobRequests.delete(key);
      // 期间镜像可能换了（重拉快照）或被丢掉：只填进仍然列着它的那份。
      const current = mirrors.get(taskId);
      if (!current?.remoteBlobs.delete(id) || blob === null || current.doc.blobs.has(id)) return;
      current.doc.blobs.set(id, blob);
      notify(key);
    },
    (error: unknown) => {
      blobRequests.delete(key);
      console.error("getTspBlob 失败", error);
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
  window.studio.onTaskRemoved(dropTspDocument);
}

/** 打开一个 TSP 任务的画面时调用：订阅事件，没有镜像就拉快照。可重复调用。 */
export function ensureTspDocument(taskId: TaskId): void {
  start();
  if (!mirrors.has(taskId)) fetchSnapshot(taskId);
}

const dropListeners = new Set<(taskId: TaskId) => void>();

/** 一份镜像被丢掉时回调（各自按任务记的界面缓存跟着清，例如折叠状态）；返回取消函数。 */
export function onTspDocumentDropped(listener: (taskId: TaskId) => void): () => void {
  dropListeners.add(listener);
  return () => dropListeners.delete(listener);
}

/** 丢掉一份镜像（任务被移除；应用内登录的临时会话每次登录都是一个新进程，对话框打开 / 重试时先丢掉上一次的）。之后再 ensure 会重新拉快照。 */
export function dropTspDocument(taskId: TaskId): void {
  forgetBirths(taskId);
  mirrors.delete(taskId);
  fetching.delete(taskId);
  cachedSurfaces.delete(taskId);
  derivedCache.delete(taskId);
  drives.delete(taskId);
  for (const cache of [roleIndexes, cachedViews]) {
    for (const key of cache.keys()) if (key.startsWith(`${taskId}${SEP}`)) cache.delete(key);
  }
  notifyTask(taskId);
  releaseSeqWaiters(taskId);
  seqWaiters.delete(taskId);
  for (const listener of dropListeners) listener(taskId);
}

// ───────── 读取 ─────────

/** 非 hook 读取（事件处理里用）。 */
export function peekTspNode(taskId: TaskId, sf: string, id: string): DocNode | null {
  return mirrors.get(taskId)?.doc.surfaces.get(sf)?.nodes.get(id) ?? null;
}

export function peekTspBlob(taskId: TaskId, id: string | undefined): DocBlob | null {
  return id === undefined ? null : (mirrors.get(taskId)?.doc.blobs.get(id.toLowerCase()) ?? null);
}

// 作业（S2Jobs）：每批消息应用后通知一次（和 panelKey 同一个时机），文档用普通引用读。
/** 非 hook 读取：这个任务的 TSP 文档镜像（只读）；还没有为 null。 */
export function peekTspDocument(taskId: TaskId): TspDocument | null {
  return mirrors.get(taskId)?.doc ?? null;
}

/** 订阅"这个任务的文档又应用了一批消息"（快照整体替换也会通知）；返回取消函数。 */
export function subscribeTspBatches(taskId: TaskId, listener: () => void): () => void {
  return subscribe(panelKey(taskId), listener);
}

/** 审批/提问卡上点击动作为 `act` 的按钮（键盘快捷键用）；没有门、没有这个按钮或没有镜像为 null。 */
export function peekGateButton(taskId: TaskId, act: string): { sf: string; id: string } | null {
  const doc = mirrors.get(taskId)?.doc;
  return doc ? findGateButton(doc, act) : null;
}

/**
 * omp 的面板（全屏 surface 或 Agent Hub）盖在会话上：输入框不往主会话发（见 shared/tsp/gate.ts）。每批消息后重算，值没变不重画。
 * 主进程在后台驱动 Hub（子代理面板的插话 / 结束 / 恢复）期间那个 Hub 不算：输入框照常用，主进程会让发出的消息等到驱动结束。
 */
export function useTspPanelOpen(taskId: TaskId): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(panelKey(taskId), l), [taskId]);
  return useSyncExternalStore(sub, () => {
    if (drives.has(taskId)) return false;
    const doc = mirrors.get(taskId)?.doc;
    return doc ? hasBlockingPanel(doc) : false;
  });
}

/** 按 id 订阅一个节点：只有这个节点的记录换了才重画；节点不存在返回 null。 */
export function useTspNode(taskId: TaskId, sf: string, id: string): DocNode | null {
  const sub = useMemo(() => (l: () => void) => subscribe(nodeKey(taskId, sf, id), l), [taskId, sf, id]);
  return useSyncExternalStore(sub, () => peekTspNode(taskId, sf, id));
}

/**
 * 这些子节点里有没有能显示的内容（node-blank.ts 的 hasNoVisibleChild）：没有则返回 true（容器据此收起，data-blank）。
 * 只订阅这几个子节点的记录（它们 hidden / role / 子节点列表变了才重算），结果是布尔值，没变不重画容器；
 * 子节点或孙节点是错误横幅 / 回顾行时（画不画取决于对话整体）才多订阅 role 索引。`off` = 不判断（始终 false，不订阅）。
 */
export function useTspNoVisibleChild(
  taskId: TaskId,
  sf: string,
  ids: readonly string[],
  mode: "off" | "container" | "dock",
): boolean {
  let watchRoles = false;
  if (mode !== "off") {
    for (const id of ids) {
      const child = peekTspNode(taskId, sf, id);
      if (dependsOnRoles(child) || child?.c.some((grand) => dependsOnRoles(peekTspNode(taskId, sf, grand)))) {
        watchRoles = true;
        break;
      }
    }
  }
  const sub = useMemo(
    () => (l: () => void) => {
      if (mode === "off") return () => undefined;
      const offs = ids.map((id) => subscribe(nodeKey(taskId, sf, id), l));
      if (watchRoles) offs.push(subscribe(roleKey(taskId, sf), l));
      return () => {
        for (const off of offs) off();
      };
    },
    [taskId, sf, ids, mode, watchRoles],
  );
  return useSyncExternalStore(sub, () => {
    if (mode === "off") return false;
    const env: DrawEnv = {
      peek: (id) => peekTspNode(taskId, sf, id),
      get hasErrorCard() {
        return roleIndex(taskId, sf)?.trailingError != null;
      },
      get latestRecap() {
        return roleIds(taskId, sf, RECAP_ROLE).at(-1);
      },
    };
    return hasNoVisibleChild(ids, env, mode === "container");
  });
}

export function useTspBlob(taskId: TaskId, id: string | undefined): DocBlob | null {
  const key = id?.toLowerCase();
  const sub = useMemo(
    () => (l: () => void) => {
      if (key === undefined) return () => undefined;
      const unsubscribe = subscribe(blobKey(taskId, key), l);
      requestBlob(taskId, key);
      return unsubscribe;
    },
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

const NO_NOTES: readonly StatusNote[] = [];

/** omp 的状态行（切模型等）：文档里记下来的，按出现顺序（见 shared/tsp/status-notes.ts）。 */
export function useTspStatusNotes(taskId: TaskId, sf: string): readonly StatusNote[] {
  const sub = useMemo(() => (l: () => void) => subscribe(surfaceKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => mirrors.get(taskId)?.doc.surfaces.get(sf)?.statusNotes ?? NO_NOTES);
}

// ───────── main 区里按 role 找节点（用量行的位置、用户消息有没有） ─────────

function roleIndex(taskId: TaskId, sf: string): RoleIndex | null {
  const mirror = mirrors.get(taskId);
  if (!mirror) return null;
  const cacheKey = `${taskId}${SEP}${sf}`;
  const cached = roleIndexes.get(cacheKey);
  if (cached?.mirror === mirror) return cached.index;
  const index = buildRoleIndex(mirror.doc.surfaces.get(sf)?.nodes);
  roleIndexes.set(cacheKey, { mirror, index });
  return index;
}

function roleIds(taskId: TaskId, sf: string, role: string): readonly string[] {
  return roleIndex(taskId, sf)?.byRole.get(role) ?? NO_IDS;
}

/**
 * 这个助手节点是不是一轮的最后一个、而这一轮 omp 没发用量行（恢复会话时 omp 不重发）：是则返回这一轮是第几轮（从 0 数），
 * 否则 -1。`fileTurns` 是会话文件里的轮数：和文档里的轮数不一致（正在发新消息、压缩过、文件还没读到）时一律 -1，
 * 宁可不补也不把别的轮的用量补错位置。
 */
export function useBareTurnIndex(taskId: TaskId, sf: string, assistantId: string, fileTurns: number): number {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => {
    const index = roleIndex(taskId, sf);
    if (index === null || index.turnCount !== fileTurns) return -1;
    return index.lastAssistantOfBareTurn.get(assistantId) ?? -1;
  });
}

/** main 区里的轮数（omp.user 的个数）；用它在新增一轮时重读会话文件。 */
export function useTspTurnCount(taskId: TaskId, sf: string): number {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => roleIndex(taskId, sf)?.turnCount ?? 0);
}

/** 这个回顾行是不是 main 区里最后一个：对话里只显示最新的一条，新回顾来了旧的就收起。 */
export function useIsLatestRecap(taskId: TaskId, sf: string, id: string): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => roleIds(taskId, sf, RECAP_ROLE).at(-1) === id);
}

/** main 区里有没有 omp 的用户消息（omp.user）。 */
export function useTspHasUserMessage(taskId: TaskId, sf: string): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => roleIds(taskId, sf, USER_ROLE).length > 0);
}

/** 这张错误卡是不是对话末尾那张（它之后没有新消息、没有成功的回答）：只有它旁边显示"重试"（见 shared/tsp/error-turn.ts）。 */
export function useIsTrailingErrorCard(taskId: TaskId, sf: string, id: string): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => roleIndex(taskId, sf)?.trailingError === id);
}

/** 对话里有没有收尾的错误卡：dock 里 omp 的错误横幅只有这时才是重复的（isOmpErrorDuplicate）。 */
export function useHasTrailingErrorCard(taskId: TaskId, sf: string): boolean {
  const sub = useMemo(() => (l: () => void) => subscribe(roleKey(taskId, sf), l), [taskId, sf]);
  return useSyncExternalStore(sub, () => roleIndex(taskId, sf)?.trailingError != null);
}

// ───────── 主进程在后台驱动 omp（子代理面板 S1，spec §4.28；上下文构成） ─────────

/**
 * 主进程正在后台驱动 omp：这期间不画 layer（omp 被驱动时弹出的 Hub / 报告），也不当成"面板开着"。
 * `hub`：子代理面板的聚焦 / 插话 / 结束 / 恢复（过程区压暗，面板显示"正在发给 <名字>"）；`context`：读 omp 的 /context 报告。
 */
export type TspDrive = { kind: "hub"; name: string; op: "focus" | "steer" | "kill" | "revive" } | { kind: "context" };

const drives = new Map<TaskId, TspDrive>();
const driveKey = (taskId: TaskId): string => `d${SEP}${taskId}`;

/** 一次驱动开始（调 IPC 之前）；主进程在 omp 弹出东西的那几帧里渲染进程已经知道该藏它。 */
export function beginTspDrive(taskId: TaskId, drive: TspDrive): void {
  drives.set(taskId, drive);
  notify(driveKey(taskId));
  notify(panelKey(taskId));
}

/**
 * 结束这一次驱动；期间被另一次驱动接替（主进程会排在这次之后做）就留给那一次结束。
 * 先等镜像追上主进程已发出的消息（`getTspSeq`）：IPC 回复可能比之前发出的批次先到（负载高时实测先到 30–50ms），
 * 不等的话 omp 已经关掉的弹窗（聚焦子代理时的 Hub、上下文报告）会在放开遮挡后再画一帧。
 */
export async function endTspDrive(taskId: TaskId, drive: TspDrive): Promise<void> {
  try {
    await catchUp(taskId, await window.studio.getTspSeq(taskId));
  } catch (error) {
    console.error("getTspSeq 失败", error);
  }
  if (drives.get(taskId) !== drive) return;
  drives.delete(taskId);
  notify(driveKey(taskId));
  notify(panelKey(taskId));
}

/** 镜像的序号到 `seq` 为止（没有镜像时不等）。 */
function catchUp(taskId: TaskId, seq: number): Promise<void> {
  const mirror = mirrors.get(taskId);
  if (mirror === undefined || mirror.seq >= seq) return Promise.resolve();
  return new Promise((resolve) => {
    const list = seqWaiters.get(taskId) ?? [];
    list.push({ seq, resolve });
    seqWaiters.set(taskId, list);
  });
}

/** 镜像前进了（批次、快照）或被丢掉：放行已经追上的等待；`all`：拉快照失败，全部放行。 */
function releaseSeqWaiters(taskId: TaskId, all = false): void {
  const list = seqWaiters.get(taskId);
  if (!list) return;
  const seq = mirrors.get(taskId)?.seq;
  const waiting = list.filter((waiter) => {
    if (!all && seq !== undefined && seq < waiter.seq) return true;
    waiter.resolve();
    return false;
  });
  if (waiting.length > 0) seqWaiters.set(taskId, waiting);
  else seqWaiters.delete(taskId);
}

export function isTspDriving(taskId: TaskId): boolean {
  return drives.has(taskId);
}

export function useTspDrive(taskId: TaskId): TspDrive | null {
  const sub = useMemo(() => (l: () => void) => subscribe(driveKey(taskId), l), [taskId]);
  return useSyncExternalStore(sub, () => drives.get(taskId) ?? null);
}

/**
 * useTspDerived 的共享结果：(任务, derive 函数) → 在镜像的哪一版上算的、结果。多个组件用同一个 derive 时每个版本只算一次。
 * 版本：声明了 `nodes` 的是那份 NodeWatch 的 version（相关节点变了才变），没声明的是镜像的 seq（每批都变）。
 */
const derivedCache = new Map<TaskId, Map<unknown, { mirror: Mirror; version: number; value: unknown }>>();

/**
 * 从文档推导一个值（结果和上次相等就沿用上次的对象，不重画）。`derive` / `same` / `nodes` 必须是稳定引用（模块级），
 * 同一个 `derive` 配的 `same`、`nodes` 也必须是同一个：缓存按 (任务, derive) 共享。没有镜像时为 null。
 * `nodes`：derive 只读这些节点（见 shared/tsp/node-watch.ts 的前提），它们没变就不重算；不给则每批消息后重算。
 */
export function useTspDerived<T>(
  taskId: TaskId,
  derive: (doc: TspDocument) => T,
  same: (a: T, b: T) => boolean,
  nodes?: NodeDeps,
): T | null {
  const sub = useMemo(() => (l: () => void) => subscribe(panelKey(taskId), l), [taskId]);
  return useSyncExternalStore(sub, () => {
    const mirror = mirrors.get(taskId);
    if (!mirror) return null;
    let version = mirror.seq;
    if (nodes) {
      let watch = mirror.watches.get(nodes);
      if (!watch) mirror.watches.set(nodes, (watch = new NodeWatch(mirror.doc, nodes)));
      version = watch.version;
    }
    let byDerive = derivedCache.get(taskId);
    if (!byDerive) derivedCache.set(taskId, (byDerive = new Map()));
    const entry = byDerive.get(derive);
    if (entry && entry.mirror === mirror && entry.version === version) return entry.value as T;
    const next = derive(mirror.doc);
    const value = entry && same(entry.value as T, next) ? (entry.value as T) : next;
    byDerive.set(derive, { mirror, version, value });
    return value;
  });
}

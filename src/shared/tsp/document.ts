// TSP 文档模型（docs/architecture/tsp-migration.md）：程序发来的 o / f / t / x / b 按规范（Tern SDK 文档
// protocol/documents）应用到一份内存文档上。主进程（权威副本，推任务状态、给快照）和渲染进程（画界面）
// 用同一份纯函数，保证两边状态一致。
//
// 节点记录不可变：任何改动都换一个新对象（父节点的 children 变了也换父节点），渲染进程按对象身份判断要不要重画。
// 表（Map）本身原地改。
import { isRecord } from "../type-guards.ts";
import { mergeStatusNotes, statusNotesIn, type StatusNote } from "./status-notes.ts";
import type { TspClose, TspFrame, TspNode, TspOpen, TspOp, TspPalette } from "./tsp.generated.ts";

export interface DocNode {
  readonly id: string;
  readonly k: string;
  readonly p: Readonly<Record<string, unknown>>;
  /** 子节点 id，按显示顺序。 */
  readonly c: readonly string[];
  /** 父节点 id；surface 根节点为 null。 */
  readonly parent: string | null;
}

export interface DocSurface {
  readonly id: string;
  readonly mode: TspOpen["mode"];
  readonly title: string | null;
  readonly role: string | null;
  /** 含根节点（id = surface id，kind `col`）。 */
  readonly nodes: Map<string, DocNode>;
  /** 拿着光标的 editor / input；没有时为 null。 */
  focus: string | null;
  /** 最近一次 reveal；渲染进程滚过去以后不清，靠 seq 判断是不是新的。 */
  reveal: { id: string; where: "start" | "end" | "nearest"; seq: number } | null;
  /** `suspend` 之后为 true，直到 `resume`。 */
  suspended: boolean;
  /** 最后应用的帧号（程序发来的 s）。 */
  lastFrame: number;
  /** omp 的状态行（toast `omp.toast.status`）：节点下一帧就没了，出现那一帧记下来；同一个节点 id 换文字时替换那一条（见 status-notes.ts）。每次变化换一个新数组。 */
  statusNotes: readonly StatusNote[];
}

export interface DocBlob {
  readonly mime: string | null;
  /** base64。 */
  readonly data: string;
}

export interface TspDocument {
  /** 按打开顺序。关掉（keep:false）的 surface 移除；keep:true 的保留但不再是活的。 */
  readonly surfaces: Map<string, DocSurface>;
  /** 仍然打开（没收到 x）的 surface id。 */
  readonly live: Set<string>;
  readonly palettes: Map<string, TspPalette>;
  readonly blobs: Map<string, DocBlob>;
  /** reveal 的全局递增号，每应用一次 reveal 加一。 */
  revealSeq: number;
}

/** 程序 → 终端里会改文档的消息（q 由会话层处理，不进文档）。 */
export type TspDocMessage =
  | { verb: "o"; body: TspOpen }
  | { verb: "f"; body: TspFrame }
  | { verb: "t"; body: TspPalette }
  | { verb: "x"; body: TspClose }
  | { verb: "b"; id: string; mime: string | null; data: string };

export interface OpError {
  /** 帧里的第几个 op（0 起）。 */
  op: number;
  msg: string;
}

export interface ApplyResult {
  /** 被拒的 op；规范要求逐个拒、其余照常应用。整帧被丢时 op 为 -1。 */
  errors: OpError[];
  /** 记录被换掉、新增或删除的节点 id（按 surface 分）。 */
  changed: Map<string, Set<string>>;
}

/** 有主文字（`text` / `splice` 操作的对象）的节点种类。 */
const TEXT_KINDS: ReadonlySet<string> = new Set([
  "text",
  "md",
  "code",
  "ansi",
  "math",
  "editor",
  "input",
  "shimmer",
  "el",
]);

export function createDocument(): TspDocument {
  return { surfaces: new Map(), live: new Set(), palettes: new Map(), blobs: new Map(), revealSeq: 0 };
}

export function applyMessage(doc: TspDocument, message: TspDocMessage): ApplyResult {
  const result: ApplyResult = { errors: [], changed: new Map() };
  switch (message.verb) {
    case "o":
      openSurface(doc, message.body, result);
      break;
    case "f":
      applyFrame(doc, message.body, result);
      break;
    case "t":
      doc.palettes.set(message.body.sf, message.body);
      break;
    case "x":
      closeSurface(doc, message.body, result);
      break;
    case "b":
      doc.blobs.set(message.id.toLowerCase(), { mime: message.mime, data: message.data });
      break;
  }
  return result;
}

function changedSet(result: ApplyResult, sf: string): Set<string> {
  let set = result.changed.get(sf);
  if (!set) {
    set = new Set();
    result.changed.set(sf, set);
  }
  return set;
}

function openSurface(doc: TspDocument, open: TspOpen, result: ApplyResult): void {
  const existing = doc.surfaces.get(open.id);
  // 规范：同 id 再开一次 = 接管（adopt）原来的 surface，文档保留；否则新开一份空文档。
  if (existing && open.adopt === true) {
    doc.live.add(open.id);
    return;
  }
  const nodes = new Map<string, DocNode>();
  nodes.set(open.id, { id: open.id, k: "col", p: {}, c: [], parent: null });
  doc.surfaces.delete(open.id);
  doc.surfaces.set(open.id, {
    id: open.id,
    mode: open.mode,
    title: open.title ?? null,
    role: open.role ?? null,
    nodes,
    focus: null,
    reveal: null,
    suspended: false,
    lastFrame: 0,
    statusNotes: [],
  });
  doc.live.add(open.id);
  changedSet(result, open.id).add(open.id);
}

function closeSurface(doc: TspDocument, close: TspClose, result: ApplyResult): void {
  const surface = doc.surfaces.get(close.id);
  if (!surface) return;
  doc.live.delete(close.id);
  if (!close.keep) {
    doc.surfaces.delete(close.id);
    doc.palettes.delete(close.id);
    changedSet(result, close.id).add(close.id);
    return;
  }
  // keep：只留 main（规范：留在回滚里），dock 和 layer 去掉，光标也没了。
  for (const region of ["dock", "layer"]) {
    if (surface.nodes.has(region)) removeSubtree(surface, region, changedSet(result, close.id));
  }
  surface.focus = null;
}

function applyFrame(doc: TspDocument, frame: TspFrame, result: ApplyResult): void {
  const surface = typeof frame.sf === "string" ? doc.surfaces.get(frame.sf) : undefined;
  if (!surface || !doc.live.has(surface.id) || !Array.isArray(frame.ops)) {
    result.errors.push({ op: -1, msg: `frame for unknown or closed surface ${String(frame.sf)}` });
    return;
  }
  surface.lastFrame = frame.s;
  const changed = changedSet(result, surface.id);
  frame.ops.forEach((op, index) => {
    const error = applyOp(doc, surface, op, changed);
    if (error !== null) result.errors.push({ op: index, msg: error });
  });
  const notes = statusNotesIn(surface, frame.ops);
  if (notes.length > 0) surface.statusNotes = mergeStatusNotes(surface.statusNotes, notes);
}

function applyOp(doc: TspDocument, surface: DocSurface, op: TspOp, changed: Set<string>): string | null {
  if (!Array.isArray(op) || typeof op[0] !== "string") return "malformed op";
  switch (op[0]) {
    case "add":
      return addOp(surface, op[1], op[2], op[3], op[4], changed);
    case "set":
      return setOp(surface, op[1], op[2], changed);
    case "text":
      return textOp(surface, op[1], op[2], op[3], changed);
    case "splice":
      return spliceOp(surface, op[1], op[2], op[3], op[4], changed);
    case "move":
      return moveOp(surface, op[1], op[2], op[3], changed);
    case "del": {
      const id = op[1];
      if (id === surface.id) return "can't delete the surface root";
      if (!surface.nodes.has(id)) return `unknown id ${id}`;
      removeSubtree(surface, id, changed);
      return null;
    }
    case "settle":
      // 只是提示，文档不变。
      return surface.nodes.has(op[1]) ? null : `unknown id ${op[1]}`;
    case "focus": {
      const id = op[1];
      if (id !== null && !surface.nodes.has(id)) return `unknown id ${id}`;
      surface.focus = id;
      return null;
    }
    case "reveal": {
      if (!surface.nodes.has(op[1])) return `unknown id ${op[1]}`;
      doc.revealSeq += 1;
      surface.reveal = {
        id: op[1],
        where: op[2] === "start" || op[2] === "end" ? op[2] : "nearest",
        seq: doc.revealSeq,
      };
      return null;
    }
    case "scroll":
      // 键盘滚动由渲染进程按焦点处理；文档里没有滚动位置。
      return surface.nodes.has(op[1]) ? null : `unknown id ${op[1]}`;
    case "suspend":
      surface.suspended = true;
      return null;
    case "resume":
      surface.suspended = false;
      return null;
    default:
      return `unknown op ${String((op as readonly unknown[])[0])}`;
  }
}

function addOp(
  surface: DocSurface,
  id: string,
  parentId: string,
  before: string | null,
  node: TspNode,
  changed: Set<string>,
): string | null {
  if (!node || typeof node !== "object" || node.id !== id) return "add: id must equal node.id";
  const parent = surface.nodes.get(parentId);
  if (!parent) return `unknown parent ${parentId}`;
  if (before !== null && !parent.c.includes(before)) return `before ${before} is not a child of ${parentId}`;
  // 整棵子树先校验再插入：任何一个节点不合格就全部不加。
  const flat: DocNode[] = [];
  const seen = new Set<string>();
  const problem = flatten(node, parentId, surface, seen, flat);
  if (problem !== null) return problem;
  for (const record of flat) {
    surface.nodes.set(record.id, record);
    changed.add(record.id);
  }
  replaceNode(surface, { ...parent, c: insertChild(parent.c, id, before) }, changed);
  return null;
}

function flatten(node: TspNode, parent: string, surface: DocSurface, seen: Set<string>, out: DocNode[]): string | null {
  if (typeof node.id !== "string" || node.id === "") return "node without an id";
  // 线上来的数据不一定守类型：按 unknown 校验。
  const kind: unknown = node.k;
  if (typeof kind !== "string" || kind === "") return `node ${node.id} without a kind`;
  if (surface.nodes.has(node.id) || seen.has(node.id)) return `duplicate id ${node.id}`;
  seen.add(node.id);
  const children = Array.isArray(node.c) ? (node.c as readonly TspNode[]) : [];
  out.push({
    id: node.id,
    k: node.k,
    p: dropNulls(node.p as Record<string, unknown> | undefined),
    c: children.map((child) => child.id),
    parent,
  });
  for (const child of children) {
    const problem = flatten(child, node.id, surface, seen, out);
    if (problem !== null) return problem;
  }
  return null;
}

function dropNulls(props: Record<string, unknown> | undefined): Readonly<Record<string, unknown>> {
  if (!props) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) if (value !== null && value !== undefined) out[key] = value;
  return out;
}

function setOp(
  surface: DocSurface,
  id: string,
  props: Readonly<Record<string, unknown>>,
  changed: Set<string>,
): string | null {
  const node = surface.nodes.get(id);
  if (!node) return `unknown id ${id}`;
  if (!props || typeof props !== "object") return "set: props must be an object";
  const next: Record<string, unknown> = { ...node.p };
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  replaceNode(surface, { ...node, p: next }, changed);
  return null;
}

function textOp(surface: DocSurface, id: string, mode: string, text: string, changed: Set<string>): string | null {
  const node = surface.nodes.get(id);
  if (!node) return `unknown id ${id}`;
  if (!TEXT_KINDS.has(node.k)) return `${node.k} has no primary text`;
  if (typeof text !== "string") return "text: string expected";
  const current = typeof node.p.text === "string" ? node.p.text : "";
  const value = mode === "append" ? current + text : text;
  replaceNode(surface, { ...node, p: { ...node.p, text: value } }, changed);
  return null;
}

function spliceOp(
  surface: DocSurface,
  id: string,
  at: number,
  del: number,
  text: string,
  changed: Set<string>,
): string | null {
  const node = surface.nodes.get(id);
  if (!node) return `unknown id ${id}`;
  if (!TEXT_KINDS.has(node.k)) return `${node.k} has no primary text`;
  const current = typeof node.p.text === "string" ? node.p.text : "";
  if (!Number.isInteger(at) || !Number.isInteger(del) || at < 0 || del < 0 || at + del > current.length) {
    return "splice: range outside the text";
  }
  const value = current.slice(0, at) + text + current.slice(at + del);
  replaceNode(surface, { ...node, p: { ...node.p, text: value } }, changed);
  return null;
}

function moveOp(
  surface: DocSurface,
  id: string,
  parentId: string,
  before: string | null,
  changed: Set<string>,
): string | null {
  const node = surface.nodes.get(id);
  if (!node) return `unknown id ${id}`;
  if (id === surface.id) return "can't move the surface root";
  const parent = surface.nodes.get(parentId);
  if (!parent) return `unknown parent ${parentId}`;
  if (before === id) return "move: before is the node itself";
  if (before !== null && !parent.c.includes(before)) return `before ${before} is not a child of ${parentId}`;
  for (let cursor: string | null = parentId; cursor !== null; cursor = surface.nodes.get(cursor)?.parent ?? null) {
    if (cursor === id) return "move: into its own subtree";
  }
  const oldParent = node.parent === null ? undefined : surface.nodes.get(node.parent);
  if (oldParent) replaceNode(surface, { ...oldParent, c: oldParent.c.filter((child) => child !== id) }, changed);
  const target = surface.nodes.get(parentId)!;
  replaceNode(
    surface,
    {
      ...target,
      c: insertChild(
        target.c.filter((child) => child !== id),
        id,
        before,
      ),
    },
    changed,
  );
  replaceNode(surface, { ...node, parent: parentId }, changed);
  return null;
}

function removeSubtree(surface: DocSurface, id: string, changed: Set<string>): void {
  const node = surface.nodes.get(id);
  if (!node) return;
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const record = surface.nodes.get(current);
    if (!record) continue;
    stack.push(...record.c);
    surface.nodes.delete(current);
    changed.add(current);
    if (surface.focus === current) surface.focus = null;
  }
  const parent = node.parent === null ? undefined : surface.nodes.get(node.parent);
  if (parent) replaceNode(surface, { ...parent, c: parent.c.filter((child) => child !== id) }, changed);
}

function replaceNode(surface: DocSurface, node: DocNode, changed: Set<string>): void {
  surface.nodes.set(node.id, node);
  changed.add(node.id);
}

function insertChild(children: readonly string[], id: string, before: string | null): string[] {
  const next = [...children];
  const at = before === null ? -1 : next.indexOf(before);
  if (at < 0) next.push(id);
  else next.splice(at, 0, id);
  return next;
}

// ───────── 快照（IPC 只能传可结构化克隆的数据；Map 可以，但统一转成普通对象便于测试比对） ─────────

export interface DocumentSnapshot {
  surfaces: {
    id: string;
    mode: TspOpen["mode"];
    title: string | null;
    role: string | null;
    nodes: DocNode[];
    focus: string | null;
    reveal: DocSurface["reveal"];
    suspended: boolean;
    lastFrame: number;
    statusNotes: readonly StatusNote[];
    live: boolean;
  }[];
  palettes: TspPalette[];
  /** 文档里 blob 的 id，不带字节（图片一张常有上百 KB，每次拉快照都整份复制太贵）：渲染进程用到哪张再按 id 取（`getTspBlob`）。 */
  blobIds: string[];
  revealSeq: number;
}

export function snapshotDocument(doc: TspDocument): DocumentSnapshot {
  return {
    surfaces: [...doc.surfaces.values()].map((surface) => ({
      id: surface.id,
      mode: surface.mode,
      title: surface.title,
      role: surface.role,
      nodes: [...surface.nodes.values()],
      focus: surface.focus,
      reveal: surface.reveal,
      suspended: surface.suspended,
      lastFrame: surface.lastFrame,
      statusNotes: surface.statusNotes,
      live: doc.live.has(surface.id),
    })),
    palettes: [...doc.palettes.values()],
    blobIds: [...doc.blobs.keys()],
    revealSeq: doc.revealSeq,
  };
}

export function restoreDocument(snapshot: DocumentSnapshot): TspDocument {
  const doc = createDocument();
  for (const surface of snapshot.surfaces) {
    doc.surfaces.set(surface.id, {
      id: surface.id,
      mode: surface.mode,
      title: surface.title,
      role: surface.role,
      nodes: new Map(surface.nodes.map((node) => [node.id, node])),
      focus: surface.focus,
      reveal: surface.reveal,
      suspended: surface.suspended,
      lastFrame: surface.lastFrame,
      statusNotes: surface.statusNotes,
    });
    if (surface.live) doc.live.add(surface.id);
  }
  for (const palette of snapshot.palettes) doc.palettes.set(palette.sf, palette);
  // blob 的字节不在快照里（见 DocumentSnapshot.blobIds），还原出的文档 blobs 为空。
  doc.revealSeq = snapshot.revealSeq;
  return doc;
}

// ───────── 查询 ─────────

/** 从根往下深度优先找第一个满足条件的节点。 */
export function findNode(
  surface: DocSurface,
  predicate: (node: DocNode) => boolean,
  from = surface.id,
): DocNode | null {
  const stack = [from];
  while (stack.length > 0) {
    const node = surface.nodes.get(stack.pop()!);
    if (!node) continue;
    if (predicate(node)) return node;
    for (let index = node.c.length - 1; index >= 0; index -= 1) stack.push(node.c[index]!);
  }
  return null;
}

export function nodeRole(node: DocNode): string | null {
  return typeof node.p.role === "string" ? node.p.role : null;
}

/** `spans`（`{t}` 片段数组）拼成纯文字；字符串原样返回，其它为空串。 */
export function spansText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((span: unknown) => (isRecord(span) && typeof span["t"] === "string" ? span["t"] : "")).join("");
}

/** 节点的纯文字：`text` 属性，或把 `spans` 拼起来。 */
export function plainText(node: DocNode): string {
  const { text, spans } = node.p;
  if (typeof text === "string") return text;
  return Array.isArray(spans) ? spansText(spans) : "";
}

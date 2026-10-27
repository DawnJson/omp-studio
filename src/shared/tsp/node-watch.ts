// 从 TSP 文档推导的值（用户消息、子代理列表、作业胶囊、role 索引）只读一小部分节点：kind / role 符合某个条件的，
// 有时再加它们的直接子节点或父节点。NodeWatch 记住这些节点在哪，每批消息应用后看 ApplyResult.changed 里有没有相关节点，
// 有才把 version 加一；调用方按 version 缓存推导结果，纯文字流式输出这类无关的批次不再整篇扫描。纯模块，主进程和渲染进程都能用。
//
// 推导要满足的前提（声明 NodeDeps 的一方负责）：结果只取决于
// - 活着的 surface 和它们的元信息（o / x 才会变）；
// - 符合条件的节点的记录，`children` / `parent` 时再加它们直接子节点 / 父节点的记录；
// - 这些节点在节点表（Map 插入顺序）和树里的先后。
// 节点记录不可变、换了就进 changed（document.ts）；删子树时每个后代都进 changed；子节点增删会换父节点。所以除了下面两种，
// 相关节点的任何变化都能从 changed 里看出来：
// - o / x：整份节点表被换掉或删掉，changed 里只有根；
// - move：祖先换了位置，子树里节点的文档顺序跟着变，changed 里只有被移动的节点和两个父节点。
// 这两种（录制里很少：51 份录制共 6 次 move）整份重扫。
import type { DocNode, TspDocument } from "./document.ts";

export interface NodeDeps {
  readonly kinds?: readonly string[];
  readonly roles?: readonly string[];
  /** 也读这些节点的直接子节点（例如用户消息卡片下 md 的正文）。 */
  readonly children?: boolean;
  /** 也读它们的父节点（例如子代理所在 task 卡片的状态）。 */
  readonly parent?: boolean;
}

export class NodeWatch {
  /** 相关节点每变一批加一。 */
  version = 0;
  readonly #kinds: ReadonlySet<string>;
  readonly #roles: ReadonlySet<string>;
  readonly #children: boolean;
  readonly #parent: boolean;
  /** surface → 符合条件的节点 id → 它的父节点 id。 */
  readonly #tracked = new Map<string, Map<string, string | null>>();
  /** surface → 父节点 id → 它下面符合条件的节点个数（只在 `parent` 时记）。 */
  readonly #parents = new Map<string, Map<string, number>>();

  constructor(doc: TspDocument, deps: NodeDeps) {
    this.#kinds = new Set(deps.kinds);
    this.#roles = new Set(deps.roles);
    this.#children = deps.children === true;
    this.#parent = deps.parent === true;
    this.#scan(doc);
  }

  #matches(node: DocNode | undefined): boolean {
    if (node === undefined) return false;
    if (this.#kinds.has(node.k)) return true;
    const role = node.p["role"];
    return typeof role === "string" && this.#roles.has(role);
  }

  #track(sf: string, id: string, parent: string | null): void {
    let tracked = this.#tracked.get(sf);
    if (!tracked) this.#tracked.set(sf, (tracked = new Map()));
    tracked.set(id, parent);
    if (!this.#parent || parent === null) return;
    let parents = this.#parents.get(sf);
    if (!parents) this.#parents.set(sf, (parents = new Map()));
    parents.set(parent, (parents.get(parent) ?? 0) + 1);
  }

  #untrack(sf: string, tracked: Map<string, string | null>, id: string): void {
    const parent = tracked.get(id) ?? null;
    tracked.delete(id);
    if (!this.#parent || parent === null) return;
    const parents = this.#parents.get(sf);
    const count = parents?.get(parent) ?? 0;
    if (count <= 1) parents?.delete(parent);
    else parents?.set(parent, count - 1);
  }

  #scan(doc: TspDocument): void {
    this.#tracked.clear();
    this.#parents.clear();
    for (const surface of doc.surfaces.values()) {
      for (const node of surface.nodes.values()) if (this.#matches(node)) this.#track(surface.id, node.id, node.parent);
    }
  }

  /**
   * 一批消息应用之后调用：`changed` 是这批消息的 ApplyResult.changed 合起来，`reset` = 这批里有 o / x 或 move。
   * 返回相关节点变了的 surface（reset 时是全部），非空时 version 已加一。
   */
  update(doc: TspDocument, changed: ReadonlyMap<string, ReadonlySet<string>>, reset: boolean): ReadonlySet<string> {
    if (reset) {
      const all = new Set([...this.#tracked.keys(), ...doc.surfaces.keys(), ...changed.keys()]);
      this.#scan(doc);
      this.version += 1;
      return all;
    }
    const dirty = new Set<string>();
    for (const [sf, ids] of changed) {
      const nodes = doc.surfaces.get(sf)?.nodes;
      let hit = false;
      for (const id of ids) {
        const node = nodes?.get(id);
        const tracked = this.#tracked.get(sf);
        const was = tracked?.has(id) === true;
        const now = this.#matches(node);
        if (
          !hit &&
          (was ||
            now ||
            (this.#parent && this.#parents.get(sf)?.has(id) === true) ||
            (this.#children && node?.parent != null && tracked?.has(node.parent) === true))
        )
          hit = true;
        if (was) this.#untrack(sf, tracked!, id);
        if (now) this.#track(sf, id, node!.parent);
      }
      if (hit) dirty.add(sf);
    }
    if (dirty.size > 0) this.version += 1;
    return dirty;
  }
}

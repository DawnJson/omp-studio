// 文件树的纯逻辑：把"已加载的各层列表 + 展开集合"摊平成可虚拟化的行，以及键盘导航。路径一律用 `/` 分隔的相对路径。
import type { DirListing } from "../../../../shared/ipc.ts";

export interface NodeRow {
  type: "node";
  path: string;
  name: string;
  kind: "dir" | "file";
  depth: number;
  ignored: boolean;
  expanded: boolean;
}

/** 目录列表被主进程截断时，跟在这一层最后的提示行。 */
export interface TruncatedRow {
  type: "truncated";
  path: string;
  depth: number;
  shown: number;
}

export type TreeRow = NodeRow | TruncatedRow;

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/** 摊平：展开且已加载的目录，子项紧跟在它后面。没加载完的展开目录暂时没有子项。 */
export function flattenTree(listings: ReadonlyMap<string, DirListing>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    const listing = listings.get(dir);
    if (listing === undefined) return;
    for (const entry of listing.entries) {
      const path = joinPath(dir, entry.name);
      const open = entry.kind === "dir" && expanded.has(path);
      rows.push({
        type: "node",
        path,
        name: entry.name,
        kind: entry.kind,
        depth,
        ignored: entry.ignored,
        expanded: open,
      });
      if (open) walk(path, depth + 1);
    }
    if (listing.truncated)
      rows.push({ type: "truncated", path: `${dir}\0truncated`, depth, shown: listing.entries.length });
  };
  walk("", 0);
  return rows;
}

export type TreeKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "Enter" | " ";

export type TreeAction =
  | { type: "move"; path: string }
  | { type: "expand"; path: string }
  | { type: "collapse"; path: string }
  | { type: "open"; path: string };

/** 当前光标在 path 时，按键产生的动作；没有动作返回 null。active 为 null（还没有光标）时上下键落到第一项。 */
export function treeKeyAction(rows: readonly TreeRow[], active: string | null, key: TreeKey): TreeAction | null {
  const nodes = rows.filter((row): row is NodeRow => row.type === "node");
  if (nodes.length === 0) return null;
  const at = active === null ? -1 : nodes.findIndex((row) => row.path === active);
  const current = at === -1 ? undefined : nodes[at];
  switch (key) {
    case "ArrowDown":
      return { type: "move", path: nodes[Math.min(at + 1, nodes.length - 1)]!.path };
    case "ArrowUp":
      return { type: "move", path: nodes[Math.max(at - 1, 0)]!.path };
    case "Home":
      return { type: "move", path: nodes[0]!.path };
    case "End":
      return { type: "move", path: nodes[nodes.length - 1]!.path };
    case "ArrowRight": {
      if (current?.kind !== "dir") return null;
      if (!current.expanded) return { type: "expand", path: current.path };
      const child = nodes[at + 1];
      return child !== undefined && child.depth > current.depth ? { type: "move", path: child.path } : null;
    }
    case "ArrowLeft": {
      if (current === undefined) return null;
      if (current.kind === "dir" && current.expanded) return { type: "collapse", path: current.path };
      const parent = parentPath(current.path);
      return parent === "" ? null : { type: "move", path: parent };
    }
    case "Enter":
    case " ":
      if (current === undefined) return null;
      if (current.kind === "file") return { type: "open", path: current.path };
      return { type: current.expanded ? "collapse" : "expand", path: current.path };
  }
}

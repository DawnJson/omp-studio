// TSP 节点组件的公共约定（docs/architecture/tsp-migration.md §4.2）：每种节点一个组件，签名都是 NodeProps。
// 组件自己按 id 订阅节点（useTspNode），子节点用 <TspChildren> 画，事件用 ctx.send 发回 omp。
import type { TaskId } from "../../../../shared/ipc.ts";
import type { DocNode } from "../../../../shared/tsp/document.ts";
import type { TspEvent } from "../../../../shared/tsp/tsp.generated.ts";

/** 一个 surface 的渲染上下文，由 TspView 提供给整棵树。 */
export interface TspContext {
  taskId: TaskId;
  /** surface id（事件的 `sf`）。 */
  sf: string;
  /** 发一个终端 → 程序事件；`sf` 由调用方填（一般就是 ctx.sf）。 */
  send(event: TspEvent): void;
  /** 按键字节原样写进伪终端（xterm 序列，见 keys.ts）。 */
  keys(data: string): void;
}

export interface NodeProps {
  node: DocNode;
  ctx: TspContext;
}

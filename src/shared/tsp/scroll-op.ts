// TSP `scroll` 操作（规范 TspScrollBy）：把节点所在的滚动容器移动一行、一屏少一行，或到两端。omp 只在 hello 声明了
// `scroll` 时发：它的面板（/changelog 等报告的正文、审批详情、上下文查看器）收到 PageUp / PageDown / ↑ / ↓ / Home / End
// 后不自己滚，交给终端滚（omp 19.2.1 实测，docs/architecture/tsp-migration.md §7「scroll」）。
// 纯函数：给定滚动容器的尺寸，算出新的 scrollTop；渲染进程（TspView 的 useScrollOps）负责找容器、量行高。
import type { TspScrollBy } from "./tsp.generated.ts";

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** 一行的像素高（容器的行高）。 */
  line: number;
}

/** 执行 `by` 之后容器的 scrollTop，夹在 [0, scrollHeight - clientHeight] 里。 */
export function scrollTopAfter(by: TspScrollBy, box: ScrollBox): number {
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  const page = Math.max(box.line, box.clientHeight - box.line);
  const next = {
    "line-up": box.scrollTop - box.line,
    "line-down": box.scrollTop + box.line,
    "page-up": box.scrollTop - page,
    "page-down": box.scrollTop + page,
    start: 0,
    end: max,
  }[by];
  return Math.min(max, Math.max(0, next));
}

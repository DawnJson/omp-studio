// ```mermaid 画成 SVG 源码（beautiful-mermaid，纯字符串、不碰 DOM）。放在 worker 里：第一张图要初始化 elkjs 布局，
// 主线程上一次就是 90ms 左右，40 个节点的图 50ms（2026-10-27 Node 实测），会卡住滚动和动画。
import type { renderMermaidSVG as RenderMermaidSVG } from "beautiful-mermaid";

export interface MermaidRequest {
  id: number;
  source: string;
}

export type MermaidReply = { id: number; svg: string } | { id: number; error: string };

// elkjs 的 elk-worker 看到"没有 document、有 self"就以为自己是 ELK 的布局 worker 脚本：接管 self.onmessage，
// 不再导出它的同线程 FakeWorker，beautiful-mermaid 一建 ELK 就报 "is not a constructor"。beautiful-mermaid
// 自己想 `delete globalThis.self` 绕开，但 worker 的 self 在原型上、删不掉，事后还要写回 self，而 worker 的 self
// 只读，又报 "Cannot set property self"（2026-10-27 Electron 44 实测）。所以先放一个空的 document（它就不删 self），
// 再把 self 换成可写的自有属性（写回不报错），然后才加载库。
(globalThis as { document?: unknown }).document ??= {};
Object.defineProperty(globalThis, "self", { value: globalThis, writable: true, configurable: true });
const library: Promise<{ renderMermaidSVG: typeof RenderMermaidSVG }> = import("beautiful-mermaid");

// 渲染进程的类型库是 DOM，没有 DedicatedWorkerGlobalScope：只声明这里用到的两个成员。
const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<MermaidRequest>) => void): void;
  postMessage(message: MermaidReply): void;
};

scope.addEventListener("message", ({ data: { id, source } }) => {
  library
    // 画布四周默认留 40px；代码块的 .md-figure 自己有内边距，这里只留一点，图缩到列宽时字不至于更小。
    .then(({ renderMermaidSVG }) => scope.postMessage({ id, svg: renderMermaidSVG(source, { padding: 8 }) }))
    .catch((error: unknown) =>
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
    );
});

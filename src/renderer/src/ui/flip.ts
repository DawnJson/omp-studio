// FLIP 补位（spec §2.6）：容器里带 data-flip-key 的直接子元素，key 集合或顺序变了之后，留下来的元素从旧位置平移回新位置。
// 只动 transform（WAAPI）；时长、曲线读 tokens.css 的 --dur-base / --ease-out；减少动效时不播（只更新记录）。
// 只有 key 序列和上次不同才量位置、才播，所以折叠展开、拖宽、首次渲染、新出现的元素都不会触发位移。
// key 序列没变时不量（父组件每次重渲染都会跑这个 effect）；行的位置在那期间变了（行变高、换行）容器尺寸也会变，
// 由 ResizeObserver 在排版之后重量一次，记录一直是最新的。
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useReducedMotion } from "../features/tsp/use-clock.ts";

interface Snapshot {
  signature: string;
  /** 元素布局位置（不含 FLIP 自己的 transform）：顶边到容器顶边的距离。 */
  tops: Map<string, number>;
}

/** 正在播的 FLIP 动画：打断时用元素当前的 translateY 接着走，不跳。 */
const running = new WeakMap<HTMLElement, Animation>();

function flipTargets(container: HTMLElement): HTMLElement[] {
  return Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.dataset.flipKey !== undefined,
  );
}

/** 当前动画带来的 translateY；没有在播的 FLIP 就是 0。 */
function residual(el: HTMLElement): number {
  if (!running.has(el)) return 0;
  return new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
}

/** 量一次各元素的布局位置；shifts 收集每个元素当前动画带来的位移（播新动画时要接上）。 */
function measure(root: HTMLElement, targets: HTMLElement[], shifts?: Map<HTMLElement, number>): Map<string, number> {
  const rootTop = root.getBoundingClientRect().top;
  const tops = new Map<string, number>();
  for (const el of targets) {
    const shift = residual(el);
    shifts?.set(el, shift);
    tops.set(el.dataset.flipKey as string, el.getBoundingClientRect().top - shift - rootTop);
  }
  return tops;
}

export function useFlip(container: RefObject<HTMLElement | null>): void {
  const reduced = useReducedMotion();
  const last = useRef<Snapshot | null>(null);
  const watched = useRef<{ root: HTMLElement; observer: ResizeObserver } | null>(null);
  useEffect(() => () => watched.current?.observer.disconnect(), []);
  // 没有依赖：每次渲染后比一次 key 序列（只读 DOM 树，不量位置）。
  useLayoutEffect(() => {
    const root = container.current;
    if (watched.current !== null && watched.current.root !== root) {
      watched.current.observer.disconnect();
      watched.current = null;
    }
    if (root === null) {
      last.current = null; // 容器卸载（折叠区收起）后重新挂上算首次渲染，不播
      return;
    }
    if (watched.current === null) {
      const observer = new ResizeObserver(() => {
        const snapshot = last.current;
        if (snapshot !== null) last.current = { signature: snapshot.signature, tops: measure(root, flipTargets(root)) };
      });
      observer.observe(root);
      watched.current = { root, observer };
    }
    const targets = flipTargets(root);
    const signature = targets.map((el) => el.dataset.flipKey).join("\n");
    const before = last.current;
    if (before !== null && before.signature === signature) return;
    const shifts = new Map<HTMLElement, number>();
    const tops = measure(root, targets, shifts);
    last.current = { signature, tops };
    if (before === null || reduced) return;
    const style = getComputedStyle(document.documentElement);
    const duration = Number.parseFloat(style.getPropertyValue("--dur-base"));
    const easing = style.getPropertyValue("--ease-out").trim();
    if (!(duration > 0)) return;
    for (const el of targets) {
      const key = el.dataset.flipKey as string;
      const oldTop = before.tops.get(key);
      if (oldTop === undefined) continue; // 新出现的元素有自己的进入动画
      const delta = oldTop + (shifts.get(el) ?? 0) - (tops.get(key) as number);
      running.get(el)?.cancel();
      running.delete(el);
      if (Math.abs(delta) < 0.5) continue;
      const animation = el.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], {
        duration,
        easing,
      });
      running.set(el, animation);
      const done = () => {
        if (running.get(el) === animation) running.delete(el);
      };
      animation.addEventListener("finish", done);
      animation.addEventListener("cancel", done);
    }
  });
}

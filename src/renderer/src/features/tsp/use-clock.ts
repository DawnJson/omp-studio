// 本地计时(elapsed、tool/agent 的 age、倒计时、spinner 帧):整个渲染进程共用一个 100ms 的定时器,有订阅者才跑。
// "现在"由定时器写进 store,组件渲染时从 store 读,不在渲染里调 Date.now()。
import { useLayoutEffect, useState, useSyncExternalStore } from "react";

const TICK_MS = 100;
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  if (timer === null) {
    // 定时器停着的时候 now 是旧的:先刷新一次,useSyncExternalStore 发现快照变了会重画。
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const subscriber of subscribers) subscriber();
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const noSubscribe = (): (() => void) => () => undefined;
const readNow = (): number => now;

/** active 为 true 时每 100ms 重画一次,返回当前时刻(ms)。active 为 false 时值不更新,不能拿来算时长。 */
export function useClock(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : noSubscribe, readNow);
}

/**
 * 以到达时刻为锚的年龄(规范 elapsed:"A positive age shows age plus the time since that age value arrived"):
 * age 的值变了就重新锚定,其它属性变了不影响计时。running 为 false 时不走字,返回 age 本身。
 */
export function useAge(age: number | undefined, running: boolean): number {
  const [anchor, setAnchor] = useState(() => ({ age, at: Date.now() }));
  // 布局阶段重新锚定:旧锚点算出的那一帧不会被画出来。
  useLayoutEffect(() => {
    setAnchor((current) => (current.age === age ? current : { age, at: Date.now() }));
  }, [age]);
  const current = useClock(running);
  // 时钟最多比锚点旧一个 tick:夹到 0,不倒走。
  return (age ?? 0) + (running ? Math.max(0, current - anchor.at) : 0);
}

function readReducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset["motion"] === "reduced"
  );
}

function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  // 应用内的"减少动效"开关写在 <html data-motion="reduced"> 上（tokens.css）。
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => {
    query.removeEventListener("change", listener);
    observer.disconnect();
  };
}

/** 系统或应用要求减少动效：循环动画（spinner 帧、shimmer）停在静止的第一帧。 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion);
}

// 本地计时(elapsed、tool/agent 的 age、倒计时、spinner 帧):整个渲染进程共用一个 100ms 的定时器,有订阅者才跑。
// "现在"由定时器写进 store,组件渲染时从 store 读,不在渲染里调 Date.now()。每个组件只取它显示要用的那一份
// (spinner 的帧号、按显示精度取整的时长),那一份没变就不重画:整秒显示的计时每秒只画一次。
import { useContext, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { elapsedStep, type ElapsedFormat } from "./fmt.ts";
import { TspEndedAtCtx } from "./tsp-context.ts";

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

/** active 为 true 时跟着共用时钟(100ms)走,返回 select(当前时刻 ms);结果没变(Object.is)就不重画。
 *  active 为 false 时时刻不更新,不能拿来算时长。select 只能依赖时刻和渲染时就定下的值。
 *  任务的进程已经不在(TspEndedAtCtx)时不走,时刻停在进程结束的那一刻。 */
export function useClock<T>(active: boolean, select: (now: number) => T): T {
  const endedAt = useContext(TspEndedAtCtx);
  return useSyncExternalStore(active && endedAt === null ? subscribe : noSubscribe, () => select(endedAt ?? now));
}

/**
 * 以到达时刻为锚的年龄(规范 elapsed:"A positive age shows age plus the time since that age value arrived"):
 * age 的值变了就重新锚定,其它属性变了不影响计时。running 为 false 时不走字,返回 age 本身。
 * 走字时按 formatElapsed(format) 的显示精度向 0 取整(elapsedStep),显示的文字和不取整时一样,只是文字不变时不重画。
 */
export function useAge(age: number | undefined, running: boolean, format: ElapsedFormat = "short"): number {
  const [anchor, setAnchor] = useState(() => ({ age, at: Date.now() }));
  // 布局阶段重新锚定:旧锚点算出的那一帧不会被画出来。
  useLayoutEffect(() => {
    setAnchor((current) => (current.age === age ? current : { age, at: Date.now() }));
  }, [age]);
  const base = age ?? 0;
  return useClock(running, (current) => {
    if (!running) return base;
    // 时钟最多比锚点旧一个 tick:夹到 0,不倒走。
    const value = base + Math.max(0, current - anchor.at);
    const step = elapsedStep(value, format);
    return Math.trunc(value / step) * step;
  });
}

function readReducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset["motion"] === "reduced"
  );
}

// 所有 useReducedMotion 共用一份媒体查询监听和 <html> 上的 MutationObserver,有订阅者才挂。
const motionListeners = new Set<() => void>();
let reducedMotion = false;
let stopMotionWatch: (() => void) | null = null;

function onMotionChange(): void {
  const next = readReducedMotion();
  if (next === reducedMotion) return;
  reducedMotion = next;
  for (const listener of motionListeners) listener();
}

function subscribeReducedMotion(listener: () => void): () => void {
  motionListeners.add(listener);
  if (stopMotionWatch === null) {
    reducedMotion = readReducedMotion();
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener("change", onMotionChange);
    // 应用内的"减少动效"开关写在 <html data-motion="reduced"> 上（tokens.css）。
    const observer = new MutationObserver(onMotionChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    stopMotionWatch = () => {
      query.removeEventListener("change", onMotionChange);
      observer.disconnect();
    };
  }
  return () => {
    motionListeners.delete(listener);
    if (motionListeners.size === 0 && stopMotionWatch !== null) {
      stopMotionWatch();
      stopMotionWatch = null;
    }
  };
}

/** 有订阅时读缓存的值(监听保持它最新);没有订阅时(首次渲染、订阅前)直接读。 */
const readReducedMotionSnapshot = (): boolean => (stopMotionWatch === null ? readReducedMotion() : reducedMotion);

/** 系统或应用要求减少动效：循环动画（spinner 帧、shimmer）停在静止的第一帧。 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotionSnapshot);
}

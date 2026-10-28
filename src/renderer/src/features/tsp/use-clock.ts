// 本地计时(elapsed、tool/agent 的 age、倒计时、spinner 帧):订阅者声明自己的刷新周期,同一周期共用一个定时器,有订阅者才跑。
// 定时器在周期的整倍数(墙钟)醒:整秒显示的计时每秒醒一次、同屏的一起跳,spinner 按它的帧长醒。
// "现在"由定时器写进 store,组件渲染时从 store 读,不在渲染里调 Date.now()。每个组件只取它显示要用的那一份
// (spinner 的帧号、按显示精度取整的时长),那一份没变就不重画。
import { useContext, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { elapsedStep, type ElapsedFormat } from "./fmt.ts";
import { TspEndedAtCtx } from "./tsp-context.ts";

/** 计时最慢的刷新周期:分钟级的显示(1h 02m)也按整秒醒,文字最多晚一秒变。 */
const SECOND_MS = 1000;

interface Cadence {
  subscribers: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  subscribe: (listener: () => void) => () => void;
}

/** 刷新周期(ms) → 订阅者和定时器;subscribe 引用稳定,周期变了 useSyncExternalStore 才换订阅。 */
const cadences = new Map<number, Cadence>();
let now = Date.now();

function schedule(period: number, cadence: Cadence): void {
  cadence.timer = setTimeout(
    () => {
      now = Date.now();
      for (const subscriber of cadence.subscribers) subscriber();
      schedule(period, cadence);
    },
    period - (Date.now() % period),
  );
}

function cadenceSubscribe(period: number): (listener: () => void) => () => void {
  const existing = cadences.get(period);
  if (existing) return existing.subscribe;
  const cadence: Cadence = {
    subscribers: new Set(),
    timer: null,
    subscribe(listener) {
      cadence.subscribers.add(listener);
      if (cadence.timer === null) {
        // 定时器停着的时候 now 是旧的:先刷新一次,useSyncExternalStore 发现快照变了会重画。
        now = Date.now();
        schedule(period, cadence);
      }
      return () => {
        cadence.subscribers.delete(listener);
        if (cadence.subscribers.size === 0 && cadence.timer !== null) {
          clearTimeout(cadence.timer);
          cadence.timer = null;
        }
      };
    },
  };
  cadences.set(period, cadence);
  return cadence.subscribe;
}

const noSubscribe = (): (() => void) => () => undefined;

/** active 为 true 时每 `period` ms(对齐到它的整倍数)取一次 select(当前时刻 ms);结果没变(Object.is)就不重画。
 *  active 为 false 时时刻不更新,不能拿来算时长。select 只能依赖时刻和渲染时就定下的值。
 *  任务的进程已经不在(TspEndedAtCtx)时不走,时刻停在进程结束的那一刻。 */
export function useClock<T>(active: boolean, period: number, select: (now: number) => T): T {
  const endedAt = useContext(TspEndedAtCtx);
  return useSyncExternalStore(active && endedAt === null ? cadenceSubscribe(period) : noSubscribe, () =>
    select(endedAt ?? now),
  );
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
  // 时钟最多比锚点旧一个周期:夹到 0,不倒走。
  const at = (current: number): number => base + Math.max(0, current - anchor.at);
  // 刷新周期 = 文字最少隔多久变(short 不到 1 分钟是 100ms,其余整秒),最慢整秒。
  const period = Math.min(SECOND_MS, elapsedStep(at(now), format));
  return useClock(running, period, (current) => {
    if (!running) return base;
    const value = at(current);
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

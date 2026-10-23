import { useEffect, useState } from "react";

/** 跨过整秒后多等这么久再读时钟：定时器早到几毫秒时也已经在新的一秒里。 */
const SLACK_MS = 20;

/**
 * 每秒刷新一次的"现在"；enabled 为 false 时不开定时器。
 * 刷新对齐到 `anchor` 起算的整秒（显示 `now - anchor` 的计时传开始时刻）：固定 1000ms 的 setInterval 和计时的整秒不同相，
 * 定时器一抖动，相邻两次读数可能落在同一秒或隔一秒，计时就会停一秒再跳两秒（6 → 8）。
 */
export function useNow(enabled: boolean, anchor = 0): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const into = (((current - anchor) % 1000) + 1000) % 1000;
      timer = setTimeout(tick, 1000 - into + SLACK_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, [enabled, anchor]);
  return now;
}

// 退出动画：open 变 false 后元素先留着放完退出动画再卸载。
// 用法：const p = usePresence(open); if (!p.mounted) return null; 根元素上展开 {...p.exitProps}。
// 退出动画由 motion.css 的 [data-closing] 规则给（读 --dur-*-exit 令牌，减少动效时为 0ms，animationend 照样触发）；
// 万一动画没跑起来（元素被 display:none 等），兜底计时器到点也会卸载，不会卡住。
import { useCallback, useEffect, useRef, useState, type AnimationEvent } from "react";

/** 比最长的退出动画（--dur-slow-exit ≈ 192ms）宽裕；只在 animationend 没来时才用到。 */
const exitFallbackMs = 400;

export interface ExitProps {
  "data-closing"?: "pop" | "fade" | undefined;
  /** 退出动画期间已经算"关了"：读屏不再读到、不能聚焦也不能点。 */
  "aria-hidden"?: true | undefined;
  inert?: boolean | undefined;
  onAnimationEnd(event: AnimationEvent<HTMLElement>): void;
}

export interface Presence {
  /** 该渲染吗（打开中或正在放退出动画）。 */
  mounted: boolean;
  /** 正在放退出动画：交互应已失效（CSS 里 pointer-events: none）。 */
  closing: boolean;
  /** 展开到放退出动画的那个元素上；只认它自己的 animationend，子元素冒上来的不算。 */
  exitProps: ExitProps;
}

/** kind：pop = 淡出 + 轻微下沉缩小（浮层、菜单、对话框）；fade = 只淡出（遮罩、整屏层）。 */
export function usePresence(open: boolean, kind: "pop" | "fade" = "pop"): Presence {
  const [mounted, setMounted] = useState(open);
  const closing = mounted && !open;
  const closingRef = useRef(closing);
  closingRef.current = closing;

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const timer = setTimeout(() => setMounted(false), exitFallbackMs);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  return {
    mounted: mounted || open,
    closing,
    exitProps: {
      "data-closing": closing ? kind : undefined,
      "aria-hidden": closing || undefined,
      inert: closing || undefined,
      onAnimationEnd: (event) => {
        if (event.target === event.currentTarget && closingRef.current) setMounted(false);
      },
    },
  };
}

/**
 * 每打开一次换一个值，给"挂载时读数据、记搜索词"的本体当 React key（`ModelPicker`、`UsageDialog`、命令面板）。
 * 退出动画还没放完又打开时 usePresence 不卸载，本体会带着上一次的状态接着用（角色表、额度都是旧的）；换 key 就挂一份新的。
 */
export function useOpenKey(open: boolean): number {
  const [last, setLast] = useState({ open, key: 0 });
  if (last.open !== open) setLast({ open, key: open ? last.key + 1 : last.key });
  return last.key;
}

export interface DialogSlot<T> {
  /** 开着的那一次：key 给对话框当 React key，value 是打开时带的参数。 */
  slot: { key: number; value: T } | null;
  open(value: T): void;
  /** 对话框放完退出动画后调用；只关 key 对得上的那一次。 */
  closed(key: number): void;
  /** 立刻卸掉（不放退出动画），如切换了范围。 */
  reset(): void;
}

/**
 * 自己管开关的对话框（挂上就是打开，关掉后放完退出动画才通知父级卸载）由父级用它记"开着的是哪一次"。
 * 退出动画还没放完又点了打开：换一个 key 立刻开新的；旧实例迟到的通知按 key 对不上，不会把新的关掉。
 */
export function useDialogSlot<T = true>(): DialogSlot<T> {
  const seq = useRef(0);
  const [slot, setSlot] = useState<{ key: number; value: T } | null>(null);
  const open = useCallback((value: T) => setSlot({ key: ++seq.current, value }), []);
  const closed = useCallback((key: number) => setSlot((current) => (current?.key === key ? null : current)), []);
  const reset = useCallback(() => setSlot(null), []);
  return { slot, open, closed, reset };
}

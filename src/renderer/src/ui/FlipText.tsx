// 翻牌文字（spec §2.6「文字变化」）：文字变了只动变的那部分（shared/ui/rolling-text.ts 比对新旧）。
// 只有数字变了：变了的那几位滚动，从右往左每位晚一点起步；数变大旧字向上滚出、新字从下面进来，变小反过来。
// 其他变化：变了的那段旧字淡出、新字淡入。动画放完（最后一个旧字 animationend）收成一段纯文字。
// 减少动效（系统偏好或应用内开关）：直接换。可访问名称 = 完整文字，翻牌的字 aria-hidden，读屏不会一位一位地念。
import { useState, type AnimationEvent, type CSSProperties } from "react";
import { rollParts, type RollPart } from "../../../shared/ui/rolling-text.ts";
import "./flip-text.css";

/** 现在要不要减少动效：系统偏好，或应用内"减少动效"开关（`<html data-motion="reduced">`）。 */
function reducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset["motion"] === "reduced"
  );
}

interface FlipState {
  value: string;
  parts: readonly RollPart[];
  /** 每次变化换一组 key，上一轮没放完的动画从头放新的。 */
  seq: number;
  /** 还没滚完的旧字。 */
  pending: number;
}

export function FlipText({
  value,
  className,
  testId,
  role,
}: {
  value: string;
  className?: string | undefined;
  testId?: string | undefined;
  /** 计时器传 "timer"。 */
  role?: "timer" | undefined;
}) {
  const [state, setState] = useState<FlipState>({ value, parts: [value], seq: 0, pending: 0 });
  // 渲染期间发现文字变了：和上一次显示的文字比对。
  if (state.value !== value) {
    const parts = reducedMotion() ? [value] : rollParts(state.value, value);
    const pending = parts.filter((part) => typeof part !== "string" && part.from !== "").length;
    setState({ value, parts: pending === 0 ? [value] : parts, seq: state.seq + 1, pending });
  }
  const onAnimationEnd = (event: AnimationEvent) => {
    if (!(event.target instanceof HTMLElement) || !event.target.classList.contains("flip-old")) return;
    const seq = state.seq;
    setState((current) => {
      if (current.seq !== seq) return current;
      return current.pending <= 1
        ? { ...current, parts: [current.value], pending: 0 }
        : { ...current, pending: current.pending - 1 };
    });
  };
  return (
    <span
      className={className ? `flip-text ${className}` : "flip-text"}
      role={role}
      aria-label={value}
      data-testid={testId}
      data-value={value}
      onAnimationEnd={onAnimationEnd}
    >
      {state.parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={`${state.seq}-${index}`} aria-hidden="true">
            {part}
          </span>
        ) : (
          <span
            key={`${state.seq}-${index}`}
            className="flip-char"
            data-motion={part.motion}
            data-gone={part.to === "" || undefined}
            style={{ "--flip-delay": `${part.delayMs}ms` } as CSSProperties}
            aria-hidden="true"
          >
            {part.from !== "" && <span className="flip-old">{part.from}</span>}
            {part.to !== "" && <span className="flip-new">{part.to}</span>}
          </span>
        ),
      )}
    </span>
  );
}

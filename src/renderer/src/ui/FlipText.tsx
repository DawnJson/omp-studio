// 翻牌文字：每个字符变了就"滚"一下——旧字符向上滚出、新字符从下面滚进来（计时器 `44m 45s` 这类 tabular 数字用）。
// 字符按"距末尾的位置"配对，所以 `59s` → `1m 0s` 这种长度变化时右边的字符仍对着右边的字符；没变的字符不动。
// 减少动效（系统偏好或应用内开关，tokens.css）：不画旧字符，数字直接换。外层是 `role="timer"`，可访问名称 = 完整文字，
// 单个字符 aria-hidden，读屏不会一位一位地念翻牌。
import { useState } from "react";
import "./flip-text.css";

/** 现在要不要减少动效：系统偏好，或应用内"减少动效"开关（`<html data-motion="reduced">`）。 */
function reducedMotion(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset["motion"] === "reduced"
  );
}

function FlipChar({ ch }: { ch: string }) {
  const [state, setState] = useState<{ cur: string; prev: string | null }>({ cur: ch, prev: null });
  // 渲染期间发现字符变了：记下旧字符（有动画才记），旧字符滚完（animationend）再清掉。
  if (state.cur !== ch) setState({ cur: ch, prev: reducedMotion() ? null : state.cur });
  const flipping = state.prev !== null && state.cur === ch;
  return (
    <span className="flip-char" data-flipping={flipping || undefined} aria-hidden="true">
      {flipping && (
        <span
          className="flip-old"
          onAnimationEnd={() => setState((current) => (current.cur === ch ? { cur: ch, prev: null } : current))}
        >
          {state.prev}
        </span>
      )}
      <span key={ch} className="flip-new">
        {ch}
      </span>
    </span>
  );
}

export function FlipText({
  value,
  className,
  testId,
}: {
  value: string;
  className?: string | undefined;
  testId?: string | undefined;
}) {
  // 从右往左配对：key = 距末尾的位置。
  const chars = [...value];
  return (
    <span
      className={className ? `flip-text ${className}` : "flip-text"}
      role="timer"
      aria-label={value}
      data-testid={testId}
      data-value={value}
    >
      {chars.map((ch, index) => (
        <FlipChar key={chars.length - index} ch={ch} />
      ))}
    </span>
  );
}

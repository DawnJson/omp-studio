// 模型选择对话框里的思考强度分段：选中项下面是一块滑动的"滑块"，切换时滑过去并轻轻弹一下；
// 滑块按档位换效果（关 → 最高越来越"热"，composer.css 的 .thinking-thumb[data-level]）。
// 键盘：←/→ 换档（radiogroup 的标准行为），选中项在 Tab 顺序里。
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { useT } from "../../i18n/use-t.ts";
import { stepThinkingLevel, thinkingLabel } from "./thinking-levels.ts";

interface ThinkingSegmentsProps {
  levels: readonly ThinkingLevel[];
  level: ThinkingLevel | null;
  onPick(level: ThinkingLevel): void;
}

interface ThumbBox {
  left: number;
  width: number;
}

export function ThinkingSegments({ levels, level, onPick }: ThinkingSegmentsProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<ThumbBox | null>(null);
  // 第一次定位不做滑动（否则打开对话框时滑块从最左边滑进来）。
  const [placed, setPlaced] = useState(false);
  const previous = useRef(level);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const measure = () => {
      const checked = root?.querySelector<HTMLElement>('[aria-checked="true"]');
      setBox(checked ? { left: checked.offsetLeft, width: checked.offsetWidth } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [level, levels]);

  useLayoutEffect(() => {
    if (box !== null && !placed) requestAnimationFrame(() => setPlaced(true));
  }, [box, placed]);

  // 换档时滑块弹一下：往高档是放大回弹，往低档是轻轻收一下。时长读 --dur-spring（减少动效时为 0，不弹）。
  useLayoutEffect(() => {
    const from = previous.current;
    previous.current = level;
    const thumb = thumbRef.current;
    if (from === level || level === null || from === null || !placed || thumb === null) return;
    const duration = parseFloat(getComputedStyle(thumb).getPropertyValue("--dur-spring"));
    if (!(duration > 0)) return;
    const up = levels.indexOf(level) > levels.indexOf(from);
    thumb.animate(
      up
        ? [{ transform: "scale(0.9)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }]
        : [{ transform: "scale(1.04)" }, { transform: "scale(0.96)" }, { transform: "scale(1)" }],
      { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [level, levels, placed]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = stepThinkingLevel(levels, level, event.key === "ArrowRight" ? 1 : -1);
    if (next) {
      onPick(next);
      requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
    }
  };

  return (
    <div
      ref={rootRef}
      className="segments thinking-segments"
      role="radiogroup"
      aria-label={t("model.thinking")}
      data-testid="thinking-segments"
      onKeyDown={onKeyDown}
    >
      {box !== null && (
        <span
          ref={thumbRef}
          className="thinking-thumb"
          aria-hidden="true"
          data-level={level ?? undefined}
          data-placed={placed || undefined}
          style={{ left: box.left, width: box.width }}
        />
      )}
      {levels.map((candidate) => (
        <button
          key={candidate}
          type="button"
          role="radio"
          aria-checked={level === candidate}
          tabIndex={level === candidate ? 0 : -1}
          className="segment"
          data-level={candidate}
          data-checked={level === candidate || undefined}
          onClick={() => onPick(candidate)}
        >
          {t(thinkingLabel[candidate] as MessageKey)}
        </button>
      ))}
    </div>
  );
}

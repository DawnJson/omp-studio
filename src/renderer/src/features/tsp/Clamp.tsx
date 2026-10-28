// 行数夹紧（card / tool 的 collapsed + preview，ansi / code 的 preview）：内容超过 N 行时只露出头（lines）或尾（tail），
// 渐隐收口，下面（lines）或上面（tail）一个"N more lines"按钮（文字是 omp 原样的英文，见 labels.ts）。行高取自 --tsp-lh；超出不到一行的零头不算。
// 知道逻辑行数的内容（ansi / code）传 lineCount、children 写成函数：夹紧时只画露出的那几行，被跳过的行直接按行数计入"N more"。
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ChevronDown } from "../../icons.tsx";
import { labels } from "./labels.ts";

interface ClampProps {
  /** 夹紧到几行；null = 不夹。 */
  lines: number | null;
  /** 露出末尾几行（bash 输出）而不是开头。 */
  tail?: boolean;
  /** 点按钮：有就调它（展开祖先），没有就本地展开/收起。 */
  onExpand?: (() => void) | undefined;
  className?: string | undefined;
  /** 内容的逻辑行数（配合函数 children）：超过 lines 时 children 拿到要画的行数（头或尾 n 行；null = 全画），
   *  "N more" = 没画的行数 + 画出的那几行折行后超出的行数。 */
  lineCount?: number | undefined;
  children: ReactNode | ((shown: number | null) => ReactNode);
}

function lineHeight(el: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(el).getPropertyValue("--tsp-lh"));
  return Number.isFinite(value) && value > 0 ? value : 20;
}

export function Clamp({ lines, tail = false, onExpand, className, lineCount, children }: ClampProps) {
  const inner = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const active = lines !== null && lines > 0 && !(expanded && onExpand === undefined);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || lines === null) {
      setMeasured(0);
      return;
    }
    // 挂载 / 从隐藏的视图切回来时不同步量（content-visibility:auto 跳过的块会被强制排版）：ResizeObserver 第一次回调
    // 在浏览器自己排版之后、绘制之前，用它给的高度；flushSync 让夹紧在同一帧画出来，不闪一帧没夹的。
    const observer = new ResizeObserver(([entry]) => {
      const lh = lineHeight(el);
      // 零头不到四分之一行的不算被藏起来的行。
      const extra = (entry!.contentRect.height - lines * lh) / lh;
      flushSync(() => setMeasured(extra > 0.25 ? Math.ceil(extra - 0.25) : 0));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [lines, expanded]);

  const skipped = active && lines !== null && lineCount !== undefined ? Math.max(0, lineCount - lines) : 0;
  const hidden = skipped + measured;
  const clamped = active && hidden > 0;
  const style: CSSProperties | undefined = clamped ? { maxHeight: `calc(${lines} * var(--tsp-lh))` } : undefined;
  const label = (
    <button
      type="button"
      className="tsp-more"
      data-tail={tail || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (onExpand) onExpand();
        else setExpanded(true);
      }}
    >
      {tail ? labels.earlierLines(hidden) : labels.moreLines(hidden)}
      <ChevronDown size={12} />
    </button>
  );
  return (
    <div className={className} data-clamped={clamped || undefined}>
      {clamped && tail && label}
      <div className="tsp-clamp" data-tail={tail || undefined} data-on={clamped || undefined} style={style}>
        <div ref={inner}>{typeof children === "function" ? children(skipped > 0 ? lines : null) : children}</div>
      </div>
      {clamped && !tail && label}
      {!active && expanded && onExpand === undefined && lines !== null && hidden > 0 && (
        <button type="button" className="tsp-more" onClick={() => setExpanded(false)}>
          {labels.showLess}
        </button>
      )}
    </div>
  );
}

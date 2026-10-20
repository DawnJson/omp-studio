// 行数夹紧（card / tool 的 collapsed + preview，ansi / code 的 preview）：内容超过 N 行时只露出头（lines）或尾（tail），
// 渐隐收口，下面（lines）或上面（tail）一个"还有 N 行"按钮。行高取自 --tsp-lh；超出不到一行的零头不算。
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "../../i18n/use-t.ts";
import { ChevronDown } from "../../icons.tsx";

interface ClampProps {
  /** 夹紧到几行；null = 不夹。 */
  lines: number | null;
  /** 露出末尾几行（bash 输出）而不是开头。 */
  tail?: boolean;
  /** 点按钮：有就调它（展开祖先），没有就本地展开/收起。 */
  onExpand?: (() => void) | undefined;
  className?: string | undefined;
  children: ReactNode;
}

function lineHeight(el: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(el).getPropertyValue("--tsp-lh"));
  return Number.isFinite(value) && value > 0 ? value : 20;
}

export function Clamp({ lines, tail = false, onExpand, className, children }: ClampProps) {
  const t = useT();
  const inner = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const active = lines !== null && lines > 0 && !(expanded && onExpand === undefined);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || lines === null) {
      setHidden(0);
      return;
    }
    const measure = (): void => {
      const lh = lineHeight(el);
      // 零头不到四分之一行的不算被藏起来的行。
      const extra = (el.offsetHeight - lines * lh) / lh;
      setHidden(extra > 0.25 ? Math.ceil(extra - 0.25) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [lines, expanded]);

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
      {t(tail ? "tsp.earlierLines" : "tsp.moreLines", { count: hidden })}
      <ChevronDown size={12} />
    </button>
  );
  return (
    <div className={className} data-clamped={clamped || undefined}>
      {clamped && tail && label}
      <div className="tsp-clamp" data-tail={tail || undefined} data-on={clamped || undefined} style={style}>
        <div ref={inner}>{children}</div>
      </div>
      {clamped && !tail && label}
      {!active && expanded && onExpand === undefined && lines !== null && hidden > 0 && (
        <button type="button" className="tsp-more" onClick={() => setExpanded(false)}>
          {t("tsp.showLess")}
        </button>
      )}
    </div>
  );
}

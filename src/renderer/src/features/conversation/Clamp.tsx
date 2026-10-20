// 通用截断块（spec 3.1 §2 第 4 行）：最多显示 lines 行，超出部分在底部渐隐（mask-image，不硬切），
// 下面一行小字"还有 N 行 · 全部显示"；展开后变"收起"。内容没有超出时什么都不多画。
// 行数靠测量：折叠时的可见高度正好是 lines 行，隐藏的行数 = 多出的高度 / 单行高度。
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "../../i18n/use-t.ts";

/** 展开后最多再长到这么多行，更长的内容在块内滚动（几千行的输出不把整个对话撑开）。 */
const EXPANDED_LINES = 40;

export function Clamp({
  lines,
  lineHeight,
  children,
  className,
}: {
  lines: number;
  /** 一行的高度（CSS 值，如 `var(--lh-code-sm)`）；折叠高度 = lines × lineHeight。 */
  lineHeight: string;
  children: ReactNode;
  className?: string;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body || expanded) return;
    const measure = () => {
      const extra = body.scrollHeight - body.clientHeight;
      const unit = body.clientHeight / lines;
      setHidden(extra > 1 && unit > 0 ? Math.max(1, Math.round(extra / unit)) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    for (const child of Array.from(body.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [children, expanded, lines]);

  const style = { "--clamp-lines": lines, "--clamp-max": EXPANDED_LINES, "--clamp-lh": lineHeight } as CSSProperties;
  const overflowing = hidden > 0 || expanded;
  return (
    <div className={className === undefined ? "clamp" : `clamp ${className}`} style={style}>
      <div
        ref={bodyRef}
        className="clamp-body"
        data-expanded={expanded || undefined}
        data-fading={(!expanded && hidden > 0) || undefined}
      >
        {children}
      </div>
      {overflowing && (
        <div className="clamp-more">
          {!expanded && (
            <>
              {t("tool.output.more", { count: hidden })}
              {" · "}
            </>
          )}
          <button
            type="button"
            className="clamp-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? t("tool.output.collapse") : t("tool.output.showAll")}
          </button>
        </div>
      )}
    </div>
  );
}

// 对话列拖拽条（spec §3.2）：贴在对话列右缘（命中区 8px，竖跨滚动区），拖动改对话列宽度；列居中，所以列宽变化是拖动量的两倍。
// 宽度存成占主区面板的百分比（ShellState.conversationWidth），窗口放大缩小时列跟着按比例变。拖动中只改 .panel 上的 --content-ratio
// 和自己的 aria-valuenow（不写 store，不重渲染）；松手 commit。双击回默认（80%），←/→ 每次右缘移 16px。
// 主区放不下比最窄（840）更宽的列（主区 − 2×留白 ≤ 840）时不画。拖动中 useColumns 不通知 omp 改列数，松手再量一次（omp 整篇重排一次）。
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { limits } from "../../../../shared/ipc.ts";
import { commitConversationWidth, useShellValue } from "../../app/shell-store.ts";
import { useT } from "../../i18n/use-t.ts";

const defaultRatio = 80;
const keyboardStep = 16;

let dragging = false;
const dragEndListeners = new Set<() => void>();

/** 正在拖对话列：列宽一直在变，先不通知 omp。 */
export function columnDragging(): boolean {
  return dragging;
}

/** 拖完（松手或取消）时调用；返回取消订阅。 */
export function onColumnDragEnd(listener: () => void): () => void {
  dragEndListeners.add(listener);
  return () => {
    dragEndListeners.delete(listener);
  };
}

function setDragging(next: boolean): void {
  dragging = next;
  if (!next) for (const listener of dragEndListeners) listener();
}

interface Metrics {
  /** 主区面板内宽（cqi 的基准）。 */
  panel: number;
  /** 列能到的最宽：min(1200, 主区 − 2×留白)。 */
  max: number;
  /** 列能到的最窄：840（主区更窄时就是主区 − 2×留白）。 */
  min: number;
}

function cssPx(el: Element, name: string, fallback: number): number {
  const value = Number.parseFloat(getComputedStyle(el).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function metrics(panel: HTMLElement): Metrics {
  const width = panel.clientWidth;
  const available = width - 2 * cssPx(panel, "--gutter", 24);
  return {
    panel: width,
    max: Math.min(cssPx(panel, "--content-w-max", 1200), available),
    min: Math.min(cssPx(panel, "--content-w-min", 840), available),
  };
}

function toRatio(width: number, m: Metrics): number {
  const [min, max] = limits.conversationWidthRange;
  return Math.round(Math.min(max, Math.max(min, (width / m.panel) * 100)) * 100) / 100;
}

export function ColumnResizer({
  column,
  scroller,
}: {
  column: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const stored = useShellValue("conversationWidth");
  const ratio = stored ?? defaultRatio;
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; metrics: Metrics; panel: HTMLElement } | null>(null);
  // 竖向只跨滚动区（不盖住下面的 dock 里的提问卡片）；主区太窄时不画。
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const el = scroller.current;
    const panel = el?.closest<HTMLElement>(".panel");
    if (!el || !panel) return;
    const measure = () => {
      const m = metrics(panel);
      setBox((current) => {
        if (m.max <= m.min) return null;
        const next = { top: el.offsetTop, height: el.offsetHeight };
        return current?.top === next.top && current.height === next.height ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [scroller]);

  // 拖动中被卸载（切任务、主区变窄）：别让 omp 一直收不到列数。
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        setDragging(false);
      }
    },
    [],
  );

  if (box === null) return null;

  /** 拖动中的宽度直接写到 DOM；取消拖动时用它还原成已提交的宽度。 */
  const show = (panel: HTMLElement, next: number | null) => {
    if (next === null) panel.style.removeProperty("--content-ratio");
    else panel.style.setProperty("--content-ratio", `${next}cqi`);
    handle.current?.setAttribute("aria-valuenow", String(next ?? defaultRatio));
  };
  const dragged = (event: PointerEvent<HTMLDivElement>): number => {
    const d = drag.current!;
    const width = Math.min(d.metrics.max, Math.max(d.metrics.min, d.startWidth + 2 * (event.clientX - d.startX)));
    return toRatio(width, d.metrics);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.closest<HTMLElement>(".panel");
    const col = column.current;
    if (event.button !== 0 || !panel || !col) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startWidth: col.getBoundingClientRect().width,
      metrics: metrics(panel),
      panel,
    };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) show(drag.current.panel, dragged(event));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // 只是点了一下（双击的前两次按下）：不把默认宽度写成数字，DOM 还原成已提交的宽度。
    const next = event.clientX === d.startX ? null : dragged(event);
    drag.current = null;
    show(d.panel, next ?? stored);
    if (next !== null) commitConversationWidth(next);
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const panel = event.currentTarget.closest<HTMLElement>(".panel");
    const col = column.current;
    if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || !panel || !col) return;
    event.preventDefault();
    const m = metrics(panel);
    const step = (event.key === "ArrowRight" ? 2 : -2) * keyboardStep;
    commitConversationWidth(toRatio(Math.min(m.max, Math.max(m.min, col.getBoundingClientRect().width + step)), m));
  };

  return (
    <div
      ref={handle}
      className="tsp-column-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("conversation.resizeColumn")}
      aria-valuemin={limits.conversationWidthRange[0]}
      aria-valuemax={limits.conversationWidthRange[1]}
      aria-valuenow={ratio}
      tabIndex={0}
      data-testid="column-resizer"
      style={{ top: box.top, height: box.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        show(d.panel, stored);
        setDragging(false);
      }}
      onDoubleClick={() => commitConversationWidth(null)}
      onKeyDown={onKeyDown}
    />
  );
}

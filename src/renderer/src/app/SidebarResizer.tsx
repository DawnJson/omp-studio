// 侧栏拖拽条（命中区 4px，贴在主区面板左缘）：拖动改宽度，松手持久化；双击恢复默认；←/→ 微调。
// 拖动中只改侧栏列的 CSS 变量和自己的 aria-valuenow（不写 store，不重渲染外壳）；松手时 commit。
import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { clampSidebarWidth, commitSidebarWidth, defaultSidebarWidth, sidebarWidthRange } from "./shell-store.ts";

const keyboardStep = 16;

export function SidebarResizer({ width, column }: { width: number; column: RefObject<HTMLElement | null> }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  /** 拖动中的宽度直接写到 DOM；取消拖动时用它还原成已提交的宽度。 */
  const show = (handle: HTMLElement, next: number) => {
    column.current?.style.setProperty("--sidebar-current", `${next}px`);
    handle.setAttribute("aria-valuenow", String(next));
  };
  const dragged = (event: PointerEvent<HTMLDivElement>) =>
    drag.current ? clampSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX) : width;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) show(event.currentTarget, dragged(event));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    commitSidebarWidth(dragged(event));
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    commitSidebarWidth(width + (event.key === "ArrowRight" ? keyboardStep : -keyboardStep));
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={sidebarWidthRange[0]}
      aria-valuemax={sidebarWidthRange[1]}
      aria-valuenow={width}
      tabIndex={0}
      data-testid="sidebar-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => {
        if (!drag.current) return;
        drag.current = null;
        show(event.currentTarget, width);
      }}
      onDoubleClick={() => commitSidebarWidth(defaultSidebarWidth)}
      onKeyDown={onKeyDown}
    />
  );
}

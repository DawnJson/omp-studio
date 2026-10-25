// 侧栏拖拽条（命中区 4px，贴在主区面板左缘）：拖动改宽度，松手持久化；双击恢复默认；←/→ 微调。
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import {
  commitSidebarWidth,
  defaultSidebarWidth,
  previewSidebarWidth,
  setSidebarResizing,
  sidebarWidthRange,
} from "./shell-store.ts";

const keyboardStep = 16;

export function SidebarResizer({ width }: { width: number }) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    setSidebarResizing(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) previewSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    commitSidebarWidth(drag.current.startWidth + event.clientX - drag.current.startX);
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
      onLostPointerCapture={() => setSidebarResizing(false)}
      onDoubleClick={() => commitSidebarWidth(defaultSidebarWidth)}
      onKeyDown={onKeyDown}
    />
  );
}

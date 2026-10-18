// 轻量弹出菜单（任务行和项目头的右键 / … 菜单）：固定定位、方向键移动、Esc 关闭并把焦点还给触发它的元素。
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  id: string;
  label: string;
  /** 右侧键帽文字，如 "F2"。 */
  shortcut?: string;
  onSelect(): void;
}

export interface MenuAnchor {
  x: number;
  y: number;
  /** 关闭后接收焦点的元素（打开前的 activeElement）。 */
  returnFocus: HTMLElement | null;
}

const edge = 8;

export function Menu({
  anchor,
  items,
  label,
  onClose,
}: {
  anchor: MenuAnchor;
  items: MenuItem[];
  label: string;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  // 贴边时翻到锚点另一侧，保证整个菜单在窗口内。
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPosition({
      left: Math.max(edge, Math.min(anchor.x, window.innerWidth - box.width - edge)),
      top: Math.max(edge, Math.min(anchor.y, window.innerHeight - box.height - edge)),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const close = () => {
    onClose();
    anchor.returnFocus?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      buttons[(to + buttons.length) % buttons.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(buttons.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  return (
    <div ref={ref} className="sb-menu" role="menu" aria-label={label} style={position} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="sb-menu-item"
          onClick={() => {
            onClose();
            // 菜单项可能要弹重命名输入框或抢焦点，所以先把焦点还回去，再执行。
            anchor.returnFocus?.focus();
            item.onSelect();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut !== undefined && <kbd className="kbd">{item.shortcut}</kbd>}
        </button>
      ))}
    </div>
  );
}

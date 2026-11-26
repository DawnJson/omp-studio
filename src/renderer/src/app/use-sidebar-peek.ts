// 侧栏悬停预览（spec §2.6「侧栏悬停预览」，所有者定 2026-11-26）：宽窗口收起侧栏后，鼠标停在窗口最左边的热区
// openDelayMs 才把侧栏盖在主区上滑出来（路过不算），离开侧栏 closeDelayMs 后收回；侧栏里的菜单、对话框开着时不收。
// 状态：null（没预览）→ open → closing（放 peek-out，animationend 后回 null）。主区宽度一直不变。
import { useCallback, useEffect, useRef, useState, type AnimationEvent, type PointerEvent } from "react";

const openDelayMs = 200;
const closeDelayMs = 300;
/** 收回动画没放出来（被 display:none 等）时兜底，比 peek-out 宽裕。 */
const closeFallbackMs = 400;

export type PeekState = "open" | "closing" | null;

/** 浮层（菜单、下拉、对话框）开着：预览不开、不收，免得菜单被盖住或侧栏从菜单底下抽走。 */
function popupOpen(): boolean {
  return document.querySelector('[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]') !== null;
}

export interface SidebarPeek {
  state: PeekState;
  /** 左边缘热区。 */
  zone: {
    onPointerEnter(event: PointerEvent<HTMLElement>): void;
    onPointerLeave(): void;
  };
  /** 侧栏列。 */
  column: {
    onPointerEnter(): void;
    onPointerLeave(event: PointerEvent<HTMLElement>): void;
    onAnimationEnd(event: AnimationEvent<HTMLElement>): void;
  };
}

/** `enabled`：宽窗口且侧栏收起时才有预览；变成 false（展开了、变窄了）立刻清掉。 */
export function useSidebarPeek(enabled: boolean): SidebarPeek {
  const [state, setState] = useState<PeekState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clear = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => {
    if (!enabled) {
      clear();
      setState(null);
    }
  }, [enabled, clear]);
  useEffect(() => clear, [clear]);

  const scheduleClose = useCallback(
    (buttons: number) => {
      clear();
      const tryClose = () => {
        // 按着键（拖文件夹、选文字）或浮层开着时再等一轮。
        if (buttons !== 0 || popupOpen()) {
          buttons = 0;
          timer.current = setTimeout(tryClose, closeDelayMs);
          return;
        }
        setState("closing");
        timer.current = setTimeout(() => setState(null), closeFallbackMs);
      };
      timer.current = setTimeout(tryClose, closeDelayMs);
    },
    [clear],
  );

  return {
    state,
    zone: {
      onPointerEnter: (event) => {
        if (!enabled) return;
        clear();
        if (stateRef.current !== null) {
          setState("open");
          return;
        }
        if (event.buttons !== 0) return;
        timer.current = setTimeout(() => {
          if (!popupOpen()) setState("open");
        }, openDelayMs);
      },
      onPointerLeave: () => {
        // 还没打开就离开：路过，取消；已经开了，鼠标是进了侧栏（它盖在热区上），由侧栏自己管。
        if (stateRef.current === null) clear();
      },
    },
    column: {
      onPointerEnter: () => {
        if (stateRef.current === null) return;
        clear();
        if (stateRef.current === "closing") setState("open");
      },
      onPointerLeave: (event) => {
        if (stateRef.current === "open") scheduleClose(event.buttons);
      },
      onAnimationEnd: (event) => {
        if (event.target === event.currentTarget && event.animationName === "peek-out") {
          clear();
          setState(null);
        }
      },
    },
  };
}

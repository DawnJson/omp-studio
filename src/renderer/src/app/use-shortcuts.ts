// 全局快捷键（spec §5.1）：Ctrl N / Ctrl Shift N / K / , / B / J / L / 1…9、Ctrl Alt ↑↓、F6、Alt+←/→、单按 Alt 开应用菜单。
// 窗口内的 keydown 监听，不注册系统级快捷键。输入框里只有带 Ctrl/Alt 修饰的键会走到这里。
import { useEffect, useRef } from "react";

export interface ShortcutActions {
  newTask(): void;
  newTaskInCurrentProject(): void;
  jumpToWaiting(): void;
  focusComposer(): void;
  /** 第 n 个任务（1 起，侧栏可见顺序）。 */
  nthTask(n: number): void;
  /** 上/下一个任务，循环。 */
  cycleTask(delta: 1 | -1): void;
  /** F6：在 侧栏 → 对话区 → 输入框 之间循环。 */
  cycleRegion(delta: 1 | -1): void;
  togglePalette(): void;
  openSettings(): void;
  toggleSidebar(): void;
  goBack(): void;
  goForward(): void;
  toggleMenu(): void;
  /** Ctrl Shift D：打开当前任务的评审。 */
  openReview(): void;
  /** Esc 栈第 5 层：侧栏抽屉打开时收起。返回是否处理了。 */
  closeDrawer(): boolean;
}

export function useShortcuts(actions: ShortcutActions): void {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    let altAlone = false;

    const onKeyDown = (event: KeyboardEvent) => {
      const act = latest.current;
      altAlone = event.key === "Alt" && !event.repeat;
      if (event.defaultPrevented) return;

      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        const handlers: Record<string, () => void> = event.shiftKey
          ? { n: act.newTaskInCurrentProject, d: act.openReview }
          : {
              n: act.newTask,
              k: act.togglePalette,
              ",": act.openSettings,
              b: act.toggleSidebar,
              j: act.jumpToWaiting,
              l: act.focusComposer,
            };
        const key = event.key.toLowerCase();
        const handler = handlers[key] ?? (/^[1-9]$/.test(key) ? () => act.nthTask(Number(key)) : undefined);
        if (handler) {
          event.preventDefault();
          handler();
        }
        return;
      }
      if (
        event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        !event.metaKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        event.preventDefault();
        act.cycleTask(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (event.key === "F6" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        act.cycleRegion(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          act.goBack();
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          act.goForward();
        }
        return;
      }
      if (event.key === "Escape" && act.closeDrawer()) event.preventDefault();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt" && altAlone) {
        event.preventDefault();
        latest.current.toggleMenu();
      }
      altAlone = false;
    };

    // 按住 Alt 时点鼠标不算"单按 Alt"。
    const cancelAlt = () => {
      altAlone = false;
    };

    // 鼠标侧键（button 3 = 后退，4 = 前进）：顶栏没有前进后退按钮，侧键和 Alt+←/→ 是仅有的入口。
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) latest.current.goBack();
      else latest.current.goForward();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointerdown", cancelAlt, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointerdown", cancelAlt, true);
    };
  }, []);
}

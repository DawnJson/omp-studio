// 全局快捷键（spec §5.1）：Ctrl N / Ctrl Shift N / Ctrl Shift O / Ctrl Shift D / Ctrl Shift E / K / F / , / B / J / L / 1…9、Ctrl Shift [ ]、F6、Alt+←/→。
// 窗口内的 keydown 监听，不注册系统级快捷键。输入框里只有带 Ctrl/Alt 修饰的键会走到这里；单独按下/松开修饰键（Alt、Ctrl、Shift）不触发任何动作。
import { useEffect, useRef } from "react";

export interface ShortcutActions {
  newTask(): void;
  newTaskInCurrentProject(): void;
  jumpToWaiting(): void;
  focusComposer(): void;
  /** 第 n 个任务（1 起，侧栏可见顺序）。 */
  nthTask(n: number): void;
  /** Ctrl Shift [ / ]：上/下一个任务，循环。 */
  cycleTask(delta: 1 | -1): void;
  /** F6：在 侧栏 → 对话区 → 输入框 之间循环。 */
  cycleRegion(delta: 1 | -1): void;
  togglePalette(): void;
  /** Ctrl F：聚焦侧栏搜索框并全选（侧栏收起时先展开）。 */
  focusSidebarSearch(): void;
  /** Ctrl Shift O：打开文件夹（同侧栏"打开文件夹"）。 */
  openFolder(): void;
  openSettings(): void;
  toggleSidebar(): void;
  goBack(): void;
  goForward(): void;
  /** Ctrl Shift D：打开当前任务的评审。 */
  openReview(): void;
  /** Ctrl Shift E：打开 / 关闭当前任务（或有项目的草稿）的文件面板。 */
  toggleFilesPanel(): void;
  /** Ctrl `：终端 打开 / 聚焦 / 收起并回到输入框。 */
  toggleTerminalFocus(): void;
  /** Esc 栈第 5 层：侧栏抽屉打开时收起。返回是否处理了。 */
  closeDrawer(): boolean;
}

export function useShortcuts(actions: ShortcutActions): void {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const act = latest.current;
      if (event.defaultPrevented) return;

      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        // 上/下一个任务按物理键位认：Shift 会把 [ ] 变成 { }，别的布局上字符也不同。
        if (event.shiftKey && (event.code === "BracketLeft" || event.code === "BracketRight")) {
          event.preventDefault();
          act.cycleTask(event.code === "BracketRight" ? 1 : -1);
          return;
        }
        const handlers: Record<string, () => void> = event.shiftKey
          ? { n: act.newTaskInCurrentProject, d: act.openReview, o: act.openFolder, e: act.toggleFilesPanel }
          : {
              n: act.newTask,
              k: act.togglePalette,
              f: act.focusSidebarSearch,
              ",": act.openSettings,
              b: act.toggleSidebar,
              j: act.jumpToWaiting,
              l: act.focusComposer,
              "`": act.toggleTerminalFocus,
            };
        const key = event.key.toLowerCase();
        const handler = handlers[key] ?? (/^[1-9]$/.test(key) ? () => act.nthTask(Number(key)) : undefined);
        if (handler) {
          event.preventDefault();
          handler();
        }
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

    // 鼠标侧键（button 3 = 后退，4 = 前进）：顶栏没有前进后退按钮，侧键和 Alt+←/→ 是仅有的入口。
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) latest.current.goBack();
      else latest.current.goForward();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);
}

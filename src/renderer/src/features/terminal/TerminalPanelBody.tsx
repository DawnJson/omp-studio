// 终端面板本体：顶边拖拽条、头部（shell 和目录）、xterm。和 xterm 一起按需加载（TerminalPanel 第一次打开时才载入这个模块）。
// 高度存在外壳状态里（和侧栏宽度一样持久化），渲染时夹到 [120px, 主区高度的 70%]；拖动中只改 DOM，松手才写 store。
import "@xterm/xterm/css/xterm.css";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { clampTerminalHeight, cwdLabel, defaultTerminalHeight } from "../../../../shared/ui/terminal-model.ts";
import { commitTerminalHeight, useShellValue } from "../../app/shell-store.ts";
import { useT } from "../../i18n/use-t.ts";
import { withShortcut } from "../../app/platform-keys.ts";
import { Close, Restart, Terminal } from "../../icons.tsx";
import { useAppInfo } from "../../store/index.ts";
import { IconButton } from "../../ui/controls.tsx";
import type { ExitProps } from "../../ui/presence.ts";
import { setTerminalOpen } from "./terminal-store.ts";
import { useTerminalSession } from "./use-terminal-session.ts";
import "./terminal.css";

const keyboardStep = 16;

export function TerminalPanelBody({ terminalKey, exitProps }: { terminalKey: TerminalKey; exitProps: ExitProps }) {
  const t = useT();
  const platform = useAppInfo()?.platform ?? "win32";
  const terminalHeight = useShellValue("terminalHeight");
  const root = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const [containerHeight, setContainerHeight] = useState(Number.POSITIVE_INFINITY);
  const session = useTerminalSession(terminalKey, host, platform);

  // 主区面板（父元素）高度变化时重新夹取：窗口缩小后终端不能把对话区挤没。
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const measure = () => setContainerHeight(parent.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const height = clampTerminalHeight(terminalHeight, containerHeight);

  /** 拖动中的高度直接写到 DOM；取消拖动时用它还原成已提交的高度。 */
  const show = (handle: HTMLElement, next: number) => {
    if (root.current) root.current.style.height = `${next}px`;
    handle.setAttribute("aria-valuenow", String(next));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: height };
  };
  // 向上拖 = 变高。
  const dragged = (event: PointerEvent<HTMLDivElement>) =>
    clampTerminalHeight(
      drag.current ? drag.current.startHeight + drag.current.startY - event.clientY : height,
      containerHeight,
    );
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) show(event.currentTarget, dragged(event));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    commitTerminalHeight(dragged(event));
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    commitTerminalHeight(
      clampTerminalHeight(height + (event.key === "ArrowUp" ? keyboardStep : -keyboardStep), containerHeight),
    );
  };

  return (
    <section
      ref={root}
      className="terminal-panel"
      {...exitProps}
      data-testid="terminal-panel"
      aria-label={t("terminal.title")}
      style={{ height }}
    >
      <div
        className="terminal-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("terminal.resize")}
        aria-valuemin={120}
        aria-valuenow={height}
        tabIndex={0}
        data-testid="terminal-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(event) => {
          if (!drag.current) return;
          drag.current = null;
          show(event.currentTarget, height);
        }}
        onDoubleClick={() => commitTerminalHeight(defaultTerminalHeight)}
        onKeyDown={onKeyDown}
      />
      <header className="terminal-head">
        <Terminal size={14} />
        <span className="terminal-shell" data-testid="terminal-shell">
          {session.shell ?? t("terminal.title")}
        </span>
        {session.cwd !== null && (
          <span className="terminal-cwd" title={session.cwd} data-testid="terminal-cwd">
            {cwdLabel(session.cwd)}
          </span>
        )}
        <span className="terminal-spacer" />
        <IconButton label={t("terminal.restart")} testId="terminal-restart" onClick={session.restart}>
          <Restart size={14} />
        </IconButton>
        <IconButton
          label={t("terminal.hide")}
          tip={withShortcut(t("terminal.hide"), "Ctrl `")}
          testId="terminal-hide"
          onClick={() => setTerminalOpen(terminalKey, false)}
        >
          <Close size={14} />
        </IconButton>
      </header>
      <div className="terminal-body">
        <div ref={host} className="terminal-host" data-terminal-host data-testid="terminal-host" />
      </div>
    </section>
  );
}

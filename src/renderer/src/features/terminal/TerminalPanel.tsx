// 内置终端面板（spec §4.19）：主区底部，顶边是拖拽条，头部显示 shell 和目录，下面是 xterm。
// 高度存在外壳状态里（和侧栏宽度一样持久化），渲染时夹到 [120px, 主区高度的 70%]。
import "@xterm/xterm/css/xterm.css";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { clampTerminalHeight, cwdLabel, defaultTerminalHeight } from "../../../../shared/ui/terminal-model.ts";
import { commitTerminalHeight, previewTerminalHeight, useShellUi } from "../../app/shell-store.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Restart, Terminal } from "../../icons.tsx";
import { useAppInfo } from "../../store/index.ts";
import { IconButton } from "../../ui/controls.tsx";
import { usePresence, type ExitProps } from "../../ui/presence.ts";
import { setTerminalOpen } from "./terminal-store.ts";
import { useTerminalSession } from "./use-terminal-session.ts";
import "./terminal.css";

const keyboardStep = 16;

/** 开关外壳：关闭时先放淡出再卸载 xterm；高度不做逐帧动画（主区靠 ResizeObserver 保阅读锚点），一步到位。 */
export function TerminalPanel({ terminalKey, open }: { terminalKey: TerminalKey; open: boolean }) {
  const presence = usePresence(open, "fade");
  if (!presence.mounted) return null;
  return <TerminalPanelBody terminalKey={terminalKey} exitProps={presence.exitProps} />;
}

function TerminalPanelBody({ terminalKey, exitProps }: { terminalKey: TerminalKey; exitProps: ExitProps }) {
  const t = useT();
  const platform = useAppInfo()?.platform ?? "win32";
  const { terminalHeight } = useShellUi();
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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startHeight: height };
  };
  // 向上拖 = 变高。
  const dragged = (event: PointerEvent<HTMLDivElement>) =>
    drag.current ? drag.current.startHeight + drag.current.startY - event.clientY : height;
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) previewTerminalHeight(clampTerminalHeight(dragged(event), containerHeight));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    commitTerminalHeight(clampTerminalHeight(dragged(event), containerHeight));
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
        onPointerCancel={() => {
          drag.current = null;
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
          tip={`${t("terminal.hide")} (Ctrl \`)`}
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

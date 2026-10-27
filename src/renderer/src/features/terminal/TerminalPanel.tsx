// 内置终端面板（spec §4.19）：主区底部，顶边是拖拽条，头部显示 shell 和目录，下面是 xterm。
// 这里只是开关外壳（留在主包里）；面板本体连同 xterm 按需加载（TerminalPanelBody.tsx，窗口淡入后空闲时预载）。
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { lazyView } from "../../ui/lazy-view.ts";
import { usePresence } from "../../ui/presence.ts";

const body = lazyView(() => import("./TerminalPanelBody.tsx").then((module) => module.TerminalPanelBody));

export const preloadTerminalPanel = body.preload;

/** 开关外壳：关闭时先放淡出再卸载 xterm；高度不做逐帧动画（主区靠 ResizeObserver 保阅读锚点），一步到位。 */
export function TerminalPanel({ terminalKey, open }: { terminalKey: TerminalKey; open: boolean }) {
  const presence = usePresence(open, "fade");
  if (!presence.mounted) return null;
  return <body.View terminalKey={terminalKey} exitProps={presence.exitProps} />;
}

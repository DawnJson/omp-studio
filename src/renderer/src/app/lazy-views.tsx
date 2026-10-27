// 按需加载的视图（ui/lazy-view.ts，各自一个 chunk，不进入口包）：设置、评审、命令面板、子代理面板、文件预览、
// git 对话框、会话信息 / 分享、omp 准备页。内置终端的 xterm 在 features/terminal/TerminalPanel.tsx 里同样按需加载。
// 挂载点（宿主）在第一次要打开时才挂上并开始加载，之后一直挂着：宿主自己管开关、放退出动画。
import { useState } from "react";
import { useGitDialog } from "../features/git/git-dialog-store.ts";
import { useSessionInfoState, useShareDialogTask } from "../features/session-info/session-info-store.ts";
import { preloadTerminalPanel } from "../features/terminal/TerminalPanel.tsx";
import { useOmpStatus, usePaletteOpen } from "../store/index.ts";
import { useReviewTaskId } from "../store/review-store.ts";
import { lazyView } from "../ui/lazy-view.ts";

const settingsView = lazyView(() =>
  import("../features/settings/SettingsView.tsx").then((module) => module.SettingsView),
);
const settingsNav = lazyView(() => import("../features/settings/SettingsNav.tsx").then((module) => module.SettingsNav));
const agentsPanel = lazyView(() => import("../features/agents/AgentsPanel.tsx").then((module) => module.AgentsPanel));
const filePreviewPane = lazyView(() =>
  import("../features/file-preview/FilePreviewPane.tsx").then((module) => module.FilePreviewPane),
);
const reviewHost = lazyView(() => import("../features/review/ReviewHost.tsx").then((module) => module.ReviewHost));
const gitDialogHost = lazyView(() => import("../features/git/GitDialogs.tsx").then((module) => module.GitDialogHost));
const sessionInfoHost = lazyView(() =>
  import("../features/session-info/SessionInfoHost.tsx").then((module) => module.SessionInfoHost),
);
const ompSetupView = lazyView(() =>
  import("../features/omp-setup/OmpSetupView.tsx").then((module) => module.OmpSetupView),
);
const commandPalette = lazyView(() =>
  import("../features/palette/CommandPalette.tsx").then((module) => module.CommandPalette),
);

/**
 * 窗口淡入之后空闲时载入常用的几个：命令面板是键盘入口（Ctrl K 后立刻打字不丢键），设置和终端打开得最多。
 * 一个接一个载入，不和别的空闲工作抢一整段主线程。其余视图第一次打开时才载入。
 */
export async function preloadFrequentViews(): Promise<void> {
  await commandPalette.preload();
  await settingsView.preload();
  await settingsNav.preload();
  await preloadTerminalPanel();
}

/** 第一次为 true 之后一直是 true。 */
function useLatched(on: boolean): boolean {
  const [latched, setLatched] = useState(on);
  if (on && !latched) setLatched(true);
  return latched || on;
}

export const SettingsView = settingsView.View;
export const SettingsNav = settingsNav.View;
export const AgentsPanel = agentsPanel.View;
export const FilePreviewPane = filePreviewPane.View;

export function ReviewHost() {
  const mounted = useLatched(useReviewTaskId() !== null);
  return mounted ? <reviewHost.View /> : null;
}

export function GitDialogHost() {
  const mounted = useLatched(useGitDialog() !== null);
  return mounted ? <gitDialogHost.View /> : null;
}

export function SessionInfoHost() {
  const info = useSessionInfoState();
  const share = useShareDialogTask();
  const mounted = useLatched(info !== null || share !== null);
  return mounted ? <sessionInfoHost.View /> : null;
}

export function CommandPalette() {
  const mounted = useLatched(usePaletteOpen());
  return mounted ? <commandPalette.View /> : null;
}

/** omp 没就绪（查找中、询问接管、安装中、出错）才需要准备页；正常启动时 omp 已就绪，这个 chunk 不加载。 */
export function OmpSetupView() {
  const status = useOmpStatus();
  const mounted = useLatched(status !== null && status.state !== "ready");
  return mounted ? <ompSetupView.View /> : null;
}

// omp 的标题里会带 Nerd Font 之类的私用区图标字形（U+E000–U+F8FF 以及补充私用区），系统字体里没有，显示成方框。
// 侧栏、历史会话和任务标题统一用这一个函数去掉。
const ICON_GLYPHS = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

/** 去掉私用区图标字形并收掉首尾空白。 */
export function stripIconGlyphs(text: string): string {
  return text.replace(ICON_GLYPHS, "").trim();
}

/**
 * Windows 控制台标题：可选的本地化前缀（`Administrator: `、`管理员: `）+ 可执行文件的绝对路径（cmd 跑命令时后面带 ` - 命令`），
 * 或 `Windows PowerShell`；可带分叉后缀（`(fork)`、`（分叉）`，可重复）。
 * 2026-11-06 之前 ConPTY 转发的这类标题被当成任务标题存进了 tasks.json（issue #8、#9），见 docs/architecture/task-model.md。
 */
const CONSOLE_TITLE =
  /^(?:[^:\\/]{1,32}:\s+)?(?:[a-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.(?:exe|com|cmd|bat)(?:\s+-\s.*)?|Windows PowerShell)(?:\s*[(（][^()（）]{1,16}[)）])*$/iu;

/** 标题是不是 Windows 控制台标题（不是 omp 或用户起的）。 */
export function looksLikeConsoleTitle(title: string): boolean {
  return CONSOLE_TITLE.test(title.trim());
}

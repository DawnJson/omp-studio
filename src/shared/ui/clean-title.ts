// omp 的标题里会带 Nerd Font 之类的私用区图标字形（U+E000–U+F8FF 以及补充私用区），系统字体里没有，显示成方框。
// 侧栏、历史会话和任务标题统一用这一个函数去掉。
const ICON_GLYPHS = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu;

/** 去掉私用区图标字形并收掉首尾空白。 */
export function stripIconGlyphs(text: string): string {
  return text.replace(ICON_GLYPHS, "").trim();
}

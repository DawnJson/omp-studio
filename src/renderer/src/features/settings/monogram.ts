// 列表行左边的字母方块（provider、MCP、SSH、skill、插件、市场共用）：取显示名的第一个字（字素），大写。
// 2026-10-29 审计 SET-10：原来各处自己截，provider 一个大写字母、其余两个小写字母，市场预设还从英文 slug 截（"官方"显示 cl）。
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function monogram(name: string): string {
  const first = segmenter.segment(name.trim()).containing(0)?.segment ?? "";
  return first.toUpperCase();
}

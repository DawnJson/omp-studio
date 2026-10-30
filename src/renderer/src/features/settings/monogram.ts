// 没有 logo 的 provider（含自定义提供商）在图标格里的字母方块：取显示名的第一个字（字素），大写（ProviderLogo 用）。
// 别的列表行画类别图标（MCP 插头、插件拼图、市场小店、SSH 终端、skill 四角星；2026-10-29 仓库所有者定）。
// 2026-10-29 审计 SET-10：原来各处自己截，provider 一个大写字母、其余两个小写字母。
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function monogram(name: string): string {
  const first = segmenter.segment(name.trim()).containing(0)?.segment ?? "";
  return first.toUpperCase();
}

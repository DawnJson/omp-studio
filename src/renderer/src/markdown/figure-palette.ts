// 当前主题下图色名的实际颜色（svg-figure.ts 的 figurePalette），切换主题时组件拿到新的一份。
// 用 <img> 显示的 SVG（回答里的 ```svg、提问表单里的内联 <svg>、侧栏预览的 svg 片段）都要先用它过一遍 prepareSvg：
// <img> 里读不到页面的 CSS 变量，`var(--surface)` 这类颜色不换掉会画成黑块。
import { useEffect, useMemo, useState } from "react";
import { onThemeChange } from "../ui/theme-change.ts";
import { figurePalette, prepareSvg, svgDataUrl } from "./svg-figure.ts";

export function useFigurePalette(): Readonly<Record<string, string>> {
  const [theme, setTheme] = useState(0);
  useEffect(() => onThemeChange(() => setTheme((value) => value + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => figurePalette(getComputedStyle(document.documentElement)), [theme]);
}

/** SVG 源码 → 按当前主题换好颜色的 data URL。 */
export function themedSvgUrl(svg: string, palette: Readonly<Record<string, string>>): string {
  return svgDataUrl(prepareSvg(svg, palette));
}

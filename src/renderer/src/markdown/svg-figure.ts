// 助手消息里 ```svg 围栏的源码处理（纯函数，不碰 DOM）。omp 在交互模式的系统提示里让模型用 ```svg 画图，
// 颜色只用 currentColor 和 var(--fg)、--muted、--border、--surface、--accent、--success、--warning、--error、
// --c1…--c6（omp 18.12.6 的 system-prompt.md，tui.renderSvg 默认开）。图交给 <img> 显示（不执行脚本、
// 不加载外部资源），而 <img> 里的 SVG 读不到页面的 CSS 变量和继承的文字色，所以先在这里换成当前主题的实际颜色。
// 做法照 omp 自己的 packages/tui/src/chat/svg-source.ts 的 prepareSvg。

/** omp 的图色名 → studio 的 token（tokens.css）。 */
export const FIGURE_TOKENS: Readonly<Record<string, string>> = {
  fg: "--text",
  muted: "--text-3",
  border: "--border",
  surface: "--bg-active",
  accent: "--accent",
  success: "--st-done",
  warning: "--st-waiting",
  error: "--st-error",
  c1: "--chart-1",
  c2: "--chart-2",
  c3: "--chart-3",
  c4: "--chart-4",
  c5: "--chart-5",
  c6: "--chart-6",
};

/** 图里没写字体时用的字体：<img> 里的 SVG 用不到页面的 Geist，用系统字体（Windows 落到 Segoe UI / 微软雅黑，mac 落到 San Francisco / 苹方；不存在的字体名自然跳过）。 */
const FIGURE_FONT = "-apple-system, 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', sans-serif";

/** `var(--name)` / `var(--name, 后备值)`；后备值里可以有一层括号（`rgb(…)`）。 */
const VAR = /var\(\s*--([\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*?))?\s*\)/g;
/** 第一个 `<svg …>` 开始标签（允许命名空间前缀）。 */
const ROOT = /<(?:[\w-]+:)?svg\b[^>]*>/i;
const VIEW_BOX = /\sviewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*["']/i;

const hasAttr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=`, "i").test(tag);

/**
 * 把图的源码改成 <img> 能照原样画出来、颜色跟当前主题的样子：
 * - `var(--name)` 换成 `palette[name]`；不认识的名字用它的后备值，没有后备值用 `palette.fg`；
 * - 根 `<svg>` 缺什么补什么：`xmlns`（没有它 <img> 不认）、`color`（让 currentColor 跟主题）、`font-family`、
 *   用到 `xlink:` 时的 `xmlns:xlink`，以及按 viewBox 的 `width` / `height`（omp 约定 1 个单位 ≈ 1px）。
 * 找不到根标签时原样返回（<img> 会加载失败，界面退回显示源码）。
 */
export function prepareSvg(svg: string, palette: Readonly<Record<string, string>>): string {
  const resolved = svg.replace(VAR, (_, name: string, fallback: string | undefined) => {
    const value = palette[name];
    if (value !== undefined) return value;
    const backup = fallback?.trim();
    return backup !== undefined && backup !== "" ? backup : (palette["fg"] ?? "currentColor");
  });
  const match = ROOT.exec(resolved);
  if (match === null) return resolved;
  const tag = match[0];
  const extra: string[] = [];
  if (!hasAttr(tag, "xmlns")) extra.push('xmlns="http://www.w3.org/2000/svg"');
  if (resolved.includes("xlink:") && !hasAttr(tag, "xmlns:xlink"))
    extra.push('xmlns:xlink="http://www.w3.org/1999/xlink"');
  if (!hasAttr(tag, "color") && palette["fg"] !== undefined) extra.push(`color="${palette["fg"]}"`);
  if (!hasAttr(tag, "font-family")) extra.push(`font-family="${FIGURE_FONT}"`);
  const box = VIEW_BOX.exec(tag);
  if (box !== null && !hasAttr(tag, "width") && !hasAttr(tag, "height"))
    extra.push(`width="${box[1]}" height="${box[2]}"`);
  if (extra.length === 0) return resolved;
  const at = match.index + tag.indexOf("svg") + 3;
  return `${resolved.slice(0, at)} ${extra.join(" ")}${resolved.slice(at)}`;
}

/** 给 <img src> 用的 data URL。 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

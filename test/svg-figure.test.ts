// 助手画的 svg 图在 <img> 里显示前的源码处理：<img> 里的 SVG 读不到页面的 CSS 变量，
// 没换掉的 var(--accent) 画出来就是黑色；根标签缺 xmlns 时 <img> 整张图加载失败。
import { describe, expect, it } from "vitest";
import { renderMermaidSVG } from "beautiful-mermaid";
import { prepareMermaidSvg, prepareSvg } from "../src/renderer/src/markdown/svg-figure.ts";

const palette = { fg: "#111111", accent: "#6b46d9", c1: "#6b46d9", warning: "#b76e00" };

describe("prepareSvg", () => {
  it("把 var(--name) 换成主题色；不认识的名字用后备值，没有后备值用前景色", () => {
    const out = prepareSvg(
      '<svg viewBox="0 0 10 10"><rect fill="var(--accent)" stroke="var( --c1 )"/>' +
        '<circle fill="var(--nope, rgb(1, 2, 3))"/><path stroke="var(--nope)"/></svg>',
      palette,
    );
    expect(out).toContain('fill="#6b46d9" stroke="#6b46d9"');
    expect(out).toContain('fill="rgb(1, 2, 3)"');
    expect(out).toContain('stroke="#111111"');
    expect(out).not.toContain("var(");
  });

  it("根标签补上 xmlns、文字色、字体和按 viewBox 的尺寸", () => {
    const out = prepareSvg('<svg viewBox="0 0 860 330"><text fill="currentColor">hi</text></svg>', palette);
    const root = /<svg[^>]*>/.exec(out)![0];
    expect(root).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(root).toContain('color="#111111"');
    expect(root).toContain("font-family=");
    expect(root).toContain('width="860" height="330"');
  });

  it("作者写了的属性不动：自己的尺寸、字体、命名空间", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="200" font-family="serif" color="red"></svg>';
    expect(prepareSvg(source, palette)).toBe(source);
  });

  it("用到 xlink 时补上 xmlns:xlink", () => {
    const out = prepareSvg('<svg viewBox="0 0 4 4"><use xlink:href="#a"/></svg>', palette);
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });
});

// mermaid 图的颜色全按根标签的 --bg / --fg 混出来：没换成主题色，深色主题里就是一块白底深字。
describe("prepareMermaidSvg", () => {
  it("根标签的颜色换成主题色、不铺背景，去掉外链字体", () => {
    const svg = renderMermaidSVG("flowchart LR\n  A[开始] --> B[结束]", { bg: "#ffffff", fg: "#000000" });
    const out = prepareMermaidSvg(svg, { bg: "#f4f4f1", fg: "#161614" });
    const root = /<svg[^>]*>/.exec(out)![0];
    expect(root).toContain('style="--bg:#f4f4f1;--fg:#161614"');
    expect(root).not.toContain("background");
    expect(out).not.toContain("@import");
    expect(out).toContain("开始");
  });
});

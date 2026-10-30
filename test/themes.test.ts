// 配色主题：每个主题都要声明全套颜色变量（缺一个就悄悄退回浅色的值）、文字对比度达标、
// 主进程登记的顶栏色（src/shared/themes.ts）和 CSS 一致，否则系统三键和顶栏两种颜色。
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeNames, themes, type ThemeName } from "../src/shared/themes.ts";
import { luminance, parseColor, type Rgba } from "../src/shared/ui/terminal-model.ts";

const stylesDir = new URL("../src/renderer/styles/", import.meta.url);
const tokensCss = readFileSync(new URL("tokens.css", stylesDir), "utf8");
const themesCss = readFileSync(new URL("themes.css", stylesDir), "utf8");

type Block = Map<string, string>;

/** 选择器后面那一块 { … } 里的声明（只认本文件的写法：一行一个，值里没有分号）。 */
function block(css: string, selector: string): Block {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const declarations = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+|color-scheme):\s*([^;]+);/g))
    declarations.set(match[1] ?? "", (match[2] ?? "").replace(/\s+/g, " ").trim());
  return declarations;
}

const lightBlock = block(tokensCss, ':root,\n[data-theme="light"]');
const blocks: Record<ThemeName, Block> = Object.fromEntries(
  themeNames.map((name) => [
    name,
    name === "light" ? lightBlock : block(name === "dark" ? tokensCss : themesCss, `[data-theme="${name}"]`),
  ]),
) as Record<ThemeName, Block>;

function color(theme: Block, token: string): Rgba {
  const value = theme.get(token);
  const parsed = value === undefined ? null : parseColor(value);
  if (parsed === null) throw new Error(`${token} is not a color: ${value}`);
  return parsed;
}

/** 半透明色按 WCAG 的做法先叠到底色上再算。 */
function over(top: Rgba, bottom: Rgba): Rgba {
  const mix = (a: number, b: number) => a * top.a + b * (1 - top.a);
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function contrast(a: Rgba, b: Rgba): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** [前景, 背景, 最低对比度]：spec §2.5 的规则。背景写 a@b 表示 a 叠在 b 上。 */
const pairs: [string, string, number][] = [
  ["--text", "--bg-app", 7],
  ...["--bg-sidebar", "--bg-raised", "--bg-overlay", "--bg-tool", "--bg-bubble", "--control-on"].map(
    (bg): [string, string, number] => ["--text", bg, 4.5],
  ),
  ...["--text-2", "--text-3"].flatMap((fg) =>
    ["--bg-app", "--bg-sidebar", "--bg-raised", "--bg-overlay", "--bg-tool"].map((bg): [string, string, number] => [
      fg,
      bg,
      4.5,
    ]),
  ),
  ...["--link", "--accent"].flatMap((fg) =>
    ["--bg-app", "--bg-raised"].map((bg): [string, string, number] => [fg, bg, 4.5]),
  ),
  ...["--st-waiting-text", "--st-done", "--st-error", "--diff-add-fg", "--diff-del-fg"].map(
    (fg): [string, string, number] => [fg, "--bg-app", 4.5],
  ),
  ["--text-on-accent", "--accent", 4.5],
  ["--text-on-primary", "--primary", 4.5],
  ["--text-on-danger", "--st-error", 4.5],
  ["--st-error", "--st-error-soft@--bg-app", 4.5],
  ["--st-waiting", "--bg-app", 3],
  ["--text-disabled", "--bg-raised", 3],
  ...["keyword", "string", "number", "comment", "func", "type", "punct"].map((name): [string, string, number] => [
    `--syn-${name}`,
    "--bg-tool",
    4.5,
  ]),
  ...[1, 2, 3, 4, 5, 6].map((n): [string, string, number] => [`--chart-${n}`, "--bg-app", 3]),
];

function resolve(theme: Block, spec: string): Rgba {
  const [top, under] = spec.split("@");
  const value = color(theme, top ?? spec);
  if (under !== undefined) return over(value, resolve(theme, under));
  return value.a < 1 ? over(value, color(theme, "--bg-app")) : value;
}

describe("配色主题", () => {
  it("系统深色和显式深色两块逐行一致", () => {
    const system = block(tokensCss, "  :root:not([data-theme])");
    expect([...system]).toEqual([...blocks.dark]);
  });

  it("每个主题声明的变量和浅色块一一对应", () => {
    const expected = [...lightBlock.keys()].sort();
    for (const name of themeNames) expect([...blocks[name].keys()].sort(), name).toEqual(expected);
  });

  it("themes.css 里的主题都登记在 themes.ts", () => {
    const declared = [...themesCss.matchAll(/^\[data-theme="([a-z-]+)"\] \{/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual(themeNames.filter((name) => name !== "light" && name !== "dark").sort());
  });

  it.each(themeNames)("%s：主进程登记的深浅、顶栏色、遮罩色和 CSS 一致", (name) => {
    const theme = blocks[name];
    const spec = themes[name];
    expect(theme.get("color-scheme")).toBe(spec.dark ? "dark" : "light");
    expect(theme.get("--bg-sidebar")).toBe(spec.sidebar);
    expect(theme.get("--text")).toBe(spec.text);
    expect(theme.get("--bg-scrim")).toBe(spec.scrim);
  });

  it.each(themeNames)("%s：自带插图的主题有图，图文件在", (name) => {
    const art = blocks[name].get("--theme-art");
    if (!themes[name].art) {
      expect(art).toBe("none");
      return;
    }
    expect(art).toBe(`url("./themes/${name}.svg")`);
    expect(existsSync(new URL(`themes/${name}.svg`, stylesDir))).toBe(true);
  });

  it.each(themeNames)("%s：文字和状态色的对比度达标", (name) => {
    const theme = blocks[name];
    const failures = pairs
      .map(([fg, bg, min]) => ({ fg, bg, min, ratio: contrast(resolve(theme, fg), resolve(theme, bg)) }))
      .filter(({ ratio, min }) => ratio < min)
      .map(({ fg, bg, min, ratio }) => `${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
    expect(failures).toEqual([]);
  });
});

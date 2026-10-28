// 高亮 token 用类名着色：主题里的每种颜色都要有类名和 tokens.css 里的规则，否则那种 token 变成无色。
import { readFileSync } from "node:fs";
import { createCssVariablesTheme } from "shiki/core";
import { describe, expect, it } from "vitest";
import { tokenProps, type HighlightToken } from "../src/renderer/src/markdown/highlight-tokens.ts";

const tok = (color: string | undefined, italic = false, bold = false): HighlightToken => ({
  text: "x",
  italic,
  bold,
  ...(color !== undefined && { color }),
});

describe("tokenProps：主题色换成类名", () => {
  const css = readFileSync(new URL("../src/renderer/styles/tokens.css", import.meta.url), "utf8");
  const theme = createCssVariablesTheme({ name: "studio", variablePrefix: "--shiki-", variableDefaults: {} });
  const colors = new Set<string>([theme.colors!["editor.foreground"]!]);
  for (const rule of theme.tokenColors ?? []) if (rule.settings.foreground) colors.add(rule.settings.foreground);

  it("主题里的每种颜色都有类名，tokens.css 里有同色的规则，不写内联 style", () => {
    expect(colors.size).toBeGreaterThan(10);
    for (const color of colors) {
      const props = tokenProps(tok(color));
      expect(props.style, color).toBeUndefined();
      expect(css, color).toContain(`.${props.className} {\n  color: ${color};\n}`);
    }
  });

  it("斜体、粗体也是类名，和调用方自己的类名拼在一起", () => {
    expect(tokenProps(tok("var(--shiki-token-keyword)", true, true), "tsp-em")).toEqual({
      className: "tsp-em hl-token-keyword hl-i hl-b",
    });
    expect(css).toContain(".hl-i {\n  font-style: italic;\n}");
    expect(css).toContain(".hl-b {\n  font-weight: var(--fw-strong);\n}");
  });

  it("认不出的颜色退回内联 style；没有颜色什么都不加", () => {
    expect(tokenProps(tok("#ff0000"))).toEqual({ style: { color: "#ff0000" } });
    expect(tokenProps(tok(undefined))).toEqual({});
  });
});

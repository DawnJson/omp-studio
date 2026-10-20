// 防的是：模型输出里的原始 HTML、危险链接把渲染进程变成脚本执行入口；以及流式渲染时已闭合的块被反复重建（界面跳动、选区丢失）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/renderer/src/markdown/markdown-static.ts";
import { parseBlocks, stabilizeStreaming } from "../src/renderer/src/markdown/parse.ts";

const html = (source: string) => renderToStaticMarkup(renderMarkdown(source, { openLink: () => {} }));

describe("原始 HTML 转义成文本", () => {
  it("<script> 和 <img onerror> 不会变成元素", () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n行内 <b onclick="x()">粗</b>');
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/<b[ >]/i);
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("html_block 里的 iframe 和 style 也只是文本", () => {
    const out = html('<iframe src="https://evil.example"></iframe>\n\n<style>body{display:none}</style>');
    expect(out).not.toMatch(/<iframe|<style/i);
  });
});

describe("危险链接协议被拒", () => {
  const dangerous = [
    "[x](javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](vbscript:msgbox(1))",
    "[x](file:///C:/Windows/System32/calc.exe)",
    "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[x][r]\n\n[r]: javascript:alert(1)",
    "![x](javascript:alert(1))",
  ];
  for (const source of dangerous) {
    it(`不生成可点击的 href：${source.split("\n")[0]}`, () => {
      const out = html(source);
      expect(out).not.toMatch(/href=/i);
      expect(out).not.toMatch(/src=/i);
    });
  }

  it("http、https 链接保留；mailto 和相对路径只显示文字（主进程 openExternal 只认 http/https）", () => {
    const out = html("[官网](https://example.com/a?b=1) [信](mailto:a@b.c) [文件](src/a.ts)");
    expect(out).toContain('href="https://example.com/a?b=1"');
    expect(out).not.toContain('href="mailto:');
    expect(out).toContain("信");
    expect(out).not.toContain('href="src/a.ts"');
    expect(out).toContain("文件");
  });

  it("远程图片不加载，显示为链接；data:image 保留", () => {
    const remote = html("![logo](https://example.com/logo.png)");
    expect(remote).not.toMatch(/<img/i);
    expect(remote).toContain('href="https://example.com/logo.png"');
    const inline = html("![dot](data:image/png;base64,iVBORw0KGgo=)");
    expect(inline).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
  });
});

describe("流式渲染", () => {
  const sample = [
    "# 标题",
    "",
    "一段 **粗体** 和 `代码`，然后是列表：",
    "",
    "- 第一项",
    "- 第二项",
    "",
    "| 列 A | 列 B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
    "```ts",
    "const x = 1;",
    "# 不是标题",
    "```",
    "",
    "> 引用",
    "",
    "最后一句。",
  ].join("\n");

  it("歧义前缀延迟一行：未完成的表头、列表、标题行先不出现", () => {
    expect(stabilizeStreaming("前文\n\n- ")).toBe("前文\n\n");
    expect(stabilizeStreaming("前文\n\n## 小")).toBe("前文\n\n");
    expect(stabilizeStreaming("前文\n\n| a | b |")).toBe("前文\n\n");
    // 表头已经结束，但分隔行还没到：仍然不放出，避免先是普通文字再变表格。
    expect(stabilizeStreaming("前文\n\n| a | b |\n")).toBe("前文\n\n");
    expect(stabilizeStreaming("前文\n\n| a | b |\n| --- | --- |\n")).toBe("前文\n\n| a | b |\n| --- | --- |\n");
    expect(stabilizeStreaming("普通文字写到一半")).toBe("普通文字写到一半");
  });

  it("围栏内以 # 开头的代码行不会被当成标题延迟", () => {
    const source = "```py\n# 注释";
    expect(stabilizeStreaming(source)).toBe(source);
  });

  it("未闭合的围栏在打开时就是代码块，闭合后 closed 才为 true", () => {
    const open = parseBlocks("```ts\nconst a = 1;");
    expect(open).toHaveLength(1);
    expect(open[0]?.tokens[0]?.type).toBe("fence");
    expect(open[0]?.closed).toBe(false);
    expect(parseBlocks("```ts\nconst a = 1;\n```")[0]?.closed).toBe(true);
  });

  for (const step of [1, 5, 50]) {
    it(`每次喂 ${step} 个字符：已闭合的块原文不再变化，最终结果与一次性渲染一致`, () => {
      let previous: string[] = [];
      for (let end = step; end < sample.length + step; end += step) {
        const prefix = sample.slice(0, Math.min(end, sample.length));
        const current = parseBlocks(stabilizeStreaming(prefix)).map((block) => block.src);
        // 上一步里不是最后一块的，这一步必须原样还在。
        const frozen = previous.slice(0, -1);
        expect(current.slice(0, frozen.length)).toEqual(frozen);
        previous = current;
      }
      expect(html(sample)).toBe(html(sample));
      expect(parseBlocks(stabilizeStreaming(sample + "\n")).map((block) => block.src)).toEqual(
        parseBlocks(sample).map((block) => block.src),
      );
    });
  }

  it("任务列表渲染成只读复选框，标记不留在文字里", () => {
    const out = html("- [x] 做完\n- [ ] 待做");
    expect(out.match(/type="checkbox"/g)).toHaveLength(2);
    expect(out).toContain("checked");
    expect(out).not.toContain("[x]");
    expect(out).toContain("待做");
  });
});

describe("公式（KaTeX）", () => {
  it("价格不是公式：$5 and $10", () => {
    const out = html("这个 $5 and $10 都不是公式");
    expect(out).not.toContain("katex");
    expect(out).toContain("$5 and $10");
  });

  it("行内 $…$ 和 \\(…\\)", () => {
    const out = html("设 $x^2$ 与 \\(y_1\\) 成立");
    expect(out.match(/class="md-math"/g)).toHaveLength(2);
    expect(out).toContain("katex");
  });

  it("块级 $$…$$（单行与多行）和 \\[…\\]", () => {
    const out = html("$$\\bar{x} = \\frac{1}{n}\\sum_{i=1}^n x_i$$\n\n$$\na^2\n+b^2\n$$\n\n\\[\nc\n\\]");
    expect(out.match(/class="md-math-block"/g)).toHaveLength(3);
    expect(out).toContain("katex-display");
  });

  it("转义的 \\$ 不开公式", () => {
    const out = html("价格 \\$5 到 \\$10");
    expect(out).not.toContain("katex");
    expect(out).toContain("$5 到 $10");
  });

  it("代码里的 $ 原样保留", () => {
    const out = html("`$x$ and $y$`\n\n```\n$$\nx\n$$\n```");
    expect(out).not.toContain("katex");
    expect(out).toContain("$x$ and $y$");
  });

  it("坏公式显示原文，不崩溃", () => {
    const out = html("坏的 $\\frac{1$ 和\n\n$$\n\\notacommand{\n$$");
    expect(out).toContain("md-math-error");
    expect(out).toContain("$\\frac{1$");
    expect(out).not.toContain("katex-error");
  });

  it("未闭合的 $$ 和 $ 保持文字", () => {
    expect(html("$$\n\\frac{1}{2}")).not.toContain("katex");
    expect(html("开头 $x^2 没写完")).not.toContain("katex");
    expect(parseBlocks("$$\na").every((block) => block.tokens.every((token) => token.type !== "math_block"))).toBe(
      true,
    );
  });

  it("KaTeX 不放行 \\href 等 trust 能力", () => {
    expect(html("$\\href{https://evil.example}{x}$")).not.toContain("href=");
  });
});

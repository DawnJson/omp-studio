// 防的是：模型输出里的原始 HTML、危险链接把渲染进程变成脚本执行入口；以及流式渲染时已闭合的块被反复重建（界面跳动、选区丢失）。
import katex from "katex";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/renderer/src/markdown/markdown-static.ts";
import { renderBlock } from "../src/renderer/src/markdown/render.ts";
import {
  blockTokens,
  parseBlocks,
  parseStreaming,
  stabilizeStreaming,
  type BlockParse,
} from "../src/renderer/src/markdown/parse.ts";

const html = (source: string) => renderToStaticMarkup(renderMarkdown(source, { openLink: () => {}, katex }));

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

  it("给了 openFile 时 file: 和不带协议的路径是链接；锚点、别的协议、javascript: 仍不可点", () => {
    const withFile = (source: string) =>
      renderToStaticMarkup(renderMarkdown(source, { openLink: () => {}, openFile: () => {}, katex }));
    const out = withFile("[Word](file:///C:/a/%E6%8A%A5.docx) [文件](src/a.ts) [盘符](C:/x/y.pdf)");
    expect(out).toContain('href="file:///C:/a/%E6%8A%A5.docx"');
    expect(out).toContain('href="src/a.ts"');
    expect(out).toContain('href="C:/x/y.pdf"');
    expect(withFile("[顶](#top) [内](omp://x) [信](mailto:a@b.c) [x](javascript:alert(1))")).not.toMatch(/href=/i);
  });

  it("远程图片不加载，显示为链接；data:image 保留", () => {
    const remote = html("![logo](https://example.com/logo.png)");
    expect(remote).not.toMatch(/<img/i);
    expect(remote).toContain('href="https://example.com/logo.png"');
    const inline = html("![dot](data:image/png;base64,iVBORw0KGgo=)");
    expect(inline).toContain('<img src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("文字里写全的 http(s) 网址可点，不吞句末的中文句号；不带协议的域名、邮箱、行内代码里的网址不变成链接", () => {
    const out = html(
      "或者直接打开 https://doi.org/10.1007/978-3-031-94223-5_25 。见https://a.com/x。\n\nexample.com a@b.com `https://in.code`",
    );
    expect(out).toContain('<a href="https://doi.org/10.1007/978-3-031-94223-5_25"');
    expect(out).toContain('<a href="https://a.com/x"');
    expect(out).toContain("</a>。");
    expect(out).not.toContain('href="http://example.com');
    expect(out).not.toContain('href="mailto:');
    expect(out).not.toContain('href="https://in.code"');
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
    expect(blockTokens(open[0]!)[0]?.type).toBe("fence");
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

  // Chromium 复制选中文字时不带 ::marker：序号必须是文字，复制出来才有"3. 4."（2026-10-27 用户报的）。
  it("有序列表的序号是文字，从 start 起数；任务项不加序号", () => {
    const text = (source: string) => html(source).replace(/<[^>]+>/g, "");
    expect(text("3. 甲\n4. 乙\n   1. 子项")).toBe("3. 甲4. 乙1. 子项");
    expect(text("- 点")).toBe("点");
    expect(text("1. [x] 做完")).toBe("做完");
  });
});

describe("增量解析（parseStreaming）与整篇解析一致", () => {
  const tricky: Record<string, string> = {
    列表跨空行: [
      "- a",
      "",
      "  续写的段落",
      "",
      "- b",
      "  - 嵌套",
      "",
      "    深层段落",
      "1. 有序",
      "2. 第二",
      "",
      "3) 另一种分隔符",
      "",
      "收尾",
      "",
      "- 新列表",
    ].join("\n"),
    缩进代码跨空行: "段落\n\n    code 1\n\n    code 2\n之后\n\n    code 3\n\n\n    code 4\n\n尾",
    围栏: "文字\n\n```js\na\n\nb\n```\n\n~~~\n未闭合\n\n更多\n\n````\n内层 ```\n````\n尾",
    公式块: "$$\na\n\nb\n$$\n\n$$\nx^2\n$$\n\n\\[\ny\n\\]\n行内 $z$ 结束\n\n$$ 单行 $$\n\n后",
    setext与惰性续行: "标题\n=====\n\n段落\n续行\n---\n\n> 引用\n惰性行\n\n> 第二段\n\n***\n\n文字\n\n  ===\n",
    表格: "| a | b |\n| - | - |\n| 1 | 2 |\n\n之后\n| c |\n| - |\n\n| x |\n|---|\n| y\n",
    引用定义: '看 [foo] 和 [bar][]\n\n段落\n\n[foo]: https://a.test\n[bar]: https://b.test "t"\n\n再引用 [foo]',
    CRLF: "a\r\n\r\nb\r\n- c\r\n\r\nd\r",
    制表符与空白行: "a\n \t\n\tcode\n\nb\n  \n\t- 列表\n\n c",
    任务列表与HTML: "- [ ] x\n- [x] y\n\n<div>\n\n</div>\n\n文字 <b>粗</b>\n",
    链接与数字列表: "见 https://a.test。\n\n2. 从二开始\n\n10. 十\n\n# 标题\n\n段落 1. 不是列表",
  };

  for (const [name, doc] of Object.entries(tricky)) {
    it(`${name}：每个前缀都和整篇解析相同`, () => {
      let raw: BlockParse | null = null;
      let stable: BlockParse | null = null;
      for (let end = 0; end <= doc.length; end += 1) {
        const prefix = doc.slice(0, end);
        raw = parseStreaming(raw, prefix);
        expect(raw.blocks).toEqual(parseBlocks(prefix));
        const shown = stabilizeStreaming(prefix);
        stable = parseStreaming(stable, shown);
        expect(stable.blocks).toEqual(parseBlocks(shown));
      }
    });
  }

  it("随机拼出的文档（行取自易错构造）：每个前缀都和整篇解析相同", () => {
    const pool = [
      "",
      "",
      "段落文字",
      "- 项",
      "  续行",
      "    缩进四格",
      "1. 有序",
      "> 引用",
      "```",
      "~~~py",
      "$$",
      "x^2 $$",
      "\\[",
      "\\]",
      "| a | b |",
      "| - | - |",
      "===",
      "---",
      "# 标题",
      "\t制表",
      "  - 嵌套",
      "* 星号",
      "行内 $y$ 和 `c`",
    ];
    let seed = 7;
    const next = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 60; round += 1) {
      const doc = Array.from({ length: 6 + next(14) }, () => pool[next(pool.length)]).join("\n");
      let state: BlockParse | null = null;
      for (let end = 0; end <= doc.length; end += 1) {
        const prefix = doc.slice(0, end);
        state = parseStreaming(state, prefix);
        expect(state.blocks, doc).toEqual(parseBlocks(prefix));
      }
    }
  });

  it("原文不是上次的延长（改写、变短、换成另一篇）时也和整篇解析相同", () => {
    const docs = Object.values(tricky);
    let state: BlockParse | null = null;
    for (const doc of docs) {
      for (const cut of [doc.length, Math.floor(doc.length / 2), doc.length - 3, 0, doc.length]) {
        const source = doc.slice(0, Math.max(0, cut));
        state = parseStreaming(state, source);
        expect(state.blocks).toEqual(parseBlocks(source));
      }
    }
  });

  it("前面已定型的块复用同一个对象（最后一块之前的都不再重解析）", () => {
    const doc = "# 标题\n\n第一段。\n\n- 项\n\n第二段写得很长很长。";
    let state = parseStreaming(null, "# 标题\n\n第一段。\n\n- 项");
    const heading = state.blocks[0];
    const paragraph = state.blocks[1];
    for (let end = state.source.length + 1; end <= doc.length; end += 1)
      state = parseStreaming(state, doc.slice(0, end));
    expect(state.blocks[0]).toBe(heading);
    expect(state.blocks[1]).toBe(paragraph);
    expect(state.blocks).toEqual(parseBlocks(doc));
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
    expect(
      parseBlocks("$$\na").every((block) => blockTokens(block).every((token) => token.type !== "math_block")),
    ).toBe(true);
  });

  it("KaTeX 不放行 \\href 等 trust 能力", () => {
    expect(html("$\\href{https://evil.example}{x}$")).not.toContain("href=");
  });

  it("KaTeX 还没加载时公式按原文显示在 code 里，块上标记 math", () => {
    const out = renderToStaticMarkup(renderMarkdown("设 $x^2$\n\n$$\ny\n$$", { openLink: () => {} }));
    expect(out).not.toContain("katex");
    expect(out).toContain('<span class="md-math"><code>$x^2$</code></span>');
    expect(out).toContain('<div class="md-math-block"><code>$$\ny\n$$</code></div>');
    expect(parseBlocks("设 $x^2$\n\n文字").map((block) => block.math)).toEqual([true, false]);
  });
});

// Markdown.tsx 画完就把块的 token 放掉，切语言、KaTeX 加载完时重画的块按原文重解析：重画出来必须和第一次一样。
describe("放掉 token 后重画的块和原来一样", () => {
  const doc = [
    "# 标题 [引用链接][r]",
    "",
    "段落里有 [链接][r]、**粗体**、`代码`、$x^2$ 和 https://example.com/a",
    "",
    "- [x] 做完的",
    "- [ ] 没做的",
    "",
    "  第二段仍在列表里",
    "",
    "3. 从三开始",
    "4. 下一项",
    "",
    "> 引用里 [定义在后面的链接][r]",
    "",
    "| a | b |",
    "| - | - |",
    "| 1 | 2 |",
    "",
    "```ts",
    "const a = 1;",
    "```",
    "",
    "$$",
    "y",
    "$$",
    "",
    "    缩进代码",
    "",
    "[r]: https://example.com/ref",
  ].join("\n");
  const ctx = { openLink: () => {}, katex };

  it("每一块重解析的输出逐字相同（含别的块里定义的链接引用、任务列表、公式）", () => {
    const blocks = parseBlocks(doc);
    const first = blocks.map((block) => renderToStaticMarkup(renderBlock(block, ctx)));
    for (const block of blocks) block.tokens = null;
    expect(blocks.map((block) => renderToStaticMarkup(renderBlock(block, ctx)))).toEqual(first);
    expect(first.join("")).toContain('href="https://example.com/ref"');
  });
});

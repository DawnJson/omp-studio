// 回答里代码块的"在侧栏预览"：哪些围栏语言有这个按钮，片段换成预览页认得的 PreviewFile（不读盘）。
import { describe, expect, it } from "vitest";
import { previewKind } from "../src/renderer/src/markdown/code-preview.ts";
import { snippetExtension, snippetFile } from "../src/renderer/src/features/file-preview/snippet.ts";

describe("previewKind", () => {
  it("html / svg / mermaid / markdown 及别名（htm、md）认，大小写和首尾空白不论；别的语言不认", () => {
    expect(previewKind("html")).toBe("html");
    expect(previewKind(" HTM ")).toBe("html");
    expect(previewKind("SVG")).toBe("svg");
    expect(previewKind("mermaid")).toBe("mermaid");
    expect(previewKind("md")).toBe("markdown");
    expect(previewKind("Markdown")).toBe("markdown");
    for (const lang of ["", "xml", "ts", "toString", "constructor", "__proto__"]) expect(previewKind(lang)).toBeNull();
  });
});

describe("snippetFile", () => {
  const palette = { fg: "#111111", accent: "#6b46d9" };

  it("html 原样进沙箱 iframe 的 srcdoc，不能用系统应用打开", () => {
    const file = snippetFile({ id: 1, kind: "html", code: "<h1>你好</h1>" }, palette);
    expect(file).toEqual({ kind: "html", path: "", size: 15, text: "<h1>你好</h1>", canOpen: false });
  });

  it("svg 当图片：颜色换成主题色、补 xmlns；源码视图仍是原文", () => {
    const code = '<svg viewBox="0 0 4 2"><rect fill="var(--accent)"/></svg>';
    const file = snippetFile({ id: 2, kind: "svg", code }, palette);
    expect(file.kind).toBe("image");
    expect(file.text).toBe(code);
    const svg = decodeURIComponent(file.dataUrl!.slice(file.dataUrl!.indexOf(",") + 1));
    expect(file.dataUrl!.startsWith("data:image/svg+xml")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#6b46d9"');
  });

  it("markdown、mermaid 当文本；扩展名让预览页认出 Markdown", () => {
    expect(snippetFile({ id: 3, kind: "markdown", code: "# 标题" }, palette).kind).toBe("text");
    expect(snippetFile({ id: 4, kind: "mermaid", code: "flowchart LR\n A-->B" }, palette).kind).toBe("text");
    expect(snippetExtension("markdown")).toBe("md");
  });
});

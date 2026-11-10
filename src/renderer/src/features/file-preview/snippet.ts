// 回答里代码块的"在侧栏预览"（spec 4.27）：代码只在内存里，不落盘、不经主进程；这里把它换成预览页认得的 PreviewFile，
// 让它和打开的文件走同一条渲染路径（html 沙箱 iframe、svg 图片、markdown 渲染；mermaid 交给代码块画图）。
import type { PreviewFile } from "../../../../shared/ipc.ts";
import type { PreviewKind } from "../../markdown/code-preview.ts";
import { prepareSvg, svgDataUrl } from "../../markdown/svg-figure.ts";

export interface Snippet {
  /** 每次打开一个片段递增（preview-store.ts），只用来区分"换了一段"。 */
  id: number;
  kind: PreviewKind;
  code: string;
}

/** 预览页按扩展名分辨 Markdown / SVG；mermaid 不是文件扩展名，PreviewContent 按它把文本交给代码块画图。 */
const extensions: Readonly<Record<PreviewKind, string>> = {
  html: "html",
  svg: "svg",
  mermaid: "mermaid",
  markdown: "md",
};

const labels: Readonly<Record<PreviewKind, string>> = {
  html: "HTML",
  svg: "SVG",
  mermaid: "Mermaid",
  markdown: "Markdown",
};

export function snippetExtension(kind: PreviewKind): string {
  return extensions[kind];
}

/** 工具栏标题里的语言名（`preview.snippet` 的 `{lang}`）。 */
export function snippetLabel(kind: PreviewKind): string {
  return labels[kind];
}

/**
 * 片段 → 预览页的内容。svg 和回答里画的图一样先换成当前主题的颜色、补上 `xmlns`（`prepareSvg`），
 * 源码视图仍是原文（`text`）。`path` 空着：片段没有文件路径，也不能用系统应用打开。
 */
export function snippetFile(snippet: Snippet, palette: Readonly<Record<string, string>>): PreviewFile {
  const { kind, code } = snippet;
  const base = { path: "", size: new TextEncoder().encode(code).length, text: code, canOpen: false };
  if (kind === "html") return { ...base, kind: "html" };
  if (kind === "svg") return { ...base, kind: "image", dataUrl: svgDataUrl(prepareSvg(code, palette)) };
  return { ...base, kind: "text" };
}

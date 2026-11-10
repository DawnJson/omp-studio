// 代码块的"在侧栏预览"（spec 4.10）：html / svg / mermaid / markdown 围栏闭合后，头部多一个按钮，把这段代码放到右侧文件面板的预览页。
// 只有任务对话区（TspView）提供，别处（文件预览、设置页的更新说明、对话框……）没有面板可开，为 null，代码块不显示这个按钮。
import { createContext, useContext } from "react";

export type PreviewKind = "html" | "svg" | "mermaid" | "markdown";

const kinds: Readonly<Record<string, PreviewKind>> = {
  html: "html",
  htm: "html",
  svg: "svg",
  mermaid: "mermaid",
  markdown: "markdown",
  md: "markdown",
};

/** 围栏语言 → 能在侧栏预览的种类；别的语言为 null。 */
export function previewKind(lang: string): PreviewKind | null {
  const key = lang.trim().toLowerCase();
  return Object.hasOwn(kinds, key) ? kinds[key]! : null;
}

export type PreviewCode = (code: string, kind: PreviewKind) => void;

export const CodePreviewCtx = createContext<PreviewCode | null>(null);

export function usePreviewCode(): PreviewCode | null {
  return useContext(CodePreviewCtx);
}

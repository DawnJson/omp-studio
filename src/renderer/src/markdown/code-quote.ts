// 代码块的"引用到输入框"：只有任务对话区（TspView）提供，别处（文件预览、设置页的更新说明……）为 null，代码块不显示这个按钮。
import { createContext, useContext } from "react";

export type QuoteCode = (code: string, lang: string) => void;

export const CodeQuoteCtx = createContext<QuoteCode | null>(null);

export function useQuoteCode(): QuoteCode | null {
  return useContext(CodeQuoteCtx);
}

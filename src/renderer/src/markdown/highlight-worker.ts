// 语法高亮 worker：Shiki 的分词是同步的，一个几百行的文件要 100ms 以上（第一次编译语法的正则还要更久），放在主线程会卡住滚动和动画。
// 高亮器和语言包都在这里按需加载；主线程（highlight.ts）只发代码、收 token。
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { HighlightToken } from "./highlight-tokens.ts";
import { resolveLanguage, type Language } from "./highlight-languages.ts";
import { loadLanguage } from "./highlight-loaders.ts";

export interface HighlightRequest {
  id: number;
  code: string;
  /** resolveLanguage 归一过的语言名。 */
  language: Language;
}

export type HighlightReply = { id: number; lines: HighlightToken[][] } | { id: number; error: string };

const themeName = "studio";
const highlighter = createHighlighterCore({
  themes: [
    createCssVariablesTheme({ name: themeName, variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true }),
  ],
  langs: [],
  engine: createJavaScriptRegexEngine(),
});
/** 每个语言只加载一次；同一语言的并发请求等同一个加载。 */
const loading = new Map<Language, Promise<void>>();

function ensureLoaded(core: HighlighterCore, language: Language): Promise<void> {
  let pending = loading.get(language);
  if (pending === undefined) {
    pending = loadLanguage(language).then((module) => core.loadLanguage(module.default));
    loading.set(language, pending);
  }
  return pending;
}

/** Markdown 源码里围栏代码块用到的语言：先加载，markdown 语法才会把块里的代码交给它着色。 */
function fencedLanguages(code: string): Language[] {
  const names = new Set<Language>();
  for (const match of code.matchAll(/^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([\w+#.-]+)/gm)) {
    const language = resolveLanguage(match[1]!);
    if (language) names.add(language);
  }
  return [...names];
}

async function tokenize(code: string, language: Language): Promise<HighlightToken[][]> {
  const core = await highlighter;
  const needed: Language[] = language === "markdown" ? [...fencedLanguages(code), language] : [language];
  for (const name of needed) await ensureLoaded(core, name);
  return core.codeToTokensBase(code, { lang: language, theme: themeName }).map((line) =>
    line.map((token) => ({
      text: token.content,
      ...(token.color ? { color: token.color } : {}),
      italic: ((token.fontStyle ?? 0) & 1) !== 0,
      bold: ((token.fontStyle ?? 0) & 2) !== 0,
    })),
  );
}

// 渲染进程的类型库是 DOM，没有 DedicatedWorkerGlobalScope：只声明这里用到的两个成员。
const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<HighlightRequest>) => void): void;
  postMessage(message: HighlightReply): void;
};

scope.addEventListener("message", ({ data: { id, code, language } }) => {
  tokenize(code, language).then(
    (lines) => scope.postMessage({ id, lines }),
    (error: unknown) => scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
});

// Shiki（JS 正则引擎，不用 WASM）+ CSS 变量主题：深浅主题不重新高亮，颜色直接取设计 token（markdown.css 里把 --shiki-* 映射到 --syn-*）。
// 高亮器和语言包都是按需异步加载；没加载完时调用方先显示纯文本，加载完只改颜色。
import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export interface HighlightToken {
  text: string;
  color?: string;
  italic: boolean;
  bold: boolean;
}

type LangModule = () => Promise<{ default: LanguageRegistration[] }>;

const languages: Record<string, LangModule> = {
  bash: () => import("shiki/langs/bash.mjs"),
  batch: () => import("shiki/langs/batch.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

const aliases: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  cmd: "batch",
  bat: "batch",
  py: "python",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  cs: "csharp",
  "c++": "cpp",
  kt: "kotlin",
  rb: "ruby",
  patch: "diff",
  docker: "dockerfile",
  svg: "xml",
};

const themeName = "studio";
let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();
const cache = new Map<string, HighlightToken[][]>();

/** 把 ```lang 里的写法归一成我们打包的语言名；不认识的返回 null（显示纯文本）。 */
export function resolveLanguage(lang: string): string | null {
  const name = lang.toLowerCase();
  const canonical = aliases[name] ?? name;
  return canonical in languages ? canonical : null;
}

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [
      createCssVariablesTheme({ name: themeName, variablePrefix: "--shiki-", variableDefaults: {}, fontStyle: true }),
    ],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

function cacheKey(code: string, language: string): string {
  return `${language}\u0000${code}`;
}

/** 已经高亮过的结果（同步）；没有时返回 null。 */
export function cachedHighlight(code: string, lang: string): HighlightToken[][] | null {
  const language = resolveLanguage(lang);
  return language ? (cache.get(cacheKey(code, language)) ?? null) : null;
}

async function ensureLoaded(core: HighlighterCore, language: string): Promise<void> {
  if (loaded.has(language)) return;
  const load = languages[language] as LangModule;
  await core.loadLanguage((await load()).default);
  loaded.add(language);
}

/** Markdown 源码里围栏代码块用到的语言：先加载，markdown 语法才会把块里的代码交给它着色。 */
function fencedLanguages(code: string): string[] {
  const names = new Set<string>();
  for (const match of code.matchAll(/^[ \t]{0,3}(?:`{3,}|~{3,})[ \t]*([\w+#.-]+)/gm)) {
    const language = resolveLanguage(match[1]!);
    if (language) names.add(language);
  }
  return [...names];
}

export async function highlight(code: string, lang: string): Promise<HighlightToken[][] | null> {
  const language = resolveLanguage(lang);
  if (!language) return null;
  const key = cacheKey(code, language);
  const hit = cache.get(key);
  if (hit) return hit;
  const core = await getHighlighter();
  const needed = language === "markdown" ? [...fencedLanguages(code), language] : [language];
  for (const name of needed) await ensureLoaded(core, name);
  const lines = core.codeToTokensBase(code, { lang: language, theme: themeName }).map((line) =>
    line.map((token) => ({
      text: token.content,
      ...(token.color ? { color: token.color } : {}),
      italic: ((token.fontStyle ?? 0) & 1) !== 0,
      bold: ((token.fontStyle ?? 0) & 2) !== 0,
    })),
  );
  if (cache.size > 200) cache.clear();
  cache.set(key, lines);
  return lines;
}

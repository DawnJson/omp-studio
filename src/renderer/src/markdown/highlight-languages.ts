// 打包的 Shiki 语言：名字 → 按需加载语言包，以及 ```lang 写法的归一。主线程只用名字，加载和着色在高亮 worker 里（highlight-worker.ts）。
import type { LanguageRegistration } from "shiki/core";

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

/** 把 ```lang 里的写法归一成我们打包的语言名；不认识的返回 null（显示纯文本）。 */
export function resolveLanguage(lang: string): string | null {
  const name = lang.toLowerCase();
  const canonical = aliases[name] ?? name;
  return canonical in languages ? canonical : null;
}

/** 加载 resolveLanguage 给出的语言（名字一定在表里）。 */
export function loadLanguage(language: string): Promise<{ default: LanguageRegistration[] }> {
  return (languages[language] as LangModule)();
}

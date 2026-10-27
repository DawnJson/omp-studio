// 打包的 Shiki 语言名，以及 ```lang 写法的归一。这里只有名字（没有 import()），主线程放心引用；
// 语言包的按需加载表在 highlight-loaders.ts，只有高亮 worker 引用，语言包 chunk 只打一份。

export const LANGUAGES = [
  "bash",
  "batch",
  "c",
  "cpp",
  "csharp",
  "css",
  "diff",
  "dockerfile",
  "go",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "jsonc",
  "jsx",
  "kotlin",
  "lua",
  "markdown",
  "php",
  "powershell",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
] as const;

export type Language = (typeof LANGUAGES)[number];

const known: ReadonlySet<string> = new Set(LANGUAGES);

const aliases: Record<string, Language> = {
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

/** 把 ```lang 里的写法归一成我们打包的语言名；不认识的返回 null（显示纯文本）。hasOwn：`constructor` 之类不算语言。 */
export function resolveLanguage(lang: string): Language | null {
  const name = lang.toLowerCase();
  if (Object.hasOwn(aliases, name)) return aliases[name]!;
  return known.has(name) ? (name as Language) : null;
}

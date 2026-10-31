// 一键检查（npm run check）：oxlint、prettier、tsc，加上 lint 管不到的仓库扫描。规则的来由见 AGENTS.md 和 docs/architecture/。
// 用法：
//   node scripts/check.ts                  全量
//   node scripts/check.ts --staged         pre-commit 用：私人信息只查暂存区里改动的文件（查暂存的内容），其余同全量
//   node scripts/check.ts --gate           工作区没有改动就直接通过，否则全量（agent 结束前的钩子）
//   node scripts/check.ts --stop-hook      Claude Code / Codex 的 Stop 钩子：同 --gate，按它们的约定退出（见 stopHook）
//   node scripts/check.ts --commit-msg <文件>   commit-msg 钩子：提交信息对照两份本地黑名单
// 每条问题一行 `路径:行: 检查名: 说明`，最多 40 行。退出码 0 = 通过，1 = 有问题。
// 本地黑名单（被 gitignore，不进仓库）：.githooks/private-patterns.local.txt（私人信息）、.githooks/no-mention.local.txt
// （CHANGELOG 和提交信息里不写的第三方客户端名）。每行一个正则，不区分大小写，`#` 开头是注释；文件不在就警告一行并跳过。
import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { nextHeading, UNRELEASED_HEADING } from "../src/shared/changelog.ts";
import { syncSkills } from "./sync-agent-adapters.ts";

const root = path.resolve(import.meta.dirname, "..");
const MAX_LINES = 40;
const PRIVATE_PATTERNS = path.join(root, ".githooks", "private-patterns.local.txt");
const NO_MENTION = path.join(root, ".githooks", "no-mention.local.txt");

interface Finding {
  file: string;
  line: number;
  id: string;
  message: string;
}

interface SourceFile {
  /** 相对仓库根目录，正斜杠。 */
  path: string;
  lines: string[];
}

/** 扫描的例外：文件 + 那一行里的一段原文 + 理由。只在这里加，不在代码里写注释豁免。 */
const ALLOW: { id: string; file: string; text: string; reason: string }[] = [
  {
    id: "css-has",
    file: "src/renderer/src/features/tsp/tsp.css",
    text: '.tsp-surface[data-mode="inline"]:has(> .tsp-dock:not([data-blank]))',
    reason: "只看 surface 的直接子元素 dock，失效范围是一个元素；改掉要把 dock 的空状态提到 surface 上",
  },
  {
    id: "css-has",
    file: "src/renderer/src/features/tsp/tsp.css",
    text: ".tsp-card-body:not(:has(> .si-retry))",
    reason: "只在错误卡片的正文上、只看直接子元素；重试按钮由 session-info 渲染，卡片自己不知道它在不在",
  },
];

const CODE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/** 读本地黑名单；文件不在就警告一行，返回 null（跳过这项检查）。 */
async function loadPatterns(file: string, what: string): Promise<RegExp[] | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    process.stderr.write(`警告：没有 ${path.relative(root, file)}，跳过${what}\n`);
    return null;
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => new RegExp(line, "i"));
}

function toSource(file: string, text: string): SourceFile | null {
  if (text.includes("\0")) return null; // 二进制
  return { path: file, lines: text.split(/\r?\n/) };
}

/** 被跟踪的文件和没被忽略的新文件（工作区里的内容）；已在工作区删掉的跳过。 */
async function worktreeFiles(): Promise<SourceFile[]> {
  const names = [...new Set(git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0"))];
  const files = await Promise.all(
    names
      .filter((name) => name !== "")
      .map(async (name) => {
        try {
          return toSource(name, await readFile(path.join(root, name), "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      }),
  );
  return files.filter((file) => file !== null);
}

/** 暂存区里新增、改动的文件，内容取暂存的版本。 */
function stagedFiles(): SourceFile[] {
  const names = git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"])
    .split("\0")
    .filter((name) => name !== "");
  return names.map((name) => toSource(name, git(["show", `:${name}`]))).filter((file) => file !== null);
}

/** 逐行匹配；`skipComments` 时跳过 `//`、`/*`、`*` 开头的注释行。 */
function grepLines(files: SourceFile[], pattern: RegExp, id: string, message: string, skipComments = false): Finding[] {
  const findings: Finding[] = [];
  for (const file of files)
    file.lines.forEach((line, index) => {
      if (skipComments && COMMENT_LINE.test(line)) return;
      if (
        pattern.test(line) &&
        !ALLOW.some((entry) => entry.id === id && entry.file === file.path && line.includes(entry.text))
      )
        findings.push({ file: file.path, line: index + 1, id, message });
    });
  return findings;
}

// ───────── 代码扫描 ─────────

function scanPrivateInfo(files: SourceFile[], patterns: RegExp[]): Finding[] {
  return patterns.flatMap((pattern) =>
    grepLines(
      files,
      pattern,
      "private-info",
      `命中私人信息规则 /${pattern.source}/，换成占位值（C:\\Users\\someone\\…）`,
    ),
  );
}

function scanInnerHtml(files: SourceFile[]): Finding[] {
  const targets = files.filter(
    (file) =>
      file.path.startsWith("src/") && CODE.test(file.path) && file.path !== "src/renderer/src/markdown/render.ts",
  );
  return grepLines(
    targets,
    /dangerouslySetInnerHTML/,
    "inner-html",
    "只有 markdown/render.ts 的 KaTeX 输出能用它；其它内容按 token 渲染成 React 元素",
    true,
  );
}

function scanShellTrue(files: SourceFile[]): Finding[] {
  const targets = files.filter((file) => /^(src|scripts|test)\//.test(file.path) && CODE.test(file.path));
  return grepLines(targets, /\bshell\s*:\s*true\b/, "shell-true", "起子进程不经过 shell，参数用数组", true);
}

function scanBrowserWindowFlags(files: SourceFile[]): Finding[] {
  const targets = files.filter((file) => file.path.startsWith("src/main/") && CODE.test(file.path));
  return grepLines(
    targets,
    /\b(nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false|webviewTag\s*:\s*true)\b/,
    "browser-window-flags",
    "窗口一律 contextIsolation、sandbox 开，nodeIntegration、webviewTag 关，不关 webSecurity",
  );
}

/** 渲染进程里整秒刷新的计时用 use-now.ts（对齐起点），不用 1000ms 的 setInterval。 */
function scanInterval1000(files: SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/renderer/") || !CODE.test(file.path) || file.path.endsWith("/use-now.ts")) continue;
    const text = file.lines.join("\n");
    for (const match of text.matchAll(/\bsetInterval\(/g)) {
      const args = callArguments(text, match.index + match[0].length);
      if (/^1_?000$/.test(args.at(-1)?.trim() ?? ""))
        findings.push({
          file: file.path,
          line: lineAt(text, match.index),
          id: "interval-1000",
          message: "整秒计时用 features/conversation/use-now.ts（对齐起点），不用 1000ms 定时器",
        });
    }
  }
  return findings;
}

/** 从 `(` 之后取到配对的 `)`，按顶层逗号分开参数（不处理字符串里的括号，定时器参数里用不到）。 */
function callArguments(text: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let from = start;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (char === "(" || char === "[" || char === "{") depth++;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) {
        args.push(text.slice(from, i));
        return args;
      }
      depth--;
    } else if (char === "," && depth === 0) {
      args.push(text.slice(from, i));
      from = i + 1;
    }
  }
  return args;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function scanE2eLocaleTheme(files: SourceFile[]): Finding[] {
  const targets = files.filter(
    (file) => file.path.startsWith("test/e2e/") && CODE.test(file.path) && file.path !== "test/e2e/launch.ts",
  );
  return grepLines(
    targets,
    /\bstudio\.set(Locale|Theme)\(|setAttribute\(\s*["'`]data-theme|dataset\.theme\s*=[^=]/,
    "e2e-locale-theme",
    "切语言、主题用 launch.ts 的 setLocale / setTheme / setLocaleTheme，它们会等主题的淡入放完",
  );
}

// ───────── CSS 扫描 ─────────

interface CssRule {
  file: string;
  line: number;
  selector: string;
}

/** 去掉注释（保留换行）后按花括号切出样式规则的选择器；@ 规则（@media 等）里的照常收集，@keyframes 里的跳过。 */
function cssRules(file: SourceFile): CssRule[] {
  const text = file.lines.join("\n").replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const rules: CssRule[] = [];
  const stack: ("at" | "keyframes" | "rule")[] = [];
  let preludeStart = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "{") {
      const raw = text.slice(preludeStart, i);
      const prelude = raw.trim();
      if (prelude.startsWith("@")) stack.push(/^@(-\w+-)?keyframes\b/.test(prelude) ? "keyframes" : "at");
      else {
        if (!stack.includes("keyframes") && !stack.includes("rule"))
          rules.push({
            file: file.path,
            line: lineAt(text, preludeStart + raw.length - raw.trimStart().length),
            selector: prelude,
          });
        stack.push("rule");
      }
      preludeStart = i + 1;
    } else if (char === "}") {
      stack.pop();
      preludeStart = i + 1;
    } else if (char === ";") preludeStart = i + 1;
  }
  return rules;
}

/** 按顶层逗号切开选择器列表。 */
function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(selector.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(selector.slice(from).trim());
  return parts;
}

const cssFiles = (files: SourceFile[]) => files.filter((file) => file.path.endsWith(".css"));

function scanCssHas(files: SourceFile[]): Finding[] {
  const targets = cssFiles(files).filter((file) => /^src\/renderer\/src\/features\/(tsp|sidebar)\//.test(file.path));
  return grepLines(targets, /:has\(/, "css-has", "对话区和侧栏不用 :has()（每次 DOM 变动都要重算），改用属性或类");
}

function scanAppChildWildcard(rules: CssRule[]): Finding[] {
  return rules
    .filter((rule) => /#app\[[^\]]*\][^{]*>\s*\*/.test(rule.selector))
    .map((rule) => ({
      file: rule.file,
      line: rule.line,
      id: "css-app-child-wildcard",
      message: "#app[...] 的选择器不以 > * 结尾：属性一变，整棵树的样式都要重算",
    }));
}

/** 样式在哪个模块：features/<功能>，或 src/renderer/src 下的第一层目录（markdown、ui…），或 src/renderer 下的 styles。 */
function cssOwner(file: string): string {
  const rest = file.slice("src/renderer/".length).split("/");
  if (rest[0] !== "src") return rest[0] ?? "";
  if (rest[1] === "features") return `features/${rest[2]}`;
  return rest.length > 2 ? (rest[1] ?? "") : ".";
}

/**
 * 同一个类在两个模块里都单独定义（选择器只有这一个类，最多带 :hover、::before 这类伪类）就报：
 * 两份样式都全局生效，互相覆盖（.md-block 那次）。带父级、属性、:has() / :not() 或组合了别的类的选择器
 * （`.x .ui-row`、`.ui-chip.mode-chip`、`.ui-row:has(…)`）是对别处样式的局部修改，不算定义。
 */
function scanDuplicateClasses(rules: CssRule[]): Finding[] {
  const owners = new Map<string, Map<string, CssRule>>();
  for (const rule of rules) {
    if (!rule.file.startsWith("src/renderer/")) continue;
    for (const part of splitSelectors(rule.selector)) {
      const name = /^(\.[\w-]+)(::?[\w-]+)*$/.exec(part)?.[1];
      if (name === undefined) continue;
      const byOwner = owners.get(name) ?? new Map<string, CssRule>();
      const owner = cssOwner(rule.file);
      if (!byOwner.has(owner)) byOwner.set(owner, rule);
      owners.set(name, byOwner);
    }
  }
  const findings: Finding[] = [];
  for (const [name, byOwner] of owners) {
    if (byOwner.size < 2) continue;
    const [first, ...rest] = [...byOwner.values()];
    for (const rule of rest)
      findings.push({
        file: rule.file,
        line: rule.line,
        id: "css-duplicate-class",
        message: `${name} 也在 ${first?.file}:${first?.line} 定义；功能的类名带本功能前缀`,
      });
  }
  return findings;
}

function scanShikiVars(files: SourceFile[]): Finding[] {
  const targets = cssFiles(files).filter((file) => file.path !== "src/renderer/styles/tokens.css");
  return grepLines(
    targets,
    /(^|[^\w-])--shiki-[\w-]*\s*:/,
    "css-shiki-vars",
    "--shiki-* 只在 styles/tokens.css 的 :root 里映射",
  );
}

/** 故意不声明的变量：引用处靠它没定义时回退成继承值。 */
const UNDECLARED_OK = new Set([
  // tokens.css 的 .hl-token-inserted / deleted / changed：继承所在 diff 行的增删色（见那里的注释）。
  "--shiki-token-inserted",
  "--shiki-token-deleted",
  "--shiki-token-changed",
]);

/**
 * `var(--x)` 引用了却哪儿都没声明的 CSS 变量（删 token 时漏改的引用，浏览器静默回退成初始值）。
 * 声明：CSS 里的 `--x:`、TS / HTML 里写成字符串的 `"--x"`（setProperty、style 对象）。引用：CSS、TS、HTML 里的 `var(--x`，注释行不算。
 */
function scanUndeclaredVars(files: SourceFile[]): Finding[] {
  const targets = files.filter(
    (file) => /^src\/(renderer|shared)\//.test(file.path) && /\.(css|ts|tsx|html)$/.test(file.path),
  );
  const declared = new Set<string>();
  for (const file of targets) {
    // CSS 和 HTML 的 style 里是 `--x:`；TS 和 HTML 的属性里是字符串 `"--x"` / `"--x: …"`。
    const patterns = [
      ...(/\.(css|html)$/.test(file.path) ? [/(?:^|[^\w-])(--[\w-]+)\s*:/g] : []),
      ...(/\.(ts|tsx|html)$/.test(file.path) ? [/["'`](--[\w-]+)["'`:]/g] : []),
    ];
    for (const pattern of patterns)
      for (const line of file.lines) for (const match of line.matchAll(pattern)) declared.add(match[1] ?? "");
  }
  const findings: Finding[] = [];
  for (const file of targets)
    file.lines.forEach((line, index) => {
      if (COMMENT_LINE.test(line)) return;
      for (const match of line.matchAll(/var\(\s*(--[\w-]+)(?![\w$-])/g)) {
        const name = match[1] ?? "";
        if (!declared.has(name) && !UNDECLARED_OK.has(name))
          findings.push({ file: file.path, line: index + 1, id: "css-undeclared-var", message: `${name} 没有声明` });
      }
    });
  return findings;
}

// ───────── CHANGELOG 和提交信息 ─────────

function scanUnreleasedMentions(files: SourceFile[], patterns: RegExp[]): Finding[] {
  const changelog = files.find((file) => file.path === "CHANGELOG.md");
  if (changelog === undefined) return [];
  const text = changelog.lines.join("\n");
  const start = text.indexOf(`${UNRELEASED_HEADING}\n`);
  if (start === -1) return [];
  const end = nextHeading(text, start + UNRELEASED_HEADING.length);
  const first = lineAt(text, start);
  const section = { path: changelog.path, lines: changelog.lines.slice(first - 1, lineAt(text, end) - 1) };
  return mentions([section], patterns, "changelog-mention").map((finding) => ({
    ...finding,
    line: finding.line + first - 1,
  }));
}

function mentions(files: SourceFile[], patterns: RegExp[], id: string): Finding[] {
  return patterns.flatMap((pattern) =>
    grepLines(files, pattern, id, `不写第三方客户端或插件的名字（/${pattern.source}/），只说用户得到的能力`),
  );
}

async function checkCommitMessage(file: string): Promise<Finding[]> {
  // `git commit -m` / `-F` 不删以 # 开头的行，它们会进提交，所以也要查。只跳过 git 自己生成、注定不进提交的部分：
  // `git commit -v` 剪刀线下面的 diff，和编辑器模板里 `#<Tab>` 开头的文件清单（仓库内路径，可能含插件目录名）。
  const all = (await readFile(file, "utf8")).split(/\r?\n/);
  const scissors = all.indexOf("# ------------------------ >8 ------------------------");
  const lines = (scissors === -1 ? all : all.slice(0, scissors)).map((line) => (line.startsWith("#\t") ? "" : line));
  const message = [{ path: path.relative(root, path.resolve(file)).replaceAll("\\", "/"), lines }];
  const privatePatterns = await loadPatterns(PRIVATE_PATTERNS, "提交信息的私人信息检查");
  const noMention = await loadPatterns(NO_MENTION, "提交信息的客户端名检查");
  return [
    ...(privatePatterns === null
      ? []
      : scanPrivateInfo(message, privatePatterns).map((f) => ({ ...f, id: "commit-msg-private" }))),
    ...(noMention === null ? [] : mentions(message, noMention, "commit-msg-mention")),
  ];
}

// ───────── 工具：oxlint、prettier、tsc（和 package.json 的 lint、format:check、typecheck 同参数） ─────────

interface ToolRun {
  id: string;
  args: string[];
  /** 从输出里取出 `路径、行、说明`；取不到的行忽略。 */
  parse(line: string): [string, number, string] | null;
}

const TOOLS: ToolRun[] = [
  {
    id: "lint",
    args: [path.join(root, "node_modules", "oxlint", "bin", "oxlint"), "--deny-warnings", "-f", "unix"],
    parse: (line) => {
      const match = /^(.+?):(\d+):\d+: (.*)$/.exec(line);
      return match ? [match[1] ?? "", Number(match[2]), match[3] ?? ""] : null;
    },
  },
  {
    id: "format",
    args: [path.join(root, "node_modules", "prettier", "bin", "prettier.cjs"), "--check", "."],
    parse: (line) => {
      const match = /^\[(warn|error)\] (.+?)(?:: (.*))?$/.exec(line);
      if (!match || /^Code style issues|^All matched files/.test(match[2] ?? "")) return null;
      return [match[2] ?? "", 1, match[3] ?? "没按 prettier 格式化（npm run format）"];
    },
  },
  {
    id: "typecheck",
    args: [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-b", "tsconfig.json", "--pretty", "false"],
    parse: (line) => {
      const match = /^(.+?)\((\d+),\d+\): (.*)$/.exec(line);
      return match ? [match[1] ?? "", Number(match[2]), match[3] ?? ""] : null;
    },
  },
];

function runTool(tool: ToolRun): Promise<Finding[]> {
  const { promise, resolve, reject } = Promise.withResolvers<Finding[]>();
  const child = spawn(process.execPath, tool.args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (output += chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) return resolve([]);
    const findings: Finding[] = [];
    // 工具在某些环境里（钩子、Bun 起的进程）输出接管道也带颜色：`[\x1b[33mwarn\x1b[39m]` 认不出来，先去掉控制序列。
    const text = stripVTControlCharacters(output);
    for (const line of text.split(/\r?\n/)) {
      const parsed = tool.parse(line);
      if (parsed)
        findings.push({ file: parsed[0].replaceAll("\\", "/"), line: parsed[1], id: tool.id, message: parsed[2] });
    }
    // 输出认不出来（工具本身出错）：原样给出第一行。
    if (findings.length === 0)
      findings.push({
        file: "package.json",
        line: 1,
        id: tool.id,
        message: `退出码 ${code}：${text.trim().split(/\r?\n/)[0] ?? ""}`,
      });
    resolve(findings);
  });
  return promise;
}

/** `.claude/skills` 是 `.agents/skills` 的镜像（postinstall 建）：加了 skill 没重建，Claude Code 就看不到它。 */
async function scanAgentAdapters(): Promise<Finding[]> {
  return (await syncSkills(root, true)).map((entry) => {
    const colon = entry.indexOf(": ");
    return {
      file: entry.slice(0, colon),
      line: 1,
      id: "agent-adapters",
      message: `${entry.slice(colon + 2)}，运行 node scripts/sync-agent-adapters.ts`,
    };
  });
}

/** `.agents/`、`docs/` 是给 agent 和人看的规则，被 .gitignore 误伤就进不了仓库（不带 `/` 的 `release/` 曾把 release skill 忽略掉）。 */
function scanIgnoredRules(): Finding[] {
  return git(["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ".agents", "docs"])
    .split("\0")
    .filter((file) => file !== "")
    .map((file) => ({
      file,
      line: 1,
      id: "ignored-rules",
      message: "被 .gitignore 忽略，提交不进仓库（git check-ignore -v 看是哪条）",
    }));
}

// ───────── 入口 ─────────

async function repoScans(staged: boolean): Promise<Finding[]> {
  const files = await worktreeFiles();
  const rules = cssFiles(files).flatMap(cssRules);
  const privatePatterns = await loadPatterns(PRIVATE_PATTERNS, "私人信息检查");
  const noMention = await loadPatterns(NO_MENTION, "CHANGELOG 的客户端名检查");
  return [
    ...(privatePatterns === null ? [] : scanPrivateInfo(staged ? stagedFiles() : files, privatePatterns)),
    ...(noMention === null ? [] : scanUnreleasedMentions(files, noMention)),
    ...scanInnerHtml(files),
    ...scanShellTrue(files),
    ...scanBrowserWindowFlags(files),
    ...scanInterval1000(files),
    ...scanE2eLocaleTheme(files),
    ...scanCssHas(files),
    ...scanAppChildWildcard(rules),
    ...scanDuplicateClasses(rules),
    ...scanShikiVars(files),
    ...scanUndeclaredVars(files),
    ...(await scanAgentAdapters()),
    ...scanIgnoredRules(),
  ];
}

async function runChecks(staged: boolean): Promise<Finding[]> {
  const results = await Promise.all([...TOOLS.map(runTool), repoScans(staged)]);
  return results.flat();
}

function formatFindings(findings: Finding[], room: number): string[] {
  const lines = findings.map((finding) => `${finding.file}:${finding.line}: ${finding.id}: ${finding.message}`);
  if (lines.length <= room) return lines;
  return [...lines.slice(0, room - 1), `…还有 ${lines.length - room + 1} 条`];
}

async function readStdinJson(): Promise<Record<string, unknown>> {
  if (process.stdin.isTTY) return {};
  let text = "";
  for await (const chunk of process.stdin) text += String(chunk);
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    // 钩子的事件 JSON 读不出来时按"没有事件"处理：只影响要不要防止反复续跑。
    return {};
  }
}

/**
 * Claude Code / Codex 的 Stop 钩子，一律退出 0，stdout 只写 JSON（Codex 把非 JSON 的 stdout 当错误）：通过时什么也不写；
 * 没通过时写 `{"decision":"block","reason":问题}`，两边都把 reason 当作继续干活的提示。不用"退出 2 + stderr"：
 * Codex 0.160.1（Windows，exec）收到退出 2 照样结束这一轮，不续跑（2026-10-30 实测）。已经因为这个钩子续跑过一次
 * （stop_hook_active）还没通过，就只给一行 systemMessage 放行，免得来回打转（Codex 没有续跑次数上限）。
 */
async function stopHook(): Promise<number> {
  const event = await readStdinJson();
  if (git(["status", "--porcelain"]) === "") return 0;
  const findings = await runChecks(false);
  if (findings.length === 0) return 0;
  const lines = formatFindings(findings, MAX_LINES);
  const output =
    event["stop_hook_active"] !== true
      ? { decision: "block", reason: lines.join("\n") }
      : { systemMessage: `scripts/check.ts 仍未通过，运行 npm run check 查看：${lines[0] ?? ""}` };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--stop-hook")) return stopHook();
  const started = performance.now();
  if (args[0] === "--commit-msg") {
    const file = args[1];
    if (file === undefined) throw new Error("用法：node scripts/check.ts --commit-msg <文件>");
    const findings = await checkCommitMessage(file);
    for (const line of formatFindings(findings, MAX_LINES)) console.log(line);
    return findings.length === 0 ? 0 : 1;
  }
  if (args.includes("--gate") && git(["status", "--porcelain"]) === "") {
    console.log("工作区没有改动，跳过检查");
    return 0;
  }
  const findings = await runChecks(args.includes("--staged"));
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (findings.length === 0) {
    console.log(`检查通过（${seconds}s）`);
    return 0;
  }
  for (const line of formatFindings(findings, MAX_LINES - 1)) console.log(line);
  console.log(`检查没通过：${findings.length} 条（${seconds}s）`);
  return 1;
}

process.exitCode = await main();

// 一键检查（npm run check）：oxlint、prettier、tsc，加上 lint 管不到的仓库扫描。规则的来由见 AGENTS.md 和 docs/architecture/。
// 用法：
//   node scripts/check.ts                  全量
//   node scripts/check.ts --staged         pre-commit 用：私人信息只查暂存区里改动的文件（查暂存的内容），其余同全量
//   node scripts/check.ts --gate           工作区没有改动就直接通过，否则全量（agent 结束前的钩子）
//   node scripts/check.ts --commit-msg <文件>   commit-msg 钩子：提交信息对照两份本地黑名单
// 每条问题一行 `路径:行: 检查名: 说明`，最多 40 行。退出码 0 = 通过，1 = 有问题。
// 本地黑名单（被 gitignore，不进仓库）：.githooks/private-patterns.local.txt（私人信息）、.githooks/no-mention.local.txt
// （CHANGELOG 和提交信息里不写的第三方客户端名）。每行一个正则，不区分大小写，`#` 开头是注释；文件不在就警告一行并跳过。
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { CHANGELOGS, nextHeading } from "../src/shared/changelog.ts";
import { dictionaries } from "../src/shared/i18n/index.ts";

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
  {
    id: "node-map-order",
    file: "src/shared/tsp/node-watch.ts",
    text: "for (const node of surface.nodes.values()) if (this.#matches(node))",
    reason: "重扫时把符合条件的节点记进 Map，只拿来查有没有、数个数，顺序不出去",
  },
  {
    id: "node-map-order",
    file: "src/renderer/src/features/tsp/tsp-store.ts",
    text: "markKnown(taskId, surface.id, surface.nodes.values())",
    reason: "把快照里已有的节点记成「见过」（进场动画不播），是集合，顺序不出去",
  },
  {
    id: "dead-export",
    file: "src/main/platform/win32/job-object.ts",
    text: "export function isInAppJob",
    reason: "测试经模块私有的 Job 句柄确认子进程真的进了 Job，搬到测试里就拿不到句柄",
  },
  {
    id: "dead-export",
    file: "src/main/history/session-usage.ts",
    text: "export function summarizeSessionUsage",
    reason:
      "整段文本喂 SessionUsageAccumulator，和 tsp/session-files.ts 增量读文件同一套规则；测试拿它当增量结果的对照",
  },
  {
    id: "dead-export",
    file: "src/main/tsp/session-extras.ts",
    text: "export function parseSession",
    reason:
      "整段文本喂 SessionExtrasAccumulator，和 tsp/session-files.ts 增量读文件同一套规则；测试拿它当增量结果的对照",
  },
  {
    id: "dead-export",
    file: "src/main/tsp/session-tree-file.ts",
    text: "export function parseSessionEntries",
    reason: "整段文本喂 SessionEntriesAccumulator，和 readSessionEntries 增量读文件同一套规则；测试用它从夹具建树",
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

function allowed(id: string, file: string, line: string): boolean {
  return ALLOW.some((entry) => entry.id === id && entry.file === file && line.includes(entry.text));
}

/** 逐行匹配；`skipComments` 时跳过 `//`、`/*`、`*` 开头的注释行。 */
function grepLines(files: SourceFile[], pattern: RegExp, id: string, message: string, skipComments = false): Finding[] {
  const findings: Finding[] = [];
  for (const file of files)
    file.lines.forEach((line, index) => {
      if (skipComments && COMMENT_LINE.test(line)) return;
      if (pattern.test(line) && !allowed(id, file.path, line))
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

/**
 * 界面里只出自绘的悬停提示（ui/Tooltip.tsx 读 title 属性）：SVG 的 `<title>` 子元素、`<abbr>`、原生 `<details>` 的提示和样式
 * 它管不到，出的是 Windows 原生提示（2026-11-10 仓库所有者："有的时候还会显示 win 原本的样式"，对话里环形图的刻度就是 `<title>`）。
 */
function scanNativeTooltips(files: SourceFile[]): Finding[] {
  const targets = files.filter((file) => file.path.startsWith("src/renderer/") && file.path.endsWith(".tsx"));
  return grepLines(
    targets,
    /<(title|abbr|details)[\s>]/,
    "native-tooltip",
    "悬停提示用元素的 title 属性（TooltipLayer 自绘），不用 SVG <title>、<abbr>、<details>",
    true,
  );
}

/**
 * 往伪终端写按键的元素会嵌套（提问对话框 > list > 编辑框），各自直接挂 onKeyDown 时同一个键里外各写一次给 omp：
 * 提问文本框一次退格删两个字、方向键走两格（PR #17），之前编辑框打字也双倍过。这类元素只经 `keyOwner`（interactive/key-event.ts）
 * 拿 `data-tspi-keys` 和 onKeyDown，它统一判断这个键归不归这一层。
 */
function scanKeyOwner(files: SourceFile[]): Finding[] {
  const tsx = files.filter((file) => file.path.startsWith("src/renderer/") && file.path.endsWith(".tsx"));
  const forwarders = tsx.filter(
    (file) =>
      file.path.startsWith("src/renderer/src/features/tsp/") &&
      file.lines.some((line) => /\bctx\.keys\(|\bsendTspKeys\(/.test(line)),
  );
  const message =
    "写按键给 omp 的元素用 {...keyOwner(onKeyDown)}（interactive/key-event.ts），不直接挂 data-tspi-keys / onKeyDown";
  return [
    ...grepLines(tsx, /\bdata-tspi-keys=/, "key-owner", message, true),
    ...grepLines(forwarders, /\bonKeyDown=\{/, "key-owner", message, true),
  ];
}

/** `spec §4.x` 的引用要能在 docs/design/spec.md 的索引里找到对应文件（2026-11-10 规范按节拆成 docs/design/spec/*.md）。 */
function scanSpecRefs(files: SourceFile[]): Finding[] {
  const index = files.find((file) => file.path === "docs/design/spec.md");
  if (index === undefined) return [];
  const known = new Set(
    index.lines.flatMap((line) => [...line.matchAll(/^\| §([\d.A-B]+) \|/g)].map((match) => match[1])),
  );
  const findings: Finding[] = [];
  for (const file of files) {
    if (file.path.startsWith("docs/design/direction-") || file.path.startsWith("CHANGELOG")) continue;
    file.lines.forEach((line, index) => {
      for (const match of line.matchAll(/spec[^§\n]{0,20}§\s?(\d+\.\d+)/g)) {
        const section = match[1]!;
        if (!section.startsWith("4.") || known.has(section)) continue;
        findings.push({
          file: file.path,
          line: index + 1,
          id: "spec-ref",
          message: `spec §${section} 在 docs/design/spec.md 的索引里没有对应文件`,
        });
      }
    });
  }
  return findings;
}

/**
 * 用 <img> 显示的 SVG 一律先过 prepareSvg（markdown/svg-figure.ts）：omp 让模型画的 SVG 颜色写的是 `var(--surface)` 这类主题变量，
 * <img> 里读不到页面的 CSS 变量，直接显示整块变黑（2026-11-10 仓库所有者截图：提问表单里的内联 <svg>）。
 * 所以不给 SVG 建 object URL（tsp-store 的 TspImage 里 SVG 只有源码），`svgDataUrl(` 只接 prepare 过的源码。
 */
function scanUnthemedSvg(files: SourceFile[]): Finding[] {
  const targets = files.filter(
    (file) =>
      file.path.startsWith("src/renderer/") &&
      CODE.test(file.path) &&
      file.path !== "src/renderer/src/markdown/svg-figure.ts",
  );
  return grepLines(
    targets,
    /svgDataUrl\((?!\s*prepare)|createObjectURL\(.*svg/i,
    "unthemed-svg",
    "SVG 先用 prepareSvg 换成当前主题的颜色再给 <img>（markdown/figure-palette.ts 的 themedSvgUrl），不直接建 URL",
    true,
  );
}

/**
 * TSP 文档的节点表（`surface.nodes`，Map）和 `doc.live`（Set）的迭代顺序是改动历史：omp 更新卡片是 del + add，节点挪到表尾；
 * 按它排列表、取第一个 / 最后一个，界面会跟着 omp 的更新来回跳（2026-11-10 仓库所有者视频：子代理面板两行每秒对调几次，"杜绝这种问题"）。
 * test/tsp-tree-order.test.ts 用打乱插入顺序的文档对拍各个推导；这里拦住新写的直接迭代。
 */
function scanNodeMapOrder(files: SourceFile[]): Finding[] {
  const targets = files.filter(
    (file) => file.path.startsWith("src/") && CODE.test(file.path) && file.path !== "src/shared/tsp/document.ts",
  );
  return [
    ...grepLines(
      targets,
      /\.nodes\??\.(values|entries|keys|forEach)\(|(\bof|\.\.\.)\s*[\w.?]+\.nodes\s*[)\]]/,
      "node-map-order",
      "节点按文档顺序走：treeNodes(surface[, from]) / findNode（shared/tsp/document.ts），不迭代 surface.nodes；顺序无关的用法加进 check.ts 的 ALLOW",
      true,
    ),
    ...grepLines(
      targets,
      /(\bof|\.\.\.)\s*(doc|document)\.live\b(?![.\w])/,
      "node-map-order",
      "活着的 surface 用 liveSurfaces(doc)（shared/tsp/document.ts，按打开顺序），不迭代 doc.live",
      true,
    ),
  ];
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

/** 宠物窗口透明、直接盖在桌面上：大模糊阴影会在浮层下面留一片灰雾（2026-11-11 所有者截图），只用 --shadow-1。 */
function scanPetShadows(files: SourceFile[]): Finding[] {
  const targets = files.filter((file) => file.path.startsWith("src/renderer/src/pet/"));
  return grepLines(
    targets,
    /var\(--shadow-(modal|2|3)\)/,
    "pet-shadow",
    "宠物窗口里的浮层只用 --shadow-1（docs/design/spec/4.32-pet.md「气泡」）",
    true,
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

// ───────── 死代码 ─────────
// 2026-11-12 审计发现悄悄攒下来的：一个没人 import 的文件、3f5a1bf 删掉调用方后留下的两个导出、一批没人用的 i18n key。
// 下面三项只读已经载入的 SourceFile[]。

/** 内置插件的 omp 扩展：原样写进 omp 的扩展目录（client-accounts/deploy.ts），不经 import 进应用。 */
const EXTENSION_DIR = "src/main/client-accounts/extension/";

/** dead-file、dead-export 查的模块：src/ 下的 .ts / .tsx，不含声明文件、生成的协议类型和内置插件。 */
function isAppModule(file: string): boolean {
  return (
    file.startsWith("src/") &&
    /\.tsx?$/.test(file) &&
    !file.endsWith(".d.ts") &&
    !file.endsWith(".generated.ts") &&
    !file.startsWith(EXTENSION_DIR)
  );
}

/** 相对路径的 `import … from`、`import "…"`、`import("…")`、`export … from`、`new URL("…", import.meta.url)`（worker）。仓库里的 import 都带扩展名。 */
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew\s+URL\(\s*)(["'`])(\.{1,2}\/[^"'`]*)\1/g;

/** 文件里相对 import 的目标（相对仓库根目录），`?raw` `?url` 这类后缀去掉；注释行不算。 */
function relativeImports(file: SourceFile): string[] {
  const text = file.lines.filter((line) => !COMMENT_LINE.test(line)).join("\n");
  return [...text.matchAll(RELATIVE_IMPORT)].map((match) =>
    path.posix.join(path.posix.dirname(file.path), (match[2] ?? "").replace(/\?.*$/s, "")),
  );
}

/** 从 `entries` 沿相对 import 走得到的文件。 */
function reachable(byPath: Map<string, SourceFile>, entries: string[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...entries];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const file = byPath.get(next);
    if (file === undefined || seen.has(next)) continue;
    seen.add(next);
    if (CODE.test(next)) pending.push(...relativeImports(file));
  }
  return seen;
}

/** 应用入口：主进程和两个 preload（electron.vite.config.ts），加上 src/renderer/*.html 的 `<script src>`（vite 的 root 是 src/renderer）。 */
function appEntries(files: SourceFile[]): string[] {
  const scripts = files
    .filter((file) => /^src\/renderer\/[^/]+\.html$/.test(file.path))
    .flatMap((file) => file.lines.flatMap((line) => [...line.matchAll(/<script\b[^>]*\bsrc="\/([^"]+)"/g)]))
    .map((match) => `src/renderer/${match[1] ?? ""}`);
  return ["src/main/index.ts", "src/preload/index.ts", "src/preload/pet.ts", ...scripts];
}

/** src/ 下从应用入口沿相对 import 走不到的模块。只有 test/、scripts/ 引用的也算：生产代码树里不放只给测试用的模块。 */
function scanDeadFiles(files: SourceFile[]): Finding[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const app = reachable(byPath, appEntries(files));
  const tooling = reachable(
    byPath,
    files.filter((file) => /^(test|scripts)\//.test(file.path) && CODE.test(file.path)).map((file) => file.path),
  );
  return files
    .filter(
      (file) => isAppModule(file.path) && !app.has(file.path) && !allowed("dead-file", file.path, file.lines[0] ?? ""),
    )
    .map((file) => ({
      file: file.path,
      line: 1,
      id: "dead-file",
      message: tooling.has(file.path)
        ? "只有 test/、scripts/ 用：生产代码树里不放只给测试用的模块，挪进 test/"
        : "从应用入口沿 import 走不到，没人用，删掉",
    }));
}

/** `export const|let|function|class|enum|interface|type NAME`（含 async、declare、abstract、const enum）。 */
const EXPORT_DECLARATION =
  /^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(const\s+enum|const|let|function\*?|class|enum|interface|type)\s+([\w$]+)/;
/** 一行写完、不带 from 的 `export { a, type B, c as d };`。 */
const EXPORT_LIST = /^export\s+(type\s+)?\{([^}]*)\}\s*;?\s*$/;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;

interface ExportedName {
  file: string;
  line: number;
  text: string;
  name: string;
  isType: boolean;
}

function exportedNames(file: SourceFile): ExportedName[] {
  const names: ExportedName[] = [];
  file.lines.forEach((text, index) => {
    const declaration = EXPORT_DECLARATION.exec(text);
    if (declaration) {
      const kind = declaration[1] ?? "";
      const isType = kind === "interface" || kind === "type";
      names.push({ file: file.path, line: index + 1, text, name: declaration[2] ?? "", isType });
      return;
    }
    const list = EXPORT_LIST.exec(text);
    if (list)
      for (const item of (list[2] ?? "").split(",")) {
        const words = item.trim().split(/\s+/);
        const name = words.at(-1);
        const isType = list[1] !== undefined || words[0] === "type";
        if (name) names.push({ file: file.path, line: index + 1, text, name, isType });
      }
  });
  return names;
}

/**
 * src/ 下的导出（范围同 dead-file）按名字在 src/、test/、scripts/ 的代码里找用处，注释行不算：
 * 别的文件没有、本文件也只有声明 → 没人用；别的文件没有、本文件在用 → 去掉 export（类型和接口不管这条）；
 * 本文件只有声明、别的用处全在 test/ → 只有测试用。
 * 只比名字、不解析绑定：两个不同的东西同名时互相遮住（conversation/format.ts 的 formatDuration 就因此没被按名字查出来，是 dead-file 抓到的）。
 */
function scanDeadExports(files: SourceFile[]): Finding[] {
  const exported = files.filter((file) => isAppModule(file.path)).flatMap(exportedNames);
  const wanted = new Set(exported.map((entry) => entry.name));
  /** 名字 → 出现它的文件 → 次数。本文件不算：ALLOW 表里写着名字。 */
  const uses = new Map<string, Map<string, number>>();
  for (const file of files) {
    if (!/^(src|test|scripts)\//.test(file.path) || !CODE.test(file.path) || file.path === "scripts/check.ts") continue;
    for (const line of file.lines) {
      if (COMMENT_LINE.test(line)) continue;
      for (const [word] of line.matchAll(IDENTIFIER)) {
        if (!wanted.has(word)) continue;
        const byFile = uses.get(word) ?? new Map<string, number>();
        byFile.set(file.path, (byFile.get(file.path) ?? 0) + 1);
        uses.set(word, byFile);
      }
    }
  }
  const findings: Finding[] = [];
  for (const entry of exported) {
    const byFile = uses.get(entry.name) ?? new Map<string, number>();
    const own = byFile.get(entry.file) ?? 0;
    const others = [...byFile.keys()].filter((file) => file !== entry.file);
    const message =
      others.length === 0 && own <= 1
        ? "没有任何地方用，删掉"
        : others.length === 0 && !entry.isType
          ? "只在本文件用，去掉 export"
          : own <= 1 && others.length > 0 && others.every((file) => file.startsWith("test/"))
            ? "只有测试用"
            : null;
    if (message !== null && !allowed("dead-export", entry.file, entry.text))
      findings.push({ file: entry.file, line: entry.line, id: "dead-export", message: `${entry.name} ${message}` });
  }
  return findings;
}

/** 按算出来的名字整块查的命名空间 → 在哪查。 */
const DYNAMIC_NAMESPACES: Record<string, string> = {
  ompcfg: 'features/settings/config-meta.ts 按 omp 的配置键查 dictionaries[locale]["ompcfg"]',
};
const I18N_DICTIONARIES = /^src\/shared\/i18n\/(zh-CN|en|run)\//;
/** 整个是 `ns.key` 的字符串字面量（任一种引号；模板字面量里没有插值）。 */
const KEY_LITERAL = /(["'`])([A-Za-z][\w-]*\.[^"'`$\s]+)\1/g;
/** 以 `ns.` 开头、走到 `${` 的模板字面量，前面这段是前缀。 */
const KEY_PREFIX = /`([A-Za-z][\w-]*\.[^`$]*)\$\{/g;

/** 命名空间在 zh-CN/index.ts 里从哪个文件 import（run/ 下的也在这里）。 */
function namespaceFiles(files: SourceFile[]): Map<string, SourceFile> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const index = byPath.get("src/shared/i18n/zh-CN/index.ts");
  const result = new Map<string, SourceFile>();
  for (const line of index?.lines ?? []) {
    const match = /^import \{ (\w+) \} from "(\.{1,2}\/[^"]+)";/.exec(line);
    const file = match && byPath.get(path.posix.join("src/shared/i18n/zh-CN", match[2] ?? ""));
    if (match && file) result.set(match[1] ?? "", file);
  }
  return result;
}

/** 字典文件里定义 `key` 的那一行（`key:`、`"key":`）。 */
function definesKey(line: string, key: string): boolean {
  const trimmed = line.trimStart();
  return [`${key}:`, `"${key}":`, `'${key}':`].some((start) => trimmed.startsWith(start));
}

/**
 * zh-CN 字典的每个 `ns.key` 都要在 src/（字典目录之外，注释行不算）用到：写成字符串字面量，或被动态前缀盖住
 * （`` `agents.kind.${x}` `` 盖住 agents.kind. 开头的所有 key，`` `goal.${op}Failed` `` 盖住整个 goal）。
 * 弱点：`` `ns.${x}` `` 盖住整个命名空间，这样拼 key 的命名空间里没人用的 key 查不出来。
 */
function scanUnusedMessages(files: SourceFile[]): Finding[] {
  const literals = new Set<string>();
  const prefixes: string[] = [];
  for (const file of files) {
    if (!file.path.startsWith("src/") || !CODE.test(file.path) || I18N_DICTIONARIES.test(file.path)) continue;
    for (const line of file.lines) {
      if (COMMENT_LINE.test(line)) continue;
      for (const match of line.matchAll(KEY_LITERAL)) literals.add(match[2] ?? "");
      for (const match of line.matchAll(KEY_PREFIX)) prefixes.push(match[1] ?? "");
    }
  }
  const sources = namespaceFiles(files);
  const findings: Finding[] = [];
  for (const [namespace, messages] of Object.entries(dictionaries["zh-CN"])) {
    if (namespace in DYNAMIC_NAMESPACES) continue;
    const source = sources.get(namespace);
    for (const key of Object.keys(messages)) {
      const full = `${namespace}.${key}`;
      if (literals.has(full) || prefixes.some((prefix) => full.startsWith(prefix))) continue;
      const index = source?.lines.findIndex((line) => definesKey(line, key)) ?? -1;
      const file = source?.path ?? "src/shared/i18n/zh-CN/index.ts";
      if (!allowed("i18n-unused", file, source?.lines[index] ?? ""))
        findings.push({
          file,
          line: index === -1 ? 1 : index + 1,
          id: "i18n-unused",
          message: `${full} 没有地方用，zh-CN 和 en 里一起删掉`,
        });
    }
  }
  return findings;
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

/**
 * 一次性的进入动画（`animation: xx-in …`，不含 infinite）都要登记：打开有动画、关闭一下消失的情况要杜绝（2026-11-11 仓库所有者）。
 * 会被关掉的东西（浮层、面板、提示、小圆点）关闭时也要有动画：组件用 ui/presence.ts 的 usePresence 把 exitProps 展开到这个元素上
 * （或 Reveal / 自己的退出类），登记时写明退出在哪；换页、换内容这类没有"关"的写明原因。键是"文件|选择器"。
 */
const ENTRY_ANIMATIONS: Record<string, string> = {
  "src/renderer/src/app/app.css|.drawer-scrim": "App.tsx 的 drawerScrim（usePresence fade）",
  "src/renderer/src/app/app.css|.scrim": "ui/Dialog.tsx（usePresence，遮罩 data-closing=fade）",
  "src/renderer/src/features/composer/composer.css|.slash": "SlashMenu / FileMenu / HistorySearch（usePresence pop）",
  "src/renderer/src/features/dialogs/dialogs.css|.toast": "Toasts.tsx（usePresence，toast-out）",
  "src/renderer/src/features/empty/empty.css|.drop-overlay": "DropOverlay.tsx（usePresence fade）",
  "src/renderer/src/features/file-preview/file-preview.css|.file-preview":
    "App.tsx 的右栏 rightPresence（usePresence panel，panel-out）；子代理、浏览器面板同一个类",
  "src/renderer/src/features/omp-setup/omp-setup.css|.setup-card": "OmpSetupView.tsx（usePresence pop）",
  "src/renderer/src/features/review/review.css|.review": "ReviewHost.tsx（usePresence fade）",
  "src/renderer/src/features/sidebar/sidebar.css|.sb-dot-running, .sb-dot-waiting, .sb-dot-error, .sb-dot-interrupted, .sb-dot-unread":
    "StatusDot.tsx 的 StatusMark：变成 none 时 usePresence fade；换种类是换内容（新图标淡入）",
  "src/renderer/src/features/sidebar/sidebar.css|.sb-update":
    "下载好更新后才出现，要到重启安装才消失，应用里没有关掉它的时候",
  "src/renderer/src/features/terminal/terminal.css|.terminal-panel": "TerminalPanel.tsx（usePresence pop）",
  "src/renderer/src/ui/controls.css|.ui-seg-dot": "controls.tsx 的 SegDot（usePresence fade）",
  "src/renderer/src/ui/controls.css|.ui-menu[data-floating]": "Menu.tsx / Select.tsx（usePresence pop）",
  "src/renderer/src/ui/controls.css|.ui-popover": "Popover.tsx、StatusPills.tsx 的作业卡片（usePresence pop）",
  "src/renderer/src/ui/controls.css|.ui-dialog": "ui/Dialog.tsx（usePresence pop）",
  "src/renderer/src/ui/controls.css|.ui-info-pop": "InfoTip.tsx（usePresence fade）",
  "src/renderer/src/ui/controls.css|.ui-tooltip": "Tooltip.tsx 的 TooltipLayer（usePresence fade）",
  "src/renderer/src/ui/controls.css|.ui-data-in": "骨架换成真实列表时淡入，是换内容，没有关",
  "src/renderer/src/ui/flip-text.css|.flip-char[data-flipping] .flip-new": "同一条规则里旧字 flip-out",
  'src/renderer/src/ui/motion.css|.reveal[data-phase="enter"]':
    'Reveal.tsx，收起是 .reveal[data-phase="exit"] 的 reveal-out',
  "src/renderer/src/ui/motion.css|.panel > :is(.empty, .settings, .tsp-view, .composer-stack, .composer)":
    "主区换页：新页面淡入换掉旧页面，没有关",
  "src/renderer/src/ui/motion.css|.sidebar-column > :is(.sb, .snav)": "侧栏位置在会话列表和设置导航之间换，没有关",
  "src/renderer/src/ui/motion.css|.settings-section": "设置换节：新节淡入换掉旧节，没有关",
};

function scanEntryWithoutExit(files: SourceFile[], rules: CssRule[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of cssFiles(files)) {
    const inFile = rules.filter((rule) => rule.file === file.path);
    file.lines.forEach((text, index) => {
      const name = /^\s*animation(?:-name)?\s*:\s*([\w-]+-in)\b/.exec(text)?.[1];
      if (name === undefined || /\binfinite\b/.test(text)) return;
      const line = index + 1;
      const rule = inFile.findLast((candidate) => candidate.line <= line);
      const key = `${file.path}|${rule?.selector.replace(/\s+/g, " ") ?? ""}`;
      if (key in ENTRY_ANIMATIONS) return;
      findings.push({
        file: file.path,
        line,
        id: "css-entry-without-exit",
        message: `进入动画 ${name} 没登记（${key}）：关闭时也要有动画（usePresence 的 exitProps），登记到 scripts/check.ts 的 ENTRY_ANIMATIONS 写明退出在哪；不会被关掉的写明原因`,
      });
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
  return Object.values(CHANGELOGS).flatMap(({ file, unreleased }) => {
    const changelog = files.find((candidate) => candidate.path === file);
    if (changelog === undefined) return [];
    const text = changelog.lines.join("\n");
    const start = text.indexOf(`${unreleased}\n`);
    if (start === -1) return [];
    const end = nextHeading(text, start + unreleased.length);
    const first = lineAt(text, start);
    const section = { path: changelog.path, lines: changelog.lines.slice(first - 1, lineAt(text, end) - 1) };
    return mentions([section], patterns, "changelog-mention").map((finding) => ({
      ...finding,
      line: finding.line + first - 1,
    }));
  });
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

/**
 * 主题画廊的缩略图（scripts/make-theme-thumbs.ts 生成，提交进仓库）跟着插图走：每张 themes/<名字>.svg 都有 thumbs/<名字>.webp，
 * sources.json 里记的 sha256 和现在的 SVG 一致（按 LF 算）。改了插图忘了重画，画廊里就是旧图。
 */
async function scanThemeThumbs(): Promise<Finding[]> {
  const dir = "src/renderer/styles/themes";
  const message = "主题插图和画廊缩略图对不上，重跑 node scripts/make-theme-thumbs.ts";
  const svgs = (await readdir(path.join(root, dir))).filter((file) => file.endsWith(".svg"));
  const thumbs = new Set(await readdir(path.join(root, dir, "thumbs")));
  const sources = JSON.parse(await readFile(path.join(root, dir, "thumbs", "sources.json"), "utf8")) as Record<
    string,
    string
  >;
  const findings: Finding[] = [];
  for (const file of svgs) {
    const name = file.slice(0, -".svg".length);
    const text = (await readFile(path.join(root, dir, file), "utf8")).replaceAll("\r\n", "\n");
    if (!thumbs.has(`${name}.webp`) || sources[name] !== createHash("sha256").update(text).digest("hex"))
      findings.push({ file: `${dir}/${file}`, line: 1, id: "theme-thumbs", message });
  }
  for (const name of Object.keys(sources))
    if (!svgs.includes(`${name}.svg`))
      findings.push({
        file: `${dir}/thumbs/sources.json`,
        line: 1,
        id: "theme-thumbs",
        message: `${name}.svg 已不在：${message}`,
      });
  return findings;
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
    ...scanNativeTooltips(files),
    ...scanKeyOwner(files),
    ...scanUnthemedSvg(files),
    ...scanNodeMapOrder(files),
    ...scanSpecRefs(files),
    ...scanBrowserWindowFlags(files),
    ...scanPetShadows(files),
    ...scanInterval1000(files),
    ...scanE2eLocaleTheme(files),
    ...scanDeadFiles(files),
    ...scanDeadExports(files),
    ...scanUnusedMessages(files),
    ...scanCssHas(files),
    ...scanAppChildWildcard(rules),
    ...scanDuplicateClasses(rules),
    ...scanEntryWithoutExit(files, rules),
    ...scanShikiVars(files),
    ...scanUndeclaredVars(files),
    ...scanIgnoredRules(),
    ...(await scanThemeThumbs()),
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

async function main(): Promise<number> {
  const args = process.argv.slice(2);
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

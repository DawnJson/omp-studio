// 输入框文字以 `!` / `!!`（bash）或 `$` / `$$`（Python）开头时，omp 把它当成"在会话里直接跑的命令"而不是给模型的消息：
// 单前缀的输出进上下文，双前缀（excluded）只显示、不进上下文。判断照 omp 18.12.6 的 input-controller（`onChange` 判模式、
// 提交时 `startsWith("!")` / `parsePythonPrefix`）：
// - bash：去掉开头空白后以 `!` 开头；`!!` = excluded。
// - Python：去掉开头空白后以 `$` 或 `$$` 开头，且前缀后面紧跟空格 / Tab / 换行（`$x`、`$$x` 不算）；
//   单个 `$` 后面的内容像 shell 命令（`cd` / `git` / 路径 / 管道 / 重定向 / 工具输出的统计行）时不算——那是用户在贴终端提示符，不是 Python。
// 纯函数；输入框的文字归 composer（draft-store），这里只读文字、给出切换前缀后的新文字，不碰 store。

export type ShellKind = "shell" | "python";

export interface ShellPrefix {
  kind: ShellKind;
  /** 双前缀：结果不进上下文。 */
  excluded: boolean;
  /** 前缀之前的空白（omp 不管它），切换时原样保留。 */
  indent: string;
  /** 前缀之后的文字（Python 含前缀后的那个空白）。 */
  rest: string;
}

// omp 的 `cfu`：单 `$` 时用来识别"其实是 shell 命令"的三个正则（input-controller.ts）。
const SHELL_LIKE_START =
  /^(?:\.{0,2}\/|~\/|cd(?:\s|$)|sudo(?:\s|$)|git(?:\s|$)|bun(?:\s|$)|npm(?:\s|$)|pnpm(?:\s|$)|yarn(?:\s|$)|node(?:\s|$)|python\d*(?:\s|$)|cargo(?:\s|$)|go(?:\s|$)|make(?:\s|$)|docker(?:\s|$)|kubectl(?:\s|$))/;
const SHELL_OPERATOR = /(?:^|\s)(?:&&|\|\||\||2>&1|[<>]{1,2})(?:\s|$)/;
const TOKEN_STATS_LINE = /^\s*in:\s+\d+\s+out:\s+\d+(?:\s+cache\s+\S+)?\s+t:\s+\S+\s+tok\/s:\s+\S+/m;

function looksLikeShell(code: string): boolean {
  const firstLine = code.split("\n", 1)[0]?.trimStart() ?? "";
  return SHELL_LIKE_START.test(firstLine) || SHELL_OPERATOR.test(firstLine) || TOKEN_STATS_LINE.test(code);
}

/** 输入框文字的 shell 前缀；不是 `!` / `$` 开头的命令（普通消息、斜杠命令）为 null。 */
export function detectShellPrefix(text: string): ShellPrefix | null {
  const trimmed = text.trimStart();
  const indent = text.slice(0, text.length - trimmed.length);
  if (trimmed.startsWith("!")) {
    const excluded = trimmed.startsWith("!!");
    return { kind: "shell", excluded, indent, rest: trimmed.slice(excluded ? 2 : 1) };
  }
  if (trimmed.startsWith("$")) {
    const length = trimmed.startsWith("$$") ? 2 : 1;
    const after = trimmed.slice(length);
    if (!/^[ \t\r\n]/.test(after)) return null;
    if (length === 1 && looksLikeShell(after.trim())) return null;
    return { kind: "python", excluded: length === 2, indent, rest: after };
  }
  return null;
}

/** 单 ↔ 双前缀（`!cmd` ↔ `!!cmd`、`$ code` ↔ `$$ code`）：改的是输入框文字的前缀，别的原样保留。 */
export function setShellExcluded(text: string, excluded: boolean): string {
  const prefix = detectShellPrefix(text);
  if (prefix === null || prefix.excluded === excluded) return text;
  const mark = prefix.kind === "shell" ? "!" : "$";
  return `${prefix.indent}${excluded ? mark + mark : mark}${prefix.rest}`;
}

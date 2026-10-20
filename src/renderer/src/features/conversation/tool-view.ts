// 工具步骤的展示数据：把 args / result 解析成头部信息和正文行（diff 行、grep 命中、行号输出）。纯函数，不碰 DOM。
// 工具结果的文本形状由 omp 决定，这里只认已知形状；认不出就退回纯文本，不猜。
import { resultDetails, toolTarget, toolVerb, type ToolVerb } from "./tool-info.ts";

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

/** 统一换行（CRLF → LF）并去掉末尾一个换行；空文本得到空数组。 */
function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  return normalized === "" ? [] : normalized.split("\n");
}

// —— 头部 ——

const nameAlias: Record<string, string> = {
  ast_edit: "Edit",
  ast_grep: "Grep",
  web_search: "Search",
  todo_write: "Todo",
  notebook: "Notebook",
};

/** 粗体显示名：已知别名，其余把工具名首字母大写、下划线换空格。 */
export function toolDisplayName(toolName: string): string {
  const alias = nameAlias[toolName];
  if (alias) return alias;
  const spaced = toolName.replace(/_/g, " ").trim();
  return spaced === "" ? toolName : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

/** 头部的等宽目标：read 带上 :起-止 行范围（路径自带选择器就原样用）。 */
export function headerTarget(toolName: string, args: unknown): string | null {
  const target = toolTarget(args);
  if (target === null || toolVerb(toolName) !== "read") return target;
  if (/:\d+(?:[-+]\d*)?$/.test(target)) return target;
  const record = asRecord(args);
  const offset = positiveInt(record?.["offset"]);
  const limit = positiveInt(record?.["limit"]);
  if (offset !== null && limit !== null) return `${target}:${offset}-${offset + limit - 1}`;
  if (offset !== null) return `${target}:${offset}-`;
  if (limit !== null) return `${target}:1-${limit}`;
  return target;
}

/** 运行时长：1 分钟内 52.1s，之后 1m 05s，超过 1 小时 1h 10m。 */
export function formatElapsed(ms: number): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) return `${(Math.floor(safe / 100) / 10).toFixed(1)}s`;
  const total = Math.floor(safe / 1000);
  if (total >= 3600) return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
}

// —— diff ——

export type DiffRow =
  | { kind: "add" | "del" | "ctx"; oldNo: number | null; newNo: number | null; text: string }
  | { kind: "gap"; count: number };

/** 标准统一 diff：靠 @@ 的行数判断 hunk 何时结束，之后的 --- / +++ / diff 行当作文件头跳过。 */
function parseUnified(lines: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let nextOld = 0; // 上一个 hunk 之后的旧行号，用来算 hunk 之间的间隔
  let seenHunk = false;
  for (const line of lines) {
    const head = oldLeft <= 0 && newLeft <= 0 ? /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line) : null;
    if (head) {
      const start = Number(head[1]);
      if (seenHunk && start > nextOld) rows.push({ kind: "gap", count: start - nextOld });
      seenHunk = true;
      oldNo = start;
      newNo = Number(head[3]);
      oldLeft = head[2] === undefined ? 1 : Number(head[2]);
      newLeft = head[4] === undefined ? 1 : Number(head[4]);
      continue;
    }
    if (oldLeft <= 0 && newLeft <= 0) continue;
    const text = line.slice(1);
    if (line.startsWith("+")) {
      rows.push({ kind: "add", oldNo: null, newNo, text });
      newNo += 1;
      newLeft -= 1;
    } else if (line.startsWith("-")) {
      rows.push({ kind: "del", oldNo, newNo: null, text });
      oldNo += 1;
      oldLeft -= 1;
    } else if (line.startsWith("\\")) {
      continue; // "\ No newline at end of file"
    } else {
      rows.push({ kind: "ctx", oldNo, newNo, text });
      oldNo += 1;
      newNo += 1;
      oldLeft -= 1;
      newLeft -= 1;
    }
    nextOld = oldNo;
  }
  return rows;
}

/** omp 自己的 diff：每行 `+12 text` / `-12 text` / ` 12 text`，跳过的部分写成 ` ... `。 */
function parseNumbered(lines: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let lastNo: number | null = null; // 上一条上下文 / 删除行的行号
  let skipped = false;
  for (const line of lines) {
    if (/^\s*\.\.\.\s*$/.test(line)) {
      skipped = true;
      continue;
    }
    const match = /^([+\- ])\s*(\d+) ?(.*)$/.exec(line);
    if (!match) continue;
    const sign = match[1];
    const no = Number(match[2]);
    const text = match[3] ?? "";
    if (sign === "+") {
      rows.push({ kind: "add", oldNo: null, newNo: no, text });
      continue;
    }
    if (skipped && lastNo !== null && no - lastNo - 1 > 0) rows.push({ kind: "gap", count: no - lastNo - 1 });
    skipped = false;
    lastNo = no;
    rows.push(
      sign === "-" ? { kind: "del", oldNo: no, newNo: null, text } : { kind: "ctx", oldNo: no, newNo: no, text },
    );
  }
  return rows;
}

export function parseDiff(diff: string): DiffRow[] {
  const lines = splitLines(diff);
  return lines.some((line) => line.startsWith("@@ ")) ? parseUnified(lines) : parseNumbered(lines);
}

export function diffStats(rows: readonly DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "del") removed += 1;
  }
  return { added, removed };
}

// —— grep ——

interface GrepRow {
  no: number;
  text: string;
  match: boolean;
}

export interface GrepFile {
  path: string;
  matches: number;
  rows: GrepRow[];
}

/**
 * omp grep 文本：`# dir/` 目录行，`## file#TAG` 文件行，` 48: text` 上下文行，`*49: text` 命中行。
 * 一个文件都认不出就返回 null（调用方退回纯文本）。
 */
export function parseGrep(text: string): GrepFile[] | null {
  const files: GrepFile[] = [];
  let dir = "";
  let current: GrepFile | null = null;
  for (const line of splitLines(text)) {
    const fileHead = /^##\s+(.+?)(?:#[0-9A-Za-z]{2,8})?\s*$/.exec(line);
    if (fileHead?.[1]) {
      const name = fileHead[1];
      current = { path: dir !== "" && !name.startsWith(dir) ? dir + name : name, matches: 0, rows: [] };
      files.push(current);
      continue;
    }
    const dirHead = /^#\s+(.+?)\s*$/.exec(line);
    if (dirHead?.[1]) {
      dir = dirHead[1].endsWith("/") || dirHead[1].endsWith("\\") ? dirHead[1] : `${dirHead[1]}/`;
      current = null;
      continue;
    }
    const row = /^([* ])\s*(\d+)[:|] ?(.*)$/.exec(line);
    if (row && current) {
      const match = row[1] === "*";
      if (match) current.matches += 1;
      current.rows.push({ no: Number(row[2]), text: row[3] ?? "", match });
    }
  }
  return files.length > 0 ? files : null;
}

// —— 行号输出 ——

export interface NumberedRow {
  no: number;
  text: string;
}

/** 每个非空行都带 `N:` 前缀才拆出行号，否则 null（原样显示）。 */
export function splitGutter(lines: readonly string[]): NumberedRow[] | null {
  const rows: NumberedRow[] = [];
  for (const line of lines) {
    const match = /^\s*(\d+):(.*)$/.exec(line);
    if (!match) return null;
    rows.push({ no: Number(match[1]), text: match[2] ?? "" });
  }
  return rows.length > 0 ? rows : null;
}

// —— 汇总 ——

export type ToolBody =
  | { kind: "diff"; rows: DiffRow[] }
  | { kind: "grep"; files: GrepFile[] }
  | { kind: "bash"; command: string | null; lines: string[] }
  | { kind: "numbered"; rows: NumberedRow[] }
  | { kind: "plain"; lines: string[] };

export type ToolInfo =
  | { kind: "search"; matches: number; files: number }
  | { kind: "diff"; added: number; removed: number }
  | { kind: "task"; agents: number | null; background: boolean };

function bashCommand(args: unknown): string | null {
  const record = asRecord(args);
  for (const key of ["command", "cmd", "code"]) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

export function buildBody(toolName: string, args: unknown, result: unknown, output: string | null): ToolBody {
  const verb: ToolVerb = toolVerb(toolName);
  const diff = asRecord(resultDetails(result))?.["diff"];
  if (typeof diff === "string") {
    const rows = parseDiff(diff);
    if (rows.some((row) => row.kind === "add" || row.kind === "del")) return { kind: "diff", rows };
  }
  const lines = splitLines(output ?? "");
  if (verb === "bash") return { kind: "bash", command: bashCommand(args), lines };
  if (toolName === "grep" || toolName === "ast_grep") {
    const files = parseGrep(output ?? "");
    if (files) return { kind: "grep", files };
  }
  const numbered = splitGutter(lines);
  return numbered ? { kind: "numbered", rows: numbered } : { kind: "plain", lines };
}

export function buildInfo(toolName: string, args: unknown, body: ToolBody): ToolInfo | null {
  if (body.kind === "grep") {
    return {
      kind: "search",
      matches: body.files.reduce((sum, file) => sum + file.matches, 0),
      files: body.files.length,
    };
  }
  if (body.kind === "diff") return { kind: "diff", ...diffStats(body.rows) };
  if (toolName === "task") {
    const record = asRecord(args);
    const tasks = record?.["tasks"];
    const background = record?.["async"] === true || record?.["background"] === true;
    return { kind: "task", agents: Array.isArray(tasks) && tasks.length > 0 ? tasks.length : null, background };
  }
  return null;
}

/** 正文可预览的行数（折叠预览按它计数，gap 行也算一行）。 */
export function bodyLineCount(body: ToolBody): number {
  switch (body.kind) {
    case "diff":
      return body.rows.length;
    case "grep":
      return body.files.reduce((sum, file) => sum + file.rows.length, 0);
    case "bash":
      return body.lines.length;
    case "numbered":
      return body.rows.length;
    case "plain":
      return body.lines.length;
  }
}

/** 默认展开：有内容就展开（像 omp，不藏在点击后面）；用户仍可收起。 */
export function defaultOpen(body: ToolBody): boolean {
  return bodyLineCount(body) > 0;
}

/** 去掉路径末尾的 :起-止 行选择器。 */
function stripSelector(path: string): string {
  return path.replace(/:\d+(?:[-+]\d*)?(?:,\d+(?:[-+]\d*)?)*$/, "");
}

/** omp 的内部地址（proc://、history://、skill://、网址等）不是文件，不做成文件链接；`C:/` 这种盘符只有一个字母，不算。 */
const uriScheme = /^[a-z][a-z0-9+.-]+:\/\//i;

/** 卡片里要显示成文件链接的路径（read 可能多个；edit / write 取参数里的路径，hashline 编辑取每个 [path#TAG] 段）。 */
export function filePaths(toolName: string, args: unknown): string[] {
  return candidatePaths(toolName, args).filter((path) => !uriScheme.test(path));
}

function candidatePaths(toolName: string, args: unknown): string[] {
  const verb = toolVerb(toolName);
  if (verb !== "read" && verb !== "edit" && verb !== "write") return [];
  const record = asRecord(args);
  const list = record?.["paths"];
  if (Array.isArray(list)) {
    return list.filter((item): item is string => typeof item === "string" && item !== "").map(stripSelector);
  }
  const input = record?.["input"];
  if (typeof input === "string" && record?.["path"] === undefined) {
    const found = [...input.matchAll(/^\[([^\]#\n]+)#[0-9A-Fa-f]{4}\]/gm)].map((match) => match[1] ?? "");
    if (found.length > 0) return [...new Set(found)];
  }
  const target = toolTarget(args);
  if (target === null) return [];
  const parts = verb === "read" ? target.split(",") : [target];
  // 逗号分隔的多文件；"a.ts:1-5,10-20" 这类行选择器不拆。
  const multi = parts.length > 1 && parts.every((part) => /[./]/.test(part) && !/\s/.test(part));
  return (multi ? parts : [target]).map(stripSelector);
}

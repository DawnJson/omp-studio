// 工具步骤的展示数据：把 args / result 解析成头部信息和正文行（diff 行、grep 命中、行号输出）。纯函数，不碰 DOM。
// 工具结果的文本形状由 omp 决定，这里只认已知形状；认不出就退回纯文本，不猜。
import type { TodoItem, TodoPhase, TodoStatus } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { asRecord, resultDetails, toolTarget, toolVerb, type Rec, type ToolVerb } from "./tool-info.ts";

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

/** omp 自己的 diff：每行 `+12|text` / `-12|text` / ` 12|text`（行号按最大位数左补空格，`|` 后面全是原文，可以为空）；跳过的部分是一个空行或 ` ... `。旧版用空格代替 `|`，也认。 */
function parseNumbered(lines: readonly string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let lastNo: number | null = null; // 上一条上下文 / 删除行的行号
  let skipped = false;
  for (const line of lines) {
    if (/^\s*(?:\.\.\.)?\s*$/.test(line)) {
      skipped = true;
      continue;
    }
    const match = /^([+\- ])\s*(\d+)(?:[| ](.*))?$/.exec(line);
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

// —— 专用工具的结果：bash 状态、glob 文件列表、todo 阶段、ask 选项、task / wait 的代理 ——

/** bash 结果 details 里的退出码和耗时（omp 给什么取什么，没有就 null）。 */
export function bashStatus(result: unknown): { exitCode: number | null; wallMs: number | null } {
  const details = asRecord(resultDetails(result));
  const exit = details?.["exitCode"];
  const wall = details?.["wallTimeMs"];
  return {
    exitCode: typeof exit === "number" && Number.isFinite(exit) ? exit : null,
    wallMs: typeof wall === "number" && Number.isFinite(wall) ? wall : null,
  };
}

/** glob / find 的输出：每个非空行是一个路径。任何一行像句子（带冒号后空格或过长）就不当文件列表。 */
export function globPaths(toolName: string, output: string | null): string[] {
  if (toolName !== "glob" && toolName !== "find") return [];
  const lines = splitLines(output ?? "")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length > 0 && lines.every((line) => line.length <= 300 && !uriScheme.test(line) && !/^[#>]/.test(line))
    ? lines
    : [];
}

/** 路径拆成 [目录部分（含末尾斜杠，可能为空）, 文件名]。 */
export function splitPath(path: string): [string, string] {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? ["", path] : [path.slice(0, cut + 1), path.slice(cut + 1)];
}

const todoStatuses: Record<TodoStatus, true> = {
  pending: true,
  in_progress: true,
  completed: true,
  abandoned: true,
  blocked: true,
};

/** todo 工具结果 `details.phases`（只留有任务的阶段）；认不出形状返回 null。进度用 todo-model 的 summarizeTodos / summarizePhase 算。 */
export function todoPhases(result: unknown): TodoPhase[] | null {
  const phases = asRecord(resultDetails(result))?.["phases"];
  if (!Array.isArray(phases)) return null;
  const out: TodoPhase[] = [];
  for (const raw of phases) {
    const phase = asRecord(raw);
    const tasks = phase?.["tasks"];
    if (!phase || !Array.isArray(tasks)) continue;
    const list: TodoItem[] = [];
    for (const item of tasks) {
      const task = asRecord(item);
      const status = task?.["status"];
      if (
        !task ||
        typeof task["content"] !== "string" ||
        typeof status !== "string" ||
        !Object.hasOwn(todoStatuses, status)
      )
        continue;
      const blocker = task["blocker"];
      list.push({
        content: task["content"],
        status: status as TodoStatus,
        ...(typeof blocker === "string" && blocker !== "" ? { blocker } : {}),
      });
    }
    if (list.length > 0) out.push({ name: typeof phase["name"] === "string" ? phase["name"] : "", tasks: list });
  }
  return out.length > 0 ? out : null;
}

export interface AskView {
  question: string;
  /** 全部选项（label + 说明）。 */
  options: { label: string; description: string | null }[];
  selected: string[];
  /** 用户选了"其他"自己写的回答。 */
  custom: string | null;
  note: string | null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function askFromDetails(raw: unknown, fallback: Rec | null): AskView | null {
  const record = asRecord(raw);
  if (!record || typeof record["question"] !== "string") return null;
  const labels = stringList(record["options"]);
  const described = new Map<string, string>();
  const argOptions = fallback?.["options"];
  if (Array.isArray(argOptions)) {
    for (const option of argOptions) {
      const item = asRecord(option);
      if (typeof item?.["label"] === "string" && typeof item["description"] === "string")
        described.set(item["label"], item["description"]);
    }
  }
  return {
    question: record["question"],
    options: labels.map((label) => ({ label, description: described.get(label) ?? null })),
    selected: stringList(record["selectedOptions"]),
    custom: typeof record["customInput"] === "string" && record["customInput"] !== "" ? record["customInput"] : null,
    note: typeof record["note"] === "string" && record["note"] !== "" ? record["note"] : null,
  };
}

/**
 * ask 工具的问题和回答：回答在结果 details（单题是 question/options/selectedOptions，多题是 results[]）；
 * 还没有回答（或被取消）时只有参数里的 questions，没有选中项。
 */
export function askViews(args: unknown, result: unknown): AskView[] {
  const details = resultDetails(result);
  const argQuestions = asRecord(args)?.["questions"];
  const asked = Array.isArray(argQuestions) ? argQuestions.map(asRecord) : [];
  const results = asRecord(details)?.["results"];
  if (Array.isArray(results)) {
    return results.flatMap((raw, index) => {
      const view = askFromDetails(raw, asked[index] ?? null);
      return view ? [view] : [];
    });
  }
  const single = askFromDetails(details, asked[0] ?? null);
  if (single) return [single];
  return asked.flatMap((item) => {
    if (!item || typeof item["question"] !== "string") return [];
    const options = Array.isArray(item["options"]) ? item["options"].map(asRecord) : [];
    return [
      {
        question: item["question"],
        options: options.flatMap((option) =>
          typeof option?.["label"] === "string"
            ? [
                {
                  label: option["label"],
                  description: typeof option["description"] === "string" ? option["description"] : null,
                },
              ]
            : [],
        ),
        selected: [],
        custom: null,
        note: null,
      },
    ];
  });
}

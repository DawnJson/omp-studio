// 工具调用的展示信息：动作文字、参数摘要、输出文本、改动文件汇总。纯函数，不碰 DOM。
// 工具参数和结果的形状由 omp 的各个工具决定，这里按"尽力而为"取值：取不到就省略，不猜。

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Rec) : null;
}

function firstString(record: Rec | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

export type ToolVerb = "read" | "edit" | "write" | "bash" | "search" | "other";

const verbByTool: Record<string, ToolVerb> = {
  read: "read",
  edit: "edit",
  ast_edit: "edit",
  notebook: "edit",
  write: "write",
  bash: "bash",
  eval: "bash",
  python: "bash",
  grep: "search",
  find: "search",
  glob: "search",
  ast_grep: "search",
  web_search: "search",
  lsp: "search",
};

export function toolVerb(toolName: string): ToolVerb {
  return verbByTool[toolName] ?? "other";
}

/** 参数里最能说明"对谁做"的一项：路径、命令、搜索词。 */
export function toolTarget(args: unknown): string | null {
  const record = asRecord(args);
  const direct = firstString(record, [
    "path",
    "file",
    "file_path",
    "command",
    "cmd",
    "pattern",
    "query",
    "url",
    "code",
  ]);
  if (direct) return direct.split("\n")[0] ?? direct;
  // hashline 编辑：input 里是 [path#TAG] 段落。
  const input = firstString(record, ["input"]);
  const header = input ? /\[([^\]#\n]+)#[0-9A-Fa-f]{4}\]/.exec(input) : null;
  return header?.[1] ?? null;
}

/** 工具输出（结果或部分结果）里的文本块拼起来。 */
export function resultText(result: unknown): string | null {
  const record = asRecord(result);
  const content = record?.["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content.flatMap((block) => {
    const item = asRecord(block);
    return item?.["type"] === "text" && typeof item["text"] === "string" ? [item["text"]] : [];
  });
  return parts.length > 0 ? parts.join("\n") : null;
}

export function resultDetails(result: unknown): unknown {
  return asRecord(result)?.["details"];
}

export interface FileChange {
  path: string;
  added: number | null;
  removed: number | null;
}

const editTools = new Set(["edit", "write", "ast_edit"]);

function countDiff(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

function pathsOfEdit(args: unknown): string[] {
  const record = asRecord(args);
  const direct = firstString(record, ["path", "file", "file_path"]);
  if (direct) return [direct];
  const input = firstString(record, ["input"]);
  if (!input) return [];
  return [...input.matchAll(/^\[([^\]#\n]+)#[0-9A-Fa-f]{4}\]/gm)].flatMap((match) => (match[1] ? [match[1]] : []));
}

export interface ToolForChanges {
  name: string;
  args: unknown;
  status: "running" | "done" | "error";
  result: unknown;
}

/**
 * 本轮改了哪些文件：只看成功的 edit / write / ast_edit。
 * 行数：edit 取结果 details.diff 的统一 diff；write 取参数 content 的行数；取不到就 null（卡片只显示文件名）。
 * 这是从工具事件推出来的近似，不是 git 的结果；需要精确数字时由主进程 git diff 提供（spec 4.12）。
 */
export function summarizeChanges(tools: readonly ToolForChanges[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const tool of tools) {
    if (tool.status !== "done" || !editTools.has(tool.name)) continue;
    const paths = pathsOfEdit(tool.args);
    if (paths.length === 0) continue;
    const details = asRecord(resultDetails(tool.result));
    const diff = typeof details?.["diff"] === "string" ? details["diff"] : null;
    let stats: { added: number; removed: number } | null = diff ? countDiff(diff) : null;
    if (!stats && tool.name === "write") {
      const content = firstString(asRecord(tool.args), ["content"]);
      stats =
        content === null ? null : { added: content.split("\n").length - (content.endsWith("\n") ? 1 : 0), removed: 0 };
    }
    // 多文件的 diff 无法拆分到各文件，只在单文件时记行数。
    const perFile = paths.length === 1 ? stats : null;
    for (const path of paths) {
      const previous = byPath.get(path);
      byPath.set(path, {
        path,
        added: perFile ? (previous?.added ?? 0) + perFile.added : (previous?.added ?? null),
        removed: perFile ? (previous?.removed ?? 0) + perFile.removed : (previous?.removed ?? null),
      });
    }
  }
  return [...byPath.values()];
}

/** 工具参数里的路径 → 相对任务目录的路径；落在目录之外（或无法判断）返回 null。 */
export function relativeToProject(file: string, project: string | null): string | null {
  const norm = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
  const f = norm(file);
  if (!/^([a-zA-Z]:|\/)/.test(f)) return f.split("/").includes("..") ? null : f;
  if (project === null) return null;
  const p = norm(project);
  return f.toLowerCase().startsWith(p.toLowerCase() + "/") ? f.slice(p.length + 1) : null;
}

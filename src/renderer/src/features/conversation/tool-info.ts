// 工具调用的展示信息：动作文字、参数摘要、输出文本。纯函数，不碰 DOM。
// 工具参数和结果的形状由 omp 的各个工具决定，这里按"尽力而为"取值：取不到就省略，不猜。

export type Rec = Record<string, unknown>;

export function asRecord(value: unknown): Rec | null {
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

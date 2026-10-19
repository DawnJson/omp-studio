// 审批门里"要做什么"的预览。审批 select 的 title 只有一两行（edit 只有 `File: x`），但同一个工具调用的
// `tool_execution_start` 在门之前到达（fixtures/rpc/approval-select.ndjson），参数已经在对话流里：
// write 的 `content`，edit 的 hashline 脚本 `input`。只取这两种已知形状，别的工具（bash 的命令已在 title 里）不编造。

interface RunningTool {
  toolName: string;
  status: "running" | "done" | "error";
  args: unknown;
}

/** 预览最多保留的字符数；门里默认只展开 8 行，其余点"展开"。 */
const MAX_PREVIEW_CHARS = 8000;

const previewKey: Record<string, string> = { write: "content", edit: "input" };

/** 等待审批的是最近一次还在运行的同名工具；取不到参数或不是 write / edit 返回 null。 */
export function approvalPreview(tools: Readonly<Record<string, RunningTool>>, toolName: string): string | null {
  const key = previewKey[toolName];
  if (key === undefined) return null;
  const pending = Object.values(tools).findLast((tool) => tool.toolName === toolName && tool.status === "running");
  const args = pending?.args;
  if (typeof args !== "object" || args === null) return null;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.replace(/\s+$/, "");
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}\n…` : text;
}

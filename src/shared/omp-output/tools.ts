// `/tools` 的输出解析（omp 18.12.5 rpc-ui：每行一个工具，`* ` 启用、`- ` 可用但当前没启用、`~ ` xd 设备）。
// 这是服务进程（用户范围、没有项目）看到的全局列表：项目里的插件和 MCP 提供的工具不在里面。

export type ToolState = "enabled" | "inactive" | "device";

export interface ToolEntry {
  name: string;
  state: ToolState;
}

export interface ToolList {
  tools: ToolEntry[];
  /** 不认识的行，原样。 */
  unparsed: string[];
}

const MARKS: Record<string, ToolState> = { "*": "enabled", "-": "inactive", "~": "device" };

export function parseTools(text: string): ToolList {
  const tools: ToolEntry[] = [];
  const unparsed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const match = /^([*\-~])\s+(\S.*)$/.exec(line);
    const state = match?.[1] === undefined ? undefined : MARKS[match[1]];
    if (match?.[2] === undefined || state === undefined) unparsed.push(line);
    else tools.push({ name: match[2], state });
  }
  return { tools, unparsed };
}

export type ToolKind = "device" | "mountedMcp" | "mounted" | "inactive" | "enabled";

/**
 * 一行工具在界面上算哪一类（实测 omp 18.12.6，临时空目录和仓库所有者本机一样）：`-` 行里，`tools.xdev` 开着时同名有 `~ xd://<名>` 的
 * 是"挂在 xd 设备下按需调用"（ast_edit、debug、lsp、MCP 服务器的 mcp__* 工具），不是关着；没有同名设备的（init_experiment 等
 * autoresearch 工具、goal）是被 omp 的模式或命令按需启用，当前会话没启用。
 */
export function toolKind(tool: ToolEntry, deviceNames: ReadonlySet<string>): ToolKind {
  if (tool.state === "device") return "device";
  if (tool.state === "enabled") return "enabled";
  if (!deviceNames.has(tool.name)) return "inactive";
  return tool.name.startsWith("mcp__") ? "mountedMcp" : "mounted";
}

/** `~ xd://<名>` 的设备名（去掉 `xd://`），用来判断同名工具是不是挂在设备下。 */
export function deviceToolNames(tools: readonly ToolEntry[]): Set<string> {
  const names = new Set<string>();
  for (const tool of tools) if (tool.state === "device" && tool.name.startsWith("xd://")) names.add(tool.name.slice(5));
  return names;
}

/**
 * 工具名 → omp 里开关它的设置项。`ast_edit` 的设置是 `astEdit.enabled`，`web_search` 是 `web_search.enabled`：
 * 两种写法都试，取快照里真有的那个；没有就不提供开关。
 */
export function toolConfigKey(name: string, knownKeys: ReadonlySet<string>): string | null {
  const camel = name.replace(/_([a-z0-9])/g, (_whole, ch: string) => ch.toUpperCase());
  for (const base of [name, camel]) {
    const key = `${base}.enabled`;
    if (knownKeys.has(key)) return key;
  }
  return null;
}

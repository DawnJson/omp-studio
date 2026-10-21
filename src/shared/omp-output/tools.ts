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

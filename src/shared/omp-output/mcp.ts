// `/mcp` 命令的输出解析（omp 18.12.5 rpc-ui 的 `command_output` 原文，样本见 test/omp-output-mcp.test.ts）。
// 文本格式不是 omp 的契约：认不出的行放进 `unparsed`，界面照原样显示，不吞。

export interface McpServerRow {
  name: string;
  /** stdio | http | sse（原样，不认识的也保留）。 */
  transport: string;
  enabled: boolean;
  /** stdio 是命令（只有可执行文件，参数 omp 不显示），http/sse 是 URL。 */
  target: string;
  /** `[user]` / `[project]` 里的词；别的来源原样保留。 */
  scope: string;
}

export interface McpList {
  servers: McpServerRow[];
  /** 不符合 `名 | 传输 | 状态 | 目标 [范围]` 的行，原样。 */
  unparsed: string[];
}

const ROW = /^(.+?) \| (\S+) \| (enabled|disabled) \| (.*?)(?: \[([^\]]+)\])?$/;

/** `/mcp list` 的输出：每行 `name | transport | enabled | target [scope]`；没有服务器时是 "No MCP servers configured."。 */
export function parseMcpList(text: string): McpList {
  const servers: McpServerRow[] = [];
  const unparsed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || /^No MCP servers configured\.?$/i.test(line)) continue;
    const match = ROW.exec(line);
    if (match === null) {
      unparsed.push(line);
      continue;
    }
    servers.push({
      name: match[1] ?? "",
      transport: match[2] ?? "",
      enabled: match[3] === "enabled",
      target: match[4] ?? "",
      scope: match[5] ?? "",
    });
  }
  return { servers, unparsed };
}

/**
 * 服务器名里有空格时 `/mcp remove|enable|disable|test` 管不了：它们按空白切词（实测 18.12.5，`remove "b c"` → `Unknown option: c"`），
 * 只有 `add` 认引号。这种服务器在界面里只读。
 */
export function isManageableMcpName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name);
}

export interface McpOutcome {
  ok: boolean;
  /** omp 的原话（去掉首尾空白）。失败时界面显示它。 */
  message: string;
}

// omp 把失败也当作普通的 command_output（`success:true`），所以只认已知的成功句式，其余一律当失败并显示原文。
const SUCCESS = [
  /^Added MCP server ".+" \((?:user|project)\)\.?$/,
  /^Removed server ".+" from (?:user|project) config\.?$/,
  /^Server ".+" (?:enabled|disabled) \(.+\)\.?$/,
  /^MCP runtime reload requested\.?$/,
];

export function mcpOutcome(text: string): McpOutcome {
  const message = text.trim();
  return { ok: SUCCESS.some((pattern) => pattern.test(message)), message };
}

export type McpTestResult =
  { connected: true; toolCount: number; tools: string[] } | { connected: false; message: string };

/** `/mcp test <name>`：`Server "x" connected (1 tools).\n  - ping`；失败是 `Connection to "x" failed: …` 或 `Server "x" not found…`。 */
export function parseMcpTest(text: string): McpTestResult {
  const message = text.trim();
  const head = /^Server ".+" connected \((\d+) tools?\)\.?/.exec(message);
  if (head === null) return { connected: false, message };
  const tools = message
    .split(/\r?\n/)
    .slice(1)
    .map((line) => /^\s*-\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
  return { connected: true, toolCount: Number(head[1]), tools };
}

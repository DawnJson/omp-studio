// 编辑 MCP 服务器（设置 → 集成 → MCP）：界面和主进程共用的类型。
// 主进程直接改 omp 自己的 MCP 配置文件里的 `mcpServers.<name>`（src/main/integrations/mcp-file.ts，规则见 AGENTS.md「omp 的边界」）。
// 纯类型，不引 React、DOM 或 Node。

export type McpEditScope = "user" | "project";
export type McpEditTransport = "stdio" | "http" | "sse";

/** token 在文件里的状态：只给"有没有"，值不出主进程。 */
export type McpTokenState = "none" | "set";

/** 编辑表单的初值：文件里这一项表单管的几个字段。 */
export interface McpServerFile {
  name: string;
  scope: McpEditScope;
  transport: McpEditTransport;
  /** stdio 才有。 */
  command: string;
  /** stdio 才有；每项都不含换行（含换行的项读不出来，见 `unsupported`）。 */
  args: string[];
  /** http / sse 才有。 */
  url: string;
  /** `headers.Authorization`（omp `/mcp add --token` 写的 `Bearer <token>`）；stdio 恒为 none。 */
  token: McpTokenState;
}

/** token 的三种处理：保持不变 / 改成新值 / 去掉。 */
export type McpTokenInput = { kind: "keep" } | { kind: "set"; value: string } | { kind: "none" };

export interface McpEditInput {
  name: string;
  scope: McpEditScope;
  /** 不能把 stdio 改成远程或反过来；http ↔ sse 可以。 */
  transport: McpEditTransport;
  command: string;
  args: string[];
  url: string;
  token: McpTokenInput;
}

export type McpEditErrorCode =
  /** 文件不存在，或里面没有这个服务器。 */
  | "not-found"
  /** 文件不是合法 JSON（或顶层不是对象）：不写。 */
  | "bad-json"
  /** 这一项的形状表单管不了（命令不是字符串、参数含换行等）：只能在文件里改。 */
  | "unsupported"
  /** 输入对不上这一项的传输方式（stdio 项不能改成远程）。 */
  | "kind-mismatch"
  /** 文件里有整数样的键（JSON 解析会改变它们的顺序），写回会打乱键序：不写。 */
  | "key-order";

export type McpEditOutcome<T> = { ok: true; value: T } | { ok: false; code: McpEditErrorCode };

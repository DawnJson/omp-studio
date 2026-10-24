// 设置 → 集成 → MCP 编辑的 IPC：校验参数，文件路径按范围由主进程算（渲染进程只传名字、范围、字段），转调 src/main/integrations/mcp-file.ts。
// 规则和边界见 AGENTS.md「omp 的边界」、docs/architecture/plugins.md「编辑 MCP 服务器」。token 只进不出。
import { isManageableMcpName } from "../../shared/omp-output/mcp.ts";
import type { McpEditInput, McpEditScope, McpTokenInput } from "../../shared/mcp-edit.ts";
import type { HandlerGroup, ProjectId } from "../../shared/ipc.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { mcpFilePath, readMcpServer, saveMcpServer } from "../integrations/mcp-file.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { IpcValidationError, parseOneOf, parseProjectId, parseRecord, parseString } from "./validate.ts";

const SCOPES = ["user", "project"] as const;
const MAX_ARGS = 64;

function parseName(value: unknown): string {
  const name = parseString(value, "name", 100);
  if (!isManageableMcpName(name)) throw new IpcValidationError("name 含不支持的字符");
  return name;
}

/** 用户范围用 agent 目录，项目范围用主进程项目记录里的目录（不用渲染进程传的路径）。 */
async function fileFor(scope: McpEditScope, projectId: unknown): Promise<string> {
  if (scope === "user") return mcpFilePath("user", resolveAgentDir(), null);
  if (projectId === null) throw new IpcValidationError("项目范围的服务器需要 projectId");
  const id: ProjectId = parseProjectId(projectId);
  return mcpFilePath("project", resolveAgentDir(), (await getTaskPool()).projectPath(id));
}

function parseToken(value: unknown): McpTokenInput {
  const record = parseRecord(value, "token");
  const kind = parseOneOf(record["kind"], "token.kind", ["keep", "set", "none"] as const);
  if (kind !== "set") return { kind };
  const token = parseString(record["value"], "token.value", 4096);
  if (token !== token.trim() || /[\p{Cc}]/u.test(token)) throw new IpcValidationError("token 含空白或控制字符");
  return { kind, value: token };
}

function parseInput(value: unknown): McpEditInput {
  const input = parseRecord(value, "input");
  const transport = parseOneOf(input["transport"], "transport", ["stdio", "http", "sse"] as const);
  const args = input["args"];
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new IpcValidationError("args 必须是数组");
  const parsedArgs = args.map((arg) => parseString(arg, "args", 4096, { allowEmpty: true }));
  if (parsedArgs.some((arg) => /[\r\n]/.test(arg))) throw new IpcValidationError("args 不能含换行");
  const command = parseString(input["command"], "command", 4096, { allowEmpty: true }).trim();
  const url = parseString(input["url"], "url", 4096, { allowEmpty: true }).trim();
  if (transport === "stdio" ? command === "" : url === "") throw new IpcValidationError("缺少命令或 URL");
  return {
    name: parseName(input["name"]),
    scope: parseOneOf(input["scope"], "scope", SCOPES),
    transport,
    command,
    args: parsedArgs,
    url,
    token: parseToken(input["token"]),
  };
}

export const mcpHandlers: HandlerGroup<"getMcpServerFile" | "saveMcpServerFile"> = {
  getMcpServerFile: async (name, scope, projectId) => {
    const parsedScope = parseOneOf(scope, "scope", SCOPES);
    return readMcpServer(await fileFor(parsedScope, projectId), parseName(name), parsedScope);
  },
  saveMcpServerFile: async (input, projectId) => {
    const parsed = parseInput(input);
    return saveMcpServer(await fileFor(parsed.scope, projectId), parsed);
  },
};

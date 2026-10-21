// 集成相关卡片的数据读取和动作：全部经 runBuiltin / SSH 的 IPC，渲染进程不拼命令文本。
import type { ProjectId } from "../../../../shared/ipc.ts";
import type { BuiltinCommand } from "../../../../shared/omp-output/index.ts";
import { splitChangelog } from "../../../../shared/omp-output/changelog.ts";
import {
  mcpOutcome,
  parseMcpList,
  parseMcpTest,
  type McpOutcome,
  type McpTestResult,
} from "../../../../shared/omp-output/mcp.ts";
import { parseTools } from "../../../../shared/omp-output/tools.ts";
import { createResource, scopeProject, type ScopeKey } from "./integrations-store.ts";

/** runBuiltin 的范围参数：用户范围 = null（服务进程），项目范围 = 该项目目录里的短命 rpc-ui。 */
function builtinScope(key: ScopeKey): { projectId: ProjectId } | null {
  const projectId = scopeProject(key);
  return projectId === null ? null : { projectId };
}

export function runBuiltinText(cmd: BuiltinCommand, key: ScopeKey): Promise<string> {
  return window.studio.runBuiltin(cmd, builtinScope(key)).then((result) => result.text);
}

export const mcpResource = createResource(async (key) =>
  parseMcpList(await runBuiltinText({ kind: "mcp", op: "list" }, key as ScopeKey)),
);

export const sshResource = createResource((key) => window.studio.listSshHosts(scopeProject(key as ScopeKey)));

/** 全局列表（服务进程）：项目里的插件和 MCP 提供的工具不在里面。 */
export const toolsResource = createResource(async () => parseTools(await runBuiltinText({ kind: "tools" }, "user")));

export const changelogResource = createResource(async () =>
  splitChangelog(await runBuiltinText({ kind: "changelog" }, "user")),
);

/** 执行一条 MCP 写命令；omp 把失败也当普通输出，所以按已知的成功句式判断，失败时带原话。 */
export async function runMcpWrite(cmd: BuiltinCommand, key: ScopeKey): Promise<McpOutcome> {
  const outcome = mcpOutcome(await runBuiltinText(cmd, key));
  await mcpResource.load(key);
  return outcome;
}

export async function runMcpTest(name: string, key: ScopeKey): Promise<McpTestResult> {
  return parseMcpTest(await runBuiltinText({ kind: "mcp", op: "test", name }, key));
}

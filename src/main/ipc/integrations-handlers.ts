// 设置 → 集成 → SSH 主机的 IPC：参数校验后转调 src/main/integrations/ssh.ts。
// MCP / 记忆 / 工具 / 更新日志走 runBuiltin（command-handlers.ts），这里没有。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HandlerGroup, ProjectId } from "../../shared/ipc.ts";
import type { SshHostInput } from "../../shared/omp-output/ssh.ts";
import { checkSshName, listSshHosts, runSshWrite, sshAddArgs, sshRemoveArgs } from "../integrations/ssh.ts";
import { getApiKeyEnv, ompManager } from "../omp-manager/index.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { runOmpCommand, type RunOmp } from "../usage/usage-service.ts";
import { IpcValidationError, parseBoolean, parseOneOf, parseProjectId, parseRecord, parseString } from "./validate.ts";

const SSH_TIMEOUT_MS = 30_000;

/** projectId 为 null：中性目录 userData/service（不混进任何项目层配置）；否则主进程记录里的项目目录，不用渲染进程传的路径。 */
async function ssh(projectId: ProjectId | null): Promise<RunOmp> {
  const status = ompManager().status;
  if (status.state !== "ready") throw new Error("omp is not ready");
  let cwd: string;
  if (projectId === null) {
    cwd = path.join(app.getPath("userData"), "service");
    await mkdir(cwd, { recursive: true });
  } else {
    const project = (await getTaskPool()).listProjects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error(`unknown project ${projectId}`);
    cwd = project.path;
  }
  return runOmpCommand(status.path, cwd, SSH_TIMEOUT_MS, await getApiKeyEnv());
}

function optionalProjectId(value: unknown): ProjectId | null {
  return value === null ? null : parseProjectId(value);
}

function optionalString(record: Record<string, unknown>, key: string, maxChars: number): string | undefined {
  const value = record[key];
  return value === undefined ? undefined : parseString(value, key, maxChars, { allowEmpty: true });
}

function parseSshHostInput(value: unknown): SshHostInput {
  const input = parseRecord(value, "input");
  const port = input["port"];
  if (port !== undefined && (typeof port !== "number" || !Number.isInteger(port)))
    throw new IpcValidationError("port 必须是整数");
  const username = optionalString(input, "username", 255);
  const keyPath = optionalString(input, "keyPath", 1024);
  const description = optionalString(input, "description", 500);
  return {
    name: parseString(input["name"], "name", 64),
    host: parseString(input["host"], "host", 255),
    ...(username !== undefined && { username }),
    ...(port !== undefined && { port }),
    ...(keyPath !== undefined && { keyPath }),
    ...(description !== undefined && { description }),
    compat: parseBoolean(input["compat"], "compat"),
    scope: parseOneOf(input["scope"], "scope", ["user", "project"] as const),
  };
}

export const integrationsHandlers: HandlerGroup<"listSshHosts" | "addSshHost" | "removeSshHost"> = {
  listSshHosts: async (projectId) => listSshHosts(await ssh(optionalProjectId(projectId))),
  addSshHost: async (input, projectId) => {
    const parsed = parseSshHostInput(input);
    const project = optionalProjectId(projectId);
    if (parsed.scope === "project" && project === null) throw new IpcValidationError("项目范围的主机需要 projectId");
    // 用户范围一律在中性目录里跑，不让项目目录里的配置影响写到哪里。
    const run = await ssh(parsed.scope === "project" ? project : null);
    return { text: await runSshWrite(run, sshAddArgs(parsed)) };
  },
  removeSshHost: async (name, scope, projectId) => {
    const parsedScope = parseOneOf(scope, "scope", ["user", "project"] as const);
    const project = optionalProjectId(projectId);
    if (parsedScope === "project" && project === null) throw new IpcValidationError("项目范围的主机需要 projectId");
    const run = await ssh(parsedScope === "project" ? project : null);
    return { text: await runSshWrite(run, sshRemoveArgs(checkSshName(parseString(name, "name", 64)), parsedScope)) };
  },
};

// 设置 → 集成 → SSH 主机、Skills 的 IPC：参数校验后转调 src/main/integrations/ssh.ts、skills.ts（都经 omp 自己的命令，skill 文件夹的复制 / 回收站是 docs/architecture/omp-boundaries.md「自己写 omp 配置的例外」之一）。
// MCP / 记忆 / 工具 / 更新日志走 runBuiltin（command-handlers.ts），这里没有。
import os from "node:os";
import { dialog, shell } from "electron";
import type { HandlerGroup, ProjectId } from "../../shared/ipc.ts";
import type { SshHostInput } from "../../shared/omp-output/ssh.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { listSkillEntries, removeSkill, setSkillEnabled, SkillPicker } from "../integrations/skills.ts";
import { checkSshName, listSshHosts, runSshWrite, sshAddArgs, sshRemoveArgs } from "../integrations/ssh.ts";
import { readyOmp } from "../omp-manager/index.ts";
import { serviceCwd } from "../service/service-omp.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { runOmpCommand, type RunOmp } from "../usage/usage-service.ts";
import { getMainWindow } from "../window/main-window.ts";
import { IpcValidationError, parseBoolean, parseOneOf, parseProjectId, parseRecord, parseString } from "./validate.ts";

const SSH_TIMEOUT_MS = 30_000;

/** projectId 为 null：中性目录 userData/service（不混进任何项目层配置）；否则主进程记录里的项目目录，不用渲染进程传的路径。 */
async function ompIn(projectId: ProjectId | null): Promise<RunOmp> {
  const status = readyOmp();
  const cwd = projectId === null ? await serviceCwd() : (await getTaskPool()).projectPath(projectId);
  return runOmpCommand(status.path, cwd, SSH_TIMEOUT_MS);
}

const skillPicker = new SkillPicker();

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

export const integrationsHandlers: HandlerGroup<
  | "listSshHosts"
  | "addSshHost"
  | "removeSshHost"
  | "listSkills"
  | "setSkillEnabled"
  | "removeSkill"
  | "pickSkillFolder"
  | "addSkill"
> = {
  listSshHosts: async (projectId) => listSshHosts(await ompIn(optionalProjectId(projectId))),
  listSkills: async (projectId) => {
    const project = optionalProjectId(projectId);
    // 用户级在中性目录里列；选了项目时在项目目录里列（用户级 + 项目级），停用补行始终读用户配置。
    const projectPath = project === null ? null : (await getTaskPool()).projectPath(project);
    return listSkillEntries(await ompIn(project), await ompIn(null), os.homedir(), projectPath);
  },
  setSkillEnabled: async (name, enabled) =>
    setSkillEnabled(await ompIn(null), parseString(name, "name", 200), parseBoolean(enabled, "enabled")),
  removeSkill: async (name, scope, projectId) => {
    const parsedScope = parseOneOf(scope, "scope", ["user", "project"] as const);
    const project = optionalProjectId(projectId);
    if (parsedScope === "project" && project === null) throw new IpcValidationError("项目范围的 skill 需要 projectId");
    const target = parsedScope === "project" ? project : null;
    await removeSkill(
      await ompIn(target),
      parseString(name, "name", 200),
      parsedScope,
      target === null ? null : (await getTaskPool()).projectPath(target),
      (folder) => shell.trashItem(folder),
    );
  },
  pickSkillFolder: async () => {
    const window = getMainWindow();
    const options = { properties: ["openDirectory" as const] };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    const dir = result.filePaths[0];
    if (result.canceled || dir === undefined) return null;
    return skillPicker.pick(dir);
  },
  addSkill: async (token, target, scope, projectId) => {
    const parsedScope = parseOneOf(scope, "scope", ["user", "project"] as const);
    const project = optionalProjectId(projectId);
    if (parsedScope === "project" && project === null) throw new IpcValidationError("项目范围的 skill 需要 projectId");
    const { name } = await skillPicker.add(
      parseString(token, "token", 100),
      parseOneOf(target, "target", ["shared", "omp"] as const),
      {
        home: os.homedir(),
        agentDir: resolveAgentDir(),
        project: parsedScope === "project" && project !== null ? (await getTaskPool()).projectPath(project) : null,
      },
    );
    return { name };
  },
  addSshHost: async (input, projectId) => {
    const parsed = parseSshHostInput(input);
    const project = optionalProjectId(projectId);
    if (parsed.scope === "project" && project === null) throw new IpcValidationError("项目范围的主机需要 projectId");
    // 用户范围一律在中性目录里跑，不让项目目录里的配置影响写到哪里。
    const run = await ompIn(parsed.scope === "project" ? project : null);
    return { text: await runSshWrite(run, sshAddArgs(parsed)) };
  },
  removeSshHost: async (name, scope, projectId) => {
    const parsedScope = parseOneOf(scope, "scope", ["user", "project"] as const);
    const project = optionalProjectId(projectId);
    if (parsedScope === "project" && project === null) throw new IpcValidationError("项目范围的主机需要 projectId");
    const run = await ompIn(parsedScope === "project" ? project : null);
    return { text: await runSshWrite(run, sshRemoveArgs(checkSshName(parseString(name, "name", 64)), parsedScope)) };
  },
};

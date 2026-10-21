// 插件和市场（设置 → 插件）：`omp plugin …` CLI，逻辑在 src/main/plugins/plugin-cli.ts。
// 用户范围在 userData/service 里跑；项目范围（`--scope project`，以及要看到项目范围的安装列表）在项目目录里跑——
// 目录取自主进程的项目记录，渲染进程只传 projectId。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { parseMarketplaceName, parsePluginAction, parsePluginName } from "../../shared/omp-output/plugins.ts";
import { ompManager } from "../omp-manager/index.ts";
import { discoverPlugins, listPlugins, readPluginConfig, runPluginAction } from "../plugins/plugin-cli.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { runOmpCommand } from "../usage/usage-service.ts";
import { IpcValidationError, parseProjectId } from "./validate.ts";

/** 安装要拉仓库、装依赖，比查询慢得多；超时会杀掉进程并报错。 */
const READ_TIMEOUT_MS = 2 * 60 * 1000;
const ACTION_TIMEOUT_MS = 10 * 60 * 1000;

/** cwd：projectId 非空时是该项目的目录（项目必须存在），否则 userData/service。 */
async function omp(timeoutMs: number, projectId: unknown = null) {
  const status = ompManager().status;
  if (status.state !== "ready") throw new Error("omp is not ready");
  let cwd = path.join(app.getPath("userData"), "service");
  if (projectId !== null && projectId !== undefined) {
    const id = parseProjectId(projectId);
    const project = (await getTaskPool()).listProjects().find((candidate) => candidate.id === id);
    if (!project) throw new IpcValidationError(`unknown project ${id}`);
    cwd = project.path;
  } else {
    await mkdir(cwd, { recursive: true });
  }
  return runOmpCommand(status.path, cwd, timeoutMs);
}

/** 动作校验失败统一成 IpcValidationError。 */
function validated<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch (error) {
    throw new IpcValidationError(error instanceof Error ? error.message : String(error));
  }
}

export const pluginHandlers: HandlerGroup<"listPlugins" | "discoverPlugins" | "getPluginConfig" | "runPluginAction"> = {
  listPlugins: async (projectId) => listPlugins(await omp(READ_TIMEOUT_MS, projectId)),
  discoverPlugins: async (marketplace) =>
    discoverPlugins(await omp(READ_TIMEOUT_MS), validated(parseMarketplaceName, marketplace)),
  getPluginConfig: async (plugin) => readPluginConfig(await omp(READ_TIMEOUT_MS), validated(parsePluginName, plugin)),
  runPluginAction: async (action, projectId) => {
    const parsed = validated(parsePluginAction, action);
    const project = "scope" in parsed && parsed.scope === "project" ? projectId : null;
    // `--scope project` 必须在项目目录里跑；没有 projectId 就拒绝，不悄悄装到别处。
    if ("scope" in parsed && parsed.scope === "project" && (projectId === null || projectId === undefined))
      throw new IpcValidationError("project scope needs a projectId");
    return runPluginAction(await omp(ACTION_TIMEOUT_MS, project), parsed);
  },
};

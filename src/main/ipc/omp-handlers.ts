// omp 管理的 IPC：状态、接管询问、下载安装、加 PATH、升级，omp 的全部设置，以及几项和 omp 管理一起交付的应用设置。
// 逻辑在 src/main/omp-manager/、src/main/omp-config/；这里只校验参数后转调。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { listJson, OmpConfigService, runOmpConfig } from "../omp-config/config-service.ts";
import { readModelDefaults, writeDefaultModel, type ModelDefaultsDeps } from "../omp-config/model-defaults.ts";
import { ompManager } from "../omp-manager/index.ts";
import { onOmpConfigChanged, readDefaultModel } from "../service/default-model.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { updateSettings } from "../settings/settings-store.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { parseBoolean, parseModelKey, parseOneOf, parseProjectId, parseString } from "./validate.ts";

// 退出时：停自管 omp 的更新定时器，关服务进程（登录、模型列表用的那个）。
registerShutdownHook(async () => {
  await ompManager().stop();
  await serviceOmp.close();
});

let config: OmpConfigService | null = null;

/** 中性目录 userData/service：不让任何项目层配置混进来。 */
async function neutralCwd(): Promise<string> {
  const cwd = path.join(app.getPath("userData"), "service");
  await mkdir(cwd, { recursive: true });
  return cwd;
}

function readyOmp(): { path: string; version: string } {
  const status = ompManager().status;
  if (status.state !== "ready") throw new Error("omp is not ready");
  return status;
}

/** omp config 子命令的执行者：用当前就绪的 omp，cwd 是中性目录。 */
function configService(): OmpConfigService {
  config ??= new OmpConfigService({
    run: async (args, env) => runOmpConfig(readyOmp().path, await neutralCwd())(args, env),
    version: async () => readyOmp().version,
    cacheFile: path.join(app.getPath("userData"), "omp-config-schema.json"),
  });
  return config;
}

const modelDefaultsDeps: ModelDefaultsDeps = {
  list: async (cwd) => listJson(runOmpConfig(readyOmp().path, cwd ?? (await neutralCwd()))),
  async setGlobalRoles(roles) {
    if (roles === null) await configService().reset("modelRoles");
    else await configService().set("modelRoles", JSON.stringify(roles));
  },
};

async function projectPath(projectId: unknown): Promise<string | null> {
  if (projectId === null) return null;
  const id = parseProjectId(projectId);
  const project = (await getTaskPool()).listProjects().find((candidate) => candidate.id === id);
  if (!project) throw new Error(`unknown project ${id}`);
  return project.path;
}

export const ompHandlers: HandlerGroup<
  | "getOmpStatus"
  | "answerTakeover"
  | "addManagedOmpToPath"
  | "retryOmpSetup"
  | "upgradePathOmp"
  | "checkOmpUpdate"
  | "installOmp"
  | "cancelOmpInstall"
  | "getOmpConfig"
  | "setOmpConfig"
  | "resetOmpConfig"
  | "setReduceMotion"
  | "setEnterWhileRunning"
  | "setNotifyOnGate"
  | "setYoloConfirmed"
  | "getDefaultModel"
  | "getModelDefaults"
  | "setDefaultModel"
> = {
  getOmpStatus: () => {
    const manager = ompManager();
    // 渲染进程启动时第一次来问，同时开始发现；之后的变化走 ompStatus 事件。
    manager.startOnce();
    return Promise.resolve(manager.status);
  },
  answerTakeover: (accept) => ompManager().answerTakeover(parseBoolean(accept, "accept")),
  addManagedOmpToPath: () => ompManager().addManagedOmpToPath(),
  retryOmpSetup: () => ompManager().retry(),
  upgradePathOmp: () => ompManager().upgradePathOmp(),
  checkOmpUpdate: () => ompManager().checkUpdate(),
  installOmp: () => ompManager().installOmp(),
  cancelOmpInstall: () => {
    ompManager().cancelInstall();
    return Promise.resolve();
  },
  getOmpConfig: () => configService().snapshot(),
  setOmpConfig: async (key, valueJson) => {
    const name = parseString(key, "key", 200);
    const result = await configService().set(name, parseString(valueJson, "value", 1024 * 1024, { allowEmpty: true }));
    onOmpConfigChanged(name);
    return result;
  },
  resetOmpConfig: async (key) => {
    const name = parseString(key, "key", 200);
    const result = await configService().reset(name);
    onOmpConfigChanged(name);
    return result;
  },
  setReduceMotion: (on) => Promise.resolve(updateSettings({ reduceMotion: parseBoolean(on, "reduceMotion") })),
  setEnterWhileRunning: (mode) =>
    Promise.resolve(
      updateSettings({ enterWhileRunning: parseOneOf(mode, "enterWhileRunning", ["steer", "followUp"]) }),
    ),
  setNotifyOnGate: (on) => Promise.resolve(updateSettings({ notifyOnGate: parseBoolean(on, "notifyOnGate") })),
  setYoloConfirmed: () => Promise.resolve(updateSettings({ yoloConfirmed: true })),
  getDefaultModel: () => readDefaultModel(),
  getModelDefaults: async (projectId) => readModelDefaults(modelDefaultsDeps, await projectPath(projectId)),
  setDefaultModel: async (projectId, model) => {
    await writeDefaultModel(
      modelDefaultsDeps,
      await projectPath(projectId),
      model === null ? null : parseModelKey(model),
    );
    onOmpConfigChanged("modelRoles");
  },
};

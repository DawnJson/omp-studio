// omp 管理的 IPC：状态、接管询问、下载安装、加 PATH、升级，omp 的全部设置，以及几项和 omp 管理一起交付的应用设置。
// 逻辑在 src/main/omp-manager/、src/main/omp-config/；这里只校验参数后转调。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { HandlerGroup } from "../../shared/ipc.ts";
import { OmpConfigService, runOmpConfig } from "../omp-config/config-service.ts";
import { ompManager } from "../omp-manager/index.ts";
import { onOmpConfigChanged, readDefaultModel } from "../service/default-model.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { updateSettings } from "../settings/settings-store.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { parseBoolean, parseOneOf, parseString } from "./validate.ts";

// 退出时：停自管 omp 的更新定时器，关服务进程（登录、模型列表用的那个）。
registerShutdownHook(async () => {
  await ompManager().stop();
  await serviceOmp.close();
});

let config: OmpConfigService | null = null;

/** omp config 子命令的执行者：用当前就绪的 omp，cwd 是中性的 userData/service（不让项目层配置混进来）。 */
function configService(): OmpConfigService {
  config ??= new OmpConfigService({
    async run(args, env) {
      const status = ompManager().status;
      if (status.state !== "ready") throw new Error("omp is not ready");
      const cwd = path.join(app.getPath("userData"), "service");
      await mkdir(cwd, { recursive: true });
      return runOmpConfig(status.path, cwd)(args, env);
    },
    async version() {
      const status = ompManager().status;
      if (status.state !== "ready") throw new Error("omp is not ready");
      return status.version;
    },
    cacheFile: path.join(app.getPath("userData"), "omp-config-schema.json"),
  });
  return config;
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
  checkOmpUpdate: async () => ({ installedVersion: await ompManager().checkUpdate() }),
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
  setEnterWhileRunning: (mode) => Promise.resolve(updateSettings({ enterWhileRunning: parseOneOf(mode, "enterWhileRunning", ["steer", "followUp"]) })),
  setNotifyOnGate: (on) => Promise.resolve(updateSettings({ notifyOnGate: parseBoolean(on, "notifyOnGate") })),
  setYoloConfirmed: () => Promise.resolve(updateSettings({ yoloConfirmed: true })),
  getDefaultModel: () => readDefaultModel(),
};

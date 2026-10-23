// omp 管理的 IPC：状态、接管询问、下载安装、加 PATH、升级，omp 的全部设置，以及几项和 omp 管理一起交付的应用设置。
// 逻辑在 src/main/omp-manager/、src/main/omp-config/；这里只校验参数后转调。
import { app } from "electron";
import path from "node:path";
import { resolveAgentDir } from "../history/session-index.ts";
import { log } from "../log/log.ts";
import { emitEvent } from "./events.ts";
import type { HandlerGroup, ModelDefaults, OmpConfigSnapshot, ProjectId } from "../../shared/ipc.ts";
import { toApprovalMode } from "../../shared/approval-mode.ts";
import { goalContinuationKey } from "../../shared/ui/goal-continuation.ts";
import { applyGoalContinuationDefault, isGoalContinuationExplicit } from "../omp-config/goal-default.ts";
import { applySetupWizardDefault, isSetupWizardExplicit, setupWizardKey } from "../omp-config/setup-wizard-default.ts";
import { registerStartupDefaults } from "../omp-config/startup-defaults.ts";
import { readOmpKeybindings } from "../omp-config/keybindings.ts";
import { notifyEnabled, type NotifyKind } from "../omp-config/notify-settings.ts";
import { readApprovalMode, type ApprovalModeDeps } from "../omp-config/approval-mode.ts";
import { listJson, OmpConfigService, runOmpConfig } from "../omp-config/config-service.ts";
import {
  readModelDefaults,
  readModelRoles,
  writeModelRole,
  type ModelDefaultsDeps,
} from "../omp-config/model-defaults.ts";
import { readModelInsights } from "../omp-config/model-insights.ts";
import { ompManager, readyOmp } from "../omp-manager/index.ts";
import { onOmpConfigChanged, readDefaultModel } from "../service/default-model.ts";
import { serviceCwd, serviceOmp } from "../service/service-omp.ts";
import { startupCache } from "../service/startup-cache-instance.ts";
import { updateSettings } from "../settings/settings-store.ts";
import { getTaskPool } from "../tasks/runtime.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import {
  IpcValidationError,
  parseBoolean,
  parseModelKey,
  parseOneOf,
  parseProjectId,
  parseString,
} from "./validate.ts";

/** 一次最多查多少个模型（omp 全部 provider 的目录也就几千个）。 */
const maxInsightKeys = 10_000;

// 退出时：停自管 omp 的更新定时器，关服务进程（登录、模型列表用的那个）。
registerShutdownHook(async () => {
  await ompManager().stop();
  await serviceOmp.close();
});

/**
 * 启动时（omp 就绪后）：`goal.continuationModes` 用户没明确设置过，就经 `omp config set` 加上 "rpc"（默认允许 /goal 自动推进）。
 * 明确设过（omp-studio 或终端里，任一取值）的不碰；失败只记 WARN，不影响启动。
 */
async function applyGoalContinuationDefaultOnStartup(): Promise<void> {
  try {
    await ompManager().ensureReady();
    const outcome = await applyGoalContinuationDefault({
      readValue: async () => {
        const json = (await listJson(runOmpConfig(readyOmp().path, await serviceCwd()))) as Record<
          string,
          { value?: unknown }
        >;
        return json[goalContinuationKey]?.value;
      },
      isExplicit: () => isGoalContinuationExplicit(resolveAgentDir()),
      write: async (modes) => {
        await configService().set(goalContinuationKey, JSON.stringify(modes));
      },
    });
    log.info(`${goalContinuationKey} startup default: ${outcome}`);
    if (outcome === "written") emitEvent("ompConfigChanged", { key: goalContinuationKey });
  } catch (error) {
    log.warn(`${goalContinuationKey} startup default failed`, error instanceof Error ? error.message : error);
  }
}

/** 启动时（omp 就绪后）：`startup.setupWizard` 用户没明确设置过，就经 `omp config set` 设成 false（关掉 omp 的首次运行引导）。失败只记 WARN。 */
async function applySetupWizardDefaultOnStartup(): Promise<void> {
  try {
    await ompManager().ensureReady();
    const outcome = await applySetupWizardDefault({
      isExplicit: () => isSetupWizardExplicit(resolveAgentDir()),
      write: async () => {
        await configService().set(setupWizardKey, "false");
      },
    });
    log.info(`${setupWizardKey} startup default: ${outcome}`);
    if (outcome === "written") emitEvent("ompConfigChanged", { key: setupWizardKey });
  } catch (error) {
    log.warn(`${setupWizardKey} startup default failed`, error instanceof Error ? error.message : error);
  }
}

/**
 * 启动默认的入口：先 goal 再引导，依次执行（两个 `omp config set` 并发会互相覆盖 config.yml）。
 * promise 登记到 startup-defaults，TSP 任务启动前等它（omp-config/startup-defaults.ts）。
 */
export function applyOmpStartupDefaults(): Promise<void> {
  const done = applyGoalContinuationDefaultOnStartup().then(applySetupWizardDefaultOnStartup);
  registerStartupDefaults(done);
  return done;
}

let config: OmpConfigService | null = null;

/** omp config 子命令的执行者：用当前就绪的 omp，cwd 是中性目录。 */
function configService(): OmpConfigService {
  config ??= new OmpConfigService({
    run: async (args, env) => runOmpConfig(readyOmp().path, await serviceCwd())(args, env),
    version: async () => readyOmp().version,
    cacheFile: path.join(app.getPath("userData"), "omp-config-schema.json"),
  });
  return config;
}

const modelDefaultsDeps: ModelDefaultsDeps = {
  list: async (cwd) => listJson(runOmpConfig(readyOmp().path, cwd ?? (await serviceCwd()))),
  async setGlobalRoles(roles) {
    if (roles === null) await configService().reset("modelRoles");
    else await configService().set("modelRoles", JSON.stringify(roles));
  },
};

/** omp 的 ask / completion / error 通知设置现在是开还是关（在这个项目目录里跑 `omp config list --json`，项目配置盖过全局）；供系统通知用。 */
export async function readNotifyEnabled(kind: NotifyKind, cwd: string | null): Promise<boolean> {
  return notifyEnabled(await modelDefaultsDeps.list(cwd), kind);
}

async function projectPath(projectId: unknown): Promise<string | null> {
  if (projectId === null) return null;
  return (await getTaskPool()).projectPath(parseProjectId(projectId));
}

/** 项目目录里 omp 对新任务实际用的默认值（同时记进启动缓存）；TSP 任务在输入框出现之前用它显示模型。 */
export async function readProjectModelDefaults(projectId: ProjectId, cwd: string): Promise<ModelDefaults> {
  const defaults = await readModelDefaults(modelDefaultsDeps, cwd);
  startupCache().setModelDefaults(projectId, defaults);
  return defaults;
}

const approvalKey = "tools.approvalMode";

const approvalModeDeps: ApprovalModeDeps = { list: modelDefaultsDeps.list };

/** 输入框的审批胶囊读的是全局生效值：读到就记进启动缓存（项目覆盖的值不记，别的项目会读到）。 */
function recordApprovalMode(value: unknown): void {
  const mode = toApprovalMode(value);
  if (mode !== null) startupCache().setApprovalMode(mode);
}

function recordSnapshot(snapshot: OmpConfigSnapshot): OmpConfigSnapshot {
  const item = snapshot.items.find((entry) => entry.key === approvalKey);
  if (item) recordApprovalMode(item.hasValue ? item.value : item.defaultValue);
  return snapshot;
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
  | "setSoundOnDone"
  | "setCopyOnSelect"
  | "setYoloConfirmed"
  | "getDefaultModel"
  | "getStartupSnapshot"
  | "getModelDefaults"
  | "getModelRoles"
  | "setModelRole"
  | "getApprovalMode"
  | "getModelInsights"
  | "getOmpKeybindings"
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
  getOmpConfig: async () => recordSnapshot(await configService().snapshot()),
  setOmpConfig: async (key, valueJson) => {
    const name = parseString(key, "key", 200);
    const result = await configService().set(name, parseString(valueJson, "value", 1024 * 1024, { allowEmpty: true }));
    if (name === approvalKey) recordApprovalMode(result.value);
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
  setSoundOnDone: (on) => Promise.resolve(updateSettings({ soundOnDone: parseBoolean(on, "soundOnDone") })),
  setCopyOnSelect: (on) => Promise.resolve(updateSettings({ copyOnSelect: parseBoolean(on, "copyOnSelect") })),
  setYoloConfirmed: () => Promise.resolve(updateSettings({ yoloConfirmed: true })),
  getDefaultModel: () => readDefaultModel(),
  getStartupSnapshot: () => Promise.resolve(startupCache().snapshot()),
  getModelDefaults: async (projectId) => {
    const defaults = await readModelDefaults(modelDefaultsDeps, await projectPath(projectId));
    startupCache().setModelDefaults(projectId === null ? null : parseProjectId(projectId), defaults);
    return defaults;
  },
  getModelRoles: async (projectId) => readModelRoles(modelDefaultsDeps, await projectPath(projectId)),
  getApprovalMode: async (projectId) => {
    const info = await readApprovalMode(approvalModeDeps, await projectPath(projectId));
    if (info.source === "global") recordApprovalMode(info.mode);
    return info;
  },
  setModelRole: async (role, model, thinking) => {
    await writeModelRole(
      modelDefaultsDeps,
      parseString(role, "role", 64),
      model === null ? null : parseModelKey(model),
      thinking === null ? null : parseString(thinking, "thinking", 16),
    );
    onOmpConfigChanged("modelRoles");
  },
  getModelInsights: async (projectId, keys) => {
    if (!Array.isArray(keys) || keys.length > maxInsightKeys)
      throw new IpcValidationError(`keys 必须是不超过 ${maxInsightKeys} 项的数组`);
    return readModelInsights(
      {
        agentDir: resolveAgentDir(),
        list: modelDefaultsDeps.list,
        warn: (message, error) => log.warn(message, error),
      },
      await projectPath(projectId),
      keys.map(parseModelKey),
    );
  },
  getOmpKeybindings: () => readOmpKeybindings(resolveAgentDir()),
};

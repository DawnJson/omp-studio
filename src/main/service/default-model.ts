// 新任务实际会用的默认模型：服务进程 `get_state` 读出的当前 model 和 thinkingLevel（omp 按它自己的配置解析：
// modelRoles.default、defaultThinkingLevel、登录状态等）。RPC 进程会监听 config.yml 自动重载（决策 10），
// 所以在 omp 设置里改了相关项之后，稍等一下再读一次并推 `defaultModel` 事件给渲染进程。
// 读到的默认模型和模型目录都记进启动缓存（startup-cache.ts），连同当时 omp 输入的指纹（catalogStamp）。
// 缓存优先：指纹没变、也没被作废（登录、退出、改 key、改 provider）就直接用缓存，不起服务进程（每个约 600 MB，omp 18.13.3）；
// 打开模型选择器（refresh）、omp 设置里改了模型相关项时现读目录和默认模型。应用启动时预读一次，缓存对得上就什么都不起。
// 盲区：凭据库（agent 目录的 agent.db：终端里 /login、OAuth 过期）不进指纹——omp 一直在写这个库（实测 omp 18.13.3，2026-10-28：
// 有任务在跑时 agent.db-wal 几秒内就改一次），放进来缓存就形同虚设；要等打开模型选择器或 studio 自己的登录、改 key 作废。
import { createHash } from "node:crypto";
import path from "node:path";
import { app } from "electron";
import type { DefaultModelInfo, ModelOption } from "../../shared/ipc.ts";
import { isProviderKeyEnv } from "../../shared/provider-keys.ts";
import { resolveAgentDir } from "../history/session-index.ts";
import { emitEvent } from "../ipc/events.ts";
import { log } from "../log/log.ts";
import { readyOmpVersion } from "../omp-manager/index.ts";
import { toModelOption } from "../tasks/convert.ts";
import { inputStamp } from "./input-stamp.ts";
import { serviceHasNoModel, serviceOmp } from "./service-omp.ts";
import { startupCache } from "./startup-cache-instance.ts";

/** 这些设置变了，默认模型/思考强度/可用模型可能跟着变。 */
const watchedKeys = new Set([
  "modelRoles",
  "modelRoleStorage",
  "defaultThinkingLevel",
  "enabledModels",
  "enabledProviders",
  "disabledProviders",
  "modelProviderOrder",
  "modelPresets",
]);
/** config.yml 写完到 RPC 进程重载完的缓冲。 */
const reloadDelayMs = 700;

/**
 * 模型目录和默认模型依赖的 omp 输入的指纹：studio 版本（自带的 studio-accounts 扩展注册 provider）+ omp 版本
 * + 系统环境里各内置 provider 的 key 变量（只进摘要，不存原值）+ agent 目录的 config.yml / config.yaml（modelRoles、enabledModels…）、
 * models.yml（自定义 provider）、.env（provider key）。凭据库变了靠 forgetCatalog 作废（见文件头的盲区）。
 */
async function catalogStamp(): Promise<string> {
  const agentDir = resolveAgentDir();
  const keys = Object.keys(process.env)
    .filter(isProviderKeyEnv)
    .sort()
    .map((name) => `${name}=${process.env[name]}`);
  const keyHash = createHash("sha256").update(keys.join("\n")).digest("hex").slice(0, 16);
  return inputStamp(
    `${app.getVersion()}+${await readyOmpVersion()}+${keyHash}`,
    ["config.yml", "config.yaml", "models.yml", ".env"].map((file) => path.join(agentDir, file)),
  );
}

/** `refresh` 为 false 时缓存优先；true 一定问服务进程。读不到时为 null（启动缓存不动）。 */
export async function readDefaultModel(refresh: boolean): Promise<DefaultModelInfo | null> {
  try {
    const generation = startupCache().catalogGeneration();
    const stamp = await catalogStamp();
    const cached = refresh ? undefined : startupCache().freshDefaultModel(stamp);
    if (cached !== undefined) return cached;
    const state = await serviceOmp.use((connection) => connection.request("get_state"));
    // 占位模型起的服务进程（没有任何可用模型，service-omp.ts）：get_state 的模型不是默认模型。
    const model: DefaultModelInfo | null =
      state.model && !serviceHasNoModel()
        ? {
            key: { provider: state.model.provider, modelId: state.model.id },
            name: state.model.name,
            thinkingLevel: state.thinkingLevel ?? null,
          }
        : null;
    startupCache().setDefaultModel(model, stamp, generation);
    return model;
  } catch (error) {
    // 服务进程起不来（omp 没就绪、没有任何可用模型）：界面按"没有默认模型"处理；启动缓存不动。
    log.warn("get_state on the service process failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * omp 的全部可用模型（服务进程 get_available_models）。`refresh` 为 false 时缓存优先；
 * true（打开模型选择器、改了模型相关设置）一定现读，同时现读默认模型并推 `defaultModel` 事件（终端里登录过的话两样都可能变了）。
 */
export async function listModelOptions(refresh: boolean): Promise<ModelOption[]> {
  const generation = startupCache().catalogGeneration();
  const stamp = await catalogStamp();
  const cached = refresh ? null : startupCache().freshModels(stamp);
  if (cached) return cached;
  if (refresh) void readDefaultModel(true).then((model) => emitEvent("defaultModel", model));
  const models = (await serviceOmp.use((connection) => connection.request("get_available_models"))).models.map(
    toModelOption,
  );
  startupCache().setModels(models, stamp, generation);
  return models;
}

/**
 * omp 的模型、凭据在服务进程之外变了（凭据库、models.yml、`omp models refresh`）：服务进程的注册表和认证状态是启动时建的，关掉它；
 * 缓存的模型目录和默认模型作废，下次读时重新起、现读。
 */
export async function reloadServiceModels(): Promise<void> {
  startupCache().forgetCatalog();
  await serviceOmp.close();
}

/**
 * 应用启动时调用：读默认模型和模型目录，让输入框工具行尽早有值。缓存优先：启动缓存里两样都有、omp 的输入没变时不起服务进程。
 * omp 还在发现/等接管时会等它就绪；失败只记 WARN。
 */
export function prewarmToolbarData(): void {
  void readDefaultModel(false);
  listModelOptions(false).catch((error: unknown) =>
    log.warn("prewarming the model list failed", error instanceof Error ? error.message : error),
  );
}

/** omp 设置里改了某一项之后调用：和模型有关的项会在重载后现读模型目录和默认模型（推事件）。 */
export function onOmpConfigChanged(key: string): void {
  if (!watchedKeys.has(key)) return;
  setTimeout(() => {
    listModelOptions(true).catch((error: unknown) =>
      log.warn("re-reading the model list failed", error instanceof Error ? error.message : error),
    );
  }, reloadDelayMs).unref();
}

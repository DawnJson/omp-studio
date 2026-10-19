// 新任务实际会用的默认模型：服务进程 `get_state` 读出的当前 model 和 thinkingLevel（omp 按它自己的配置解析：
// modelRoles.default、defaultThinkingLevel、登录状态等）。RPC 进程会监听 config.yml 自动重载（决策 10），
// 所以在 omp 设置里改了相关项之后，稍等一下再读一次并推 `defaultModel` 事件给渲染进程。
// 读到的默认模型和模型目录都记进启动缓存（startup-cache.ts）；应用启动时就预读一次，不等输入框来要。
import type { DefaultModelInfo, ModelOption } from "../../shared/ipc.ts";
import { emitEvent } from "../ipc/events.ts";
import { log } from "../log/log.ts";
import { toModelOption } from "../tasks/convert.ts";
import { serviceOmp } from "./service-omp.ts";
import { startupCache } from "./startup-cache-instance.ts";

/** 这些设置变了，默认模型/思考强度可能跟着变。 */
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

export async function readDefaultModel(): Promise<DefaultModelInfo | null> {
  try {
    const state = await serviceOmp.use((connection) => connection.request("get_state"));
    const model: DefaultModelInfo | null = state.model
      ? {
          key: { provider: state.model.provider, modelId: state.model.id },
          name: state.model.name,
          thinkingLevel: state.thinkingLevel ?? null,
        }
      : null;
    startupCache().setDefaultModel(model);
    return model;
  } catch (error) {
    // 服务进程起不来（omp 没就绪、没有任何可用模型）：界面按"没有默认模型"处理；启动缓存不动。
    log.warn("get_state on the service process failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** omp 的全部可用模型（服务进程 get_available_models）。 */
export async function listModelOptions(): Promise<ModelOption[]> {
  const models = (await serviceOmp.use((connection) => connection.request("get_available_models"))).models.map(
    toModelOption,
  );
  startupCache().setModels(models);
  return models;
}

/**
 * 应用启动时调用：马上拉起服务进程并读默认模型和模型目录，让输入框工具行的现读结果尽早到（结果进启动缓存）。
 * omp 还在发现/等接管时，serviceOmp.use 会等它就绪；失败只记 WARN。
 */
export function prewarmToolbarData(): void {
  void readDefaultModel();
  listModelOptions().catch((error: unknown) =>
    log.warn("prewarming the model list failed", error instanceof Error ? error.message : error),
  );
}

/** omp 设置里改了某一项之后调用：和默认模型有关的项会在重载后重新读一次并推事件。 */
export function onOmpConfigChanged(key: string): void {
  if (!watchedKeys.has(key)) return;
  setTimeout(() => void readDefaultModel().then((model) => emitEvent("defaultModel", model)), reloadDelayMs).unref();
}

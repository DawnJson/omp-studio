// 新任务默认值（草稿输入框的模型胶囊、起进程前的任务输入框）：显示什么模型、什么思考强度，以及"上次读到的值"。
// 切项目时胶囊第一帧就要是最终值：每个项目最近一次现读的结果记在这里（没读过时退回主进程的启动缓存），
// 绝不拿别的项目的值顶替；现读的结果和已显示的一样就不会再变。
import type { DefaultModelInfo, ModelDefaults, ModelOption, ProjectId } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
import { startupSnapshot } from "../../store/startup-snapshot.ts";
import { clampThinkingLevel, effortOrder, thinkingLevelOptions } from "./thinking-levels.ts";

export interface NewTaskDefault {
  model: ModelOption | null;
  /** 模型实际支持的档位（草稿里没有进程可问，来自模型目录）。 */
  levels: ThinkingLevel[];
  thinkingLevel: ThinkingLevel | null;
}

/**
 * 显示以项目目录里读到的 omp 配置为准：服务进程在配置重载后不会切换自己当前会话的模型（omp://settings.md
 * "Reloading does not ... switch a healthy active session's model"），它的 get_state 只在 modelRoles.default
 * 没设置时用来显示 omp 自选的模型。配置里的档位模型不支持时显示 omp 会钳到的那一档（thinking-levels.ts）。
 */
export function resolveNewTaskDefault(
  defaults: ModelDefaults | null,
  omp: DefaultModelInfo | null | undefined,
  models: readonly ModelOption[] | null,
): NewTaskDefault {
  const role = defaults?.model ?? null;
  const model =
    (models ?? []).find((m) => {
      const id = `${m.key.provider}/${m.key.modelId}`;
      if (role !== null) return role === id || role.startsWith(`${id}:`);
      return m.key.provider === omp?.key.provider && m.key.modelId === omp?.key.modelId;
    }) ?? null;
  const levels = thinkingLevelOptions(model, []);
  const configured = effortOrder.find((level) => level === defaults?.thinkingLevel) ?? omp?.thinkingLevel ?? null;
  return { model, levels, thinkingLevel: configured === null ? null : clampThinkingLevel(configured, levels) };
}

const projectKey = (projectId: ProjectId | null): string => projectId ?? "global";

const freshDefaults = new Map<string, ModelDefaults>();
/** undefined = 这次运行里还没读到过。 */
let freshOmp: DefaultModelInfo | null | undefined;
let freshModels: ModelOption[] | undefined;

export function rememberDefaults(projectId: ProjectId | null, value: ModelDefaults): void {
  freshDefaults.set(projectKey(projectId), value);
}

export function rememberOmp(value: DefaultModelInfo | null): void {
  freshOmp = value;
}

export function rememberModels(value: ModelOption[]): void {
  freshModels = value;
}

/** 这个项目最近一次读到的新任务默认值；这次运行里没读过就用启动缓存，都没有为 null。 */
export function knownDefaults(projectId: ProjectId | null): ModelDefaults | null {
  const key = projectKey(projectId);
  return freshDefaults.get(key) ?? startupSnapshot().modelDefaults?.[key] ?? null;
}

/** omp 自选的默认模型；undefined = 从没读到过。 */
export function knownOmp(): DefaultModelInfo | null | undefined {
  return freshOmp !== undefined ? freshOmp : startupSnapshot().defaultModel;
}

export function knownModels(): ModelOption[] | null {
  return freshModels ?? startupSnapshot().models ?? null;
}

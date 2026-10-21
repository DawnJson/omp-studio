// 新任务默认值的纯计算（草稿输入框的模型胶囊、起进程前的任务输入框）：显示什么模型、什么思考强度。
// "上次读到的值"的缓存在 new-task-default.ts（依赖渲染进程的启动缓存）；这里不碰 window，可以单测。
import type { DefaultModelInfo, ModelDefaults, ModelOption } from "../../../../shared/ipc.ts";
import type { ThinkingLevel } from "../../../../shared/omp-wire/rpc-wire.generated.ts";
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
  // 模型还没认出来（目录没到、项目里 modelRoles.default 指向目录里没有的模型）时没有档位可钳，原样显示配置的档位；
  // 认出来之后按模型的档位钳制，不支持思考的模型钳成 null（胶囊不显示强度）。
  return {
    model,
    levels,
    thinkingLevel: configured === null ? null : model === null ? configured : clampThinkingLevel(configured, levels),
  };
}

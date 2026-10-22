// 新任务默认值的纯计算：显示什么模型、什么思考强度。草稿输入框、起进程前的任务输入框（渲染进程）和 TSP 任务起进程前的
// 状态（主进程 tsp-runner.ts）用同一份，两边不会算出不同的结果。"上次读到的值"的缓存在渲染进程的 new-task-default.ts。
import type { DefaultModelInfo, ModelDefaults, ModelOption } from "../ipc.ts";
import type { Effort, ThinkingLevel } from "../omp-wire/rpc-wire.generated.ts";

/** 从弱到强。`off` 不在里面：它不是 effort，只有任务里 omp 报告了才有。 */
const effortOrder: readonly Effort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

const rank = (level: ThinkingLevel): number => effortOrder.indexOf(level as Effort);

/**
 * 选中的模型实际支持的档位，按界面顺序。
 * - 任务里：`live` 是 omp 的 get_available_thinking_levels（含 off，不含 auto、inherit），原样用。
 * - 草稿里（还没有进程，live 为空）：用模型的 thinking.efforts（不含 off：omp 的 defaultThinkingLevel 不接受 off）；
 *   omp 没给这个模型的思考配置时退回全部 effort。
 * 不支持思考的模型没有档位。
 */
export function thinkingLevelOptions(model: ModelOption | null, live: readonly ThinkingLevel[]): ThinkingLevel[] {
  if (model === null || !model.reasoning) return [];
  if (live.length > 0) return live.filter((level) => level === "off" || rank(level) >= 0);
  const efforts = model.thinkingEfforts ?? effortOrder;
  return effortOrder.filter((level) => efforts.includes(level));
}

/**
 * omp 把设置的档位钳到模型支持的档位：取最近的，一样近取较低的。
 * 实测 deepseek-v4-flash（efforts low/high/max）：minimal→low，medium→low，xhigh→high（真实 omp 18.12.2）。
 * 草稿没有进程可读回，用同一规则算出 omp 会实际采用的档位。
 */
export function clampThinkingLevel(level: ThinkingLevel, supported: readonly ThinkingLevel[]): ThinkingLevel | null {
  if (supported.includes(level)) return level;
  const from = rank(level);
  if (from < 0) return null;
  let best: ThinkingLevel | null = null;
  let bestDistance = Infinity;
  for (const candidate of supported) {
    const at = rank(candidate);
    if (at < 0) continue;
    const distance = Math.abs(at - from);
    if (distance < bestDistance || (distance === bestDistance && at < rank(best as ThinkingLevel))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export interface NewTaskDefault {
  model: ModelOption | null;
  /** 模型实际支持的档位（草稿里没有进程可问，来自模型目录）。 */
  levels: ThinkingLevel[];
  thinkingLevel: ThinkingLevel | null;
  /**
   * 还算不出来：这个项目的默认值或模型目录还没读到。此时 model / thinkingLevel 都是空的，界面显示占位，
   * 不拿别处（全局默认、别的项目）的值顶替再换掉。
   */
  pending: boolean;
  /** 配置里的 modelRoles.default 指向目录里没有的模型时，它的名字（去掉 `:档位` 后缀）；否则 null。 */
  unknownModel: string | null;
}

/**
 * 显示以项目目录里读到的 omp 配置为准：服务进程在配置重载后不会切换自己当前会话的模型（omp://settings.md
 * "Reloading does not ... switch a healthy active session's model"），它的 get_state 只在 modelRoles.default
 * 没设置时用来显示 omp 自选的模型。配置里的档位模型不支持时显示 omp 会钳到的那一档。
 */
export function resolveNewTaskDefault(
  defaults: Pick<ModelDefaults, "model" | "thinkingLevel"> | null,
  omp: DefaultModelInfo | null | undefined,
  models: readonly ModelOption[] | null,
): NewTaskDefault {
  if (defaults === null || models === null)
    return { model: null, levels: [], thinkingLevel: null, pending: true, unknownModel: null };
  const role = defaults.model;
  const model =
    models.find((m) => {
      const id = `${m.key.provider}/${m.key.modelId}`;
      if (role !== null) return role === id || role.startsWith(`${id}:`);
      return m.key.provider === omp?.key.provider && m.key.modelId === omp?.key.modelId;
    }) ?? null;
  const levels = thinkingLevelOptions(model, []);
  const configured = effortOrder.find((level) => level === defaults.thinkingLevel) ?? omp?.thinkingLevel ?? null;
  // 模型没认出来（项目里 modelRoles.default 指向目录里没有的模型、omp 没有默认模型）时没有档位可钳，原样显示配置的档位；
  // 认出来之后按模型的档位钳制，不支持思考的模型钳成 null（胶囊不显示强度）。
  return {
    model,
    levels,
    thinkingLevel: configured === null ? null : model === null ? configured : clampThinkingLevel(configured, levels),
    pending: false,
    unknownModel: model === null && role !== null ? (role.split(":")[0] ?? role) : null,
  };
}

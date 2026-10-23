// modelRoles 里一个角色的值：`provider/model-id`，可以后接 `:<思考强度>`（omp 的选择器语法，实测 omp config set / get 原样保存）。
// 模型 id 本身可以含冒号（`openrouter/meta/llama:free`），所以只有最后一个冒号后面是 omp 认得的档位时才算后缀。纯函数。
import type { ModelOption } from "../ipc.ts";
import type { ConfiguredThinkingLevel } from "../omp-wire/rpc-wire.generated.ts";
import { thinkingLevelOptions } from "./new-task-default.ts";

const levels: readonly ConfiguredThinkingLevel[] = [
  "auto",
  "inherit",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface RoleValue {
  /** 去掉档位后缀的选择器（`provider/model-id`、`@role` 别名等，原样）。 */
  selector: string;
  /** 后缀里的档位；没有后缀是 null。 */
  level: string | null;
}

export function splitRoleValue(value: string): RoleValue {
  const at = value.lastIndexOf(":");
  if (at > 0 && (levels as readonly string[]).includes(value.slice(at + 1)))
    return { selector: value.slice(0, at), level: value.slice(at + 1) };
  return { selector: value, level: null };
}

export function joinRoleValue(selector: string, level: string | null): string {
  return level === null || level === "" ? selector : `${selector}:${level}`;
}

/** 给角色换模型时角色原有的档位：新模型也支持就保留，否则 null（设置 → 模型的角色表和模型选择对话框共用）。 */
export function keepRoleLevel(current: string | null, model: ModelOption): string | null {
  const level = current === null ? null : splitRoleValue(current).level;
  return level !== null && (thinkingLevelOptions(model, []) as string[]).includes(level) ? level : null;
}

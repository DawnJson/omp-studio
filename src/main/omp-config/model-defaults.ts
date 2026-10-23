// 新任务的默认模型 = omp 的 modelRoles.default，按项目解析（omp 的设置就是 omp-studio 的设置，不另存）：
//   读：在项目目录里跑 `omp config list --json`，项目 .omp/config.yml 的 modelRoles 会盖过全局（实测 18.12.1）。
//   写：一律经 `omp config set modelRoles` 写全局（仓库所有者 2026-10-22 定：给角色指定模型就是全局的事；
//       只换一个任务的模型走"用于此任务"，不写配置）。项目文件里自带的 modelRoles 不碰，那个项目照旧用项目的值。
// modelRoles 只能整体写（`omp config set modelRoles.default` 报 Unknown setting），所以总是读出角色表只换目标角色。
import { joinRoleValue } from "../../shared/ui/role-value.ts";
import type { ModelDefaults, ModelKey } from "../../shared/ipc.ts";

export interface ModelDefaultsDeps {
  /** `omp config list --json` 的结果；cwd 为 null 时在中性目录里跑（只有全局配置）。 */
  list(cwd: string | null): Promise<unknown>;
  /** 写全局 modelRoles；null = `omp config reset modelRoles`。 */
  setGlobalRoles(roles: Record<string, unknown> | null): Promise<void>;
}

/** `omp config list --json` 结果里某个键的 value；键不存在或形状不对是 undefined。 */
export function valueOf(listed: unknown, key: string): unknown {
  if (typeof listed !== "object" || listed === null || !(key in listed)) return undefined;
  const entry: unknown = (listed as Record<string, unknown>)[key];
  return typeof entry === "object" && entry !== null && "value" in entry ? entry.value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export async function readModelDefaults(deps: ModelDefaultsDeps, cwd: string | null): Promise<ModelDefaults> {
  const listed = await deps.list(cwd);
  const role = asRecord(valueOf(listed, "modelRoles"))["default"];
  const thinking = valueOf(listed, "defaultThinkingLevel");
  return {
    model: typeof role === "string" ? role : null,
    thinkingLevel: typeof thinking === "string" ? thinking : null,
  };
}

/** 项目目录里生效的 modelRoles 里值是字符串的项（角色 → `provider/model[:thinking]`）。 */
export async function readModelRoles(deps: ModelDefaultsDeps, cwd: string | null): Promise<Record<string, string>> {
  const roles = asRecord(valueOf(await deps.list(cwd), "modelRoles"));
  const entries = Object.entries(roles).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

/**
 * 给任意角色（default、smol、task…）指定模型和思考强度（写成 `provider/model:level`，level 为 null 不带后缀）；
 * model 为 null = 去掉这个角色。写全局，见文件头。
 */
export async function writeModelRole(
  deps: ModelDefaultsDeps,
  role: string,
  model: ModelKey | null,
  thinking: string | null,
): Promise<void> {
  const roles = asRecord(valueOf(await deps.list(null), "modelRoles"));
  if (model === null) delete roles[role];
  else roles[role] = joinRoleValue(`${model.provider}/${model.modelId}`, thinking);
  await deps.setGlobalRoles(Object.keys(roles).length === 0 ? null : roles);
}

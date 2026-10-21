// 新任务默认值的"上次读到的值"：切项目时胶囊第一帧就要是最终值，每个项目最近一次现读的结果记在这里
// （没读过时退回主进程的启动缓存），绝不拿别的项目的值顶替；现读的结果和已显示的一样就不会再变。
// 显示什么模型、什么强度的纯计算在 shared/ui/new-task-default.ts，读取和占位在 use-new-task-default.ts。
import type { DefaultModelInfo, ModelDefaults, ModelOption, ProjectId } from "../../../../shared/ipc.ts";
import { startupSnapshot } from "../../store/startup-snapshot.ts";

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

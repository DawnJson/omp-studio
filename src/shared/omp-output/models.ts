// `omp models --kind all --json` 的输出解析（omp 18.12.6）：stdout 只有一行 `{"models":[{provider,kind,id,selector,name,…}]}`，
// 按 provider、id 排好（models.yml 校验失败的警告在 --json 时写 stderr）。
// 只留不是 chat 的（tiny、search、image、tts、stt、judge…）：对话模型照旧来自服务进程的 get_available_models（受 enabledModels 限制），
// 和 omp 的角色候选一样（scopedRolePool：限制只作用于对话模型，其余类别全部并进来）。
import type { RunnerModel } from "../ipc.ts";

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export function parseRunnerModels(stdout: string): RunnerModel[] {
  const parsed: unknown = JSON.parse(stdout);
  const models =
    typeof parsed === "object" && parsed !== null && "models" in parsed && Array.isArray(parsed.models)
      ? (parsed.models as unknown[])
      : null;
  if (models === null) throw new Error("omp models --json: no models array");
  const runners: RunnerModel[] = [];
  for (const entry of models) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, provider, id, name } = entry as Record<string, unknown>;
    if (!isText(kind) || kind === "chat" || !isText(provider) || !isText(id)) continue;
    runners.push({ kind, key: { provider, modelId: id }, name: isText(name) ? name : `${provider}/${id}` });
  }
  return runners;
}

// 新任务的默认模型 = omp 的 modelRoles.default，按项目解析（omp 的设置就是 omp-studio 的设置，不另存）。和 omp 终端里的模型选择器一样：
//   读：在项目目录里跑 `omp config list --json`，项目 .omp/config.yml 的 modelRoles 会盖过全局（实测 18.12.1）。
//   写：生效的 modelRoleStorage 是 project 时只改 `<项目>/.omp/config.yml` 的 modelRoles（omp://settings.md）；
//       否则经 `omp config set modelRoles` 写全局。omp 没有写项目配置的命令（`omp config set` 永远写全局，实测），
//       所以项目文件由这里用 yaml 的 Document 改，文件里的注释和其它键原样保留。
// modelRoles 只能整体写（`omp config set modelRoles.default` 报 Unknown setting），所以总是读出角色表只换目标角色。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import type { ModelDefaults, ModelKey } from "../../shared/ipc.ts";
import { writeFileAtomic } from "../tasks/atomic-write.ts";

export interface ModelDefaultsDeps {
  /** `omp config list --json` 的结果；cwd 为 null 时在中性目录里跑（只有全局配置）。 */
  list(cwd: string | null): Promise<unknown>;
  /** 写全局 modelRoles；null = `omp config reset modelRoles`。 */
  setGlobalRoles(roles: Record<string, unknown> | null): Promise<void>;
}

function valueOf(listed: unknown, key: string): unknown {
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
    storage: valueOf(listed, "modelRoleStorage") === "project" ? "project" : "global",
  };
}

/** 项目目录里生效的 modelRoles 里值是字符串的项（角色 → `provider/model[:thinking]`）。 */
export async function readModelRoles(deps: ModelDefaultsDeps, cwd: string | null): Promise<Record<string, string>> {
  const roles = asRecord(valueOf(await deps.list(cwd), "modelRoles"));
  const entries = Object.entries(roles).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries);
}

/** 给任意角色（default、smol、task…）指定模型；null = 去掉这个角色。写到哪层见文件头。 */
export async function writeModelRole(
  deps: ModelDefaultsDeps,
  cwd: string | null,
  role: string,
  model: ModelKey | null,
): Promise<void> {
  const selector = model === null ? null : `${model.provider}/${model.modelId}`;
  if (cwd !== null && (await readModelDefaults(deps, cwd)).storage === "project") {
    await writeProjectRole(path.join(cwd, ".omp", "config.yml"), role, selector);
    return;
  }
  const roles = asRecord(valueOf(await deps.list(null), "modelRoles"));
  if (selector === null) delete roles[role];
  else roles[role] = selector;
  await deps.setGlobalRoles(Object.keys(roles).length === 0 ? null : roles);
}

async function writeProjectRole(file: string, role: string, selector: string | null): Promise<void> {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`${file}: ${doc.errors[0]!.message}`);
  if (selector === null) {
    doc.deleteIn(["modelRoles", role]);
    const js: unknown = doc.toJS();
    const roles = typeof js === "object" && js !== null && "modelRoles" in js ? js.modelRoles : undefined;
    // 删完空了就去掉整个 modelRoles，免得留一个空映射盖住全局的角色。
    if (roles !== undefined && Object.keys(asRecord(roles)).length === 0) doc.delete("modelRoles");
  } else {
    doc.setIn(["modelRoles", role], selector);
  }
  await writeFileAtomic(file, doc.toString(), `omp-studio-${process.pid}`);
}

// 审批模式（tools.approvalMode）按项目解析，规则同 model-defaults.ts 的读：
//   在项目目录里跑 `omp config list --json`，项目 `.omp/config.yml` 设了 tools.approvalMode 就盖过全局（实测 omp 18.12.5）；
//   omp 只看 cwd 下的 `.omp/config.yml`，不往上找父目录。list 的结果不带来源，所以项目文件有没有设它由这里只读解析。
// 只读：写入只经 `omp config set`（全局）。omp 没有写项目层的命令（`omp config set` 在项目目录里照样写全局，
// 并提示 "Project settings override this value here"，实测 18.12.5），studio 不自己改项目文件；项目覆盖时界面不让改。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { toApprovalMode } from "../../shared/approval-mode.ts";
import type { ApprovalModeInfo } from "../../shared/ipc.ts";
import { valueOf } from "./model-defaults.ts";

export interface ApprovalModeDeps {
  /** `omp config list --json` 的结果；cwd 为 null 时在中性目录里跑（只有全局配置）。 */
  list(cwd: string | null): Promise<unknown>;
}

const configKey = "tools.approvalMode";

/** 项目文件不存在是正常的（false）；存在但 YAML 解析不了就抛，不当成"没设"。 */
async function projectSets(cwd: string): Promise<boolean> {
  const file = path.join(cwd, ".omp", "config.yml");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) throw new Error(`${file}: ${doc.errors[0]!.message}`);
  return typeof doc.getIn(["tools", "approvalMode"]) === "string";
}

export async function readApprovalMode(deps: ApprovalModeDeps, cwd: string | null): Promise<ApprovalModeInfo> {
  const value = valueOf(await deps.list(cwd), configKey);
  return {
    mode: toApprovalMode(value),
    source: cwd !== null && (await projectSets(cwd)) ? "project" : "global",
  };
}

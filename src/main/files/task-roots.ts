// 文件面板的根目录：任务自己的 cwd（下标 0，也是缺省），或这个任务的额外工作区目录（`/add-dir`，下标 1…n）。
// 渲染进程只能给下标（IPC 入口用 parseInteger 校验，见 `parseRootIndex`）；绝对路径由主进程从任务状态里的列表
// （omp 的输出，见 tasks/workspace-dirs.ts）取，从不接受渲染进程传来的根。下标过期（目录刚被移除）时抛错，不会悄悄落到别的根上。
import path from "node:path";
import { parseInteger } from "../ipc/validate.ts";

/** 下标上限：远大于任何实际的工作区目录数，只为拦住荒唐的输入。 */
export const MAX_ROOT_INDEX = 64;

/** 校验来自渲染进程的根下标：缺省 = 0（任务 cwd）；其余必须是 0…64 的整数。 */
export function parseRootIndex(value: unknown): number {
  return value === undefined ? 0 : parseInteger(value, "root", 0, MAX_ROOT_INDEX);
}

/** 下标 → 根目录的绝对路径。0 = cwd；i ≥ 1 = workspaceDirs[i - 1]（必须存在且是绝对路径）。 */
export function rootDir(cwd: string, workspaceDirs: readonly string[], index: number): string {
  if (index === 0) return cwd;
  const dir = workspaceDirs[index - 1];
  if (dir === undefined) throw new Error("unknown workspace directory (the list changed; refresh the file panel)");
  if (!path.isAbsolute(dir)) throw new Error("workspace directory is not an absolute path");
  return dir;
}

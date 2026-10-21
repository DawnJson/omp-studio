// 任务的额外工作区目录（`/add-dir`）：状态只存在于 omp 进程里（实测不写配置，进程重启就没了），所以这里只存 omp 最近一次
// 报出来的列表，进程退出时清空。唯一来源是 omp 的输出（`/dirs`、`/add-dir`、`/remove-dir` 的 toast / command_output），
// 渲染进程传来的路径从不进这个列表——文件面板按下标选根（main/files/task-roots.ts），校验靠这里的列表。
import { parseDirsOutput } from "../../shared/omp-output/dirs.ts";

export class WorkspaceDirs {
  #dirs: readonly string[] = [];

  /** 额外目录（不含任务自己的 cwd），按 omp 给的顺序。 */
  get dirs(): readonly string[] {
    return this.#dirs;
  }

  /** 进程退出：omp 那边的列表没了。返回是否有变化。 */
  reset(): boolean {
    if (this.#dirs.length === 0) return false;
    this.#dirs = [];
    return true;
  }

  /**
   * 用 omp 的一条输出更新列表，返回是否有变化。omp 拒绝（目录不存在、已在工作区…）或输出认不出来时，
   * 以 omp 原文抛错，列表保持不变。
   */
  apply(output: string): boolean {
    const parsed = parseDirsOutput(output);
    if (parsed.kind === "rejected") throw new Error(parsed.message);
    if (parsed.kind === "unparsed") throw new Error(parsed.text.trim() === "" ? "omp returned no output" : parsed.text);
    const same = parsed.dirs.length === this.#dirs.length && parsed.dirs.every((dir, i) => dir === this.#dirs[i]);
    if (same) return false;
    this.#dirs = parsed.dirs;
    return true;
  }
}

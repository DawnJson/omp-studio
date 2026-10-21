// TSP 任务的"导出为 HTML"：TSP 没有 export_html（那是 rpc 命令），也没有"把 /export 当消息发"的可靠通道，
// 所以用 omp 自己的 CLI：`omp --export <会话文件> <输出路径>`（实测 omp 18.12.5：第二个位置参数就是输出路径，
// 绝对路径含中文、空格、不存在的上级目录都照写，不补扩展名；会话文件不存在时退出码 1，stderr 是 "Error: File not found: …"）。
// 不带输出路径时 omp 写进当前目录，所以调用方必须传绝对路径。
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { prependToPath } from "./launch-args.ts";

const EXPORT_TIMEOUT_MS = 60_000;

/** 把会话文件导出成 `outputPath`（绝对路径）；失败时抛出 omp 的错误输出。 */
export async function exportSessionHtml(sessionFile: string, outputPath: string, cwd: string): Promise<void> {
  if (!path.isAbsolute(outputPath)) throw new Error("export path must be absolute");
  const executable = await getOmpExecutable();
  const env = executable.managedBin ? prependToPath(process.env, executable.managedBin) : process.env;
  const done = Promise.withResolvers<void>();
  execFile(
    executable.path,
    ["--export", sessionFile, outputPath],
    { cwd, env, timeout: EXPORT_TIMEOUT_MS, windowsHide: true },
    (error, _stdout, stderr) => {
      if (error) done.reject(new Error(stderr.trim() || error.message));
      else done.resolve();
    },
  );
  await done.promise;
  // 退出码 0 但没有文件（不该发生）也当失败，不假装导出了。
  await stat(outputPath);
}

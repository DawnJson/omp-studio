// 判断"omp 读的输入变没变"的廉价指纹：omp 版本 + 一组文件/目录的修改时间（不存在记 "-"）。几次 stat，不起 omp。
// 用在三处缓存上：斜杠命令列表（slash-commands.ts）、`omp config list --json`（omp-handlers.ts）、模型目录和默认模型（default-model.ts）。
// 目录的修改时间只在直接子项增删、改名时变：新建 skill 目录、命令文件会让指纹变，只改已有文件的内容不会（文件本身列进来的除外）。
import { stat } from "node:fs/promises";

export async function inputStamp(version: string, paths: readonly string[]): Promise<string> {
  const times = await Promise.all(
    paths.map((file) =>
      stat(file).then(
        (info) => String(info.mtimeMs),
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "ENOTDIR") return "-";
          throw error;
        },
      ),
    ),
  );
  return [version, ...times].join("|");
}

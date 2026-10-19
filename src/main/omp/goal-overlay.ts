// `--config` 覆盖文件：写在 userData 下（不碰用户的 omp 配置），任务进程启动时用 `--config <路径>` 带上。
// 不 import electron，单元测试可以直接用。
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { goalContinuationOverlay } from "./launch-args.ts";

/** 同一个文件的写入排队：多个任务同时启动时，Windows 上并发 rename 到同一个目标会 EPERM。 */
const queues = new Map<string, Promise<unknown>>();

async function writeIfChanged(file: string): Promise<void> {
  // 内容没变就不动它：别的 omp 进程可能正好在读，Windows 上改名覆盖打开着的文件会失败。
  if ((await readFile(file, "utf8").catch(() => null)) === goalContinuationOverlay) return;
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, goalContinuationOverlay, "utf8");
  await rename(temp, file);
}

/** 写 `<dir>/goal-continuation.yml`（先写临时文件再改名，读的人不会看到半截内容），返回它的路径。 */
export async function writeGoalOverlay(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "goal-continuation.yml");
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(() => writeIfChanged(file));
  queues.set(file, run);
  await run;
  return file;
}

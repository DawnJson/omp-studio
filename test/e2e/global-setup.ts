// Playwright 的 globalSetup（playwright.config.ts）。返回的函数是 globalTeardown，两边共用开跑时的临时目录快照。
// - 开跑前：e2e 跑的是 out/ 的构建产物。src/ 里有比 out/ 新的文件或目录就是没重新构建，测的是旧代码，直接失败
//   （目录也算：删掉、改名文件只改它所在目录的修改时间）。
// - 跑完后：launchApp / launchSettings 的临时目录（omp-studio-e2e-*、omp-studio-agent-*、custom-models 的 `omp-studio 代理 agent-*`）
//   有本次新留下的，说明哪个用例的启动助手或 cleanup 没走完（Electron 进程可能也还活着），整轮失败并列出来。开跑前就在的残留不算；
//   同一台机器上同时跑两轮 Playwright 时，另一轮还在用的目录也会被算进来，所以不要并行跑两轮 e2e。
// - 把 Playwright 主进程降到"低于正常"优先级：之后起的 worker、Electron、omp 都继承它（Windows 的 CreateProcess 和
//   POSIX 的 nice 都往子进程传），跑 e2e 时用户手上的程序先拿 CPU，不卡。
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const tempPrefixes = ["omp-studio-e2e-", "omp-studio-agent-", "omp-studio 代理 agent-"];

/** 目录本身和它下面（递归）所有文件、目录里最新的修改时间；目录不存在时是 null。 */
async function newestMtime(dir: string): Promise<{ file: string; mtimeMs: number } | null> {
  let entries;
  try {
    entries = await readdir(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let newest = { file: dir, mtimeMs: (await stat(dir)).mtimeMs };
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isDirectory()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const { mtimeMs } = await stat(file);
    if (mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
  }
  return newest;
}

async function leftoverTempDirs(): Promise<Set<string>> {
  const names = await readdir(os.tmpdir());
  return new Set(names.filter((name) => tempPrefixes.some((prefix) => name.startsWith(prefix))));
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const source = await newestMtime(path.join(root, "src"));
  const built = await newestMtime(path.join(root, "out"));
  if (built === null) throw new Error("没有 out/：e2e 跑的是构建产物，先 npm run build。");
  if (source !== null && source.mtimeMs > built.mtimeMs) {
    throw new Error(
      `out/ 比 src/ 旧（${path.relative(root, source.file)} 改于 ${new Date(source.mtimeMs).toISOString()}，` +
        `out/ 最新的文件写于 ${new Date(built.mtimeMs).toISOString()}）：e2e 会测旧代码，先 npm run build。`,
    );
  }

  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL);
  const before = await leftoverTempDirs();
  return async function globalTeardown() {
    const added = [...(await leftoverTempDirs())].filter((name) => !before.has(name));
    if (added.length > 0) {
      throw new Error(
        `本轮 e2e 留下了 ${added.length} 个临时目录（某个用例的启动助手或 cleanup 没走完，Electron 可能也还在）：\n` +
          added.map((name) => `  ${path.join(os.tmpdir(), name)}`).join("\n"),
      );
    }
  };
}

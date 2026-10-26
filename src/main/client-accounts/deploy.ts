// 内置 magpie 插件的 omp 扩展：随应用一起打包（`import.meta.glob` 的 `?raw` 进主进程 bundle），启动时写到 userData，
// 每次起 omp 用 `-e <入口>` 加载。为什么是扩展、为什么不能放 asar，见 docs/architecture/client-accounts.md。
//
// 目录带内容哈希：内容变了换目录，旧目录删掉；omp 进程读的是磁盘文件，所以不能留在 asar 里。
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCES = import.meta.glob<string>(["./extension/**/*", "!./extension/**/*.d.mts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** 相对目录 → 文件内容：`extension/` 下的全部文件（类型声明除外）。测试按这张表核对写出来的东西。 */
export const ACCOUNT_EXTENSION_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SOURCES).map(([file, content]) => [file.slice("./extension/".length), content]),
);

/** 入口文件（相对扩展目录）；`-e` 传它的绝对路径。 */
export const ACCOUNT_EXTENSION_ENTRY = "studio-accounts.mjs";

const DIR_PREFIX = "accounts-";

/** 内容哈希决定目录名：同一份内容只写一次。 */
export function extensionContentHash(files: Readonly<Record<string, string>> = ACCOUNT_EXTENSION_FILES): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    hash.update(name);
    hash.update("\0");
    hash.update(files[name] ?? "");
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * 把扩展写到 `<baseDir>/omp-extensions/accounts-<hash>/`，返回入口文件的绝对路径。
 * 目录已存在且入口文件在位时直接返回（启动时只多一次 readdir/stat）。
 */
export async function deployAccountExtension(
  baseDir: string,
  files: Readonly<Record<string, string>> = ACCOUNT_EXTENSION_FILES,
): Promise<string> {
  const root = path.join(baseDir, "omp-extensions");
  const dir = path.join(root, `${DIR_PREFIX}${extensionContentHash(files)}`);
  const entryPath = path.join(dir, ACCOUNT_EXTENSION_ENTRY);

  if (await exists(entryPath)) {
    await pruneOldDirs(root, path.basename(dir));
    return entryPath;
  }

  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await pruneOldDirs(root, path.basename(dir));
  return entryPath;
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/** 只留当前这一份：升级后旧的扩展目录没有进程在读，删掉。 */
async function pruneOldDirs(root: string, keep: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === keep || !name.startsWith(DIR_PREFIX)) continue;
    await rm(path.join(root, name), { recursive: true, force: true, maxRetries: 3 });
  }
}

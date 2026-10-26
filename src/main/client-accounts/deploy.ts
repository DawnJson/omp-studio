// 内置 magpie 插件的 omp 扩展：随应用一起打包（`import.meta.glob` 的 `?raw` 进主进程 bundle），启动时写进 omp 的扩展目录
// `<agent 目录>/extensions/studio-accounts/`，omp 每个进程（studio 起的、终端里的、`omp commit` 这类子命令）都会自动加载它。
// 为什么是扩展、为什么放在 omp 的扩展目录，见 docs/architecture/client-accounts.md。
//
// 只写这一个目录（AGENTS.md「omp 的边界」的例外）：内容没变的文件不碰，变了的原子替换；
// 上一版写过、这一版没有的文件按清单删掉。插件自己写的模型缓存不在清单里，不受影响。
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const SOURCES = import.meta.glob<string>(["./extension/**/*", "!./extension/**/*.d.mts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

/** 相对目录 → 文件内容：`extension/` 下的全部文件（类型声明除外）。 */
export const ACCOUNT_EXTENSION_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SOURCES).map(([file, content]) => [file.slice("./extension/".length), content]),
);

/** omp 扩展目录下 studio 唯一会写的子目录。 */
export const ACCOUNT_EXTENSION_DIR = "studio-accounts";

/** omp 18.12.6 只认目录里的 `index.ts` / `index.js`（`extensibility/extensions/loader.ts` 的 indexNames）：转到真正的入口。 */
const INDEX_FILE = "index.js";
const INDEX_SOURCE = 'export { default } from "./studio-accounts.mjs";\n';

/** studio 上一次写进去的文件清单（相对路径）：下次据此删掉不再需要的文件，别的文件（插件的缓存）不动。 */
const MANIFEST_FILE = ".studio-files.json";

/**
 * 把扩展写到 `<agentDir>/extensions/studio-accounts/`，返回这个目录。
 * 每次启动都核对一遍：内容一样的文件不重写（启动只多读一遍约 1 MB 的文件）。
 */
export async function deployAccountExtension(
  agentDir: string,
  files: Readonly<Record<string, string>> = ACCOUNT_EXTENSION_FILES,
): Promise<string> {
  const dir = path.join(agentDir, "extensions", ACCOUNT_EXTENSION_DIR);
  const wanted: Record<string, string> = { ...files, [INDEX_FILE]: INDEX_SOURCE };
  for (const [name, content] of Object.entries(wanted)) {
    const target = path.join(dir, name);
    if ((await readText(target)) === content) continue;
    await mkdir(path.dirname(target), { recursive: true });
    // 终端里的 omp 可能正在读：先写临时文件再换名，不让它读到写了一半的模块。
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, content, "utf8");
    await rename(temp, target);
  }
  const previous = parseManifest(await readText(path.join(dir, MANIFEST_FILE)));
  for (const name of previous) {
    if (name in wanted) continue;
    await rm(path.join(dir, name), { force: true, maxRetries: 3 });
  }
  await writeFile(path.join(dir, MANIFEST_FILE), JSON.stringify(Object.keys(wanted).sort()), "utf8");
  return dir;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** 清单里只认留在这个目录里的相对路径：被改坏的清单不能让 studio 删到目录外面去。 */
function parseManifest(text: string | null): string[] {
  if (text === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.filter(
    (name): name is string =>
      typeof name === "string" &&
      name !== "" &&
      !path.isAbsolute(name) &&
      !path.normalize(name).split(/[\\/]/).includes(".."),
  );
}

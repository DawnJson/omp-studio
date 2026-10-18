// 找 PATH 上的 omp，读出版本和管理者。规则见 docs/architecture/omp-install.md "发现 PATH 上的 omp"。
import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export interface OmpManager {
  /** `manager.json` 的 `manager` 字段，如 `tern`。 */
  id: string;
  /** 显示名：`name` 字段，没有时同 `id`。 */
  name: string;
}

export interface OmpInstall {
  path: string;
  version: string;
  /** exe 上两级目录的 `manager.json`；没有就是用户自己装的。 */
  manager: OmpManager | null;
}

/**
 * PATH 上第一个 `omp` 是 `.cmd`/`.bat` 之类的脚本（比如 npm 全局安装生成的 shim）。
 * 不用 shell 就启动不了它（Node 对这类文件 spawn 会报 EINVAL），而启动子进程不允许用 shell，所以不支持。
 */
export class UnsupportedOmpLauncherError extends Error {
  override name = "UnsupportedOmpLauncherError";
  readonly path: string;

  constructor(launcherPath: string) {
    super(`omp on PATH is a script launcher, which omp-studio cannot start without a shell: ${launcherPath}`);
    this.path = launcherPath;
  }
}

/**
 * 按 PATH 顺序找第一个 `omp`，和用户在终端里敲 `omp` 得到的是同一个。找不到返回 null。
 * Windows 上第一个命中的不是 `.exe`/`.com` 时抛 `UnsupportedOmpLauncherError`，不跳过它去找后面的：
 * 那样用的就不是终端里的那个 omp 了。
 */
export async function findOmpOnPath(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const isWindows = process.platform === "win32";
  // Windows 上环境变量名不区分大小写，常见的是 `Path`。
  const read = (name: string) =>
    env[Object.keys(env).find((key) => (isWindows ? key.toUpperCase() === name : key === name)) ?? name];
  const dirs = (read("PATH") ?? "").split(path.delimiter).filter(Boolean);
  const extensions = isWindows ? (read("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, "omp" + ext);
      try {
        await access(candidate, isWindows ? constants.F_OK : constants.X_OK);
      } catch {
        // 这个目录里没有，继续找下一个。
        continue;
      }
      const resolved = await realpath(candidate);
      if (isWindows && ![".exe", ".com"].includes(path.extname(resolved).toLowerCase()))
        throw new UnsupportedOmpLauncherError(resolved);
      return resolved;
    }
  }
  return null;
}

/** 执行 `omp --version` 并读 `manager.json`。 */
export async function inspectOmp(exePath: string): Promise<OmpInstall> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  execFile(exePath, ["--version"], { timeout: 15_000, windowsHide: true }, (error, stdout) =>
    error ? reject(error) : resolve(stdout),
  );
  const output = await promise;
  const version = /^omp\/(\S+)/m.exec(output)?.[1];
  if (!version) throw new Error(`unexpected \`omp --version\` output: ${output.slice(0, 200)}`);
  return { path: exePath, version, manager: await readManager(exePath) };
}

/** 与 omp 自己的判断一致：`manager` 是字符串就算受管，显示名取 `name`，没有就用 `manager`。 */
async function readManager(exePath: string): Promise<OmpManager | null> {
  const file = path.join(path.dirname(path.dirname(exePath)), "manager.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // 内容不是 JSON：不是一个有效的管理者声明，按未受管处理。
    return null;
  }
  if (typeof json !== "object" || json === null || !("manager" in json) || typeof json.manager !== "string")
    return null;
  const name = "name" in json && typeof json.name === "string" ? json.name : json.manager;
  return { id: json.manager, name };
}

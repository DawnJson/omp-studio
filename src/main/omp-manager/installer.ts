// omp-studio 自管的那一份 omp：目录布局、安装、换当前版本、保留最近 3 个版本。规则见 docs/architecture/omp-install.md。
//   <root>/manager.json          {"manager":"omp-studio","name":"omp-studio"}，让 omp 自己知道由谁管理
//   <root>/versions/<版本>.exe    保留最近 3 个
//   <root>/bin/omp.exe           当前版本（用户 PATH 指向 bin）
// 不碰 ~/.omp/natives/<版本>：终端可能还在用（omp-install.md）。
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { downloadVerified, VerifyError, type BuildInfo, type BuildPatch, type FetchFn } from "./build-service.ts";
import { applySingleStreamPatch } from "./hpatch.ts";
import { log } from "../log/log.ts";
import { compareVersions } from "../../shared/omp-version.ts";

const KEEP_VERSIONS = 3;

export interface ManagedLayout {
  root: string;
  versionsDir: string;
  binDir: string;
  binExe: string;
  managerJson: string;
}

export function managedLayout(root: string): ManagedLayout {
  const exe = process.platform === "win32" ? "omp.exe" : "omp";
  return {
    root,
    versionsDir: path.join(root, "versions"),
    binDir: path.join(root, "bin"),
    binExe: path.join(root, "bin", exe),
    managerJson: path.join(root, "manager.json"),
  };
}

function versionExe(layout: ManagedLayout, version: string): string {
  return path.join(layout.versionsDir, `${version}${path.extname(layout.binExe)}`);
}

export interface InstallOptions {
  fetch: FetchFn;
  build: BuildInfo;
  /** 当前装着的 exe。build 带补丁且补丁正是从它做出来的（sha256 对得上）时，先试补丁。 */
  fromExe?: string | undefined;
  onProgress?: ((receivedBytes: number, totalBytes: number) => void) | undefined;
  onVerifying?: (() => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** 下载校验 build 对应的版本（能用补丁就用补丁），写 manager.json，把它换成当前版本，清理旧版本。返回装好的版本号。 */
export async function installBuild(layout: ManagedLayout, options: InstallOptions): Promise<string> {
  const { build } = options;
  await mkdir(layout.versionsDir, { recursive: true });
  await mkdir(layout.binDir, { recursive: true });
  const target = versionExe(layout, build.version);
  // 同版本已经校验过地放在 versions/ 里就不重复下载（下载总是先写 .partial，改名才算校验通过）。
  if (
    !(await stat(target).then(
      (s) => s.isFile(),
      () => false,
    ))
  ) {
    const patched =
      build.patch !== null &&
      options.fromExe !== undefined &&
      (await installFromPatch(options, build.patch, options.fromExe, target));
    if (!patched) {
      await downloadVerified({
        fetch: options.fetch,
        source: { url: build.downloadUrl, size: build.file.size, sha256: build.file.sha256 },
        dest: target,
        onProgress: options.onProgress,
        onVerifying: options.onVerifying,
        signal: options.signal,
      });
    }
  }
  await writeFile(layout.managerJson, JSON.stringify({ manager: "omp-studio", name: "omp-studio" }) + "\n", "utf8");
  await activateVersion(layout, build.version);
  await pruneVersions(layout, build.version);
  return build.version;
}

/**
 * 下补丁（约 30 MB，全量 220 MB）并应用到 fromExe，结果和 build 的 size、sha256 都对上才改名成 target。
 * 补丁不适用或任何一步失败都返回 false，由调用方退回全量下载；用户取消照常抛出。
 */
async function installFromPatch(
  options: InstallOptions,
  patch: BuildPatch,
  fromExe: string,
  target: string,
): Promise<boolean> {
  const { signal } = options;
  const patchFile = `${target}.patch`;
  const partial = `${target}.partial`;
  try {
    if ((await hashFile(fromExe)).sha256 !== patch.fromSha256) return false;
    await downloadVerified({ fetch: options.fetch, source: patch, dest: patchFile, signal });
    await applySingleStreamPatch({ oldPath: fromExe, patchPath: patchFile, outPath: partial, signal });
    const result = await hashFile(partial);
    if (result.size !== options.build.file.size || result.sha256 !== options.build.file.sha256)
      throw new VerifyError("the patched file does not match the build");
    await rename(partial, target);
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    log.warn(
      "omp patch update failed, downloading the full build instead",
      error instanceof Error ? error.message : error,
    );
    return false;
  } finally {
    await rm(patchFile, { force: true });
    await rm(partial, { force: true });
  }
}

async function hashFile(file: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256");
  let size = 0;
  await pipeline(createReadStream(file), async (chunks: AsyncIterable<Buffer>) => {
    for await (const chunk of chunks) {
      hash.update(chunk);
      size += chunk.length;
    }
  });
  return { size, sha256: hash.digest("hex") };
}

/**
 * 把 versions/<版本>.exe 换成 bin/omp.exe。Windows 不能覆盖运行中的 exe，但可以改名：
 * 先复制到 bin 里的临时名，再把旧的改成 `.omp.exe.old-<时间戳>`，最后把新的改名到位。
 * 正在跑的 omp 进程继续用旧文件，新进程用新版本。
 */
async function activateVersion(layout: ManagedLayout, version: string): Promise<void> {
  const staging = path.join(layout.binDir, `.omp.exe.new-${process.pid}`);
  await copyFile(versionExe(layout, version), staging);
  const hadOld = await stat(layout.binExe).then(
    () => true,
    () => false,
  );
  const old = path.join(layout.binDir, `.omp.exe.old-${Date.now()}`);
  try {
    if (hadOld) await rename(layout.binExe, old);
    await rename(staging, layout.binExe);
  } catch (error) {
    // 新文件没能就位：把旧的放回去，bin/omp.exe 不能因此消失。
    if (hadOld) await rename(old, layout.binExe).catch(() => {});
    await rm(staging, { force: true });
    throw error;
  }
}

/** 删 bin 里换下来的旧 exe；还有进程在用的删不掉，留到下次启动。 */
export async function sweepOldBinaries(layout: ManagedLayout): Promise<void> {
  let names: string[];
  try {
    names = await readdir(layout.binDir);
  } catch {
    // bin 还不存在：没装过，没有东西可清。
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith(".omp.exe.old-") || name.startsWith(".omp.exe.new-"))
      .map((name) => rm(path.join(layout.binDir, name), { force: true }).catch(() => {})),
  );
}

/** versions/ 里只留最近 KEEP_VERSIONS 个（按版本号），当前版本一定保留；遗留的 .partial 和补丁一并删掉。 */
async function pruneVersions(layout: ManagedLayout, currentVersion: string): Promise<void> {
  const ext = path.extname(layout.binExe);
  const names = await readdir(layout.versionsDir);
  await Promise.all(
    names
      .filter((name) => name.endsWith(".partial") || name.endsWith(".patch"))
      .map((name) => rm(path.join(layout.versionsDir, name), { force: true })),
  );
  const versions = names.filter((name) => name.endsWith(ext)).map((name) => name.slice(0, name.length - ext.length));
  // 当前版本一定留，占一个名额；其余按版本号从新到旧补满。
  const kept = [
    currentVersion,
    ...versions.filter((version) => version !== currentVersion).sort((a, b) => compareVersions(b, a)),
  ].slice(0, KEEP_VERSIONS);
  const removable = versions.filter((version) => !kept.includes(version));
  await Promise.all(removable.map((version) => rm(path.join(layout.versionsDir, `${version}${ext}`), { force: true })));
}

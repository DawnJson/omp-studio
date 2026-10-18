// omp 管理在应用里的接线：把 OmpManager 接上 electron（net.fetch、userData、事件推送）、PATH 发现和用户 PATH 注册表。
// 其它模块（launch.ts、服务进程、IPC handlers）只用这里导出的 ompManager() 和 getOmpExecutable()。
import { app, net } from "electron";
import path from "node:path";
import { emitEvent } from "../ipc/events.ts";
import { findOmpOnPath, inspectOmp, type OmpInstall } from "../omp/discover.ts";
import { addToUserPath, pathContains, readUserPath } from "../platform/win32/user-path.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { OmpManager, runOmpUpdate, type ManagerDeps, type UserPathAccess } from "./manager.ts";
import { MIN_OMP_VERSION } from "./version.ts";

export { getApiKeyEnv } from "./api-keys.ts";

/** 自管目录：`%LOCALAPPDATA%\omp-studio\omp`。未打包时 `STUDIO_OMP_HOME`（或测试的 STUDIO_USER_DATA）可以改，测试不碰真实用户目录。 */
function managedRoot(): string {
  if (!app.isPackaged) {
    const override = process.env["STUDIO_OMP_HOME"];
    if (override) return override;
    if (process.env["STUDIO_USER_DATA"]) return path.join(app.getPath("userData"), "omp");
  }
  const base = process.env["LOCALAPPDATA"] ?? path.join(app.getPath("home"), ".local", "share");
  return path.join(base, "omp-studio", "omp");
}

/** 写用户 PATH 之前把原值留一份（写坏用户 PATH 的风险对策，arch.md 风险表）。 */
function windowsUserPath(): UserPathAccess {
  return {
    contains: (dir) => pathContains(readUserPath().raw, dir),
    addFront: (dir) => {
      addToUserPath(dir, {
        onBeforeWrite: (previous) => {
          const folder = app.getPath("userData");
          mkdirSync(folder, { recursive: true });
          writeFileSync(path.join(folder, `path-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`), previous ?? "", { encoding: "utf8", mode: 0o600 });
        },
      });
    },
  };
}

/** 未打包时 `STUDIO_TEST_OMP`（JSON `{command,args}`）指向假 omp：发现流程把它当作"别人管理的 omp"，不查 PATH；会照常问接管，e2e 的 launchApp 预先记下"拒绝"。 */
function testOverride(): Pick<ManagerDeps, "findOnPath" | "inspect"> | null {
  const raw = app.isPackaged ? undefined : process.env["STUDIO_TEST_OMP"];
  if (!raw) return null;
  const { command } = JSON.parse(raw) as { command: string };
  const install: OmpInstall = { path: command, version: MIN_OMP_VERSION, manager: { id: "test", name: "test" } };
  return { findOnPath: () => Promise.resolve(command), inspect: () => Promise.resolve(install) };
}

let manager: OmpManager | null = null;

export function ompManager(): OmpManager {
  manager ??= new OmpManager({
    root: managedRoot(),
    stateFile: path.join(app.getPath("userData"), "omp-studio-state.json"),
    // net.fetch 走 Chromium 网络栈，自动用系统代理（国内常见）。
    fetch: (url, init) => net.fetch(url, { ...(init?.headers && { headers: init.headers }), ...(init?.signal && { signal: init.signal }) }),
    baseUrl: process.env["PI_BUILD_URL"],
    findOnPath: () => findOmpOnPath(),
    inspect: inspectOmp,
    userPath: process.platform === "win32" ? windowsUserPath() : null,
    emit: (status) => emitEvent("ompStatus", status),
    runUpdate: runOmpUpdate,
    ...testOverride(),
  });
  return manager;
}

/** 等到有可用的 omp 再返回它的路径。`managedBin` 非空时（自管）启动子进程要把它前置到子进程 PATH，让 `omp update` 认到 manager.json。 */
export function getOmpExecutable(): Promise<{ path: string; managedBin: string | null }> {
  return ompManager().ensureReady();
}

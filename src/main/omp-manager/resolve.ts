// 决定用哪个 omp（arch.md 第 6.1 节的流程图）。纯函数：输入是"PATH 上有什么、自管副本有没有、问过没有"，
// 输出是下一步做什么。读盘、执行 omp --version 都在 manager.ts，这里不碰文件系统，方便逐分支单测。
import type { OmpInstall } from "../omp/discover.ts";
import type { OmpSource } from "../../shared/ipc.ts";
import { takeoverKey, type OmpStudioState } from "./takeover-state.ts";

export type PathScan =
  | { kind: "none" }
  /** PATH 上第一个 omp 是 .cmd/.bat 之类的脚本，启动不了。 */
  | { kind: "script"; path: string }
  | { kind: "exe"; install: OmpInstall };

export interface ResolveInput {
  scan: PathScan;
  /** 自管目录里 bin/omp.exe 的检查结果；没装过为 null。 */
  managed: OmpInstall | null;
  state: OmpStudioState;
}

export type Decision =
  /** 直接用这个 omp，不动它。 */
  | { action: "use"; path: string; version: string; source: OmpSource }
  /** 用自管副本；没有就先下载。`takeover` 表示这是用户同意接管的结果（要把 bin 放进用户 PATH）。 */
  | { action: "use_managed"; reason: "missing" | "takeover" }
  | { action: "ask_takeover"; path: string; version: string | null; launchable: boolean }
  | { action: "unusable"; path: string };

/** 自管的 exe 是否由 omp-studio 声明管理（manager.json 里是 omp-studio）。 */
export function isStudioManager(install: OmpInstall): boolean {
  return install.manager?.id === "omp-studio";
}

export function resolveOmp(input: ResolveInput): Decision {
  const { scan, state } = input;
  if (scan.kind === "none") return { action: "use_managed", reason: "missing" };

  if (scan.kind === "exe") {
    const { install } = scan;
    if (install.manager !== null) {
      // 有管理者的不问，直接用；管理者是 omp-studio 自己时 onUserPath 由 manager.ts 补上。
      if (isStudioManager(install)) return { action: "use", path: install.path, version: install.version, source: { kind: "studio_managed", onUserPath: true } };
      return { action: "use", path: install.path, version: install.version, source: { kind: "managed_by_other", managerName: install.manager.name } };
    }
  }

  const exePath = scan.kind === "exe" ? scan.install.path : scan.path;
  const answer = state.takeover[takeoverKey(exePath)];
  if (answer === "accepted") return { action: "use_managed", reason: "takeover" };
  if (answer === "declined") {
    if (scan.kind === "script") return { action: "unusable", path: scan.path };
    return { action: "use", path: scan.install.path, version: scan.install.version, source: { kind: "user_installed" } };
  }
  return {
    action: "ask_takeover",
    path: exePath,
    version: scan.kind === "exe" ? scan.install.version : null,
    launchable: scan.kind === "exe",
  };
}

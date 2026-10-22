// 决定用哪个 omp（流程见 docs/architecture/omp-install.md）。纯函数：输入是"PATH 上有什么、自管副本有没有、问过没有"，
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
  /** managerName 不为 null：PATH 上的 omp 由别的管理者（如 Tern）管理，同一个弹窗，文案不同。 */
  | { action: "ask_takeover"; path: string; version: string | null; launchable: boolean; managerName: string | null }
  | { action: "unusable"; path: string };

/** 自管的 exe 是否由 omp-studio 声明管理（manager.json 里是 omp-studio）。 */
function isStudioManager(install: OmpInstall): boolean {
  return install.manager?.id === "omp-studio";
}

export function resolveOmp(input: ResolveInput): Decision {
  const { scan, state } = input;
  if (scan.kind === "none") return { action: "use_managed", reason: "missing" };

  // omp-studio 自己管理的直接用；onUserPath 由 manager.ts 补上。
  if (scan.kind === "exe" && isStudioManager(scan.install)) {
    return {
      action: "use",
      path: scan.install.path,
      version: scan.install.version,
      source: { kind: "studio_managed", onUserPath: true },
    };
  }

  // 用户自装的和别的管理者（如 Tern）管理的，都问一次要不要接管；回答按 exe 路径记。
  // 接管只是另装一份放到 PATH 最前，别人的目录和 manager.json 不碰；拒绝就照旧用它。
  const exePath = scan.kind === "exe" ? scan.install.path : scan.path;
  const managerName = scan.kind === "exe" ? (scan.install.manager?.name ?? null) : null;
  const answer = state.takeover[takeoverKey(exePath)];
  if (answer === "accepted") return { action: "use_managed", reason: "takeover" };
  if (answer === "declined") {
    if (scan.kind === "script") return { action: "unusable", path: scan.path };
    const source: OmpSource =
      managerName === null ? { kind: "user_installed" } : { kind: "managed_by_other", managerName };
    return { action: "use", path: scan.install.path, version: scan.install.version, source };
  }
  return {
    action: "ask_takeover",
    path: exePath,
    version: scan.kind === "exe" ? scan.install.version : null,
    launchable: scan.kind === "exe",
    managerName,
  };
}

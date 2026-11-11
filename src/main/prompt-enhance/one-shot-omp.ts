// 一次性 `omp -p` 调用用哪个 omp：和任务进程同一个（提示词优化、宠物起名和说话共用）。
// 未打包时调用方指定的环境变量（JSON `{command, args}`，同 STUDIO_TEST_COMMIT_OMP）可以指向假 omp。
import { app } from "electron";
import type { OmpCommand } from "../git/commit-message.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { parseTestOmpOverride, prependToPath } from "../omp/launch-args.ts";

export async function oneShotOmp(
  testOverrideEnv: "STUDIO_TEST_ENHANCE_OMP" | "STUDIO_TEST_PET_OMP",
): Promise<OmpCommand> {
  const override = app.isPackaged ? undefined : process.env[testOverrideEnv];
  if (override) {
    const parsed = parseTestOmpOverride(override);
    return { command: parsed.command, args: parsed.args, env: { ...process.env } };
  }
  const executable = await getOmpExecutable();
  return { command: executable.path, args: [], env: prependToPath({ ...process.env }, executable.managedBin) };
}

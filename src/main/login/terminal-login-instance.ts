// 应用内终端登录的单例和它的 Electron 接线：userData 下自己的临时 cwd、测试用假 omp、外观、事件出口、退出时关进程。
// 逻辑在 terminal-login.ts（不 import electron，单元测试直接实例化）。
import { app, nativeTheme } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { emitEvent } from "../ipc/events.ts";
import { buildTspLaunch } from "../omp/launch.ts";
import { parseTestOmpOverride } from "../omp/launch-args.ts";
import { serviceOmp } from "../service/service-omp.ts";
import { getSettings } from "../settings/settings-store.ts";
import { registerShutdownHook } from "../window/shutdown.ts";
import { TerminalLogin } from "./terminal-login.ts";

/**
 * 临时 omp 的工作目录：userData/login-cwd，不是任何项目或任务的目录（omp 在 cwd 里读项目配置和扩展，这里要一个什么都没有的地方）。
 * 只建目录，不放任何文件；omp 带 `--no-session`，也不会在里面或用户的会话目录里留会话。
 */
async function loginCwd(): Promise<string> {
  const cwd = path.join(app.getPath("userData"), "login-cwd");
  await mkdir(cwd, { recursive: true });
  return cwd;
}

let instance: TerminalLogin | null = null;

/** 单例；要在 app ready 之后调用（userData 路径）。 */
export function terminalLogin(): TerminalLogin {
  if (instance) return instance;
  instance = new TerminalLogin({
    providerIds: async () =>
      (await serviceOmp.use((connection) => connection.request("get_login_providers"))).providers.map(
        (provider) => provider.id,
      ),
    launch: async () => {
      const cwd = await loginCwd();
      // e2e：未打包时 STUDIO_TEST_LOGIN_OMP（JSON `{command, args}`，同 STUDIO_TEST_OMP）指向回放登录录制的假 omp。
      const override = app.isPackaged ? undefined : process.env["STUDIO_TEST_LOGIN_OMP"];
      if (override) {
        const parsed = parseTestOmpOverride(override);
        return { command: parsed.command, args: parsed.args, cwd, env: { ...process.env } };
      }
      // PI_CODING_AGENT_DIR 不动：登录就是要把凭据写进用户真实的 agent 目录，由 omp 自己写。
      return buildTspLaunch({ cwd, noSession: true });
    },
    appVersion: app.getVersion(),
    appearance: () => ({ dark: nativeTheme.shouldUseDarkColors, reduceMotion: getSettings().reduceMotion }),
    onBatch: (batch) => emitEvent("tspBatch", batch),
  });
  const login = instance;
  registerShutdownHook(() => login.shutdown());
  return login;
}

// 启动构建产物（先 npm run build）：Playwright 的 _electron.launch，userData 指到临时目录，和真实数据隔离。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..", "..");

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close(): Promise<void>;
}

export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-"));
  // 指向 Vite 开发服务器的变量会让应用去加载开发页面；e2e 只跑构建产物。
  const { ELECTRON_RENDERER_URL: _devUrl, ...baseEnv } = process.env;
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...baseEnv, STUDIO_USER_DATA: userDataDir, ...extraEnv },
  });
  const page = await app.firstWindow();
  return {
    app,
    page,
    userDataDir,
    async close() {
      await app.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

export const screenshotsDir = path.join(root, "screenshots");

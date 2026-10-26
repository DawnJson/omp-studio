// 打包后的应用能不能把窗口显示出来：启动可执行文件，等窗口显示并淡入（不透明度到 1），30 秒内没到就失败。
// e2e 跑的是未打包的 out/，只在打包版出现的问题测不到：Linux 打包版曾经一直不记 first-contentful-paint，
// 窗口永远透明（2026-10-26，见 docs/architecture/linux.md "启动时窗口一直透明"）。
// 窗口 ready-to-show 之前 getOpacity() 是默认的 1，所以只认显示着的窗口（和 test/e2e/tray.e2e.ts 一样）。
// 用法：node scripts/smoke-packaged.ts <可执行文件>（Linux 的 release/linux-unpacked/omp-studio、mac 的 .app/Contents/MacOS/omp-studio）
// 打包版不认 STUDIO_USER_DATA，用临时 HOME 隔开用户数据；只在 CI 上跑。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";

const [executable] = process.argv.slice(2);
if (executable === undefined) throw new Error("用法：node scripts/smoke-packaged.ts <可执行文件>");

const home = await mkdtemp(path.join(os.tmpdir(), "omp-studio-smoke-"));
try {
  const app = await electron.launch({ executablePath: path.resolve(executable), env: { ...process.env, HOME: home } });
  try {
    await app.firstWindow();
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            return window?.isVisible() ? window.getOpacity() : 0;
          }),
        { message: "窗口 30 秒内没有显示并淡入", timeout: 30_000 },
      )
      .toBe(1);
    console.log("打包后的应用：窗口已显示");
  } finally {
    await app.close();
  }
} finally {
  await rm(home, { recursive: true, force: true, maxRetries: 10 });
}

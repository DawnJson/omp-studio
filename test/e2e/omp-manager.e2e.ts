import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { findOmpOnPath, inspectOmp } from "../../src/main/omp/discover.ts";
import type { OmpStatus } from "../../src/shared/ipc.ts";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

async function localeAndTheme(page: Page, locale: "zh-CN" | "en", theme: "light" | "dark"): Promise<void> {
  await page.evaluate(
    async ({ locale: nextLocale, theme: nextTheme }) => {
      await globalThis.studio.setLocale(nextLocale);
      await globalThis.studio.setTheme(nextTheme);
    },
    { locale, theme },
  );
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** 测试用的 agent 目录：服务进程不读真实 ~/.omp（AGENTS.md "开发和测试时隔离用户数据"）。 */
async function launchIsolated(
  options: { askTakeover?: boolean } = {},
  extraEnv: Record<string, string> = {},
): Promise<{ launched: LaunchedApp; agentDir: string }> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  return { launched: await launchApp({ PI_CODING_AGENT_DIR: agentDir, ...extraEnv }, options), agentDir };
}

/** 渲染进程只认主进程推来的 ompStatus 事件，测试里用同一个通道推合成状态来截各个准备页。 */
async function pushStatus(launched: LaunchedApp, status: OmpStatus): Promise<void> {
  await launched.app.evaluate(({ BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("studio:event:ompStatus", payload);
  }, status);
}

test("PATH 上是 Tern 管理的 omp：问一次要不要接管，选继续用 Tern 的就直接用它", async () => {
  const onPath = await findOmpOnPath().catch(() => null);
  const install = onPath ? await inspectOmp(onPath) : null;
  test.skip(install?.manager?.id !== "tern", "这台机器 PATH 上第一个 omp 不是 Tern 管理的");
  const { launched, agentDir } = await launchIsolated({ askTakeover: true });
  try {
    const { page } = launched;
    await expect(page.getByTestId("omp-setup")).toHaveAttribute("data-state", "ask_takeover", { timeout: 30_000 });
    expect(await page.evaluate(() => globalThis.studio.getOmpStatus())).toMatchObject({
      state: "ask_takeover",
      path: onPath,
      managerName: "Tern",
      launchable: true,
    });
    await expect(page.getByTestId("takeover-no")).toContainText("Tern");
    await page.getByTestId("takeover-no").click();
    await expect(page.getByTestId("omp-setup")).toHaveCount(0);
    const status = await page.evaluate(() => globalThis.studio.getOmpStatus());
    expect(status).toMatchObject({
      state: "ready",
      path: onPath,
      source: { kind: "managed_by_other", managerName: "Tern" },
    });

    await page.keyboard.press("Control+,");
    await page.getByTestId("settings-nav-omp").click();
    await expect(page.getByTestId("omp-source")).toContainText("Tern");
    await expect(page.getByTestId("omp-path")).toHaveText(onPath ?? "");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("设置页和 omp 准备页截图：中英文 × 浅深主题", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("settings")).toBeVisible();

    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await localeAndTheme(page, locale, theme);
        for (const section of ["general", "models", "omp"] as const) {
          await page.getByTestId(`settings-nav-${section}`).click();
          if (section === "models") await expect(page.getByTestId("providers")).toBeVisible();
          // 模型与账号要等服务进程读完 provider 列表；读不出来时界面显示原因，同样截下来。
          if (section === "models") await page.waitForTimeout(4000);
          await page.screenshot({
            path: path.join(screenshotsDir, `omp-e-settings-${section}-${locale}-${theme}.png`),
          });
        }
      }
    }

    // 准备页的几个状态：按主进程会推的形状合成。
    const states: Record<string, OmpStatus> = {
      "takeover-exe": {
        state: "ask_takeover",
        path: "C:\\Users\\me\\AppData\\Local\\omp\\omp.exe",
        version: "18.8.7",
        launchable: true,
        managerName: null,
      },
      "takeover-script": {
        state: "ask_takeover",
        path: "C:\\Users\\me\\AppData\\Roaming\\npm\\omp.cmd",
        version: null,
        launchable: false,
        managerName: null,
      },
      "takeover-tern": {
        state: "ask_takeover",
        path: "C:\\Users\\me\\AppData\\Local\\Tern\\omp\\bin\\omp.exe",
        version: "18.12.1",
        launchable: true,
        managerName: "Tern",
      },
      installing: { state: "installing", version: "18.12.1", receivedBytes: 96_000_000, totalBytes: 222_742_016 },
      error: { state: "error", stage: "download", message: "build service answered 503" },
      unusable: { state: "unusable", path: "C:\\Users\\me\\AppData\\Roaming\\npm\\omp.cmd", reason: "script_launcher" },
      missing: { state: "missing", version: "18.12.1", sizeBytes: 222_742_016, source: "build.stencil.so" },
    };
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await localeAndTheme(page, locale, theme);
        for (const [name, status] of Object.entries(states)) {
          await pushStatus(launched, status);
          await expect(page.getByTestId("omp-setup")).toBeVisible();
          await page.screenshot({ path: path.join(screenshotsDir, `omp-e-setup-${name}-${locale}-${theme}.png`) });
        }
      }
    }
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("接管询问：同意/拒绝的按钮把回答发给主进程", async () => {
  // 构建服务指向没人监听的端口：ready 之后那次后台"检查更新"直接失败、不推状态，
  // 否则它的应答（真实的 ready）会盖掉下面推的合成状态，卡片在点击前就消失。
  const { launched, agentDir } = await launchIsolated({}, { PI_BUILD_URL: "http://127.0.0.1:9/" });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await pushStatus(launched, {
      state: "ask_takeover",
      path: "C:\\x\\omp.exe",
      version: "18.8.7",
      launchable: true,
      managerName: null,
    });
    await expect(page.getByTestId("takeover-no")).toBeFocused();
    // 主进程此刻没有在问（状态是合成的），应答被拒绝：界面不崩，卡片还在，等真实状态推来。
    await page.getByTestId("takeover-no").click();
    await expect(page.getByTestId("omp-setup")).toBeVisible();
    await pushStatus(launched, {
      state: "ready",
      source: { kind: "user_installed" },
      path: "C:\\x\\omp.exe",
      version: "18.12.0",
      belowMinimum: false,
      stagedUpdate: null,
    });
    await expect(page.getByTestId("omp-setup")).toHaveCount(0);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

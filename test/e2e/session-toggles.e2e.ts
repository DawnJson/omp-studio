// 输入框的"会话开关"菜单（spec 4.14）：fake-tsp-omp 回放 fixtures/tsp/status-toggles.jsonl（omp 18.12.5 的状态 toast 切换段）。
// 假 omp 只有收到和录制一样的 send 才继续，所以菜单点到哪一步、发出的命令文本对不对，靠"界面走得下去"和 --log 断言。
// 配置默认值（skillful 开、其余关、browser.headless 关 = 可见）由替换 getOmpConfig 给出，不依赖真实 omp。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, setLocaleTheme, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

interface Started {
  launched: LaunchedApp;
  sent(): Promise<string[]>;
  cleanup(): Promise<void>;
}

async function start(): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp toggles e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, "status-toggles", "--speed=20", `--log=${log}`],
    }),
  });
  await launched.app.evaluate(({ dialog, ipcMain }, dir) => {
    // 模型列表和角色表：smol 指 V4 Lite，Prewalk 一行才能写出"换成谁"、能点启用。
    const model = (modelId: string, name: string) => ({
      key: { provider: "deepseek", modelId },
      name,
      contextWindow: 128_000,
      reasoning: true,
      acceptsImages: false,
      maxTokens: null,
      thinkingEfforts: null,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    ipcMain.removeHandler("studio:listTaskModels");
    ipcMain.handle("studio:listTaskModels", () => [
      model("deepseek-v4-flash", "DeepSeek V4 Flash"),
      model("deepseek-v4-lite", "DeepSeek V4 Lite"),
    ]);
    ipcMain.removeHandler("studio:getModelRoles");
    ipcMain.handle("studio:getModelRoles", () => ({
      default: "deepseek/deepseek-v4-flash",
      smol: "deepseek/deepseek-v4-lite",
    }));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    const item = (key: string, value: unknown) => ({
      key,
      tab: "tools",
      type: typeof value === "boolean" ? "boolean" : "record",
      description: "",
      options: null,
      value,
      hasValue: true,
      redacted: false,
      defaultValue: value,
      hasDefault: true,
    });
    ipcMain.removeHandler("studio:getOmpConfig");
    ipcMain.handle("studio:getOmpConfig", () => ({
      ompVersion: "18.12.5",
      tabs: ["tools"],
      items: [
        item("skillful", true),
        item("extendedContext", false),
        item("computer.enabled", false),
        item("advisor.enabled", false),
        item("browser.headless", false),
        item("prewalk.enabled", false),
        item("modelPresets", {}),
      ],
    }));
  }, project);
  await launched.page.getByTestId("sidebar-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  return {
    launched,
    async sent() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as { kind: string; body?: { ev?: string; text?: string } })
        .filter((record) => record.kind === "tsp" && record.body?.ev === "send")
        .map((record) => record.body?.text ?? "");
    },
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

async function openMenu(page: Page): Promise<void> {
  await page.getByTestId("toggles-button").click();
  await expect(page.getByTestId("toggle-skillful")).toBeVisible();
}

test("会话开关：默认值补位；切换发 /命令，omp 的 toast 回来后标本会话、亮小圆点；/computer 开启先确认", async () => {
  test.setTimeout(120_000);
  const { launched, sent, cleanup } = await start();
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    await expect(page.getByTestId("toggles-button")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("toggles-button")).not.toHaveAttribute("data-differs", /.*/);
    await openMenu(page);

    // 没动过：显示配置默认值，没有"本会话"、没有圆点。
    await expect(page.getByTestId("toggle-skillful-switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("toggle-extendedContext-switch")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("toggle-skillful-session")).toHaveCount(0);
    await expect(page.getByTestId("toggle-skillful-dot")).toHaveCount(0);
    await expect(page.getByTestId("toggle-browser-mode").getByRole("radio", { name: /可见|Visible/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Skill 清单关掉：和默认（开）不同 → 圆点 + 本会话。
    await page.getByTestId("toggle-skillful-switch").click();
    await expect(page.getByTestId("toggle-skillful-switch")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("toggle-skillful-dot")).toBeVisible();
    await expect(page.getByTestId("toggle-skillful-session")).toBeVisible();
    await expect(page.getByTestId("toggles-button")).toHaveAttribute("data-differs", "true");

    // 扩展上下文开：同上。
    await page.getByTestId("toggle-extendedContext-switch").click();
    await expect(page.getByTestId("toggle-extendedContext-switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("toggle-extendedContext-dot")).toBeVisible();

    // 电脑操作：开启先确认；取消不发命令。
    await page.getByTestId("toggle-computer-switch").click();
    await expect(page.getByTestId("toggles-computer-confirm")).toBeVisible();
    await page.getByTestId("toggles-computer-confirm").getByRole("button").first().click();
    await expect(page.getByTestId("toggle-computer-switch")).toHaveAttribute("aria-checked", "false");
    expect(await sent()).toEqual(["/skillful off", "/extended-context on"]);
    // 再点、确认：发 /computer on。
    await page.getByTestId("toggle-computer-switch").click();
    await page.getByTestId("toggles-computer-confirm-yes").click();
    await expect(page.getByTestId("toggle-computer-switch")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("toggle-computer-dot")).toBeVisible();

    // 顾问。
    await page.getByTestId("toggle-advisor-switch").click();
    await expect(page.getByTestId("toggle-advisor-switch")).toHaveAttribute("aria-checked", "true");

    // 浏览器窗口：默认可见，点"后台"发 /browser headless，回来后标本会话、亮圆点。
    await page
      .getByTestId("toggle-browser-mode")
      .getByRole("radio", { name: /后台|Background/ })
      .click();
    await expect(
      page.getByTestId("toggle-browser-mode").getByRole("radio", { name: /后台|Background/ }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("toggle-browser-dot")).toBeVisible();
    expect(await sent()).toEqual([
      "/skillful off",
      "/extended-context on",
      "/computer on",
      "/advisor on",
      "/browser headless",
    ]);

    await shoot(page, "session-toggles");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toggle-skillful")).toHaveCount(0);

    // prewalk 在模型选择器里：写明从当前模型换到 smol 角色的哪个模型；单发动作，omp 的回话原样显示在下面。
    await page.getByTestId("model-chip").click();
    await expect(page.getByTestId("prewalk-plan")).toContainText("DeepSeek V4 Lite");
    await page.getByTestId("prewalk-arm").click();
    await expect(page.getByTestId("prewalk-reply")).toContainText("Prewalk: target");
    expect(await sent()).toEqual([
      "/skillful off",
      "/extended-context on",
      "/computer on",
      "/advisor on",
      "/browser headless",
      "/prewalk",
    ]);
    await shoot(page, "model-prewalk");
  } finally {
    await cleanup();
  }
});

async function shoot(page: Page, name: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["en", "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await setLocaleTheme(page, locale, scheme);
    await page.screenshot({ path: path.join(screenshotsDir, `${name}-${locale}-${scheme}.png`) });
  }
}

test("斜杠命令：/skillful 不带参数打开菜单，/computer on 打开确认，/prewalk 打开模型选择器，不直接发给 omp", async () => {
  test.setTimeout(90_000);
  const { launched, sent, cleanup } = await start();
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    await expect(page.getByTestId("toggles-button")).toBeVisible({ timeout: 30_000 });
    const input = page.getByTestId("composer-input");
    await input.fill("/skillful");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toggle-skillful")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toggle-skillful")).toHaveCount(0);
    await input.fill("/computer on");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toggles-computer-confirm")).toBeVisible();
    await page
      .getByTestId("toggles-computer-confirm")
      .getByRole("button", { name: /取消|Cancel/ })
      .click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("toggles-computer-confirm")).toHaveCount(0);
    await input.fill("/prewalk");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("model-prewalk")).toBeVisible();
    expect(await sent()).toEqual([]);
  } finally {
    await cleanup();
  }
});

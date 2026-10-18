// 设置页里 omp 的全部设置：真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR，不碰真实 ~/.omp。
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

async function launchIsolated(extraEnv: Record<string, string> = {}): Promise<{ launched: LaunchedApp; agentDir: string }> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir, ...extraEnv });
  await expect.poll(() => launched.page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), { timeout: 30_000 }).toBe("ready");
  await launched.page.setViewportSize({ width: 1200, height: 800 });
  await launched.page.keyboard.press("Control+,");
  await expect(launched.page.getByTestId("settings")).toBeVisible();
  return { launched, agentDir };
}

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

async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId("settings-search").fill(text);
}

async function configValue(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (wanted) => (await globalThis.studio.getOmpConfig()).items.find((item) => item.key === wanted)?.value, key);
}

test("改一项：已修改 + 已保存，值真的写进了 omp；恢复默认后回到默认值", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await search(page, "compaction.keepRecentTokens");
    const row = page.getByTestId("cfg-compaction.keepRecentTokens");
    await expect(row).toBeVisible();
    await expect(row.getByText("已修改")).toHaveCount(0);
    await row.getByRole("textbox").fill("12345");
    await expect(row.getByText("已保存")).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("已修改")).toBeVisible();
    expect(await configValue(page, "compaction.keepRecentTokens")).toBe(12345);

    await row.getByRole("button", { name: "恢复默认" }).click();
    await expect(row.getByText("已修改")).toHaveCount(0);
    expect(await configValue(page, "compaction.keepRecentTokens")).toBe(20000);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("纯键盘：Tab 到开关，空格切换，保存后"+"已修改"+"出现", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await search(page, "compaction.idleEnabled");
    const toggle = page.getByTestId("cfg-compaction.idleEnabled").getByRole("switch");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("cfg-compaction.idleEnabled").getByText("已修改")).toBeVisible({ timeout: 10_000 });
    expect(await configValue(page, "compaction.idleEnabled")).toBe(true);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("被环境变量覆盖：保存成功但提示实际生效的值来自环境变量；JSON 写错就地报错、不保存", async () => {
  const { launched, agentDir } = await launchIsolated({ HINDSIGHT_API_URL: "http://example.invalid:1" });
  try {
    const { page } = launched;
    await search(page, "hindsight.apiUrl");
    const row = page.getByTestId("cfg-hindsight.apiUrl");
    await row.getByRole("textbox").fill("http://localhost:9999");
    await expect(row.getByText(/覆盖/)).toContainText("HINDSIGHT_API_URL", { timeout: 10_000 });
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-overridden-zh-CN-light.png") });

    await search(page, "compaction.methodOrder");
    const json = page.getByTestId("cfg-compaction.methodOrder");
    await json.getByRole("textbox").fill('["remote",');
    await expect(json.getByRole("alert")).toContainText("JSON");
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-json-error-zh-CN-light.png") });
    // 没通过校验的内容不会被保存：值还是默认的数组。
    expect(await configValue(page, "compaction.methodOrder")).toEqual(["remote", "snapcompact", "handoff", "shake", "soft"]);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});


test("默认模型：getDefaultModel 返回 null 或 {key,name,thinkingLevel}，不抛错", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const model = await launched.page.evaluate(() => globalThis.studio.getDefaultModel());
    console.log("defaultModel", JSON.stringify(model));
    if (model !== null) expect(model).toMatchObject({ key: { provider: expect.any(String), modelId: expect.any(String) }, name: expect.any(String) });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("只是打开设置页、切分组、搜索、展开编辑器，不会写 omp 的配置", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await expect(page.getByTestId("settings-nav-cfg-model")).toBeVisible({ timeout: 30_000 });
    for (const tab of ["context", "model", "internal", "tasks"]) await page.getByTestId(`settings-nav-cfg-${tab}`).click();
    await search(page, "modelRoles");
    await expect(page.getByTestId("roles-editor")).toBeVisible();
    await search(page, "fallbackChains");
    await expect(page.getByTestId("chains-editor")).toBeVisible();
    await search(page, "compaction.methodOrder");
    await expect(page.getByTestId("cfg-compaction.methodOrder").getByRole("textbox")).toBeVisible();
    // 防抖和卸载时的提交都已经过去：没有"正在保存"。
    await page.waitForTimeout(2500);
    await expect(page.getByText("正在保存…")).toHaveCount(0);
    // omp 的配置文件（临时 agent 目录里）没有被写过：不存在，或者是空的。
    const written = await readFile(path.join(agentDir, "config.yml"), "utf8").catch(() => "");
    expect(written.trim()).toBe("");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("自定义下拉：键盘 ↑↓ 选择、首字母跳转、Esc 只关弹层；选中即写进 omp", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await search(page, "retry.fallbackOn");
    const combo = page.getByTestId("cfg-retry.fallbackOn").getByRole("combobox");
    await combo.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect.poll(() => configValue(page, "retry.fallbackOn"), { timeout: 10_000 }).toBe("usage-limit");
    // 首字母跳转到 except-usage-limit；Esc 关掉弹层但没有退出设置页。
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("e");
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-dropdown-zh-CN-light.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByTestId("settings")).toBeVisible();
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("模型角色：结构化编辑，不用手写 JSON", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await search(page, "modelRoles");
    const editor = page.getByTestId("roles-editor");
    await expect(editor).toBeVisible();
    await editor.getByRole("textbox").fill("plan");
    await editor.getByRole("button", { name: "添加" }).click();
    await expect(editor.locator(".se-name", { hasText: "plan" })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-roles-zh-CN-light.png") });
    expect(Object.keys((await configValue(page, "modelRoles")) as object)).toContain("plan");
    await search(page, "fallbackChains");
    await expect(page.getByTestId("chains-editor")).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-chains-zh-CN-light.png") });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("截图：omp 设置分组、搜索，中英文 × 浅深主题", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await expect(page.getByTestId("settings-nav-cfg-tasks")).toBeVisible({ timeout: 30_000 });
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await localeAndTheme(page, locale, theme);
        await search(page, "");
        for (const tab of ["tasks", "model", "internal"] as const) {
          await page.getByTestId(`settings-nav-cfg-${tab}`).click();
          await expect(page.locator(".cfg-row").first()).toBeVisible();
          await page.screenshot({ path: path.join(screenshotsDir, `omp-e-config-${tab}-${locale}-${theme}.png`) });
        }
        await search(page, locale === "zh-CN" ? "压缩" : "compaction");
        await expect(page.locator(".cfg-row").first()).toBeVisible();
        await page.screenshot({ path: path.join(screenshotsDir, `omp-e-config-search-${locale}-${theme}.png`) });
        await search(page, "zzzz-no-such-setting");
        await expect(page.getByText(locale === "zh-CN" ? "没有匹配" : "No settings match")).toBeVisible();
        await page.screenshot({ path: path.join(screenshotsDir, `omp-e-config-empty-${locale}-${theme}.png`) });
      }
    }
    // 窄窗口：分节列表收成一行，长文本不溢出。
    await localeAndTheme(page, "zh-CN", "light");
    await search(page, "");
    await page.getByTestId("settings-nav-cfg-internal").click();
    await page.setViewportSize({ width: 820, height: 800 });
    // 窄窗口侧栏是抽屉：如果开着，用顶栏按钮收起，免得挡住设置页。
    await page.waitForTimeout(400);
    if ((await page.getByTestId("app-root").getAttribute("data-sidebar")) === "shown") await page.getByTestId("topbar-sidebar").click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("settings")).toBeVisible();
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-narrow-zh-CN-light.png") });
    // 页面本身不横向溢出（长 key、长描述都要换行）。
    const overflow = await page.locator(".settings-scroll").evaluate((element) => {
      const size = element as unknown as { scrollWidth: number; clientWidth: number };
      return size.scrollWidth > size.clientWidth;
    });
    expect(overflow).toBe(false);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

// 设置页里 omp 的全部设置：真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR，不碰真实 ~/.omp。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, setLocaleTheme, type LaunchedApp } from "./launch.ts";

async function launchIsolated(
  extraEnv: Record<string, string> = {},
): Promise<{ launched: LaunchedApp; agentDir: string }> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-"));
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir, ...extraEnv });
  try {
    await expect
      .poll(() => launched.page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await launched.page.setViewportSize({ width: 1200, height: 800 });
    // omp 可能比界面先就绪：等 React 挂上（快捷键监听才在），再按 Ctrl ,。
    await expect(launched.page.getByTestId("app-root")).toBeVisible();
    await launched.page.keyboard.press("Control+,");
    await expect(launched.page.getByTestId("settings")).toBeVisible();
  } catch (error) {
    // 中途失败调用方拿不到 launched：在这里关掉应用、删掉目录，不留进程和临时目录。
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
  return { launched, agentDir };
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId("settings-search").fill(text);
}

async function configValue(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    async (wanted) => (await globalThis.studio.getOmpConfig()).items.find((item) => item.key === wanted)?.value,
    key,
  );
}

test("改一项：改过的标记 + 已保存，值真的写进了 omp；恢复默认后回到默认值", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await search(page, "compaction.keepRecentTokens");
    const row = page.getByTestId("cfg-compaction.keepRecentTokens");
    await expect(row).toBeVisible();
    const reset = page.getByTestId("cfg-compaction.keepRecentTokens-reset");
    await expect(reset).toHaveCount(0);
    await row.getByRole("textbox").fill("12345");
    await expect(row.getByText("已保存")).toBeVisible({ timeout: 10_000 });
    await expect(reset).toBeVisible();
    expect(await configValue(page, "compaction.keepRecentTokens")).toBe(12345);

    await reset.click();
    await expect(reset).toHaveCount(0);
    expect(await configValue(page, "compaction.keepRecentTokens")).toBe(20000);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("纯键盘：Tab 到开关，空格切换，保存后恢复默认图标出现", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await search(page, "compaction.idleEnabled");
    const toggle = page.getByTestId("cfg-compaction.idleEnabled").getByRole("switch");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("cfg-compaction.idleEnabled-reset")).toBeVisible({ timeout: 10_000 });
    expect(await configValue(page, "compaction.idleEnabled")).toBe(true);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("被环境变量覆盖：保存成功但提示实际生效的值来自环境变量；对象设置的 JSON 写错就地报错、不保存", async () => {
  const { launched, agentDir } = await launchIsolated({ HINDSIGHT_API_URL: "http://example.invalid:1" });
  try {
    const { page } = launched;
    await search(page, "hindsight.apiUrl");
    const row = page.getByTestId("cfg-hindsight.apiUrl");
    await row.getByRole("textbox").fill("http://localhost:9999");
    await expect(row.getByText(/覆盖/)).toContainText("HINDSIGHT_API_URL", { timeout: 10_000 });
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-overridden-zh-CN-light.png") });

    // 对象设置：行上是"编辑…"按钮，点开对话框里写 JSON，校验不过不能保存。
    await search(page, "compaction.modelThresholds");
    await page.getByTestId("cfg-compaction.modelThresholds").getByRole("button", { name: "编辑…" }).click();
    const dialog = page.getByTestId("cfg-json-dialog");
    await dialog.getByTestId("cfg-json-text").fill('{"a":');
    await expect(dialog.getByRole("alert")).toContainText("JSON");
    await expect(dialog.getByTestId("cfg-json-save")).toBeDisabled();
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-json-error-zh-CN-light.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    // 没通过校验的内容不会被保存：值还是默认的空对象。
    expect(await configValue(page, "compaction.modelThresholds")).toEqual({});
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
    if (model !== null)
      expect(model).toMatchObject({
        key: { provider: expect.any(String), modelId: expect.any(String) },
        name: expect.any(String),
      });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("只是打开设置页、切分组、搜索、展开编辑器，不会写 omp 的配置", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    await page.getByTestId("settings-nav-tools").click();
    await expect(page.locator(".ui-row").first()).toBeVisible({ timeout: 30_000 });
    for (const section of ["context", "tools", "agents", "advanced"])
      await page.getByTestId(`settings-nav-${section}`).click();
    await page.getByTestId("settings-nav-models").click();
    await search(page, "modelRoles");
    await page.getByTestId("cfg-modelRoles").getByRole("button", { name: "编辑…" }).click();
    await expect(page.getByTestId("roles-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await search(page, "fallbackChains");
    await page.getByTestId("cfg-retry.fallbackChains").getByRole("button", { name: "编辑…" }).click();
    await expect(page.getByTestId("chains-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await search(page, "compaction.methodOrder");
    await expect(page.getByTestId("cfg-compaction.methodOrder").getByRole("textbox")).toBeVisible();
    // 防抖和卸载时的提交都已经过去：没有"正在保存"。
    await page.waitForTimeout(2500);
    await expect(page.getByText("正在保存…")).toHaveCount(0);
    // omp 的配置文件（临时 agent 目录里）只有启动时的两项默认（goal.continuationModes 加上 rpc、startup.setupWizard 关掉），界面操作没有写别的。
    const written = await readFile(path.join(agentDir, "config.yml"), "utf8").catch(() => "");
    expect(written.replace(/\s+/g, " ").trim()).toBe(
      "goal: continuationModes: - interactive - rpc startup: setupWizard: false",
    );
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("自定义下拉：键盘 ↑↓ 选择、首字母跳转、Esc 只关弹层；选中即写进 omp", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    // retry.fallbackOn 的三个值有了短的中文名后变成分段控件；换一个选项多、值没有翻译的键。
    await search(page, "edit.mode");
    const combo = page.getByTestId("cfg-edit.mode").getByRole("combobox");
    await combo.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // omp 默认 hashline，弹层从当前值开始：下移一项是 patch。
    await expect.poll(() => configValue(page, "edit.mode"), { timeout: 10_000 }).toBe("patch");
    // 首字母跳转到 replace；Esc 关掉弹层但没有退出设置页。
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("r");
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
    // 快照要起一次 omp 才读得到：行上的"编辑…"按钮出现后点开对话框。
    await page.getByTestId("cfg-modelRoles").getByRole("button", { name: "编辑…" }).click({ timeout: 30_000 });
    const editor = page.getByTestId("roles-editor");
    // 快照要起一次 omp 才读得到（机器忙时远超 5 秒），和别的用例一样给读取留 30 秒。
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.getByRole("textbox").fill("plan");
    await editor.getByRole("button", { name: "添加" }).click();
    await expect(editor.locator(".se-name", { hasText: "plan" })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-config-roles-zh-CN-light.png") });
    expect(Object.keys((await configValue(page, "modelRoles")) as object)).toContain("plan");
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await search(page, "fallbackChains");
    await page.getByTestId("cfg-retry.fallbackChains").getByRole("button", { name: "编辑…" }).click();
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
    await page.getByTestId("settings-nav-agents").click();
    await expect(page.locator(".ui-row").first()).toBeVisible({ timeout: 30_000 });
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await setLocaleTheme(page, locale, theme);
        await search(page, "");
        for (const tab of ["agents", "models", "tools"] as const) {
          await page.getByTestId(`settings-nav-${tab}`).click();
          await expect(page.locator(".ui-row").first()).toBeVisible();
          await page.screenshot({ path: path.join(screenshotsDir, `omp-e-config-${tab}-${locale}-${theme}.png`) });
        }
        await search(page, locale === "zh-CN" ? "压缩" : "compaction");
        await expect(page.locator(".ui-row").first()).toBeVisible();
        await page.screenshot({ path: path.join(screenshotsDir, `omp-e-config-search-${locale}-${theme}.png`) });
        await search(page, "zzzz-no-such-setting");
        await expect(page.getByText(locale === "zh-CN" ? "没有匹配" : "No settings match")).toBeVisible();
        await page.screenshot({ path: path.join(screenshotsDir, `omp-e-config-empty-${locale}-${theme}.png`) });
      }
    }
    // 窄窗口：设置导航变成内容顶上的下拉，长文本不溢出。
    await setLocaleTheme(page, "zh-CN", "light");
    await search(page, "");
    await page.getByTestId("settings-nav-tools").click();
    await page.setViewportSize({ width: 820, height: 800 });
    // 窄窗口侧栏是抽屉：如果开着，用顶栏按钮收起，免得挡住设置页。
    await page.waitForTimeout(400);
    if ((await page.getByTestId("app-root").getAttribute("data-sidebar")) === "shown")
      await page.keyboard.press("Control+b");
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

test("通用页：通知与回顾是 omp 自己的设置、改了写进 omp；快捷键表多一组“omp 快捷键”并跟着 keybindings.yml 变；模型页有思考块开关", async () => {
  const { launched, agentDir } = await launchIsolated();
  try {
    const { page } = launched;
    // 用户在终端版的 omp 里改过键位：改了模型切换键，禁用了重试。
    await writeFile(
      path.join(agentDir, "keybindings.yml"),
      "# 我的键位\napp.model.cycleForward: Ctrl+Alt+M\napp.retry: []\n",
      "utf8",
    );
    // 切走再切回：通用页挂载时重读键位文件。
    await page.getByTestId("settings-nav-models").click();
    await page.getByTestId("settings-nav-general").click();
    await setLocaleTheme(page, "zh-CN", "light");

    const notify = page.getByTestId("notify-settings");
    for (const key of ["ask.notify", "completion.notify", "error.notify", "recap.enabled", "recap.idleSeconds"])
      await expect(notify.getByTestId(`cfg-${key}`)).toBeVisible({ timeout: 30_000 });
    await expect(notify.getByTestId("setting-sound-on-done")).toBeVisible();
    // studio 自己的"有任务在等你时通知我"开关已经去掉：通知只看 omp 的设置。
    await expect(page.getByTestId("setting-notify")).toHaveCount(0);
    expect(await configValue(page, "error.notify")).toBe("off");
    await notify.getByTestId("cfg-error.notify").getByRole("radio", { name: "开启" }).click();
    await expect.poll(() => configValue(page, "error.notify"), { timeout: 10_000 }).toBe("on");

    const shortcuts = page.getByTestId("omp-shortcuts");
    await expect(shortcuts.getByTestId("omp-shortcut-app.model.cycleForward").locator("kbd")).toHaveText([
      "Ctrl",
      "Alt",
      "M",
    ]);
    await expect(shortcuts.getByTestId("omp-shortcut-app.thinking.cycle").locator("kbd")).toHaveText(["Shift", "Tab"]);
    await expect(shortcuts.getByTestId("omp-shortcut-app.retry")).toHaveCount(0);
    await expect(page.locator("#settings-shortcuts")).toContainText("omp 快捷键");
    for (const locale of ["zh-CN", "en"] as const) {
      for (const theme of ["light", "dark"] as const) {
        await setLocaleTheme(page, locale, theme);
        await page.locator("#settings-shortcuts").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(screenshotsDir, `omp-e-shortcuts-${locale}-${theme}.png`) });
        await notify.scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(screenshotsDir, `omp-e-notify-${locale}-${theme}.png`) });
      }
    }

    // 模型页：思考块的两个开关（TSP 下实测起作用，docs/architecture/omp-settings.md）。
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("cfg-hideThinkingBlock")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("cfg-expandThinkingBlocks")).toBeVisible();
    await page.getByTestId("cfg-expandThinkingBlocks").getByRole("switch").click();
    await expect.poll(() => configValue(page, "expandThinkingBlocks"), { timeout: 10_000 }).toBe(true);
    await page.screenshot({ path: path.join(screenshotsDir, "omp-e-thinking-blocks-zh-CN-light.png") });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

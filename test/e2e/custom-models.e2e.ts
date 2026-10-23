// 设置 → 模型与账号 → 自定义提供商（阶段 2.6）：添加（含一键拉取、勾选、手动添加）→ 编辑 → 删除，直接改 models.yml。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR + 本地假的 OpenAI 兼容服务；不连任何真实服务。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeOpenAi } from "../fake-openai/server.ts";
import { launchApp, screenshotsDir, setLocaleTheme, type LaunchedApp } from "./launch.ts";

const SECRET = "sk-fake-e2e-secret";

async function screenshots(page: Page, name: string, target = page.getByTestId("custom-providers")): Promise<void> {
  for (const locale of ["zh-CN", "en"] as const) {
    for (const theme of ["light", "dark"] as const) {
      await setLocaleTheme(page, locale, theme);
      await target.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(screenshotsDir, `custom-models-${name}-${locale}-${theme}.png`) });
    }
  }
}

async function launchSettings(): Promise<{ launched: LaunchedApp; agentDir: string }> {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio 代理 agent-"));
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    await expect
      .poll(() => launched.page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await launched.page.setViewportSize({ width: 1200, height: 900 });
    // omp 可能比界面先就绪：等 React 挂上（快捷键监听才在），再按 Ctrl ,。
    await expect(launched.page.getByTestId("app-root")).toBeVisible();
    await launched.page.keyboard.press("Control+,");
    await expect(launched.page.getByTestId("settings")).toBeVisible();
    await launched.page.getByTestId("settings-nav-providers").click();
  } catch (error) {
    // 中途失败调用方拿不到 launched：在这里关掉应用、删掉目录，不留进程和临时目录。
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
  return { launched, agentDir };
}

test("自定义提供商：添加（拉取、勾选、手动添加）→ 新模型出现在 omp 的模型列表 → 编辑 → 删除；注释和其它 provider 原样保留", async () => {
  const fake = await startFakeOpenAi({ apiKey: SECRET, models: ["fake-chat", "fake-mini", "fake-extra"] });
  const { launched, agentDir } = await launchSettings();
  const file = path.join(agentDir, "models.yml");
  try {
    const { page } = launched;
    await writeFile(
      file,
      "# 我自己的模型配置\nproviders:\n  # 本地的\n  other-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: keep-me # 别动\n",
      "utf8",
    );
    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-providers").click();
    await setLocaleTheme(page, "zh-CN", "light");

    const card = page.getByTestId("custom-providers");
    await expect(card.getByTestId("custom-provider-other-local")).toBeVisible();

    // 添加：先拉取（key 错 → 看得见的错误），改对后拉取成功。
    await page.getByTestId("custom-add").click();
    const form = page.getByTestId("custom-provider-form");
    await expect(form).toBeVisible();
    await page.getByTestId("custom-id").fill("fake-proxy");
    await page.getByTestId("custom-base-url").fill(fake.baseUrl);
    await page.getByTestId("custom-key").fill("wrong-key");
    await expect(page.getByTestId("custom-key")).toHaveAttribute("type", "password");
    await page.getByTestId("custom-fetch").click();
    await expect(page.getByTestId("custom-fetch-notice")).toContainText("拒绝");
    await expect(page.getByTestId("custom-fetch-notice")).toHaveAttribute("role", "alert");

    await page.getByTestId("custom-key").fill(SECRET);
    await page.getByTestId("custom-key-toggle").click();
    await expect(page.getByTestId("custom-key")).toHaveAttribute("type", "text");
    await page.getByTestId("custom-fetch").click();
    await expect(page.getByTestId("custom-model-fake-chat")).toBeVisible();
    await expect(page.getByTestId("custom-model-fake-chat")).not.toBeChecked();
    await expect(page.getByTestId("custom-selected-count")).toContainText("0 / 3");
    await expect(page.getByTestId("custom-save")).toBeDisabled(); // 一个都没勾

    await page.getByTestId("custom-model-fake-chat").check();
    await page.getByTestId("custom-model-fake-mini").check();
    await page.getByTestId("custom-manual-model").fill("manual-x");
    await page.getByTestId("custom-manual-model").press("Enter");
    await expect(page.getByTestId("custom-model-manual-x")).toBeChecked();
    await expect(page.getByTestId("custom-selected-count")).toContainText("3 / 4");
    await screenshots(page, "form", form);

    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("custom-save").click();
    await expect(form).toHaveCount(0);
    const row = page.getByTestId("custom-provider-fake-proxy");
    await expect(row).toContainText("3 个模型");
    await expect(row).toContainText("已设置 key");
    // 界面上任何地方都看不到 key。
    expect(await page.locator("body").innerText()).not.toContain(SECRET);

    // 文件：新条目写进去，注释和别的 provider 原样。
    const written = await readFile(file, "utf8");
    expect(written).toContain("# 我自己的模型配置");
    expect(written).toContain("# 本地的");
    expect(written).toContain("# 别动");
    expect(written).toContain("other-local:");
    expect(written).toContain(`apiKey: ${SECRET}`);
    expect(written).toContain("- id: manual-x");

    // 新模型出现在 omp 的模型列表里（服务进程已重启）。
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            globalThis.studio
              .listModels()
              .then((models) =>
                models.filter((model) => model.key.provider === "fake-proxy").map((model) => model.key.modelId),
              ),
          ),
        { timeout: 30_000 },
      )
      .toEqual(["fake-chat", "fake-mini", "manual-x"]);
    // 默认模型下拉（"模型"一节）里能搜到它（下拉按 provider 折叠，搜索时匹配的组都展开）。
    // 模型列表是保存后异步重读的；重读完成前下拉里还是旧的，所以整段重试。
    await page.getByTestId("settings-nav-models").click();
    await expect(async () => {
      if (await page.getByRole("listbox").isVisible()) await page.keyboard.press("Escape");
      await page.getByTestId("setting-default-model").click();
      await page.getByTestId("setting-default-model-search").fill("manual");
      await expect(page.getByRole("listbox")).toContainText("manual-x", { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.getByTestId("settings-nav-providers").click();
    await screenshots(page, "list");

    // 编辑：取消勾选手动添加的那个，key 保持不变。
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("custom-edit-fake-proxy").click();
    await expect(page.getByTestId("custom-id")).toBeDisabled();
    await expect(page.getByTestId("custom-model-manual-x")).toBeChecked();
    await page.getByTestId("custom-model-manual-x").uncheck();
    await page.getByTestId("custom-save").click();
    await expect(form).toHaveCount(0);
    await expect(row).toContainText("2 个模型");
    const edited = await readFile(file, "utf8");
    expect(edited).not.toContain("manual-x");
    expect(edited).toContain(`apiKey: ${SECRET}`);
    expect(edited).toContain("# 别动");

    // 校验错误显示在表单里：Base URL 不是 http(s)。
    await page.getByTestId("custom-edit-fake-proxy").click();
    await page.getByTestId("custom-base-url").fill("ftp://example.com");
    await page.getByTestId("custom-save").click();
    await expect(page.getByTestId("custom-save-error")).toContainText("http");
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(page.getByTestId("settings")).toBeVisible(); // Esc 只关了表单

    // 删除：先取消，再确认。
    await page.getByTestId("custom-more-fake-proxy").click();
    await page.getByTestId("custom-delete-fake-proxy").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click();
    await expect(row).toBeVisible();
    await page.getByTestId("custom-more-fake-proxy").click();
    await page.getByTestId("custom-delete-fake-proxy").click();
    await page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
    await expect(row).toHaveCount(0);
    const after = await readFile(file, "utf8");
    expect(after).not.toContain("fake-proxy");
    expect(after).toContain("# 我自己的模型配置");
    expect(after).toContain("keep-me # 别动");
  } finally {
    await launched.close();
    await fake.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("自定义提供商：自动发现模型——开关写 discovery、不用勾模型；omp 读到 /models 里的模型；刷新模型按钮跑通；关掉后去掉 discovery", async () => {
  const fake = await startFakeOpenAi({ models: ["disc-a", "disc-b"] });
  const { launched, agentDir } = await launchSettings();
  const file = path.join(agentDir, "models.yml");
  try {
    const { page } = launched;
    await writeFile(
      file,
      "# 我自己的模型配置\nproviders:\n  # 本地的\n  other-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: keep-me # 别动\n",
      "utf8",
    );
    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-providers").click();
    await setLocaleTheme(page, "zh-CN", "light");
    await expect(page.getByTestId("custom-provider-other-local")).toBeVisible();

    await page.getByTestId("custom-add").click();
    const form = page.getByTestId("custom-provider-form");
    await expect(form).toBeVisible();
    await page.getByTestId("custom-id").fill("fake-disco");
    await page.getByTestId("custom-base-url").fill(fake.baseUrl);
    await page.getByTestId("custom-key-mode-none").click();
    // 没勾任何模型、也没开自动发现：不能保存；打开开关后可以。
    await expect(page.getByTestId("custom-save")).toBeDisabled();
    await page.getByTestId("custom-discovery").click();
    await expect(page.getByTestId("custom-discovery")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("custom-save")).toBeEnabled();
    await screenshots(page, "form-discovery", form);
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("custom-save").click();
    await expect(form).toHaveCount(0);
    await expect(page.getByTestId("custom-provider-fake-disco")).toContainText("运行时发现模型");

    // 文件：只加了 fake-disco 这一层，里面是默认的 discovery.type；别的内容原样。
    const written = await readFile(file, "utf8");
    expect(written).toContain("# 我自己的模型配置");
    expect(written).toContain("# 本地的");
    expect(written).toContain("keep-me # 别动");
    expect(written).toMatch(/fake-disco:[\s\S]*discovery:\s+type: openai-models-list/);
    expect(written).not.toContain("- id: disc-a"); // 发现的模型不写进文件

    // omp 重新加载后从假服务的 /models 读到模型。
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            globalThis.studio
              .listModels()
              .then((models) =>
                models.filter((model) => model.key.provider === "fake-disco").map((model) => model.key.modelId),
              ),
          ),
        { timeout: 30_000 },
      )
      .toEqual(["disc-a", "disc-b"]);

    // 刷新模型：omp models refresh 跑完、给出提示。
    await page.getByTestId("custom-refresh").click();
    await expect(page.getByText("已刷新模型目录")).toBeVisible({ timeout: 90_000 });
    await screenshots(page, "list-discovery");

    // 编辑：开关是开的；关掉并勾选一个模型再保存 → discovery 去掉，别的内容不动。
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("custom-edit-fake-disco").click();
    await expect(page.getByTestId("custom-discovery")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("custom-discovery").click();
    await expect(page.getByTestId("custom-save")).toBeDisabled(); // 没有模型、也没开发现
    await page.getByTestId("custom-manual-model").fill("manual-only");
    await page.getByTestId("custom-manual-model").press("Enter");
    await page.getByTestId("custom-save").click();
    await expect(form).toHaveCount(0);
    const off = await readFile(file, "utf8");
    expect(off).not.toContain("discovery:");
    expect(off).toContain("- id: manual-only");
    expect(off).toContain("keep-me # 别动");
  } finally {
    await launched.close();
    await fake.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("自定义提供商：读不懂的 models.yml 显示错误，不覆盖文件", async () => {
  const { launched, agentDir } = await launchSettings();
  try {
    const { page } = launched;
    await writeFile(path.join(agentDir, "models.yml"), "providers: [1, 2", "utf8");
    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-providers").click();
    await setLocaleTheme(page, "en", "light");
    await expect(page.getByTestId("custom-load-failed")).toBeVisible();
    await expect(page.getByTestId("custom-add")).toBeDisabled();
    expect(await readFile(path.join(agentDir, "models.yml"), "utf8")).toBe("providers: [1, 2");
    await page.screenshot({ path: path.join(screenshotsDir, "custom-models-unreadable-en-light.png") });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

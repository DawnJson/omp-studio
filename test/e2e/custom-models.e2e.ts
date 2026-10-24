// 设置 → 模型与账号 → 自定义提供商（阶段 2.6）：添加（含一键拉取、勾选、手动添加）→ 编辑 → 删除，直接改 models.yml。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR + 本地假的 OpenAI 兼容服务；不连任何真实服务。
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { startFakeOpenAi } from "../fake-openai/server.ts";
import { expectNoOverflow, launchApp, setLocaleTheme, type LaunchedApp } from "./launch.ts";

const SECRET = "sk-fake-e2e-secret";

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
    // 接口类型的下拉在对话框里能选（列表挂在 body 上，层级要在遮罩之上）：换成 Responses 再换回来。
    const api = page.getByTestId("custom-api");
    await api.click();
    await page.getByTestId("custom-api-list").getByRole("option").nth(1).click();
    await expect(api).toHaveAttribute("aria-expanded", "false");
    await expect(form).toBeVisible();
    await expect(api).toContainText("Responses");
    await api.click();
    await page.getByTestId("custom-api-list").getByRole("option").first().click();
    await expect(api).not.toContainText("Responses");
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

test("只覆盖内置 provider 的条目（anthropic 下只有 modelOverrides）：卡片上能设置 / 清除 key，覆盖项原样，omp 真的用这个 key", async () => {
  const { launched, agentDir } = await launchSettings();
  const file = path.join(agentDir, "models.yml");
  // 真实 omp 认的 anthropic 凭据：models.yml 的 apiKey 优先于订阅和凭据库（docs/architecture/custom-models.md）。
  const ompToken = () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
    delete env["ANTHROPIC_API_KEY"];
    delete env["ANTHROPIC_OAUTH_TOKEN"];
    try {
      return execFileSync("omp", ["token", "anthropic"], { env, encoding: "utf8", windowsHide: true }).trim();
    } catch {
      return null;
    }
  };
  try {
    const { page } = launched;
    await writeFile(
      file,
      "providers:\n  anthropic:\n    # 上下文窗口\n    modelOverrides:\n      claude-opus-5:\n        contextWindow: 1000000\n",
      "utf8",
    );
    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-providers").click();
    await setLocaleTheme(page, "zh-CN", "light");

    const row = page.getByTestId("custom-provider-anthropic");
    await expect(row).toContainText("覆盖内置 provider · 未设置 key");
    // 编辑表单存不了这种条目（要 Base URL 和模型）：不给"编辑"。
    await expect(row.getByTestId("custom-edit-anthropic")).toHaveCount(0);

    await row.getByTestId("custom-key-anthropic").click();
    const dialog = page.getByTestId("custom-key-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("custom-key-save")).toBeDisabled();
    await dialog.getByTestId("custom-key-dialog-value").fill("sk-ant-e2e-key");
    await page.getByTestId("custom-key-save").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("toasts").getByText("key 已保存")).toBeVisible();
    await expect(row).toContainText("已设置 key");
    await expect(row.getByTestId("custom-key-anthropic")).toHaveText("更换 key");
    const saved = await readFile(file, "utf8");
    expect(saved).toContain("apiKey: sk-ant-e2e-key");
    expect(saved).toContain("# 上下文窗口");
    expect(saved).toContain("contextWindow: 1000000");
    expect(ompToken()).toBe("sk-ant-e2e-key");

    await page.getByTestId("custom-more-anthropic").click();
    await page.getByTestId("custom-clear-key-anthropic").click();
    await expect(row).toContainText("未设置 key");
    const cleared = await readFile(file, "utf8");
    expect(cleared).not.toContain("apiKey");
    expect(cleared).toContain("contextWindow: 1000000");
    expect(ompToken()).not.toBe("sk-ant-e2e-key");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("自定义提供商：模型行里设思考、图片输入、上下文窗口、最大输出 → 写进 models.yml、omp 采用；自动的格子显示 omp 补的值", async () => {
  const fake = await startFakeOpenAi({ models: ["house-model", "house-plain"] });
  const { launched, agentDir } = await launchSettings();
  const file = path.join(agentDir, "models.yml");
  try {
    const { page } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("custom-add").click();
    await page.getByTestId("custom-id").fill("meta-proxy");
    await page.getByTestId("custom-base-url").fill(fake.baseUrl);
    await page.getByTestId("custom-key-mode-none").click();
    await page.getByTestId("custom-fetch").click();
    // 没勾选的模型行里没有参数控件；勾上才出现。
    await expect(page.getByTestId("custom-model-house-model")).toBeVisible();
    await expect(page.getByTestId("custom-model-contextWindow-house-model")).toHaveCount(0);
    await page.getByTestId("custom-model-house-model").check();
    await page.getByTestId("custom-model-house-plain").check();

    for (const column of ["reasoning", "images"]) {
      await page.getByTestId(`custom-model-${column}-house-model`).click();
      await page
        .getByTestId(`custom-model-${column}-house-model-list`)
        .getByRole("option", { name: "支持", exact: true })
        .click();
    }
    const context = page.getByTestId("custom-model-contextWindow-house-model");
    // 写不成 token 数的不能保存。
    await context.fill("很大");
    await expect(context).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("custom-save")).toBeDisabled();
    await context.fill("272k");
    await page.getByTestId("custom-model-maxTokens-house-model").fill("32,000");
    await page.getByTestId("custom-save").click();
    await expect(page.getByTestId("custom-provider-form")).toHaveCount(0);

    const written = await readFile(file, "utf8");
    expect(written).toContain("reasoning: true");
    expect(written).toContain("input: [ text, image ]");
    expect(written).toContain("contextWindow: 272000");
    expect(written).toContain("maxTokens: 32000");
    // 全是"自动"的模型只写 id。
    expect(written).toMatch(/- id: house-plain\s*$/);

    // omp 采用了写进去的值；house-plain 用 omp 的默认。
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            globalThis.studio
              .listModels()
              .then((models) =>
                models
                  .filter((model) => model.key.provider === "meta-proxy")
                  .map((model) => [
                    model.key.modelId,
                    model.reasoning,
                    model.acceptsImages,
                    model.contextWindow,
                    model.maxTokens,
                  ]),
              ),
          ),
        { timeout: 30_000 },
      )
      .toEqual([
        ["house-model", true, true, 272000, 32000],
        ["house-plain", false, false, 128000, 16384],
      ]);

    // 再打开：写过的显示原值；自动的格子后面是 omp 现在用的值。
    await page.getByTestId("custom-edit-meta-proxy").click();
    await expect(page.getByTestId("custom-model-contextWindow-house-model")).toHaveValue("272000");
    await expect(page.getByTestId("custom-model-reasoning-house-model")).toContainText("支持");
    await expect(page.getByTestId("custom-model-contextWindow-house-plain")).toHaveAttribute(
      "placeholder",
      "自动 · 128K",
    );
    await expect(page.getByTestId("custom-model-reasoning-house-plain")).toContainText("自动 · 不支持");
    await expectNoOverflow(page.getByTestId("custom-provider-form"));

    // 换回自动 → 这一项从文件里去掉。
    await page.getByTestId("custom-model-contextWindow-house-model").fill("");
    await page.getByTestId("custom-save").click();
    await expect(page.getByTestId("custom-provider-form")).toHaveCount(0);
    const cleared = await readFile(file, "utf8");
    expect(cleared).not.toContain("contextWindow");
    expect(cleared).toContain("maxTokens: 32000");
  } finally {
    await launched.close();
    await fake.close();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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

test("自定义提供商：环境变量形式的 key——models.yml 只写变量名，key 写进 agent 目录的 .env；删除后没人用的那一行也删掉，别的行原样", async () => {
  const fake = await startFakeOpenAi({ apiKey: SECRET, models: ["fake-chat"] });
  const { launched, agentDir } = await launchSettings();
  const file = path.join(agentDir, "models.yml");
  const envFile = path.join(agentDir, ".env");
  try {
    const { page } = launched;
    await writeFile(envFile, "# 我的 key\r\nHF_TOKEN=hf-keep\r\n", "utf8");
    await page.getByTestId("settings-nav-general").click();
    await page.getByTestId("settings-nav-providers").click();
    await setLocaleTheme(page, "zh-CN", "light");

    await page.getByTestId("custom-add").click();
    const form = page.getByTestId("custom-provider-form");
    await page.getByTestId("custom-id").fill("env-proxy");
    await page.getByTestId("custom-base-url").fill(fake.baseUrl);
    await page.getByTestId("custom-key-mode-env").click();
    await page.getByTestId("custom-key").fill("Pro_E2E_KEY");
    const value = page.getByTestId("custom-key-env-value");
    await expect(value).toHaveAttribute("type", "password");
    await value.fill(SECRET);
    // 拉取用刚填的值（还没写进 .env）。
    await page.getByTestId("custom-fetch").click();
    await page.getByTestId("custom-model-fake-chat").check();
    await page.getByTestId("custom-save").click();
    await expect(form).toHaveCount(0);

    const row = page.getByTestId("custom-provider-env-proxy");
    await expect(row).toContainText("环境变量 Pro_E2E_KEY（.env）");
    expect(await page.locator("body").innerText()).not.toContain(SECRET);
    const yml = await readFile(file, "utf8");
    expect(yml).toContain("apiKey: Pro_E2E_KEY");
    expect(yml).not.toContain(SECRET);
    expect(await readFile(envFile, "utf8")).toBe(`# 我的 key\r\nHF_TOKEN=hf-keep\r\nPro_E2E_KEY=${SECRET}\r\n`);

    // 编辑：变量名没改时值框提示“已写在 .env 里”，留空保存不动 .env。
    await page.getByTestId("custom-edit-env-proxy").click();
    await expect(page.getByTestId("custom-key")).toHaveValue("Pro_E2E_KEY");
    await expect(page.getByTestId("custom-key-env-value")).toHaveAttribute(
      "placeholder",
      "已写在 .env 里，留空保持不变",
    );
    await page.getByTestId("custom-save").click();
    await expect(form).toHaveCount(0);
    expect(await readFile(envFile, "utf8")).toContain(`Pro_E2E_KEY=${SECRET}`);

    await page.getByTestId("custom-more-env-proxy").click();
    await page.getByTestId("custom-delete-env-proxy").click();
    await expect(page.getByRole("alertdialog")).toContainText(".env");
    await page.getByRole("alertdialog").getByRole("button", { name: "删除" }).click();
    await expect(row).toHaveCount(0);
    expect(await readFile(envFile, "utf8")).toBe("# 我的 key\r\nHF_TOKEN=hf-keep\r\n");
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
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

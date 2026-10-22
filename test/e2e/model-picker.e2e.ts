// 模型选择对话框的角色范围：给非 default 角色指定模型，写进 omp 的 modelRoles（持久化），重新打开能看到徽标。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR，里面一个 auth: none 的本地 provider 提供两个模型；不连任何真实服务。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, setLocaleTheme } from "./launch.ts";

const modelsYml =
  "providers:\n  role-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: role-one\n      - id: role-two\n";

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId("model-chip").click();
  await expect(page.getByTestId("model-picker")).toBeVisible();
}

async function roles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => globalThis.studio.getModelRoles(null));
}

test("角色范围：选 Task 再选模型，modelRoles.task 写入 omp 配置，default 不动；重新打开有 task 徽标", async () => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-roles-"));
  await writeFile(path.join(agentDir, "models.yml"), modelsYml, "utf8");
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.setViewportSize({ width: 1200, height: 900 });
    await openPicker(page);

    // 左栏"角色"：omp 的 7 个内置角色各一行，默认在给 default 选（顶栏没有角色标记）。
    await page.getByTestId("model-scope-roles").click();
    await expect(page.getByTestId("model-scope-roles")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("model-role-option")).toHaveCount(7);
    await expect(page.getByTestId("model-role-target")).toHaveCount(0);

    // 角色范围里搜索框过滤角色，Enter 切到它：回到全部模型，顶栏写明在给 Task 选，并说明用途。
    await page.getByTestId("model-search").fill("task");
    await expect(page.getByTestId("model-role-option")).toHaveCount(1);
    await page.getByTestId("model-search").press("Enter");
    await expect(page.getByTestId("model-role-target")).toContainText("Task");
    await expect(page.getByTestId("model-scope-all")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("model-role-use")).toBeVisible();

    // 点模型 = 给 task 指定它。
    await page.getByTestId("model-search").fill("role-two");
    const option = page.getByTestId("model-option").first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await option.click();
    await expect.poll(async () => (await roles(page))["task"], { timeout: 30_000 }).toBe("role-local/role-two");
    expect((await roles(page))["default"]).toBeUndefined();
    await expect(option.getByTestId("model-role-badge")).toHaveText("task");

    // 顶栏的 × 改回给 default 选。
    await page.getByTestId("model-role-clear").click();
    await expect(page.getByTestId("model-role-target")).toHaveCount(0);

    // 关掉再打开：徽标还在、角色行写着它的模型（读的是 omp 里持久化的值）。
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("model-picker")).toHaveCount(0);
    await openPicker(page);
    await page.getByTestId("model-search").fill("role-two");
    await expect(page.getByTestId("model-option").first().locator('[data-role="task"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("model-search").fill("");
    await page.getByTestId("model-scope-roles").click();
    await expect(page.locator('[data-testid="model-role-option"][data-role="task"]')).toContainText("role-two");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

const tableModelsYml =
  "providers:\n  table-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: table-one\n        contextWindow: 1000000\n";

test("模型选择对话框：一张表、底部是生效模型的参数（窗口、速度）；Tab 在框内循环；搜索过滤；@ 列角色；Esc 后焦点回到胶囊；截图", async () => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-picker-"));
  await writeFile(path.join(agentDir, "models.yml"), tableModelsYml, "utf8");
  await writeFile(path.join(agentDir, "config.yml"), "modelRoles:\n  default: table-local/table-one\n", "utf8");
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.setViewportSize({ width: 1200, height: 900 });
    const chip = page.getByTestId("model-chip");
    await chip.click();
    const picker = page.getByTestId("model-picker");
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("model-search")).toBeFocused();
    // 一张表：没有 provider 组头，行直接可见；底部是正在生效的模型的参数（照终端版 omp）。
    await expect(page.getByTestId("model-option").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("model-details")).toContainText("1M");
    await expect(page.getByTestId("model-speed").first()).not.toHaveText("…");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(
          `(() => document.querySelector('[data-testid="model-picker"]')?.contains(document.activeElement) === true)()`,
        ),
      ).toBe(true);
    }
    // 搜索过滤：不存在的词没有结果，清空后恢复。
    await page.getByTestId("model-search").fill("zzz-no-such-model");
    await expect(page.getByTestId("model-option")).toHaveCount(0);
    await page.getByTestId("model-search").fill("");
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    // 左栏的提供商（真实 omp 还会列它自带的几个）：只列它的模型；只有正在生效的模型所在的提供商带点。
    const provider = page.getByTestId("model-scope-provider").filter({ hasText: "table-local" });
    await expect(provider).toHaveCount(1);
    await expect(page.locator('[data-testid="model-picker"] .mp-scope-dot')).toHaveCount(1);
    await expect(provider.locator(".mp-scope-dot")).toHaveCount(1);
    await provider.click();
    await expect(provider).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("model-option")).toHaveCount(1);
    await page.getByTestId("model-scope-all").click();
    // @ 开头列角色（每个角色一行，带绑定的模型），清空后回到模型表。
    await page.getByTestId("model-search").fill("@");
    await expect(page.getByTestId("model-role-option").first()).toBeVisible();
    await expect(page.getByTestId("model-option")).toHaveCount(0);
    await page.getByTestId("model-search").fill("");
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    await page.getByTestId("model-search").focus();
    for (const [locale, scheme] of [
      ["zh-CN", "light"],
      ["zh-CN", "dark"],
      ["en", "light"],
      ["en", "dark"],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await setLocaleTheme(page, locale, scheme);
      await page.screenshot({ path: path.join(screenshotsDir, `main-model-picker-${locale}-${scheme}.png`) });
    }
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(chip).toBeFocused();
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

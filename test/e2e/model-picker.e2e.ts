// 模型选择对话框的角色标签：给非 default 角色指定模型，写进 omp 的 modelRoles（持久化），重新打开能看到徽标。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR，里面一个 auth: none 的本地 provider 提供两个模型；不连任何真实服务。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp } from "./launch.ts";

const modelsYml =
  "providers:\n  role-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: role-one\n      - id: role-two\n";

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId("model-chip").click();
  await expect(page.getByTestId("model-picker")).toBeVisible();
}

async function roles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => globalThis.studio.getModelRoles(null));
}

test("角色标签：选 Task 再选模型，modelRoles.task 写入 omp 配置，default 不动；重新打开有 task 徽标", async () => {
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

    // 角色标签：omp 的内置角色，默认停在 default。
    const tabs = page.getByTestId("model-role-tab");
    await expect(tabs).toHaveCount(7);
    await expect(page.getByTestId("model-role-tab").first()).toHaveAttribute("aria-selected", "true");

    // 选 Task：标题变成"切换 Task 模型"，并说明用途。
    await page.getByTestId("model-role-tab").and(page.locator('[data-role-tab="task"]')).click();
    await expect(page.getByTestId("model-picker")).toContainText(/Task/);
    await expect(page.getByTestId("model-role-use")).toBeVisible();
    // ←/→ 在标签间移动（键盘可达）。
    await page.keyboard.press("ArrowRight");
    await expect(page.locator('[data-role-tab="commit"]')).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.locator('[data-role-tab="task"]')).toHaveAttribute("aria-selected", "true");

    // 搜索出的模型行直接在表里；点模型 = 给 task 指定它。
    await page.getByTestId("model-search").fill("role-two");
    const option = page.getByTestId("model-option").first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await option.click();
    await expect.poll(async () => (await roles(page))["task"], { timeout: 30_000 }).toBe("role-local/role-two");
    expect((await roles(page))["default"]).toBeUndefined();
    await expect(option.getByTestId("model-role-badge")).toHaveText("task");

    // 关掉再打开：徽标还在（读的是 omp 里持久化的值）。
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("model-picker")).toHaveCount(0);
    await openPicker(page);
    await page.getByTestId("model-search").fill("role-two");
    await expect(page.getByTestId("model-option").first().locator('[data-role="task"]')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('[data-role-tab="task"]')).toHaveAttribute("title", /role-two/);
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

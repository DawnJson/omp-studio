// 模型选择对话框：点行只是选中；"用于此任务"只管这一个任务（草稿里是即将建的任务，以 --model / --thinking 起进程，不写配置）；
// 点一个角色转到给它选模型，"应用"写进全局 omp 配置（modelRoles），重新打开能看到徽标。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR，里面一个 auth: none 的本地 provider；不连任何真实服务。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

/** 中英文 × 浅深主题各截一张（关掉动效，免得切语言时截到淡入的半透明帧）。 */
async function shoot(page: Page, name: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await setLocaleTheme(page, locale, scheme);
    await page.screenshot({ path: path.join(screenshotsDir, `${name}-${locale}-${scheme}.png`) });
  }
}

test("角色范围：选 Task 再选模型并应用，modelRoles.task 写入 omp 配置，default 不动；重新打开有 task 徽标", async () => {
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

    // 顶栏的 × 改回给 default 选；@ 开头搜角色、Enter 再切回 task。
    await page.getByTestId("model-role-clear").click();
    await expect(page.getByTestId("model-role-target")).toHaveCount(0);
    await page.getByTestId("model-search").fill("@task");
    await page.getByTestId("model-search").press("Enter");
    await expect(page.getByTestId("model-role-target")).toContainText("Task");

    // 点模型只是选中，还没写；"应用角色"才给 task 指定它并关闭。
    await page.getByTestId("model-search").fill("role-two");
    const option = page.getByTestId("model-option").first();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await option.click();
    await expect(option).toHaveAttribute("aria-selected", "true");
    expect((await roles(page))["task"]).toBeUndefined();
    await page.getByTestId("model-use").click();
    await expect(page.getByTestId("model-picker")).toHaveCount(0);
    await expect.poll(async () => (await roles(page))["task"], { timeout: 30_000 }).toBe("role-local/role-two");
    expect((await roles(page))["default"]).toBeUndefined();

    // 重新打开：徽标在、角色行写着它的模型（读的是 omp 里持久化的值）。
    await openPicker(page);
    await page.getByTestId("model-search").fill("role-two");
    await expect(page.getByTestId("model-option").first().locator('[data-role="task"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("model-search").fill("");
    await page.getByTestId("model-scope-roles").click();
    const taskRole = page.locator('[data-testid="model-role-option"][data-role="task"]');
    await expect(taskRole).toContainText("role-two");
    // 点角色：转到给它选模型，表里选中的是它现在的模型，主按钮是"应用"。
    await taskRole.click();
    await expect(page.getByTestId("model-role-target")).toContainText("Task");
    await expect(page.locator('[data-testid="model-option"][aria-selected="true"]')).toContainText("role-two");
    await expect(page.getByTestId("model-use")).toHaveText(/^(应用|Apply)$/);
    await shoot(page, "model-picker-role");

    // 设置 → 模型：角色每个一格下拉，显示的是同一份 modelRoles；改 smol 写全局，task 不动。
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,");
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("setting-role-task")).toContainText("role-two", { timeout: 30_000 });
    await page.getByTestId("setting-role-smol").click();
    await page.getByRole("option", { name: "role-one" }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-one");
    expect((await roles(page))["task"]).toBe("role-local/role-two");
    await expect(page.getByTestId("setting-role-smol")).toContainText("role-one");
    await shoot(page, "settings-models-roles");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

const tableModelsYml =
  "providers:\n  table-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: table-one\n        contextWindow: 1000000\n      - id: table-two\n        reasoning: true\n        contextWindow: 400000\n";

test("模型选择对话框：一张表、表头和数字列对齐；Tab 在框内循环；搜索过滤；@ 列角色；点行只选中、用于此任务才切换；Esc 后焦点回到输入框；截图", async () => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-picker-"));
  await writeFile(path.join(agentDir, "models.yml"), tableModelsYml, "utf8");
  await writeFile(path.join(agentDir, "config.yml"), "modelRoles:\n  default: table-local/table-one\n", "utf8");
  const config = () => readFile(path.join(agentDir, "config.yml"), "utf8");
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
    await expect(chip).toHaveText("table-one", { timeout: 30_000 });
    const input = page.getByTestId("composer-input");
    await input.focus();
    await chip.click();
    const picker = page.getByTestId("model-picker");
    await expect(picker).toBeVisible();
    await expect(page.getByTestId("model-search")).toBeFocused();
    // 一张表：没有 provider 组头，行直接可见；底部是正在生效的模型的参数（照终端版 omp）。
    await expect(page.getByTestId("model-option").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("model-details")).toContainText("1M");
    await expect(page.getByTestId("model-speed").first()).not.toHaveText("…");
    // 表头 Int / t/s / Ctx / $/M 和每行的数字右缘对齐（表头字体和行不同，曾经按 ch 定宽对不齐）。
    const rightEdges = (selector: string) =>
      page
        .locator(selector)
        .evaluateAll((cells) =>
          (cells as unknown as { getBoundingClientRect(): { right: number } }[])
            .slice(0, 4)
            .map((cell) => Math.round(cell.getBoundingClientRect().right)),
        );
    expect(await rightEdges('[data-testid="model-option"] .mp-num')).toEqual(await rightEdges(".mp-cols .mp-num"));
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
    await expect(page.getByTestId("model-option")).toHaveCount(2);
    await page.getByTestId("model-scope-all").click();
    // @ 开头列角色（每个角色一行，带绑定的模型），清空后回到模型表。
    await page.getByTestId("model-search").fill("@");
    await expect(page.getByTestId("model-role-option").first()).toBeVisible();
    await expect(page.getByTestId("model-option")).toHaveCount(0);
    await page.getByTestId("model-search").fill("");
    await expect(page.getByTestId("model-option").first()).toBeVisible();
    await page.getByTestId("model-search").focus();
    await shoot(page, "main-model-picker");

    // 点另一个模型只是选中：参数行和思考强度跟着它（它支持思考，档位可选），胶囊和 omp 配置都不变。
    await page.getByTestId("model-search").fill("table-two");
    await page.getByTestId("model-option").first().click();
    await expect(page.getByTestId("model-details")).toContainText("400K");
    await page.getByTestId("thinking-segments-high").click();
    await expect(page.getByTestId("thinking-segments-high")).toHaveAttribute("aria-checked", "true");
    await expect(chip).toHaveText("table-one");
    expect(await config()).not.toContain("table-two");
    // Esc 放弃：什么都没写；焦点回到打开前的输入框，胶囊上没有焦点框。
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(chip).not.toBeFocused();
    expect(await config()).not.toContain("table-two");

    // 选中 + 档位 + "用于此任务"：关闭对话框，胶囊换成它和这一档；只管即将建的这个任务，omp 配置不动。
    await chip.click();
    await page.getByTestId("model-search").fill("table-two");
    await page.getByTestId("model-option").first().click();
    await page.getByTestId("thinking-segments-high").click();
    await page.getByTestId("model-use").click();
    await expect(picker).toHaveCount(0);
    await expect(chip).toHaveText("table-two");
    await expect(page.getByTestId("chip-thinking")).toHaveAttribute("data-level", "high");
    expect(await config()).not.toContain("table-two");
    // 发第一条：任务以 --model / --thinking 起进程，胶囊显示 omp 报的会话模型；配置里的默认值始终没变。
    await input.fill("hi");
    await input.press("Enter");
    await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 30_000 });
    await expect(chip).toHaveText("table-two", { timeout: 30_000 });
    await expect(page.getByTestId("chip-thinking")).toHaveAttribute("data-level", "high");
    expect(await config()).toContain("default: table-local/table-one");
    expect(await config()).not.toContain("table-two");
    expect(await config()).not.toContain("defaultThinkingLevel");
    // 新草稿：刚才的选择只属于那个任务，胶囊回到 omp 的默认值。
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("draft-composer")).toBeVisible();
    await expect(chip).toHaveText("table-one", { timeout: 30_000 });
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

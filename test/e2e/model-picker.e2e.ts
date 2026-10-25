// 模型选择对话框：点行只是选中；"用于此任务"只管这一个任务（草稿里是即将建的任务，以 --model / --thinking 起进程，不写配置）；
// 点一个角色转到给它选模型，"应用"写进全局 omp 配置（modelRoles），重新打开能看到徽标。
// 设置 → 模型：omp 的每个角色一行（主模型 + 备用模型），特定能力的角色只列那一类模型（`omp models --kind all`）。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR，里面一个 auth: none 的本地 provider；不连任何真实服务。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectInfoTipsOnLabelLine, expectNoOverflow, launchApp, setLocaleTheme } from "./launch.ts";

const modelsYml =
  "providers:\n  role-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: role-one\n        reasoning: true\n      - id: role-two\n        reasoning: true\n      - id: role-three\n";

async function openPicker(page: Page): Promise<void> {
  await page.getByTestId("model-chip").click();
  await expect(page.getByTestId("model-picker")).toBeVisible();
}

async function roles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => globalThis.studio.getModelRoles(null));
}

async function chains(page: Page): Promise<unknown> {
  return page.evaluate(
    async () =>
      (await globalThis.studio.getOmpConfig()).items.find((item) => item.key === "retry.fallbackChains")?.value,
  );
}

test("角色范围：选 Task 再选模型并应用，modelRoles.task 写入 omp 配置，default 不动；重新打开有 task 徽标；设置里的角色表和备用模型", async () => {
  test.setTimeout(150_000);
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
    // 关掉动效：下拉的弹出动画里元素“不稳定”，点分组标题会一直重试。
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1200, height: 900 });
    await openPicker(page);

    // 左栏"角色"：omp 的 11 个对话角色各一行（特定能力的角色不在这里），默认在给 default 选（顶栏没有角色标记）。
    await page.getByTestId("model-scope-roles").click();
    await expect(page.getByTestId("model-scope-roles")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("model-role-option")).toHaveCount(11);
    await expect(page.getByTestId("model-role-target")).toHaveCount(0);

    // 角色范围里搜索框过滤角色，Enter 切到它：回到全部模型，顶栏写明在给 Task 选，并说明用途。
    await page.getByTestId("model-search").fill("task");
    await expect(page.getByTestId("model-role-option")).toHaveCount(1);
    await page.getByTestId("model-search").press("Enter");
    await expect(page.getByTestId("model-role-target")).toContainText("Task");
    await expect(page.getByTestId("model-scope-all")).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("model-role-target")).toHaveAttribute("title", /.+/);

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
    // 给角色选时是全部模型、按提供商折叠：它现在的模型所在的提供商展开着；点标题收起，行跟着收起，再点展开。
    const group = page.locator('[data-testid="model-provider-group"][data-provider="role-local"]');
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await expect(group.locator("xpath=..").getByTestId("model-option")).toHaveCount(0);
    await group.click();
    await expect(page.locator('[data-testid="model-option"][aria-selected="true"]')).toContainText("role-two");
    await expect(page.getByTestId("model-use")).toHaveText(/^(应用|Apply)$/);

    // 设置 → 模型：每个角色一行，显示的是同一份 modelRoles；改 smol 写全局，task 不动。
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("model-picker")).toHaveCount(0);
    await page.keyboard.press("Control+,");
    await page.getByTestId("settings-nav-models").click();
    await expect(page.getByTestId("setting-role-task")).toContainText("role-two", { timeout: 30_000 });
    // 下拉按 provider 折叠：smol 没设时组都收着，点开 role-local 再选。
    await page.getByTestId("setting-role-smol").click();
    const smolGroup = page.locator('[data-testid="setting-role-smol-group"][data-group="role-local"]');
    await expect(smolGroup).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("option", { name: "role-one" })).toHaveCount(0);
    await smolGroup.click();
    await page.getByRole("option", { name: "role-one" }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-one");
    expect((await roles(page))["task"]).toBe("role-local/role-two");
    await expect(page.getByTestId("setting-role-smol")).toContainText("role-one");

    // 备用模型：给 smol 加 role-two，写进 retry.fallbackChains.smol；主模型 role-one 不在可加的里面。
    await page.getByTestId("setting-chain-smol-add").click();
    await page.getByTestId("setting-chain-smol-add-search").fill("role");
    await expect(page.getByRole("option", { name: "role-one" })).toHaveCount(0);
    await page.getByRole("option", { name: "role-two" }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-two"] });
    const fallback = page.getByTestId("setting-chain-smol-0");
    await expect(fallback).toHaveText("role-local/role-two");

    // 备用模型也能选思考强度（role-two 支持思考）：默认沿用当前；选 High 写成 `provider/模型:high`，模型下拉仍只写模型，档位下拉显示 High（中文界面也写英文）；
    // 带后缀的也不会再出现在"添加备用…"里。
    const chainLevel = page.getByTestId("setting-chain-smol-thinking-0");
    await expect(chainLevel).toContainText(/沿用当前|Keep current/);
    await chainLevel.click();
    await page.getByRole("option", { name: /^High$/ }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-two:high"] });
    await expect(fallback).toHaveText("role-local/role-two");
    await expect(chainLevel).toContainText("High");
    await page.getByTestId("setting-chain-smol-add").click();
    await page.getByTestId("setting-chain-smol-add-search").fill("role");
    await expect(page.getByRole("option", { name: "role-two" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // 每个备用模型单独一行，模型和思考强度与主模型那一行同列同宽；"添加备用…"在最下面一行、模型那一列。窄窗口、中英文下都不越界。
    for (const locale of ["en", "zh-CN"] as const) {
      await setLocaleTheme(page, locale, "light");
      for (const width of [900, 1200]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoOverflow(page.getByTestId("setting-role-row-smol"));
        await expectInfoTipsOnLabelLine(page.getByTestId("settings"));
        const box = async (testId: string) => {
          const found = await page.getByTestId(testId).boundingBox();
          if (found === null) throw new Error(`${testId} 不可见`);
          return found;
        };
        const main = await box("setting-role-smol");
        const mainLevel = await box("setting-role-smol-thinking");
        const chained = await box("setting-chain-smol-0");
        const chainedLevel = await box("setting-chain-smol-thinking-0");
        const add = await box("setting-chain-smol-add");
        expect(chained.y).toBeGreaterThanOrEqual(main.y + main.height);
        expect(add.y).toBeGreaterThanOrEqual(chained.y + chained.height);
        for (const other of [chained, add]) {
          expect(Math.abs(other.x - main.x)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(other.width - main.width)).toBeLessThanOrEqual(0.5);
        }
        expect(Math.abs(chainedLevel.x - mainLevel.x)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(chainedLevel.width - mainLevel.width)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(chainedLevel.y - chained.y)).toBeLessThanOrEqual(1);
      }
    }
    // 去掉后缀：选"沿用当前"。
    await chainLevel.click();
    await page.getByRole("option", { name: /^(沿用当前|Keep current)$/ }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-two"] });

    // 网页搜索只列搜索服务，不列对话模型；选 Tavily 写 modelRoles.web。
    await page.getByTestId("setting-role-web").click();
    await page.getByTestId("setting-role-web-search").fill("tavily");
    await expect(page.getByRole("option", { name: "Tavily", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("setting-role-web-search").fill("role");
    await expect(page.getByRole("option", { name: "role-one" })).toHaveCount(0);
    await page.getByTestId("setting-role-web-search").fill("tavily");
    await page.getByRole("option", { name: "Tavily", exact: true }).click();
    await expect.poll(async () => (await roles(page))["web"], { timeout: 30_000 }).toBe("web/tavily");

    // 备用那一行的 × 删掉最后一个备用模型：整条去掉，不留空列表。
    await page.getByTestId("setting-chain-smol-remove-0").click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({});

    // 角色自己的思考强度：触发器写全 provider/模型 id；没选时跟随默认；选了写成 `provider/model:level`。
    const smol = page.getByTestId("setting-role-smol");
    const smolLevel = page.getByTestId("setting-role-smol-thinking");
    await expect(smol).toHaveText("role-local/role-one");
    await expect(smolLevel).toBeEnabled();
    await smolLevel.click();
    await page.getByRole("option", { name: /^High$/ }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-one:high");
    // 带档位的值照样匹配上目录里的模型：触发器仍是同一种写法（不再退成原文 "…:high"），档位单独显示。
    await expect(smol).toHaveText("role-local/role-one");
    await expect(smolLevel).toContainText("High");
    // 只换模型：档位在新模型也支持就保留；换成不支持思考的模型就去掉，档位控件禁用。
    await smol.click();
    await page.getByRole("option", { name: "role-two" }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-two:high");
    await expect(smol).toHaveText("role-local/role-two");
    await smol.click();
    await page.getByRole("option", { name: "role-three" }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-three");
    await expect(smolLevel).toBeDisabled();
    // 换回支持思考的模型后档位控件可用；选"跟随默认"去掉后缀。
    await smol.click();
    await page.getByRole("option", { name: "role-one" }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-one");
    await expect(smol).toHaveText("role-local/role-one");
    await expect(smolLevel).toBeEnabled();
    await expect(smolLevel).toContainText(/跟随默认|Default/);
    await smolLevel.click();
    await page.getByRole("option", { name: /^Minimal$/ }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-one:minimal");
    await expect(smolLevel).toContainText("Minimal");
    await smolLevel.click();
    await page.getByRole("option", { name: /^(跟随默认|Default)$/ }).click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-one");

    // 模型选择对话框给角色"应用"：角色原有的档位新模型也支持就保留，不支持（role-three 不支持思考）就去掉。
    await page.evaluate(() =>
      globalThis.studio.setModelRole("smol", { provider: "role-local", modelId: "role-one" }, "high"),
    );
    await page.keyboard.press("Escape");
    await openPicker(page);
    await page.getByTestId("model-search").fill("@smol");
    await page.getByTestId("model-search").press("Enter");
    await page.getByTestId("model-search").fill("role-two");
    await page.getByTestId("model-option").first().click();
    await page.getByTestId("model-use").click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-two:high");
    await openPicker(page);
    await page.getByTestId("model-search").fill("@smol");
    await page.getByTestId("model-search").press("Enter");
    await page.getByTestId("model-search").fill("role-three");
    await page.getByTestId("model-option").first().click();
    await page.getByTestId("model-use").click();
    await expect.poll(async () => (await roles(page))["smol"], { timeout: 30_000 }).toBe("role-local/role-three");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("设置 → 模型角色：添加自定义角色（名字 + 模型，重名或不合法时不能加），删除自定义角色连同它的备用链；集成与插件排在 Provider 与订阅后面", async () => {
  test.setTimeout(120_000);
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-custom-roles-"));
  await writeFile(path.join(agentDir, "models.yml"), modelsYml, "utf8");
  await writeFile(
    path.join(agentDir, "config.yml"),
    "modelRoles:\n  WRITER: role-local/role-one\nretry:\n  fallbackChains:\n    WRITER:\n      - role-local/role-two\n",
    "utf8",
  );
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1200, height: 800 });
    await setLocaleTheme(page, "zh-CN", "light");
    await page.keyboard.press("Control+,");

    // 导航：这一节叫"模型角色"；集成与插件紧跟 Provider 与订阅，在工具与权限前面。
    const nav = page.getByTestId("settings-nav-models");
    await expect(nav).toHaveText("模型角色");
    const navY = async (item: string) => (await page.getByTestId(`settings-nav-${item}`).boundingBox())?.y ?? NaN;
    const [providersY, extensionsY, toolsY] = [await navY("providers"), await navY("extensions"), await navY("tools")];
    expect(providersY).toBeLessThan(extensionsY);
    expect(extensionsY).toBeLessThan(toolsY);

    await nav.click();
    // 之后在窄窗口里查：对话框不越界。
    await page.setViewportSize({ width: 900, height: 800 });
    // 配置里的自定义角色有删除按钮，内置角色没有。
    await expect(page.getByTestId("setting-role-WRITER")).toContainText("role-one", { timeout: 30_000 });
    await expect(page.getByTestId("setting-role-WRITER-remove")).toBeVisible();
    await expect(page.getByTestId("setting-role-smol-remove")).toHaveCount(0);

    // 添加：和内置或已有角色重名（不分大小写）、不是字母开头都不能加；名字和模型都填了才能加。
    await page.getByTestId("setting-role-add").click();
    const dialog = page.getByTestId("setting-role-add-dialog");
    const name = page.getByTestId("setting-role-add-name");
    const save = page.getByTestId("setting-role-add-save");
    for (const [text, error] of [
      ["Smol", "已经有这个角色"],
      ["writer", "已经有这个角色"],
      ["9x", "字母开头"],
    ] as const) {
      await name.fill(text);
      await expect(dialog).toContainText(error);
      await expect(save).toBeDisabled();
    }
    await name.fill("reviewer");
    await expect(dialog).not.toContainText("已经有这个角色");
    await expect(save).toBeDisabled();
    await page.getByTestId("setting-role-add-model").click();
    await page.getByTestId("setting-role-add-model-search").fill("role-two");
    await page.getByRole("option", { name: "role-two" }).click();
    await expectNoOverflow(dialog);
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await roles(page))["reviewer"], { timeout: 30_000 }).toBe("role-local/role-two");
    await expect(page.getByTestId("setting-role-reviewer")).toContainText("role-two");

    // 删除：modelRoles 里的这一项和它的备用链一起去掉，行跟着消失；别的角色不动。
    await page.getByTestId("setting-role-WRITER-remove").click();
    await expect.poll(async () => (await roles(page))["WRITER"], { timeout: 30_000 }).toBeUndefined();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({});
    await expect(page.getByTestId("setting-role-row-WRITER")).toHaveCount(0);
    expect((await roles(page))["reviewer"]).toBe("role-local/role-two");
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("备用模型链的结构化编辑器：带后缀的值显示档位，改档位写回后缀，换成不支持思考的模型去掉后缀，窄窗口不越界", async () => {
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-chains-"));
  await writeFile(path.join(agentDir, "models.yml"), modelsYml, "utf8");
  await writeFile(
    path.join(agentDir, "config.yml"),
    "retry:\n  fallbackChains:\n    smol:\n      - role-local/role-two:high\n",
    "utf8",
  );
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.getByTestId("app-root")).toBeVisible();
    await page.keyboard.press("Control+,");
    await page.getByTestId("settings-search").fill("fallbackChains");
    await page
      .getByTestId("cfg-retry.fallbackChains")
      .getByRole("button", { name: /编辑…|Edit…/ })
      .click({ timeout: 30_000 });
    const editor = page.getByTestId("chains-editor");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    // 模型下拉显示不带后缀的选择器，档位下拉显示 High。
    const level = page.getByTestId("chain-level-smol-0");
    await expect(level).toContainText("High", { timeout: 30_000 });
    await expect(editor.getByRole("combobox").first()).toContainText("role-two");
    await expect(editor.getByRole("combobox").first()).not.toContainText(":high");
    // 改档位：只换后缀。
    await level.click();
    await page.getByRole("option", { name: /^Minimal$/ }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-two:minimal"] });
    // 换成不支持思考的 role-three：后缀去掉，档位下拉不画（占位空着）。
    await editor.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "role-three" }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-three"] });
    await expect(page.getByTestId("chain-level-smol-0")).toHaveCount(0);
    // 换回 role-two：档位又能选；选 Medium。
    await editor.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "role-two" }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-two"] });
    await page.getByTestId("chain-level-smol-0").click();
    await page.getByRole("option", { name: /^Medium$/ }).click();
    await expect.poll(() => chains(page), { timeout: 30_000 }).toEqual({ smol: ["role-local/role-two:medium"] });
    for (const locale of ["en", "zh-CN"] as const) {
      await setLocaleTheme(page, locale, "light");
      for (const width of [900, 1200]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoOverflow(editor);
      }
    }
  } finally {
    await launched.close();
    await rm(agentDir, { recursive: true, force: true });
  }
});

const tableModelsYml =
  "providers:\n  table-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: table-one\n        contextWindow: 1000000\n      - id: table-two\n        reasoning: true\n        contextWindow: 400000\n";

test("模型选择对话框：一张表、表头和数字列对齐；Tab 在框内循环；搜索过滤；@ 列角色；点行只选中、用于此任务才切换；Esc 后焦点回到输入框", async () => {
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

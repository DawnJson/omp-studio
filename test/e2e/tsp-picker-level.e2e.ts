// omp 19.2.1 的模型切换器（Alt+P）：fake-tsp-omp 回放 fixtures/tsp/model-picker-19.jsonl（真实 omp 录制，临时 agent 目录里
// 三个本地模型：role-one / role-two 支持思考、role-three 不支持）。picker 带 level（思考强度滑杆）、anchor "composer"、
// search "list"、density "snug"、scopeStyle "rail" 和一个 head 动作（Task / Main）。假 omp 只在收到和录制逐字相同的事件后
// 才往下放帧，所以"界面走到下一步"本身就证明发对了事件。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoOverflow, launchApp, setLocale } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

async function received(log: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
    .filter((record) => record.kind === "tsp" && record.body !== undefined)
    .map((record) => record.body as Record<string, unknown>)
    .filter((body) => ["send", "action", "activate", "select"].includes(String(body["ev"])));
}

type Box = { left: number; top: number; bottom: number };
async function box(page: Page, selector: string): Promise<Box> {
  const rect = await page.locator(selector).first().boundingBox();
  if (rect === null) throw new Error(`${selector} is not laid out`);
  return { left: rect.x, top: rect.y, bottom: rect.y + rect.height };
}

test("模型切换器(omp 19.2.1 录制):思考强度滑杆按录制的档位画、点格子发 level、跟着 omp 更新;从输入框往上弹;rail 和 head 动作;900 宽中英文不越界", async () => {
  test.setTimeout(120_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp picker level e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, "model-picker-19", "--speed=20", `--log=${log}`],
    }),
  });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await page.getByTestId("composer-input").fill("!echo hi");
    await page.keyboard.press("Enter");
    await expect(page.locator('[data-testid="tsp-view"] [data-role="omp.bash"]')).toBeVisible({ timeout: 30_000 });
    // 窄窗口(900 宽)放在侧栏的"打开文件夹"点完之后:窄时侧栏收起。
    await page.setViewportSize({ width: 900, height: 760 });

    // Alt+P 转给 omp,omp 在 layer 里开出切换器。
    await page.getByTestId("composer-input").focus();
    await page.keyboard.press("Alt+p");
    const picker = page.locator('[data-testid="tsp-view"] .tspi-picker');
    await expect(picker).toBeVisible({ timeout: 30_000 });
    const level = picker.getByTestId("tsp-picker-level");
    const track = level.getByRole("slider");
    await expect(track).toHaveAttribute("aria-valuetext", "High");
    await expect(track).toHaveAttribute("aria-valuemax", "6");
    await expect(level.locator(".tspi-pk-tick")).toHaveCount(7);
    await expect(level.locator(".tspi-pk-level-chip .d")).toHaveText("role-local");
    // 键写在悬停提示里(图标的提示 = 名字 + 键)。
    await expect(level.locator(".tspi-pk-level-ic")).toHaveAttribute("title", "Thinking  ← →");

    // search "list":没有头一行,搜索在列表表头行;rail 只有图标;head 动作在 rail 顶上;snug 行 30px。
    await expect(picker.locator(".tspi-pk-head")).toHaveCount(0);
    await expect(picker.locator(".tspi-pk-lhead .tspi-pk-search")).toBeVisible();
    await expect(picker.locator(".tspi-pk-scopes.rail .tspi-pk-scope .lbl")).toHaveCount(0);
    await expect(picker.locator('.tspi-pk-scopes.rail .tspi-pk-scope[data-v="provider:role-local"]')).toHaveAttribute(
      "title",
      "role-local · 3",
    );
    const task = picker.locator('.tspi-pk-scopes.rail .tspi-pk-hact[data-act="task"]');
    await expect(task).toHaveAttribute("title", "Task / Main  Alt+P");
    await expect(task).toHaveAttribute("aria-pressed", "false");
    await expect(picker.locator('.tspi-pk-row[data-v="role-local/role-one"]')).toHaveCSS("height", "30px");
    // role-one 带七个角色芯片:名字照样完整,芯片在后面让位。
    const label = picker.locator('.tspi-pk-row[data-v="role-local/role-one"] .tspi-pk-label');
    await expect(label).toHaveText("role-one");
    expect(
      await label.evaluate((el) => {
        const m = el as unknown as { scrollWidth: number; clientWidth: number };
        return m.scrollWidth - m.clientWidth;
      }),
    ).toBeLessThanOrEqual(0);

    // anchor "composer":面板贴在输入框上方、左缘和输入框对齐(等弹出动画和窄窗口的重排放完再量)。
    const placement = async () => {
      const sheet = await box(page, '[data-testid="tsp-view"] .tspi-pk-sheet');
      const composer = await box(page, '[data-testid="composer-stack"]');
      return {
        above: sheet.bottom <= composer.top + 1 && composer.top - sheet.bottom < 40,
        leftAligned: Math.abs(sheet.left - composer.left) < 1.5,
      };
    };
    await expect.poll(placement).toEqual({ above: true, leftAligned: true });

    for (const locale of ["en", "zh-CN"] as const) {
      await setLocale(page, locale);
      await expectNoOverflow(picker.locator(".tspi-pk-sheet"));
    }
    // 切语言后焦点离开了搜索框:放回去(键盘一直归 omp)。
    await picker.locator(".tspi-pk-search input, .tspi-pk-search textarea").first().focus();

    // 点 Low 那一格:发 level,omp 回 set 后滑杆停在 Low。
    await level.locator('.tspi-pk-tick[data-step="low"]').click();
    await expect(track).toHaveAttribute("aria-valuetext", "Low", { timeout: 15_000 });
    expect(await received(log)).toContainEqual({ ev: "action", sf: "s:1", id: "layer/0", act: "level", value: "low" });
    // 焦点还在搜索框:→ 写给 omp,升一格。
    await page.keyboard.press("ArrowRight");
    await expect(track).toHaveAttribute("aria-valuetext", "Med", { timeout: 15_000 });

    // 不支持思考的模型:滑杆冻住,原因做悬停提示,点了不发事件。
    await picker.locator('.tspi-pk-row[data-v="role-local/role-three"]').click();
    await expect(level).toHaveAttribute("data-frozen", "");
    await expect(track).toHaveAttribute("title", "role-three does not reason");
    await expect(track).toHaveAttribute("aria-valuemax", "4");
    await picker.locator('.tspi-pk-row[data-v="role-local/role-two"]').click();
    await expect(level).not.toHaveAttribute("data-frozen", "");
    await expect(track).toHaveAttribute("aria-valuetext", "Med");

    // head 动作:按下 = Task 模式(omp 撤掉滑杆),再按回来。
    await task.click();
    await expect(task).toHaveAttribute("aria-pressed", "true");
    await expect(level).toHaveCount(0);
    await task.click();
    await expect(task).toHaveAttribute("aria-pressed", "false");
    await expect(level).toBeVisible();

    // 再点 role-two = 选用它:切换器关掉,输入框的模型名换成 role-two。
    await picker.locator('.tspi-pk-row[data-v="role-local/role-two"]').click();
    await expect(picker).toHaveCount(0, { timeout: 15_000 });
    expect((await received(log)).filter((event) => event["ev"] !== "send")).toEqual([
      { ev: "action", sf: "s:1", id: "layer/0", act: "level", value: "low" },
      { ev: "select", sf: "s:1", id: "layer/0", item: "role-local/role-three" },
      { ev: "select", sf: "s:1", id: "layer/0", item: "role-local/role-two" },
      { ev: "action", sf: "s:1", id: "layer/0", act: "task" },
      { ev: "action", sf: "s:1", id: "layer/0", act: "task" },
      { ev: "activate", sf: "s:1", id: "layer/0", item: "role-local/role-two" },
    ]);
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 3 });
  }
});

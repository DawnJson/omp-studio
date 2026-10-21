// TSP 引擎的端到端(docs/architecture/tsp-migration.md):启动构建产物,任务引擎设为 tsp,STUDIO_TEST_OMP 指向
// fake-tsp-omp(在伪终端里回放 fixtures/tsp 的 omp 录制,不调真实模型),驱动真实的 主进程 → 伪终端 → IPC → 渲染进程。
// 假 omp 只有在收到和录制完全一样的事件(send / action / activate)后才继续回放,所以"界面走到下一步"本身就证明
// 渲染进程发对了事件;另外用 --log 断言它收到了什么。截图:完成 / 等你确认(审批) / 提问,中英 × 深浅。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

interface Started {
  launched: LaunchedApp;
  /** 假 omp 收到的 TSP 事件(不含 ack / resize 等终端自发的)。 */
  received(): Promise<Record<string, unknown>[]>;
  cleanup(): Promise<void>;
}

async function start(fixture: string): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp(
    {
      STUDIO_TEST_OMP: JSON.stringify({
        command: process.execPath,
        args: [fakeOmp, fixture, "--speed=20", `--log=${log}`],
      }),
    },
    { taskEngine: "tsp" },
  );
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await launched.page.getByTestId("sidebar-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  return {
    launched,
    async received() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
        .filter((record) => record.kind === "tsp" && record.body !== undefined)
        .map((record) => record.body as Record<string, unknown>)
        .filter((body) => ["send", "action", "activate", "select"].includes(String(body["ev"])));
    },
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

/** 草稿输入框发第一句话:主进程等 omp 的输入框 sendable 后用 send 事件提交(任务建好以后同一个位置换成任务的 studio 输入框)。 */
async function sendFirst(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
  // 草稿 → 任务：输入框在原位接着用，不重放换页淡入（否则从透明闪一下）。
  const stack = page.getByTestId("composer-stack");
  await expect(stack).toHaveAttribute("data-from-draft", "");
  await expect(stack).toHaveCSS("animation-name", "none");
  // 任务的输入框也写着工作目录（和草稿同一个位置），焦点一直在输入框上（焦点框不断）。
  await expect(stack.getByTestId("composer-folder")).toHaveText(/项目 目录$/);
  await expect(page.getByTestId("composer-input")).toBeFocused();
}

const role = (page: Page, name: string) => page.locator(`[data-testid="tsp-view"] [data-role="${name}"]`);

async function shoot(page: Page, state: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.evaluate(
      async ({ locale, scheme }) => {
        await globalThis.studio.setLocale(locale);
        await globalThis.studio.setTheme(scheme);
      },
      { locale, scheme },
    );
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", locale);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(screenshotsDir, `tsp-${state}-${locale}-${scheme}.png`) });
  }
}

const TASK_PROMPT =
  "先用 todo 工具列出计划。然后用 task 工具并行派两个子代理:一个修 calc/ops.py 里的 bug,一个修 calc/text.py 里的 bug。子代理都完成后运行 python -m pytest -q 确认通过,最后用两句话总结。";

test("完整一轮:草稿的第一句话用 send 交给 omp;待办、子代理、bash、回答按 omp 的节点画出来,跑完侧栏回到空闲", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start("task");
  try {
    const { page } = launched;
    await sendFirst(page, TASK_PROMPT);
    const row = page.getByTestId("task-row").first();
    await expect(row).toHaveAttribute("data-status", "running", { timeout: 20_000 });
    // 回放跑完:本轮用量出现,omp 的工作状态行消失,侧栏变回空闲。
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    await expect(row).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    await expect(role(page, "omp.user").first()).toContainText("calc/ops.py");
    await expect(role(page, "omp.tool.todo").first()).toBeVisible();
    await expect(role(page, "omp.tool.bash").first()).toContainText("pytest");
    await expect(role(page, "omp.assistant").last()).toBeVisible();
    // omp 收到的提交就是草稿原文,发给它的是 send 事件(不是逐字按键)。
    expect(await received()).toEqual([expect.objectContaining({ ev: "send", id: "j.line/input", text: TASK_PROMPT })]);
    // 混合形态:过程区是 omp 的节点,输入框是 studio 的 Composer(模型胶囊、思考强度、发送在它上面),omp 自己的输入框卡片不画。
    await expect(page.getByTestId("composer-stack")).toBeVisible();
    await expect(page.getByTestId("model-chip")).toBeVisible();
    await expect(page.getByTestId("send-button")).toBeVisible();
    await expect(role(page, "omp.editor")).toHaveCount(0);
    await expect(page.locator('[data-testid="tsp-view"] .tspi-editor')).toHaveCount(0);
    // omp 自己的欢迎块(logo、"omp"、版本、小提示)不画;过程区顶部是 studio 的标题块(像素标志 + 任务所在文件夹),随对话滚动。
    await expect(role(page, "omp.welcome")).toHaveCount(0);
    await expect(
      page.locator('[data-testid="tsp-view"] [data-testid="studio-header"] [data-testid="pixel-logo"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="tsp-view"] [data-testid="studio-header-folder"]')).toContainText(
      "项目 目录",
    );
    // 改动卡片不在 TSP 滚动区里(有改动时是输入框上方的改动条,同在 composer-stack 里)。
    await expect(page.locator('.tsp-scroller [data-testid="change-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="tsp-view"] [data-testid="change-strip"]')).toHaveCount(0);
    // 在 studio 输入框里打字不会变成发给 omp 的按键。
    const before = (await received()).length;
    await page.getByTestId("composer-input").fill("还没发的草稿");
    await page.waitForTimeout(300);
    expect((await received()).length).toBe(before);
    await page.getByTestId("composer-input").fill("");
    // omp 一路改写上方的节点(折叠卡片、去掉思考中),用户没动过滚动:跑完仍贴在底部,看得到最后的回答。
    await expect(page.getByTestId("jump-latest")).toHaveCount(0);
    const distance = await page.evaluate(
      `(() => { const el = document.querySelector(".tsp-scroller"); return el.scrollHeight - el.clientHeight - el.scrollTop; })()`,
    );
    expect(distance).toBeLessThanOrEqual(2);
    await shoot(page, "done");
    // 切到另一个 TSP 任务：只剩一个过程区，画的是新任务（过程区和输入框同 key 时，React 会把上一个任务的过程区留在页面上）。
    const second = await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      return (await globalThis.studio.createTask({ projectId: project!.id })).id;
    });
    await page.locator(`[data-nav="task:${second}"]`).click();
    await expect(page.getByTestId("tsp-view")).toHaveCount(1);
    await expect(page.getByTestId("tsp-view")).toHaveAttribute("data-task-id", second);
  } finally {
    await cleanup();
  }
});

test("审批:omp 的审批门出现时任务是等你确认;点批准发出门上的 action,命令接着跑完", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("approval");
  try {
    const { page } = launched;
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    const approve = page.locator('[data-testid="tsp-view"] [data-id="t.actions/approve"]');
    await expect(approve).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "needs_you");
    await expect(page.getByTestId("gate-slot")).toHaveCount(0);
    await expect(role(page, "omp.editor.ask.approval")).toBeVisible();
    await expect(role(page, "omp.editor")).toHaveCount(0);
    await shoot(page, "gate");
    await approve.click();
    await expect(approve).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    expect((await received()).filter((event) => event["ev"] === "action")).toEqual([
      expect.objectContaining({ ev: "action", id: "t.actions/approve", act: "approve" }),
    ]);
  } finally {
    await cleanup();
  }
});

test("提问:选项是 omp 的列表,双击一项发 activate;提问期间 studio 输入框不能发送,omp 收到答案后继续", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("ask");
  try {
    const { page } = launched;
    await sendFirst(page, "请用 ask 工具问我一个问题:三个选项 A 快 / B 稳 / C 省钱,只问这一个,然后等我回答。");
    const option = page.locator('[data-testid="tsp-view"] [data-id="t.q0/option:1"]');
    await expect(option).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "needs_you");
    // 门由 omp 画在过程区里,studio 不再挂门槽;输入框在提问期间不能发送,但能打字。
    await expect(page.getByTestId("gate-slot")).toHaveCount(0);
    await expect(role(page, "omp.editor.ask")).toBeVisible();
    await expect(role(page, "omp.editor")).toHaveCount(0);
    await page.getByTestId("composer-input").fill("先别发");
    await expect(page.getByTestId("send-button")).toBeDisabled();
    await page.getByTestId("composer-input").fill("");
    await shoot(page, "ask");
    await option.dblclick();
    await expect(option).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    expect((await received()).filter((event) => event["ev"] === "activate")).toEqual([
      expect.objectContaining({ ev: "activate", id: "t.q0", item: "t.q0/option:1" }),
    ]);
    // 提问被撤掉后焦点回到 studio 输入框。
    await expect(page.getByTestId("composer-input")).toBeFocused();
  } finally {
    await cleanup();
  }
});

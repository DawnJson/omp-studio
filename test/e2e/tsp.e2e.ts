// TSP 引擎的端到端(docs/architecture/tsp-migration.md):启动构建产物,任务引擎设为 tsp,STUDIO_TEST_OMP 指向
// fake-tsp-omp(在伪终端里回放 fixtures/tsp 的 omp 录制,不调真实模型),驱动真实的 主进程 → 伪终端 → IPC → 渲染进程。
// 假 omp 只有在收到和录制完全一样的事件(send / action / activate)后才继续回放,所以"界面走到下一步"本身就证明
// 渲染进程发对了事件;另外用 --log 断言它收到了什么。截图:完成 / 等你确认(审批) / 提问,中英 × 深浅。
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import { parseSession } from "../../src/main/tsp/session-extras.ts";
import { launchApp, openTaskRow, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

interface Started {
  launched: LaunchedApp;
  /** 假 omp 收到的 TSP 事件(不含 ack / resize 等终端自发的)。 */
  received(): Promise<Record<string, unknown>[]>;
  cleanup(): Promise<void>;
}

async function start(fixture: string, env: Record<string, string> = {}): Promise<Started> {
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
      ...env,
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

/** 页面里 getComputedStyle 用到的最小类型(e2e 的类型检查没有 DOM 类型)。 */
type PageStyle = {
  getComputedStyle(
    el: unknown,
    pseudo?: string,
  ): { opacity: string; content: string; height: string; flexGrow: string; display: string; fontSize: string };
};

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
    // TSP 任务没有改动摘要：过程区里没有改动卡片，输入框上方也没有改动条（评审从顶栏按钮 / Ctrl Shift D / 提交对话框进）。
    await expect(page.locator('.tsp-scroller [data-testid="change-card"]')).toHaveCount(0);
    await expect(page.getByTestId("change-strip")).toHaveCount(0);
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
    await shoot(page, "ask-done");
  } finally {
    await cleanup();
  }
});

test("过程卡片:diff 的上下文行和增删行一样是一行(行号在左、文字在右),代码长行折行不出横向滚动条", async () => {
  test.setTimeout(90_000);
  // cards = approval 的录制,最后一帧多加了一张 edit 卡(diff,含空行和长行上下文)和一张 eval 卡(长代码行 + 输出 + 底栏)。
  const { launched, cleanup } = await start("cards");
  try {
    const { page } = launched;
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    const approve = page.locator('[data-testid="tsp-view"] [data-id="t.actions/approve"]');
    await expect(approve).toBeVisible({ timeout: 30_000 });
    await approve.click();
    const edit = role(page, "omp.tool.edit");
    await expect(edit).toBeVisible({ timeout: 30_000 });
    // 上下文行(第 8 行是长段落):行号和文字同一行开始,文字不掉到行号下面。
    const ctx = edit.locator('.tsp-dl[data-kind="ctx"]').nth(1);
    const [gutter, text] = await Promise.all([
      ctx.locator(".tsp-dg").first().boundingBox(),
      ctx.locator(".tsp-dt").boundingBox(),
    ]);
    expect(text!.y).toBe(gutter!.y);
    expect(text!.x).toBeGreaterThan(gutter!.x + gutter!.width);
    // 过程区的文字是 omp 原样的英文,中文界面也一样(不走 i18n)。
    await expect(edit.locator(".tsp-dsep")).toContainText("unchanged lines");
    // eval 的长代码行折行,代码块不能横向滚动。
    const code = role(page, "omp.tool.eval").locator(".tsp-code-body").first();
    await expect(code).toBeVisible();
    const overflow = await code.evaluate((el) => {
      const box = el as unknown as { scrollWidth: number; clientWidth: number };
      return box.scrollWidth - box.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    await edit.scrollIntoViewIfNeeded();
    await shoot(page, "cards");
  } finally {
    await cleanup();
  }
});

test("用户消息悬停:从气泡分步移向复制按钮的整条路上按钮都在,点击发出 copy-message;Tab 到按钮也显示", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start("task");
  try {
    const { page } = launched;
    await sendFirst(page, TASK_PROMPT);
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    const bubble = role(page, "omp.user").first();
    const tools = role(page, "omp.user.tools").first();
    const copy = tools.locator('[data-id$="/copy"]');
    await bubble.scrollIntoViewIfNeeded();
    // 没悬停:按钮不显示。
    await page.mouse.move(1, 1);
    await expect(tools).toHaveCSS("opacity", "0");
    // 鼠标先进气泡正文,再一小步一小步移到按钮中心:每一步都要保持显示(间隙不能断开悬停)。
    const box = (await bubble.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tools).toHaveCSS("opacity", "1");
    const target = (await copy.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      // evaluate 只把回调本身发进页面,所以 getComputedStyle 写在回调里;e2e 的类型检查没有 DOM 类型,经 globalThis 取。
      expect(await tools.evaluate((el) => (globalThis as unknown as PageStyle).getComputedStyle(el).opacity)).toBe("1");
    }
    await page.mouse.down();
    await page.mouse.up();
    await expect
      .poll(async () => (await received()).some((e) => e["ev"] === "action" && e["act"] === "copy-message"))
      .toBe(true);
    // 鼠标点过复制按钮后焦点留在它上面,但鼠标移走按钮行照样收起(只认键盘焦点)。
    await page.mouse.move(1, 1);
    await expect(tools).toHaveCSS("opacity", "0");
    // 键盘:Shift+Tab 离开、Tab 回到复制按钮,按钮行显示且有焦点;回车同样触发。
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(copy).toBeFocused();
    await expect(tools).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await received()).filter((e) => e["ev"] === "action" && e["act"] === "copy-message").length)
      .toBe(2);
  } finally {
    await cleanup();
  }
});

test("恢复会话:omp 不重发的每轮用量脚注补回;回顾只补最新一条、放回它的位置(之后还有新一轮也照样补),用 ※ 不用时钟图标", async () => {
  test.setTimeout(120_000);
  // 假 omp 回放的是 omp 18.12.4 `--resume` 一个 3 轮会话的实录:旧对话重发了,但没有 omp.turn.usage / omp.recap。
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp tsp resume agent "));
  const sessionFile = path.join(agentDir, "sessions", "--e2e--", "2026-10-20T01-17-16-019Z_resume.jsonl");
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await copyFile(path.join(root, "fixtures", "tsp", "resume-session.jsonl"), sessionFile);
  // omp 的空闲回顾只进 agent 目录的 history.db(session_recaps);会话 id 是会话文件头里的 id。
  // 两条:更早的一条在第 1 轮之后,最新一条在第 2 轮之后、第 3 轮开始之前——之后还有第 3 轮的消息,不能因此不显示。
  const starts = parseSession(await readFile(sessionFile, "utf8")).turnStarts;
  const secondsBetween = (a: number | undefined, b: number | undefined) => Math.floor(((a ?? 0) + (b ?? 0)) / 2 / 1000);
  const db = new DatabaseSync(path.join(agentDir, "history.db"));
  db.exec(
    "CREATE TABLE session_recaps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)))",
  );
  const insert = db.prepare("INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES (?, ?, ?, ?)");
  insert.run(
    "01a156e2-5573-752f-ae26-c89b4b0fd495",
    "E:/x",
    "更早的回顾:刚读完 calc.py。",
    secondsBetween(starts[0], starts[1]),
  );
  insert.run(
    "01a156e2-5573-752f-ae26-c89b4b0fd495",
    "E:/x",
    "目标是验证 calc.py。已读完三个文件,下一步等你的指示。",
    secondsBetween(starts[1], starts[2]),
  );
  db.close();
  const { launched, cleanup } = await start("resume", {
    PI_CODING_AGENT_DIR: agentDir,
    FAKE_TSP_SESSION_FILE: sessionFile,
  });
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    // 侧栏的项目文件夹默认折叠,openTaskRow 先展开再点任务行。
    await openTaskRow(page);
    await expect(role(page, "omp.user")).toHaveCount(3, { timeout: 30_000 });
    // 每轮末尾补一行用量:3 行,按会话文件算(第 1 轮 11.2s · 2859 tok · $0.0019),和 omp 实时那行同格式。
    const usage = page.locator('[data-testid="tsp-view"] [data-role="omp.turn.usage"][data-restored]');
    await expect(usage).toHaveCount(3);
    await expect(usage.nth(0)).toHaveText("11.2s · 2.9K tok · $0.0019 this turn");
    await expect(usage.nth(1)).toHaveText("47.5s · 2.8K tok · $0.0023 this turn");
    await expect(usage.nth(2)).toHaveText("4.7s · 1.1K tok · $0.0009 this turn");
    await expect(usage.nth(2)).toHaveAttribute("title", /^This turn: 4\.7s · 1,097 tokens \(838 in · 259 out\)/);
    // 补的行在每轮最后一个助手消息里面(和 omp 实时的位置一样),不是游离在外。
    await expect(page.locator('[data-role="omp.assistant"] > [data-role="omp.turn.usage"]')).toHaveCount(3);
    // 回顾:整个对话里只有最新的一条,图标是 ※(不是时钟/回退图标),斜体淡色,悬停提示是 omp 原样的英文。
    const recap = role(page, "omp.recap");
    await expect(recap).toHaveCount(1);
    await expect(recap).toContainText("目标是验证 calc.py");
    await expect(recap.locator(".tsp-icon")).toHaveCount(0);
    expect(
      await recap.evaluate((el) => (globalThis as unknown as PageStyle).getComputedStyle(el, "::before").content),
    ).toBe('"※"');
    await expect(recap).toHaveCSS("font-style", "italic");
    await expect(recap).toHaveAttribute("title", "Recap while you were away");
    // 位置:第 2 轮之后、第 3 轮之前(前两个用户消息在它前面,第三个在它后面)。
    const relations = await recap.evaluate((el) => {
      type Node = { compareDocumentPosition(other: unknown): number };
      const users = [
        ...(
          globalThis as unknown as { document: { querySelectorAll(selector: string): Node[] } }
        ).document.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.user"]'),
      ];
      return users.map((user) => (el as unknown as Node).compareDocumentPosition(user) & 6);
    });
    // 4 = 这个用户消息在回顾后面,2 = 在前面。
    expect(relations).toEqual([2, 2, 4]);
    await recap.scrollIntoViewIfNeeded();
    await shoot(page, "resume");
  } finally {
    await cleanup();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("压缩分隔画成整行横线夹文字;切模型后 omp 的状态行留在对话里(不是一闪而过的弹层);点分隔展开摘要", async () => {
  test.setTimeout(120_000);
  // 假 omp 回放的是 omp 18.12.5 `--resume` 一个压缩过的会话:section omp.compaction(折叠)、启动时的状态行,
  // 末尾是切模型后的 "Session-only model: …"(录制里选择器的那几帧去掉了,免得假 omp 等输入)。
  const { launched, cleanup } = await start("compact");
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    const divider = role(page, "omp.compaction");
    await expect(divider).toBeVisible({ timeout: 30_000 });
    // 头文字是 omp 原样的英文,中文界面也一样。
    const head = divider.locator(".tsp-section-head");
    await expect(head).toContainText("Snap-compacted");
    await expect(head).toContainText("48K");
    await expect(head).toContainText("6.1K tokens");
    // 整行分隔:文字两侧各一段连贯横线(伪元素,撑满剩余宽度,1px 高),没有折叠箭头。
    const parts = await head.evaluate((el) => {
      const win = globalThis as unknown as PageStyle;
      const child = (selector: string) =>
        (el as unknown as { querySelector(s: string): unknown }).querySelector(selector);
      const before = win.getComputedStyle(el, "::before");
      const after = win.getComputedStyle(el, "::after");
      return {
        before: { content: before.content, height: before.height, flexGrow: before.flexGrow },
        after: { content: after.content, height: after.height, flexGrow: after.flexGrow },
        chevron: win.getComputedStyle(child(".tsp-chev")).display,
        fontSize: win.getComputedStyle(child(".tsp-head")).fontSize,
      };
    });
    for (const line of [parts.before, parts.after])
      expect(line).toEqual({ content: '""', height: "1px", flexGrow: "1" });
    expect(parts.chevron).toBe("none");
    // 文字 13px(--fs-sm):比过程里的小字(12px)大一号。
    expect(parts.fontSize).toBe("13px");
    // 摘要默认收着,点文字展开。
    await expect(divider.locator(".tsp-section-body")).toHaveCount(0);
    await head.click();
    await expect(divider.locator(".tsp-section-body")).toContainText("The user asked two questions");
    await head.click();
    await expect(divider.locator(".tsp-section-body")).toHaveCount(0);
    // 状态行:启动时的两条 + 切模型那条,都留在对话里,没有弹层。
    const notes = page.getByTestId("tsp-status-note");
    await expect(notes).toHaveCount(3);
    await expect(notes.nth(0)).toHaveText("Session compacted 1 time");
    await expect(notes.nth(2)).toHaveText(
      "Session-only model: deepseek/deepseek-v4-pro. Use Alt+M or /model for roles.",
    );
    await expect(page.locator(".toast")).toHaveCount(0);
    // 它们在最后一条助手回答的后面。
    const order = await notes.nth(2).evaluate((el) => {
      type Node = { compareDocumentPosition(other: unknown): number };
      const assistants = [
        ...(
          globalThis as unknown as { document: { querySelectorAll(selector: string): Node[] } }
        ).document.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.assistant"]'),
      ];
      const last = assistants[assistants.length - 1];
      return last === undefined ? -1 : (el as unknown as Node).compareDocumentPosition(last) & 2;
    });
    // 2 = 最后一条助手回答在状态行前面。
    expect(order).toBe(2);
    await notes.nth(2).scrollIntoViewIfNeeded();
    await shoot(page, "compact");
  } finally {
    await cleanup();
  }
});

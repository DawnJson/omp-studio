// 模式胶囊和输入框上方状态区（spec §4.14，docs/architecture/conversation.md「模式与状态区」）：fake-tsp-omp 回放 omp 18.12.6 的录制
// （fixtures/tsp/composer-{loop,retry,interrupted}.jsonl、compact-ok、hub-steer），不调真实模型。假 omp 只在收到和录制一样的 send 之后才继续，
// 所以界面走得下去就证明发对了；另用 --log 断言它收到的 send / action。
// 首发不能是斜杠命令：先 createTask，再用开关表单（runTaskCommand）或 sendPrompt 直发。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, setLocaleTheme, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

interface Started {
  launched: LaunchedApp;
  received(): Promise<Record<string, unknown>[]>;
  cleanup(): Promise<void>;
}

async function start(fixture: string, speed: number): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp modes e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, fixture, `--speed=${speed}`, `--log=${log}`],
    }),
  });
  try {
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await launched.page.getByTestId("sidebar-open-folder").click();
    await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  } catch (error) {
    await launched.close().catch(() => {});
    await rm(work, { recursive: true, force: true });
    throw error;
  }
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

/** 建任务并打开（不发首发消息）；返回任务 id。 */
async function newTask(page: Page): Promise<string> {
  const taskId = await page.evaluate(async () => {
    const [p] = await globalThis.studio.listProjects();
    return (await globalThis.studio.createTask({ projectId: p!.id })).id;
  });
  await openTaskRow(page);
  return taskId;
}

async function sendPrompt(page: Page, taskId: string, text: string): Promise<void> {
  await page.evaluate(
    ([id, body]) => globalThis.studio.sendPrompt(id as never, { text: body!, whenBusy: "steer" }),
    [taskId, text],
  );
}

async function sentTexts(started: Started): Promise<string[]> {
  return (await started.received()).filter((event) => event["ev"] === "send").map((event) => String(event["text"]));
}

/** 截图：中英 × 深浅，名字 tsp-modes-<名>-<语言>-<主题>.png；每种主题换好以后调 `ready` 重新摆好界面（换主题会收起浮层）。 */
async function shoot(page: Page, name: string, ready: () => Promise<void> = async () => {}): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await setLocaleTheme(page, locale, scheme);
    await ready();
    await page.screenshot({ path: path.join(screenshotsDir, `tsp-modes-${name}-${locale}-${scheme}.png`) });
  }
}

test("模式胶囊(composer-loop):无模式时开关在会话开关菜单,Loop 表单开始 → 胶囊 Loop 3/3;扩展状态是只读标签;暂停后停止;实时速度来自 omp.composer.rate", async () => {
  test.setTimeout(120_000);
  const started = await start("composer-loop", 20);
  try {
    const { page } = started.launched;
    const taskId = await newTask(page);
    // 扩展 setStatus 写的两条状态：状态行右侧只读小标签，悬停（title）看全文。
    const tags = page.getByTestId("run-ext-tag");
    await expect(tags).toHaveCount(2, { timeout: 30_000 });
    await expect(tags.first()).toHaveText("Indexed 128 files");
    await expect(tags.first()).toHaveAttribute("title", "Indexed 128 files");
    await expect(page.getByTestId("mode-chip")).toHaveCount(0);

    // 没有模式：Plan / Vibe / Loop 的开关在会话开关菜单里。填次数 3，开始 → omp 收到 `/loop 3`。
    const openMenu = async () => {
      if ((await page.getByTestId("mode-loop-form").count()) === 0) await page.getByTestId("toggles-button").click();
      await expect(page.getByTestId("mode-loop-form")).toBeVisible();
    };
    await openMenu();
    await expect(page.getByTestId("toggle-plan")).toBeVisible();
    await expect(page.getByTestId("toggle-vibe")).toBeVisible();
    await page.getByTestId("mode-loop-limit").fill("3");
    await shoot(page, "loop-form", async () => {
      await openMenu();
      await page.getByTestId("mode-loop-limit").fill("3");
    });
    await openMenu();
    await page.getByTestId("mode-loop-limit").fill("3");
    await page.getByTestId("mode-loop-start").click();
    const chip = page.getByTestId("mode-chip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toHaveAttribute("data-mode", "loop");
    await expect(page.getByTestId("mode-chip-label")).toHaveText(/3\/3/);
    expect(await sentTexts(started)).toEqual(["/loop 3"]);

    // 回放里用户发一句话，循环从 3/3 跑到 0/3 后暂停；胶囊始终读 omp 的状态行。
    await sendPrompt(page, taskId, "Reply with just the word PONG and nothing else.");
    await expect(chip).toHaveAttribute("data-paused", "true", { timeout: 60_000 });
    await expect(page.getByTestId("mode-chip-label")).toHaveText(/0\/3|Loop/);
    await chip.click();
    await expect(page.getByTestId("mode-loop-status")).toHaveAttribute("data-state", "paused");
    await shoot(page, "chip", async () => {
      if ((await page.getByTestId("mode-loop-status").count()) === 0) await chip.click();
      await expect(page.getByTestId("mode-loop-status")).toBeVisible();
    });
    // 停止 = `/loop`；模式从状态行消失，胶囊随之没有。
    if ((await page.getByTestId("mode-loop-stop").count()) === 0) await chip.click();
    await page.getByTestId("mode-loop-stop").click();
    await expect(chip).toHaveCount(0, { timeout: 30_000 });
    expect((await sentTexts(started)).slice(0, 3)).toEqual([
      "/loop 3",
      "Reply with just the word PONG and nothing else.",
      "/loop",
    ]);

    // 速度：omp 开了 composer.tokenRate 时生成中出现 omp.composer.rate，工具行用它（取整，title 写明来源）。
    // 只在生成中显示。真实录制里第一帧 rate 到这一轮结束只有 80 毫秒，录制在这之后的帧（第 105 行起）手工整体推后了 40 秒
    // （回放速度 20 下约 2 秒），模拟一段更长的生成；仍按帧查，拿到就读文字。
    await sendPrompt(page, taskId, "Write the numbers from 1 to 60, one per line, nothing else.");
    const live = await page.waitForFunction(
      () => {
        const doc = (
          globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }
        ).document;
        return doc.querySelector('[data-testid="usage-tps"][data-live="true"]')?.textContent ?? null;
      },
      undefined,
      { timeout: 60_000, polling: "raf" },
    );
    expect(await live.jsonValue()).toMatch(/^\d+ tok\/s$/);
  } finally {
    await started.cleanup();
  }
});

test("自动重试(composer-retry):状态行画倒计时圆环和 第 N/M 次重试，点取消发出 omp 的 interrupt 动作", async () => {
  test.setTimeout(150_000);
  // 第 2 次重试的等待约 7 秒（录制里的时间），速度 1.6 让它在界面上停留 4 秒多，够截图和点击。
  const started = await start("composer-retry", 1.6);
  try {
    const { page } = started.launched;
    const taskId = await newTask(page);
    await sendPrompt(page, taskId, "Reply with just the word PONG.");
    const retry = page.getByTestId("run-retry");
    await expect(retry).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("run-retry-text")).toHaveText(/(1|2)\/3|Retry (1|2)\/3/, { timeout: 60_000 });
    await expect(page.getByTestId("run-retry-ring")).toBeVisible();
    await expect(page.getByTestId("run-retry-text")).toHaveText(/2\/3/, { timeout: 60_000 });
    await shoot(page, "retry");
    await page.getByTestId("run-cancel").click();
    await expect
      .poll(async () =>
        (await started.received()).some((event) => event["ev"] === "action" && event["act"] === "interrupt"),
      )
      .toBe(true);
  } finally {
    await started.cleanup();
  }
});

test("压缩(compact-ok):压缩时状态行出现不定进度条和取消，点取消发 omp 的 interrupt 动作", async () => {
  test.setTimeout(150_000);
  const started = await start("compact-ok", 2);
  try {
    const { page } = started.launched;
    const taskId = await newTask(page);
    await sendPrompt(page, taskId, "Write about 350 words on the history of bridges. No tools.");
    await expect.poll(() => sentTexts(started).then((texts) => texts.length)).toBe(1);
    await sendPrompt(page, taskId, "Write about 350 words on how volcanoes form. No tools.");
    await expect.poll(() => sentTexts(started).then((texts) => texts.length)).toBe(2);
    await sendPrompt(page, taskId, "/compact");
    await expect(page.getByTestId("run-compaction-bar")).toBeVisible({ timeout: 60_000 });
    await shoot(page, "compact");
    await page.getByTestId("run-cancel").click();
    await expect
      .poll(async () =>
        (await started.received()).some((event) => event["ev"] === "action" && event["act"] === "interrupt"),
      )
      .toBe(true);
  } finally {
    await started.cleanup();
  }
});

test("上一轮被中断(composer-interrupted):状态行写 上一轮被中断，点重试发 /retry", async () => {
  test.setTimeout(90_000);
  const started = await start("composer-interrupted", 20);
  try {
    const { page } = started.launched;
    const taskId = await newTask(page);
    await sendPrompt(page, taskId, "Run the shell command `sleep 60` using the bash tool and then say done.");
    const note = page.getByTestId("run-interrupted");
    await expect(note).toBeVisible({ timeout: 60_000 });
    await expect(note).toContainText(/上一轮被中断|last turn was interrupted/i);
    await shoot(page, "interrupted");
    await page.getByTestId("run-interrupted-retry").click();
    await expect.poll(() => sentTexts(started)).toContain("/retry");
  } finally {
    await started.cleanup();
  }
});

test("聚焦子代理(hub-steer):状态行上方横幅写正在给 Beta 发消息，输入框占位符换成对 Beta 说，回到主会话发 omp 的 focus:Main", async () => {
  test.setTimeout(150_000);
  const started = await start("hub-steer", 4);
  try {
    const { page } = started.launched;
    const taskId = await newTask(page);
    const first = (await readFixtureFirstPrompt()) ?? "";
    await sendPrompt(page, taskId, first);
    const pill = page.getByTestId("pill-agents");
    await expect(pill).toBeVisible({ timeout: 90_000 });
    await pill.click();
    const panel = page.getByTestId("agents-panel");
    await panel.locator('[data-testid="agents-row"][data-name="Beta"]').click();
    await panel.getByTestId("agents-steer-input").fill("Also say PINEAPPLE in your final reply.");
    await panel.getByTestId("agents-steer-input").press("Enter");
    // 插话期间主进程在后台聚焦 Beta：横幅和占位符跟着出现。
    const banner = page.getByTestId("run-focus");
    await expect(banner).toBeVisible({ timeout: 60_000 });
    await expect(banner).toContainText(/Beta/);
    await expect(page.getByTestId("composer-input")).toHaveAttribute("placeholder", /Beta/);
    await shoot(page, "focus");
    await page.getByTestId("run-focus-back").click();
    await expect.poll(async () => (await started.received()).some((event) => event["act"] === "focus:Main")).toBe(true);
    await expect(banner).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await started.cleanup();
  }
});

async function readFixtureFirstPrompt(): Promise<string | undefined> {
  const text = await readFile(path.join(root, "fixtures", "tsp", "hub-steer.jsonl"), "utf8");
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const entry = JSON.parse(line) as { dir: string; body?: { ev?: string; text?: string } };
    if (entry.dir === "in" && entry.body?.ev === "send") return entry.body.text;
  }
  return undefined;
}

// 上下文构成读的是 omp 自己的 /context：点圆环 → 主进程点 omp 输入框上的 meter、读完报告再关掉，界面上不出现 omp 的弹窗。
// 用 fixtures/tsp/context-report 回放（omp 18.12.6 实录：打开、关闭各两次）；中英 × 深浅截图到 screenshots/。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, setLocaleTheme, testOmp } from "./launch.ts";

async function received(log: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
    .filter((record) => record.kind === "tsp" && record.body?.["ev"] === "action")
    .map((record) => record.body!);
}

/** 从现在起 omp 的报告弹层进过 DOM 几次。 */
async function watchOmpReport(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const g = globalThis as unknown as {
      __ompReport: number;
      document: { body: unknown; querySelector(selector: string): unknown };
      MutationObserver: new (callback: () => void) => { observe(node: unknown, options: object): void };
    };
    g.__ompReport = 0;
    new g.MutationObserver(() => {
      if (g.document.querySelector('[data-role="omp.overlay.report"]')) g.__ompReport += 1;
    }).observe(g.document.body, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (globalThis as unknown as { __ompReport: number }).__ompReport);
}

test("上下文构成：数字来自 omp 的 /context，omp 的弹窗不出现、读完就关；再打开先显示上次的再重读；截图", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 上下文 e2e-"));
  const project = path.join(work, "项目 目录");
  const log = path.join(work, "omp-received.jsonl");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("context-report", { log }) });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await page.evaluate(async () => {
      const [p] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: p!.id });
    });
    await openTaskRow(page);
    const meter = page.getByTestId("composer-stack").getByTestId("context-meter");
    await expect(meter).toBeVisible({ timeout: 20_000 });
    const ompReportSeen = await watchOmpReport(page);

    await meter.click();
    const breakdown = page.getByTestId("context-breakdown");
    const row = (part: string) => breakdown.locator(`[data-testid="context-row"][data-part="${part}"]`);
    // omp 的类别和顺序、精确值换算出的缩写和百分比（窗口 200K）；已用 8.2K 不含剩余空间和预留。
    const expected: [string, string][] = [
      ["systemPrompt", "System prompt3K1.5%"],
      ["systemTools", "System tools4.5K2.3%"],
      ["systemContext", "System context1150.1%"],
      ["skills", "Skills5490.3%"],
      ["messages", "消息00%"],
      ["free", "剩余空间161.8K81%"],
      ["buffer", "自动压缩预留30K15%"],
    ];
    await expect(breakdown.getByTestId("context-row")).toHaveCount(expected.length);
    for (const [part, text] of expected) await expect(row(part)).toHaveText(text);
    await expect(breakdown.locator(".ctx-head")).toContainText("8.2K / 200K");
    await expect(breakdown.locator(".ctx-note")).toHaveCount(0);
    // omp 收到的是点 meter 和点报告的 Close（不是 Esc，Esc 在运行中会打断这一轮）。
    await expect
      .poll(() => received(log))
      .toEqual([
        { ev: "action", sf: "s:1", id: "3.context", act: "status.context" },
        { ev: "action", sf: "s:1", id: "q.actions/close", act: "close" },
      ]);
    expect(await ompReportSeen()).toBe(0);
    await expect(page.locator('[data-role="omp.overlay.report"]')).toHaveCount(0);

    for (const [locale, scheme] of [
      ["zh-CN", "light"],
      ["zh-CN", "dark"],
      ["en", "light"],
      ["en", "dark"],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await setLocaleTheme(page, locale, scheme);
      await page.screenshot({ path: path.join(screenshotsDir, `context-report-${locale}-${scheme}.png`) });
    }
    await setLocaleTheme(page, "zh-CN", "light");

    await page.keyboard.press("Escape");
    await expect(breakdown).toHaveCount(0);
    await expect(meter).toBeFocused();

    // 再打开：上次的数字立刻在（没有"正在计算"），同时又请 omp 读了一次（第二个报告有它自己的 Close）。
    await meter.click();
    await expect(row("systemTools")).toHaveText("System tools4.5K2.3%");
    await expect
      .poll(async () => (await received(log)).slice(2))
      .toEqual([
        { ev: "action", sf: "s:1", id: "3.context", act: "status.context" },
        { ev: "action", sf: "s:1", id: "s.actions/close", act: "close" },
      ]);
    expect(await ompReportSeen()).toBe(0);
    await page.keyboard.press("Escape");
    await expect(breakdown).toHaveCount(0);
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// 上下文构成读的是 omp 自己的 /context：点圆环 → 主进程点 omp 输入框上的 meter、读完报告再关掉，界面上不出现 omp 的弹窗。
// 用 fixtures/tsp/context-report 回放（omp 18.12.6 实录：打开、关闭各两次）。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoOverflow, launchApp, openTaskRow, setLocaleTheme, testOmp } from "./launch.ts";

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

test("上下文构成：数字来自 omp 的 /context，omp 的弹窗不出现、读完就关；再打开先显示上次的再重读", async () => {
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

/** 假 omp 收到的 send 事件的文字（`received` 只留 action）。 */
async function receivedSends(log: string): Promise<string[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
    .filter((record) => record.kind === "tsp" && record.body?.["ev"] === "send")
    .map((record) => String(record.body!["text"]));
}

/** 起 app、开项目、建任务、等圆环出现（context-report 回放：窗口 200K，omp 给的自动压缩触发点 85%）。 */
async function openContextTask(label: string) {
  const work = await mkdtemp(path.join(os.tmpdir(), `omp ${label} e2e-`));
  const project = path.join(work, "项目 目录");
  const log = path.join(work, "omp-received.jsonl");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("context-report", { log }) });
  const cleanup = async () => {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
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
    await expect(page.getByTestId("composer-stack").getByTestId("context-meter")).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { launched, page: launched.page, log, cleanup };
}

test("压缩一栏：圆环上有自动压缩刻度，构成里写在 85% 自动压缩；点「立即压缩」omp 收到 /compact", async () => {
  const { page, log, cleanup } = await openContextTask("压缩");
  try {
    const meter = page.getByTestId("composer-stack").getByTestId("context-meter");
    await expect(meter.getByTestId("context-ring-tick")).toHaveAttribute("data-at", "85");
    await meter.click();
    await expect(page.getByTestId("context-auto-at")).toHaveText(/85%/);
    await expect(page.getByTestId("context-handoff")).toBeEnabled();
    await expect(page.getByTestId("context-compaction")).toBeVisible();
    // "在 X% 自动压缩"和两个按钮在同一行：按钮在文字右边、竖向和文字重叠，"交接"贴着这一栏的右边。
    const [autoAt, compactBtn, handoffBtn, section] = await Promise.all(
      ["context-auto-at", "context-compact", "context-handoff", "context-compaction"].map((id) =>
        page.getByTestId(id).boundingBox(),
      ),
    );
    expect(compactBtn!.x).toBeGreaterThan(autoAt!.x + autoAt!.width);
    expect(compactBtn!.y).toBeLessThan(autoAt!.y + autoAt!.height);
    expect(compactBtn!.y + compactBtn!.height).toBeGreaterThan(autoAt!.y);
    expect(Math.abs(handoffBtn!.x + handoffBtn!.width - (section!.x + section!.width))).toBeLessThanOrEqual(1);
    // 窄窗口、中英文下这一栏都不越界（英文放不下时按钮换到下一行）。
    await page.setViewportSize({ width: 900, height: 900 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(page.getByTestId("context-compaction"));
    }
    await setLocaleTheme(page, "zh-CN", "light");
    await page.getByTestId("context-compact").click();
    await expect.poll(() => receivedSends(log)).toContain("/compact");
  } finally {
    await cleanup();
  }
});

test("压缩一栏：点「交接」omp 收到 /handoff", async () => {
  const { page, log, cleanup } = await openContextTask("交接");
  try {
    await page.getByTestId("composer-stack").getByTestId("context-meter").click();
    await page.getByTestId("context-handoff").click();
    await expect.poll(() => receivedSends(log)).toContain("/handoff");
  } finally {
    await cleanup();
  }
});

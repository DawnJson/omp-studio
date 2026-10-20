// 子代理泳道的端到端：假 omp 回放真实录制 fixtures/rpc/subagents-parallel.ndjson（两个并行子代理，一个读文件、一个读完写文件），
// 驱动 主进程 → IPC → 渲染进程：过程行展开出泳道、点开子代理详情、steer / cancel。
// 帧里没有时间戳，泳道的时间是主进程接收时间，所以回放时在子代理的帧之间插 delay，让时间轴有宽度。
// 中英 × 深浅各截图到 screenshots/（subagents-*）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fixtureFile = path.join(root, "fixtures", "rpc", "subagents-parallel.ndjson");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");

interface Line {
  kind: string;
  frame?: { type?: string; payload?: { progress?: { id?: string; toolCount?: number } } };
}

const FRAME_GAP_MS = 250;

/** 在每个子代理帧前等一会（时间轴有宽度）；cut 不为 null 时在第 cut 条之后截断并挂起（子代理停在运行中）。 */
async function paced(cutAt: ((line: Line) => boolean) | null): Promise<string> {
  const raw = (await readFile(fixtureFile, "utf8")).split("\n").filter(Boolean);
  const lines = raw.map((line): Line => JSON.parse(line));
  const cut = cutAt === null ? -1 : lines.findIndex(cutAt);
  if (cutAt !== null) expect(cut).toBeGreaterThan(0);
  const out: string[] = [];
  lines.forEach((line, index) => {
    if (cut !== -1 && index > cut) return;
    const type = line.kind === "out" ? line.frame?.type : undefined;
    if (type === "subagent_progress" || type === "subagent_lifecycle")
      out.push(JSON.stringify({ kind: "delay", ms: FRAME_GAP_MS }));
    out.push(raw[index] as string);
  });
  // 截断的尾部里 get_subagent_messages 的 in/out 要留着：fake-omp 靠它们回详情，它们不占回放顺序。
  if (cut !== -1) out.push(...raw.slice(cut + 1).filter((line) => line.includes("get_subagent_messages")));
  if (cut !== -1) out.push(JSON.stringify({ kind: "hang" }));
  return out.join("\n") + "\n";
}

const bothRunning = (line: Line) =>
  line.frame?.type === "subagent_progress" &&
  line.frame.payload?.progress?.id === "BetaSummarizer" &&
  (line.frame.payload.progress.toolCount ?? 0) >= 1;

async function start(fixtureText: string): Promise<{ launched: LaunchedApp; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 泳道 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  // BetaSummarizer 读的是相对路径 beta.txt：放一份真文件，点文件链接时预览能读到。
  await writeFile(path.join(project, "beta.txt"), "beta 的内容\n第二行\n");
  const fixture = path.join(work, "lanes.ndjson");
  await writeFile(fixture, fixtureText);
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  return {
    launched,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

async function openNewTaskAndSend(page: Page, prompt: string): Promise<void> {
  await page.evaluate(async () => {
    const project = await globalThis.studio.addProject();
    if (!project) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: project.id });
  });
  await openTaskRow(page);
  const input = page.getByTestId("composer-input");
  await expect(input).toBeVisible();
  await input.fill(prompt);
  await page.keyboard.press("Enter");
}

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
    await page.screenshot({ path: path.join(screenshotsDir, `subagents-${state}-${locale}-${scheme}.png`) });
  }
}

const prompt = "用 task 工具并行派两个子代理，分别读 alpha.txt 和 beta.txt";

test("回放结束后：展开已工作行出现泳道，两个子代理各一行，点开看费用、摘要、完整记录和只属于它的改动", async () => {
  const { launched, cleanup } = await start(await paced(null));
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, prompt);
    const done = page.getByTestId("process-done");
    await expect(done).toBeVisible({ timeout: 45_000 });
    await expect(done).toContainText("2 subagents");
    // 过程默认展开：泳道直接可见；标题行可收起再展开。
    await expect(page.getByTestId("lanes")).toBeVisible();
    await done.locator(".process-row").click();
    await expect(page.getByTestId("lanes")).toHaveCount(0);
    await done.locator(".process-row").click();
    await expect(page.getByTestId("lanes")).toBeVisible();
    const rows = page.getByTestId("lane-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-lane", "AlphaReader");
    await expect(rows.nth(1)).toHaveAttribute("data-lane", "BetaSummarizer");
    await expect(rows.nth(0)).toHaveAttribute("data-status", "completed");
    await expect(rows.nth(1)).toHaveAttribute("data-status", "completed");
    // 像 Tern 里 omp 的 Agents 表：表头是合计（费用 · 用时 · 请求 · token），行里有模型名，右侧数字列。
    await expect(page.getByTestId("lanes-toggle")).toContainText("Agents");
    await expect(page.getByTestId("lanes-totals")).toHaveText(/^\$[\d.]+ · [\d.]+s · \d+ req · [\d.]+K? tok$/);
    await expect(rows.nth(0)).toContainText("deepseek-v4-flash");
    // 数字列上下对齐：列头的 Cost 和两行的 Cost 右边缘一致。
    const costRight = async (row: ReturnType<Page["locator"]>) => {
      const box = await row.locator(".agent-num").first().boundingBox();
      return (box?.x ?? 0) + (box?.width ?? 0);
    };
    const header = page.locator(".agent-cols");
    const edges = await Promise.all([costRight(header), costRight(rows.nth(0)), costRight(rows.nth(1))]);
    expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
    // 过程里的普通工具行仍在泳道下面。
    await expect(page.locator(".details .step-tool").first()).toBeVisible();
    await page.getByTestId("lanes").evaluate("(el) => el.scrollIntoView({ block: 'start' })");
    await shoot(page, "lanes");

    await rows.nth(1).click();
    const detail = page.getByTestId("lane-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute("data-lane", "BetaSummarizer");
    await expect(detail).toContainText(/\$0\.0004/);
    // 完成的子代理不能再 steer / cancel。
    await expect(page.getByTestId("lane-steer")).toHaveCount(0);
    await expect(page.getByTestId("lane-cancel")).toHaveCount(0);
    // 摘要和完整记录来自 get_subagent_messages：读文件 + 写文件两次工具调用。
    await expect(page.getByTestId("lane-summary")).not.toContainText(/(还没有结论|No conclusion yet)/);
    await expect(page.getByTestId("lane-record").locator(".step-tool")).toHaveCount(2, { timeout: 10_000 });
    // 工具卡上的文件名可点：右侧打开预览，读的是任务目录里的 beta.txt；Esc 关闭，焦点回到链接。
    const link = page.getByTestId("lane-record").getByTestId("file-link").filter({ hasText: "beta.txt" }).first();
    await link.click();
    const preview = page.getByTestId("file-preview");
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("file-preview-name")).toHaveText("beta.txt");
    await expect(page.getByTestId("file-preview-body")).toContainText("beta 的内容");
    await shoot(page, "preview");
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(link).toBeFocused();
    // 只看它的改动：它写了 beta-summary.md；Alpha 没改文件。
    await page.getByTestId("lane-tab-changes").click();
    await expect(page.getByTestId("lane-changes")).toContainText("beta-summary.md");
    await page.getByTestId("lane-detail").evaluate("(el) => el.scrollIntoView({ block: 'start' })");
    await shoot(page, "detail");

    await rows.nth(0).click();
    await expect(detail).toHaveAttribute("data-lane", "AlphaReader");
    await page.getByTestId("lane-tab-changes").click();
    await expect(page.getByTestId("lane-changes")).not.toContainText("beta-summary.md");
    // 再点一次同一行收起详情。
    await rows.nth(0).click();
    await expect(detail).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("子代理在跑：运行中的泳道，steer 发出后有提示，cancel 要二次确认", async () => {
  const { launched, cleanup } = await start(await paced(bothRunning));
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, prompt);
    // 运行中泳道直接列在对话里，不用先点开；"N 个子代理在跑"在输入框上方的状态行。
    const live = page.getByTestId("process-live");
    await expect(live).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("run-status-main")).toContainText("2 subagents", { timeout: 30_000 });
    const rows = page.getByTestId("lane-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-status", "running");
    await expect(rows.nth(1)).toHaveAttribute("data-status", "running");

    await rows.nth(0).click();
    const detail = page.getByTestId("lane-detail");
    await expect(detail).toHaveAttribute("data-lane", "AlphaReader");
    const input = page.getByTestId("lane-steer").locator("input");
    await input.fill("也说一声 hi");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toasts")).toContainText("AlphaReader");
    await expect(input).toHaveValue("");

    await page.getByTestId("lane-cancel").click();
    await expect(page.getByTestId("lane-cancel-confirm")).toBeVisible();
    await page.getByTestId("lane-detail").evaluate("(el) => el.scrollIntoView({ block: 'end' })");
    await shoot(page, "running");
    // 先点"不取消"：确认条收起，子代理还在跑。
    await page.getByTestId("lane-cancel-confirm").locator("button").nth(1).click();
    await expect(page.getByTestId("lane-cancel-confirm")).toHaveCount(0);
    await page.getByTestId("lane-cancel").click();
    await page.getByTestId("lane-cancel-yes").click();
    // fake-omp 回 cancelled: true；界面等 omp 的 aborted 帧才改状态（这里没有），确认条收起、没有报错。
    await expect(page.getByTestId("lane-cancel-confirm")).toHaveCount(0);
    await expect(page.locator(".toast[data-level='error']")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

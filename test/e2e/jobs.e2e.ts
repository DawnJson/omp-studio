// 后台任务的端到端：假 omp 回放真实录制 fixtures/rpc/bg-jobs.ndjson（task 子代理 ListDir + 异步 bash bg_1，agent 用 wait 等它们），
// 验证 输入框上方"等待 N 个后台任务"状态行、输入框右上方的胶囊计数、点开的看板（列出两个 job，展开看输出，Esc 关闭回到胶囊）。
// 运行中的瞬间靠"在某一行之后截断并挂起"固定下来（和 subagent-lanes.e2e.ts 一样）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fixtureFile = path.join(root, "fixtures", "rpc", "bg-jobs.ndjson");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");

/** 回放到第 cutLine 行（1 起数）为止并挂起；null = 完整回放。 */
async function fixtureUntil(cutLine: number | null): Promise<string> {
  const raw = (await readFile(fixtureFile, "utf8")).split("\n").filter(Boolean);
  if (cutLine === null) return raw.join("\n") + "\n";
  // 截断的尾部里 get_subagent_messages 的 in/out 留着：fake-omp 靠它们回子代理详情，它们不占回放顺序。
  const rest = raw.slice(cutLine).filter((line) => line.includes("get_subagent_messages"));
  return [...raw.slice(0, cutLine), ...rest, JSON.stringify({ kind: "hang" })].join("\n") + "\n";
}

async function start(fixtureText: string): Promise<{ launched: LaunchedApp; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp jobs e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const fixture = path.join(work, "jobs.ndjson");
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
  await page.getByTestId("task-row").first().locator(".sb-row-main").click();
  const input = page.getByTestId("composer-input");
  await expect(input).toBeVisible();
  await input.fill(prompt);
  await page.keyboard.press("Enter");
}

const prompt =
  "用 task 工具开 1 个子代理读一下当前目录列出文件；同时用 bash 后台运行一个 12 秒的命令，等它们都结束再汇报。";

test("agent 在 wait 两个 job：状态行说在等几个，胶囊 2 运行 │ 0 结束；状态行下不再重复列 job", async () => {
  // 第 485 行：第一次 wait 的第二条 update，ListDir 和 bg_1 都还在跑。
  const { launched, cleanup } = await start(await fixtureUntil(485));
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, prompt);
    const status = page.getByTestId("run-status-main");
    await expect(status).toContainText(/(等待 2 个后台任务|waiting on 2 jobs)/, { timeout: 30_000 });
    await expect(page.getByTestId("job-chip")).toHaveCount(0);
    const pill = page.getByTestId("jobs-pill");
    await expect(pill.getByTestId("jobs-pill-running")).toHaveText("2");
    await expect(pill.getByTestId("jobs-pill-done")).toHaveText("0");
  } finally {
    await cleanup();
  }
});

test("子代理完成、bash 还在跑：1/2 个后台任务 · 1 个完成；看板列出两个 job，展开 bash 看输出，Esc 关闭回到胶囊", async () => {
  // 第 550 行：第二次 wait 的最后一条 update（bg_1 已跑了 11.7 秒），ListDir 早已完成。
  const { launched, cleanup } = await start(await fixtureUntil(550));
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, prompt);
    await expect(page.getByTestId("run-status-main")).toContainText(
      /(等待 1\/2 个后台任务 · 1 个完成|waiting on 1 of 2 jobs · 1 done)/,
      { timeout: 30_000 },
    );
    const pill = page.getByTestId("jobs-pill");
    await expect(pill.getByTestId("jobs-pill-running")).toHaveText("1");
    await expect(pill.getByTestId("jobs-pill-done")).toHaveText("1");
    // 胶囊不在输入框里：在输入框右上方单独一行（状态行之上），右边和输入框对齐（同 Tern 里的 omp）。
    await expect(page.locator(".composer").getByTestId("jobs-pill")).toHaveCount(0);
    const [pillBox, statusBox, composerBox] = await Promise.all([
      pill.boundingBox(),
      page.getByTestId("run-status").boundingBox(),
      page.locator(".composer").boundingBox(),
    ]);
    expect(pillBox && statusBox && pillBox.y + pillBox.height <= statusBox.y + 1).toBe(true);
    expect(
      pillBox && composerBox && Math.abs(pillBox.x + pillBox.width - (composerBox.x + composerBox.width)) <= 2,
    ).toBe(true);

    await pill.click();
    const board = page.getByTestId("jobs-board");
    await expect(board).toBeVisible();
    const rows = page.getByTestId("job-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-job-id", "ListDir");
    await expect(rows.nth(0)).toHaveAttribute("data-type", "task");
    await expect(rows.nth(0)).toHaveAttribute("data-status", "completed");
    await expect(rows.nth(1)).toHaveAttribute("data-job-id", "bg_1");
    await expect(rows.nth(1)).toHaveAttribute("data-type", "bash");
    await expect(rows.nth(1)).toHaveAttribute("data-status", "running");

    await page.keyboard.press("Escape");
    await expect(board).toHaveCount(0);
    await expect(pill).toBeFocused();
  } finally {
    await cleanup();
  }
});

test("回放结束后：胶囊 0 运行 │ 2 结束，看板里 ListDir 和 bg_1 都是已完成，bg_1 展开能看到命令输出", async () => {
  const { launched, cleanup } = await start(await fixtureUntil(null));
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, prompt);
    const pill = page.getByTestId("jobs-pill");
    await expect(pill.getByTestId("jobs-pill-done")).toHaveText("2", { timeout: 45_000 });
    await expect(pill.getByTestId("jobs-pill-running")).toHaveText("0");

    await pill.click();
    const rows = page.getByTestId("job-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute("data-status", "completed");
    await expect(rows.nth(1)).toHaveAttribute("data-status", "completed");
    await rows.nth(1).click();
    await expect(page.getByTestId("job-output")).toContainText("job-done");
  } finally {
    await cleanup();
  }
});

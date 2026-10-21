// 输入框草稿的端到端：草稿存进主进程（userData/drafts.json），防抖后落盘；刷新页面时防抖中的草稿被立刻冲刷。
// 任务用假 omp（伪终端里回放 fixtures/tsp/slash-status），项目目录带空格和中文。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, openTaskRow, testOmp, type LaunchedApp } from "./launch.ts";

async function start(): Promise<{ launched: LaunchedApp; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 草稿 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status") });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await launched.page.evaluate(async () => {
    const added = await globalThis.studio.addProject();
    if (!added) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: added.id });
  });
  await openTaskRow(launched.page);
  await expect(launched.page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
  await expect(launched.page.getByTestId("composer-input")).toBeVisible();
  return {
    launched,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

test("草稿存进主进程，防抖后落盘", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page, userDataDir } = launched;
    await page.getByTestId("composer-input").fill("打了一半的消息");
    await expect
      .poll(async () => readFile(path.join(userDataDir, "drafts.json"), "utf8").catch(() => ""), { timeout: 5000 })
      .toContain("打了一半的消息");
  } finally {
    await cleanup();
  }
});

test("刷新页面时防抖中的草稿被立刻冲刷，最后几个字不丢", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page, userDataDir } = launched;
    await page.getByTestId("composer-input").fill("刷新前最后几个字");
    await page.reload(); // 不等 400ms 防抖
    await expect
      .poll(async () => readFile(path.join(userDataDir, "drafts.json"), "utf8").catch(() => ""), { timeout: 5000 })
      .toContain("刷新前最后几个字");
  } finally {
    await cleanup();
  }
});

// 剪贴板的端到端：在输入框里粘贴资源管理器复制的文件 → 插入路径（preload 取路径）；对话里鼠标选中文字 → 自动复制（设置项可关），
// 输入框里选中不动剪贴板。用 PowerShell 的 Set-Clipboard -LiteralPath 放真实的文件列表（CF_HDROP），和在资源管理器里按 Ctrl+C 一样。
// 测试会改系统剪贴板，结束时恢复原来的文字内容（文件列表等其它格式恢复不了）。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { copyFilesToClipboard as copyFiles, launchApp, openTaskRow, testOmp, type LaunchedApp } from "./launch.ts";

interface Started {
  launched: LaunchedApp;
  work: string;
  cleanup(): Promise<void>;
}

async function start(): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 剪贴板 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  // resume 录制：omp 起来就把整段旧对话（用户消息、工具卡片、回答）画出来，不用先发消息。
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("resume") });
  const saved = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
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
  return {
    launched,
    work,
    async cleanup() {
      await launched.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved).catch(() => undefined);
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

function clipboardText(launched: LaunchedApp): Promise<string> {
  return launched.app.evaluate(({ clipboard }) => clipboard.readText());
}

test("粘贴文件：普通文件变成附件卡片和 #N 芯片，文件夹插入路径（有空格的加引号）；图片以外不弹提示；输入框没有附件按钮，也没有 file input", async () => {
  const { launched, work, cleanup } = await start();
  try {
    const { page } = launched;
    const spaced = path.join(work, "笔记 草稿.md");
    const plain = path.join(work, "data.csv");
    await writeFile(spaced, "# 草稿\n");
    await writeFile(plain, "a,b\n");

    // 附件只来自粘贴和拖入（2026-10-22 起没有附件按钮）：工具行里的 .tool-btn 只剩会话开关（齿轮），页面里没有 input[type=file]。
    await expect(page.getByTestId("composer-attach")).toHaveCount(0);
    await expect(page.locator(".composer-tools .tool-btn")).toHaveCount(1);
    await expect(page.locator(".composer input[type=file]")).toHaveCount(0);

    const input = page.getByTestId("composer-input");
    await input.fill("看看 ");
    await copyFiles([spaced, plain]);
    await input.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+V");
    // 普通文件是附件：顶部两张文件卡片，文字里是 #1 #2 芯片，路径不进输入框。
    const cards = page.getByTestId("attachment");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("data-kind", "file");
    await expect(cards.nth(0)).toContainText("笔记 草稿.md");
    await expect(cards.nth(1)).toContainText("data.csv");
    await expect(input).toHaveValue(/^看看 .*#1.*笔记.*草稿\.md.*#2.*data\.csv/);
    expect(await input.inputValue()).not.toContain(work);
    await expect(page.getByTestId("toasts")).toHaveText("");

    // 文件夹不是附件：和终端里一样插入路径，临时目录名里有空格，所以加引号；走输入框自己的编辑，Ctrl+Z 能撤回。
    await input.fill("看看 ");
    await expect(cards).toHaveCount(0);
    await copyFiles([work]);
    await input.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+V");
    await expect(input).toHaveValue(`看看 "${work}"`);
    await expect(cards).toHaveCount(0);
    await page.keyboard.press("Control+Z");
    await expect(input).toHaveValue("看看 ");
  } finally {
    await cleanup();
  }
});

test("选中即复制：对话里鼠标选中就进剪贴板并提示；输入框里选中不动剪贴板；设置里关掉后不再复制", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText("原来的内容"));

    // 恢复出来的最后一条回答的第一段。
    const answer = page.locator('[data-testid="tsp-view"] [data-role="omp.assistant"] p').first();
    await expect(answer).toBeVisible();
    const expected = ((await answer.textContent()) ?? "").trim();
    expect(expected).not.toBe("");
    await answer.click({ clickCount: 3 });
    await expect.poll(async () => (await clipboardText(launched)).trim()).toBe(expected);
    await expect(page.getByTestId("toasts").filter({ hasText: "已复制" })).toBeVisible();

    // 输入框里选中：剪贴板不变。
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText("原来的内容"));
    const input = page.getByTestId("composer-input");
    await input.fill("这段字不该被复制");
    await input.click({ clickCount: 3 });
    await page.waitForTimeout(200);
    expect(await clipboardText(launched)).toBe("原来的内容");

    // 关掉设置：对话里选中也不复制。
    await page.evaluate(() => globalThis.studio.setCopyOnSelect(false));
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await answer.click({ clickCount: 3 });
    await page.waitForTimeout(200);
    expect(await clipboardText(launched)).toBe("原来的内容");
  } finally {
    await cleanup();
  }
});

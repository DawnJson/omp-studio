// 剪贴板的端到端：在输入框里粘贴资源管理器复制的文件 → 插入路径（preload 取路径）；对话里鼠标选中文字 → 自动复制（设置项可关），
// 输入框里选中不动剪贴板。用 PowerShell 的 Set-Clipboard -LiteralPath 放真实的文件列表（CF_HDROP），和在资源管理器里按 Ctrl+C 一样。
// 测试会改系统剪贴板，结束时恢复原来的文字内容（文件列表等其它格式恢复不了）。
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, type LaunchedApp } from "./launch.ts";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "session-stats.ndjson");

interface Started {
  launched: LaunchedApp;
  work: string;
  cleanup(): Promise<void>;
}

async function start(): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 剪贴板 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  const saved = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await launched.page.getByTestId("sidebar-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
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

/** 像在资源管理器里选中这些文件按 Ctrl+C。 */
async function copyFiles(files: readonly string[]): Promise<void> {
  const list = files.map((file) => `'${file.replaceAll("'", "''")}'`).join(",");
  await run("powershell", ["-NoProfile", "-Command", `Set-Clipboard -LiteralPath ${list}`]);
}

function clipboardText(launched: LaunchedApp): Promise<string> {
  return launched.app.evaluate(({ clipboard }) => clipboard.readText());
}

async function sendFirst(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("assistant-message")).toContainText("4");
}

test("粘贴文件：插入路径（有空格的加引号），图片以外不弹提示；输入框没有添加附件的按钮", async () => {
  const { launched, work, cleanup } = await start();
  try {
    const { page } = launched;
    const spaced = path.join(work, "笔记 草稿.md");
    const plain = path.join(work, "data.csv");
    await writeFile(spaced, "# 草稿\n");
    await writeFile(plain, "a,b\n");

    await expect(page.locator(".composer-tools .tool-btn")).toHaveCount(0);
    await expect(page.locator(".composer input[type=file]")).toHaveCount(0);

    const input = page.getByTestId("composer-input");
    await input.fill("看看 ");
    await copyFiles([spaced, plain]);
    await input.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Control+V");
    // 临时目录名里有空格，两个路径都加引号。
    await expect(input).toHaveValue(`看看 "${spaced}" "${plain}"`);
    await expect(page.getByTestId("toasts")).toHaveText("");
    // 插入走的是输入框自己的编辑：Ctrl+Z 能撤回。
    await page.keyboard.press("Control+Z");
    await expect(input).toHaveValue("看看 ");
  } finally {
    await cleanup();
  }
});

test("选中即复制：对话里鼠标选中就进剪贴板并提示；输入框里选中不动剪贴板；设置里关掉后不再复制；复制按钮照常可用", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await sendFirst(page, "用一句中文回答：2+2 等于几？不要调用任何工具。");
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText("原来的内容"));

    const answer = page.getByTestId("assistant-message").locator("p").first();
    await answer.click({ clickCount: 3 });
    await expect.poll(async () => (await clipboardText(launched)).trim()).toBe("4。");
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

    // 复制按钮（写剪贴板的权限只放行应用自己的页面，之前全拒时按钮也复制不了）。
    await page.getByTestId("assistant-message").hover();
    await page.locator(".answer-copy").click();
    await expect.poll(() => clipboardText(launched)).toBe("4。");
  } finally {
    await cleanup();
  }
});

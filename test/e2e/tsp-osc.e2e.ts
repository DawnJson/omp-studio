// omp 的终端序列在界面上的结果（假 omp 回放 slash-status 录制 + 插入的 OSC，docs/architecture/tsp-migration.md §7）：
// 标题后缀 ` · #12` → 顶栏分支胶囊旁的 PR 徽标；OSC 7 当前目录 → 输入框工具行的文件夹标签。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { makeRepo } from "../git-helpers.ts";
import { launchApp, setLocale, testOmp, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

interface Session {
  launched: LaunchedApp;
  page: Page;
  work: string;
  project: string;
  cleanup(): Promise<void>;
}

async function start(omp: (work: string) => Promise<string>, env: Record<string, string> = {}): Promise<Session> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp osc 界面 e2e-"));
  const project = await makeRepo(work);
  const launched = await launchApp({ STUDIO_TEST_OMP: await omp(work), ...env });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await setLocale(page, "zh-CN");
    return {
      launched,
      page,
      work,
      project,
      async cleanup() {
        await launched.close();
        await rm(work, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await launched.close().catch(() => {});
    await rm(work, { recursive: true, force: true });
    throw error;
  }
}

async function sendFirstMessage(page: Page): Promise<void> {
  await page.getByTestId("composer-input").fill("hi");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tsp-view")).toBeVisible();
}

test("PR 徽标：标题后缀 ` · #12` 变成分支胶囊旁的 #12 按钮，任务标题里没有后缀", async () => {
  const session = await start(async () => testOmp("slash-status"), {
    FAKE_TSP_TITLE: "\u{f1821} 修复 登录 bug · #12",
  });
  try {
    const { page } = session;
    await sendFirstMessage(page);
    const badge = page.getByTestId("git-pr-badge");
    await expect(badge).toHaveText("#12");
    await expect(page.getByTestId("git-menu")).toBeVisible();
    const tasks = await page.evaluate(() => globalThis.studio.listTasks());
    expect(tasks.map((task) => task.title)).toContain("修复 登录 bug");
    expect(tasks.every((task) => !task.title.includes("#12"))).toBe(true);
  } finally {
    await session.cleanup();
  }
});

test("cwd 跟随：omp 发 OSC 7（目录名带空格和中文）后输入框的文件夹标签换成新目录", async () => {
  let moved = "";
  const session = await start(async (work) => {
    moved = path.join(work, "新 目录 two");
    await mkdir(moved);
    // slash-status 录制的第二行起插入 OSC 7（真实 omp 的写法：file://主机名 + pathToFileURL(目录).pathname）。
    const lines = (await readFile(path.join(root, "fixtures", "tsp", "slash-status.jsonl"), "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "");
    const osc = {
      t: JSON.parse(lines[0] as string).t,
      dir: "out",
      verb: "osc",
      body: `7;file://${os.hostname()}${pathToFileURL(moved).pathname}`,
    };
    const fixture = path.join(work, "slash-status-moved.jsonl");
    await writeFile(fixture, [lines[0], JSON.stringify(osc), ...lines.slice(1)].join("\n"));
    return testOmp(fixture);
  });
  try {
    const { page } = session;
    await sendFirstMessage(page);
    await expect(page.getByTestId("composer-folder")).toHaveText(/新 目录 two$/);
    const tasks = await page.evaluate(() => globalThis.studio.listTasks());
    expect(tasks.map((task) => task.cwd.toLowerCase())).toContain(moved.toLowerCase());
  } finally {
    await session.cleanup();
  }
});

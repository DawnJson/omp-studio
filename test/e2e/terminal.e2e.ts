// 内置终端的端到端：真实的 主进程 node-pty → IPC → 渲染进程 xterm，shell 是本机的 pwsh/powershell。
// 任务用假 omp（回放 bash-tool），项目目录带空格和中文。断言用户看得见的结果（xterm 的 DOM 行）和进程是否残留。
// 中英 × 深浅各截图到 screenshots/（terminal-*）。
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { TaskId } from "../../src/shared/ipc.ts";
import { findOmp, makeRepo, makeScratch } from "../git-helpers.ts";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "bash-tool.ndjson");

// 开发机/CI 的 shell 常设 NO_COLOR=1：应用和终端里的 PowerShell 会继承它并去掉输出里的颜色（空串也算设置了），
// 截图就看不到 ANSI 色板。只在本文件的测试进程里去掉。
delete process.env["NO_COLOR"];

interface Started {
  launched: LaunchedApp;
  taskId: TaskId;
  project: string;
  cleanup(): Promise<void>;
}

async function start(): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 终端 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  const { page } = launched;
  await page.evaluate(async () => {
    await globalThis.studio.setLocale("zh-CN");
    const added = await globalThis.studio.addProject();
    if (!added) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: added.id });
  });
  await page.getByTestId("task-row").first().locator(".sb-row-main").click();
  await expect(page.getByTestId("composer-input")).toBeVisible();
  const taskId = await page.evaluate(async () => (await globalThis.studio.listTasks())[0]?.id);
  if (taskId === undefined) throw new Error("没有任务");
  return {
    launched,
    taskId,
    project,
    async cleanup() {
      await launched.close();
      // 刚结束的进程可能还要一会儿才释放目录。
      await rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    },
  };
}

const rowsSelector = '[data-testid="terminal-host"] .xterm-rows > div';

/** xterm DOM 渲染器每行一个 div；空格可能是 NBSP。 */
async function termRows(page: Page): Promise<string[]> {
  const rows = await page.locator(rowsSelector).allInnerTexts();
  return rows.map((row) => row.replaceAll("\u00a0", " ").trimEnd());
}

async function expectRow(page: Page, matcher: RegExp | string): Promise<RegExpExecArray | null> {
  let found: RegExpExecArray | null = null;
  await expect
    .poll(
      async () => {
        for (const row of await termRows(page)) {
          const hit =
            typeof matcher === "string"
              ? row === matcher
                ? ([row] as unknown as RegExpExecArray)
                : null
              : matcher.exec(row);
          if (hit) {
            found = hit;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found;
}

async function run(page: Page, command: string): Promise<void> {
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

async function waitPrompt(page: Page): Promise<void> {
  await expectRow(page, /PS .*项目 目录>/);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function expectGone(pids: number[]): Promise<void> {
  await expect.poll(() => pids.filter(alive), { timeout: 15_000 }).toEqual([]);
}

async function openPanel(page: Page): Promise<void> {
  await page.keyboard.press("Control+`");
  await expect(page.getByTestId("terminal-panel")).toBeVisible();
}

test("Ctrl+` 打开终端：cwd 是项目目录、命令有输出；隐藏再打开恢复屏幕和同一个 shell", async () => {
  const { launched, project, cleanup } = await start();
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").focus();
    await openPanel(page);
    await expect(page.getByTestId("terminal-shell")).toHaveText(/^(pwsh|powershell)\.exe$/);
    await expect(page.getByTestId("terminal-cwd")).toHaveText("项目 目录");
    await expect(page.getByTestId("terminal-cwd")).toHaveAttribute("title", project);
    await waitPrompt(page);

    await run(page, "echo omp-studio-term");
    await expectRow(page, "omp-studio-term");
    await run(page, "Split-Path -Leaf (Get-Location)");
    await expectRow(page, "项目 目录");
    await run(page, "$x = 42");

    // Esc 属于终端：不会冒泡到全局（输入框的 Esc 停止任务就监听 window）。
    await page.evaluate(
      "(() => { window.__escSeen = 0; window.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.__escSeen += 1; }); })()",
    );
    await page.keyboard.press("Escape");
    expect(await page.evaluate("window.__escSeen")).toBe(0);

    // 隐藏面板不结束 shell；再打开时 backlog 还原屏幕，$x 还在。
    await page.getByTestId("terminal-hide").click();
    await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
    await page.getByTestId("topbar-terminal").click();
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
    await expectRow(page, "omp-studio-term");
    await run(page, '"x=$x"');
    await expectRow(page, "x=42");

    // Ctrl+` 从终端出来：面板收起，焦点回输入框。
    await page.keyboard.press("Control+`");
    await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toBeFocused();
    // 再按一次：打开并聚焦终端。
    await page.keyboard.press("Control+`");
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
    await expect(page.locator("[data-terminal-host] textarea")).toBeFocused();
  } finally {
    await cleanup();
  }
});

test("新任务草稿也有终端：发出第一条消息后，同一个 shell 和屏幕交给新建的任务", async () => {
  const { launched, project, taskId, cleanup } = await start();
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").focus();
    await page.keyboard.press("Control+n");
    await expect(page.getByTestId("empty-draft")).toBeVisible();
    await expect(page.getByTestId("topbar-terminal")).toBeVisible();

    // 草稿的终端在草稿项目（刚才那个）的目录里。
    await page.getByTestId("topbar-terminal").click();
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
    await expect(page.getByTestId("terminal-cwd")).toHaveAttribute("title", project);
    await waitPrompt(page);
    await run(page, '"pid=$PID"');
    const shellPid = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
    await run(page, "$x = 7; echo draft-marker");
    await expectRow(page, "draft-marker");

    // 发第一条消息：任务建出来，面板保持打开，还是同一个 shell（pid、$x、屏幕都在）。
    await page.getByTestId("composer-input").fill("你好");
    await page.getByTestId("send-button").click();
    await expect.poll(async () => (await page.evaluate(() => globalThis.studio.listTasks())).length).toBe(2);
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
    await expectRow(page, "draft-marker");
    await page.getByTestId("terminal-host").click();
    await run(page, '"again pid=$PID x=$x"');
    expect(Number((await expectRow(page, /^again pid=(\d+) x=7$/))?.[1])).toBe(shellPid);
    expect(alive(shellPid)).toBe(true);

    // 终端属于新任务：归档它，shell 随之结束；原来的任务没受影响。
    const tasks = await page.evaluate(() => globalThis.studio.listTasks());
    const created = tasks.find((task) => task.id !== taskId);
    if (!created) throw new Error("没有新任务");
    await page.evaluate((id) => globalThis.studio.archiveTask(id), created.id);
    await expectGone([shellPid]);
  } finally {
    await cleanup();
  }
});

test("shell 退出显示提示，按任意键在同一目录重新启动；重启按钮结束旧进程", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await openPanel(page);
    await waitPrompt(page);
    await run(page, '"pid=$PID"');
    const first = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
    expect(first).toBeGreaterThan(0);

    await run(page, "exit");
    await expectRow(page, /进程已退出，代码 0.*按任意键重新启动/);
    await expectGone([first]);
    await page.keyboard.press("a");
    await waitPrompt(page);
    await expect.poll(async () => (await termRows(page)).some((row) => row.includes("进程已退出"))).toBe(false);
    await run(page, '"pid=$PID"');
    await expect.poll(async () => (await termRows(page)).filter((row) => /^pid=\d+$/.test(row)).length).toBe(1);
    const second = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
    expect(second).not.toBe(first);

    await page.getByTestId("terminal-restart").click();
    await expectGone([second]);
    await waitPrompt(page);
    await run(page, '"pid=$PID"');
    const third = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
    expect(third).not.toBe(second);
  } finally {
    await cleanup();
  }
});

test("归档任务和退出应用都会结束终端及其子进程，不留残余", async () => {
  const { launched, taskId, cleanup } = await start();
  try {
    const { page } = launched;
    await openPanel(page);
    await waitPrompt(page);
    await run(page, '"pid=$PID"');
    const shellPid = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
    // 子进程（Start-Process 出来的 ping 继承应用 Job）：整棵树都要没。
    await run(
      page,
      "$p = Start-Process ping.exe -ArgumentList '-t','127.0.0.1' -WindowStyle Hidden -PassThru; \"child=$($p.Id)\"",
    );
    const childPid = Number((await expectRow(page, /^child=(\d+)$/))?.[1]);
    expect(alive(shellPid) && alive(childPid)).toBe(true);

    await page.evaluate((id) => globalThis.studio.archiveTask(id), taskId);
    await expectGone([shellPid, childPid]);
  } finally {
    await cleanup();
  }
});

test("退出应用时 shell 一起结束", async () => {
  const { launched, cleanup } = await start();
  const { page } = launched;
  await openPanel(page);
  await waitPrompt(page);
  await run(page, '"pid=$PID"');
  const shellPid = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
  expect(alive(shellPid)).toBe(true);
  await cleanup();
  await expectGone([shellPid]);
});

test("拖拽条和键盘调整高度：最小 120px、最大主区 70%，松手后持久化", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await openPanel(page);
    const handle = page.getByTestId("terminal-resizer");
    const height = async () => (await page.getByTestId("terminal-panel").boundingBox())?.height ?? 0;
    const before = await height();
    await handle.focus();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect.poll(height).toBe(before + 32);
    expect((await page.evaluate(() => globalThis.studio.getShellState())).terminalHeight).toBe(before + 32);

    // 拖到最上：不超过主区 70%。
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, 0, { steps: 6 });
    await page.mouse.up();
    const panel = (await page.getByTestId("main-panel").boundingBox())!;
    expect(await height()).toBeLessThanOrEqual(panel.height * 0.7 + 1);
    expect(await height()).toBeGreaterThan(before + 32);

    // 拖到最下：不小于 120px。
    const box2 = (await handle.boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2, panel.y + panel.height + 200, { steps: 6 });
    await page.mouse.up();
    expect(await height()).toBe(120);
    await page.waitForTimeout(100);
    expect((await page.evaluate(() => globalThis.studio.getShellState())).terminalHeight).toBe(120);
  } finally {
    await cleanup();
  }
});

test("命令面板可切换终端；对话已吸底时打开面板仍吸底", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").fill("用 bash 工具运行 echo omp-studio");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("assistant-message")).not.toHaveAttribute("data-live", "true", { timeout: 20_000 });
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-palette").getByRole("combobox").fill("切换终端");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("terminal-panel")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          "(() => { const el = document.querySelector('.scroller'); return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1; })()",
        ),
      )
      .toBe(true);
  } finally {
    await cleanup();
  }
});

test("截图：中英 × 深浅", async () => {
  const { launched, cleanup } = await start();
  try {
    const { page } = launched;
    await openPanel(page);
    await waitPrompt(page);
    await run(
      page,
      '(30..37)+(90..97) | % { Write-Host -NoNewline "$([char]27)[$($_)m■ $_ $([char]27)[0m" }; Write-Host ""; echo omp-studio-term',
    );
    await expectRow(page, "omp-studio-term");
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
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(screenshotsDir, `terminal-${locale}-${scheme}.png`) });
    }
    // 退出后的提示行也截一张（英文深色）。
    await page.getByTestId("terminal-host").click();
    await run(page, "exit");
    await expectRow(page, /Process exited with code 0/);
    await page.screenshot({ path: path.join(screenshotsDir, "terminal-exited-en-dark.png") });
  } finally {
    await cleanup();
  }
});

// worktree 由真实 omp 创建（omp worktree add）：PATH 上没有 omp 时跳过。
const realOmp = findOmp();

test("worktree 任务的终端在 worktree 目录里；丢弃 worktree 时先结束终端，目录才删得掉", async () => {
  test.skip(realOmp === null, "real omp is not on PATH; worktrees are created by `omp worktree add`");
  const scratch = await makeScratch("终端 worktree");
  const repo = await makeRepo(scratch);
  const launched = await launchApp({
    OMP_WORKTREE_DIR: path.join(scratch, "omp worktrees"),
    PI_CODING_AGENT_DIR: path.join(scratch, "omp agent"),
    STUDIO_TEST_WORKTREE_OMP: realOmp ?? "",
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page.evaluate(async () => {
      await globalThis.studio.setLocale("zh-CN");
      const added = await globalThis.studio.addProject();
      if (!added) throw new Error("addProject 没有返回项目");
      await globalThis.studio.createTask({ projectId: added.id, worktree: true });
    });
    await page.getByTestId("task-row").first().locator(".sb-row-main").click();
    // worktree 任务的 cwd 是 worktree 根，不是项目目录。
    const worktreeDir = await page.evaluate(async () => (await globalThis.studio.listTasks())[0]?.cwd);
    if (worktreeDir === undefined) throw new Error("没有任务");
    expect(worktreeDir).not.toBe(repo);

    await openPanel(page);
    // 终端头里的目录是 worktree 的最后一段，shell 里的当前目录也是它。
    await expect(page.getByTestId("terminal-cwd")).toHaveText(path.basename(worktreeDir));
    await run(page, '"pid=$PID"');
    const shellPid = Number((await expectRow(page, /^pid=(\d+)$/))?.[1]);
    await run(page, "Split-Path -Leaf (Get-Location)");
    await expectRow(page, path.basename(worktreeDir));

    const taskId = await page.evaluate(async () => (await globalThis.studio.listTasks())[0]?.id);
    if (taskId === undefined) throw new Error("没有任务");
    await page.evaluate((id) => globalThis.studio.discardTaskWorktree(id), taskId);
    expect(existsSync(worktreeDir)).toBe(false);
    await expectGone([shellPid]);
  } finally {
    await launched.close();
    await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
});

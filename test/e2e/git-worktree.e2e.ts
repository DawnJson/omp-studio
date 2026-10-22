// 阶段 4 worktree 与 git 操作的端到端：真实临时仓库（路径含空格和中文）+ 假 omp 回放（fake-tsp-omp，伪终端里）。
// 覆盖：工作树胶囊 → 任务在 worktree 里运行 → 提交对话框 → 合并回基分支 → 推送到本地裸仓库 → 丢弃确认 → 清理无主 worktree；
// 冲突 / 被拒绝的合并；不是 git 仓库时没有胶囊，空仓库时胶囊禁用。中英 × 深浅截图到 screenshots/。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { findOmp, makeRepo, put, sh } from "../git-helpers.ts";
import { expandSidebarFolders, launchApp, screenshotsDir, testOmp, type LaunchedApp } from "./launch.ts";

interface Session {
  launched: LaunchedApp;
  page: Page;
  work: string;
  /** 假 omp 每次启动记下的工作目录。 */
  cwdFile: string;
  cleanup(): Promise<void>;
}

// worktree 由真实 omp 创建（omp worktree add）：PATH 上没有 omp 时整个文件 skip。
const realOmp = findOmp();
test.skip(realOmp === null, "real omp is not on PATH; worktrees are created by `omp worktree add`");

function ompEnv(work: string): Record<string, string> {
  return {
    OMP_WORKTREE_DIR: path.join(work, "omp worktrees"),
    PI_CODING_AGENT_DIR: path.join(work, "omp agent"),
  };
}

async function start(prepare: (work: string) => Promise<string>): Promise<Session> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp git 界面 e2e-"));
  const project = await prepare(work);
  const cwdFile = path.join(work, "cwd.log");
  const launched = await launchApp({
    ...ompEnv(work),
    STUDIO_TEST_WORKTREE_OMP: realOmp ?? "",
    STUDIO_TEST_OMP: testOmp("slash-status"),
    FAKE_OMP_CWD_FILE: cwdFile,
  });
  const { page } = launched;
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await page.getByTestId("sidebar-open-folder").click();
  await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  await page.evaluate(() => globalThis.studio.setLocale("zh-CN"));
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", "zh-CN");
  return {
    launched,
    page,
    work,
    cwdFile,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
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
    await page.screenshot({ path: path.join(screenshotsDir, `git-${state}-${locale}-${scheme}.png`) });
  }
  // 回到中文浅色：后面的步骤按中文菜单文案找元素。
  await page.evaluate(async () => {
    await globalThis.studio.setLocale("zh-CN");
    await globalThis.studio.setTheme("light");
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await expect(page.getByTestId("app-root")).toHaveAttribute("data-locale", "zh-CN");
}

/** worktree 任务的 worktree 目录和分支（从主仓库的 `git worktree list` 读）。 */
function findStudioWorktree(repo: string): { dir: string; branch: string } | null {
  const blocks = sh(repo, "worktree", "list", "--porcelain").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dir = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(studio\/.+)$/m.exec(block)?.[1];
    if (dir && branch) return { dir: path.normalize(dir), branch };
  }
  return null;
}

const real = (target: string) => realpathSync.native(target).toLowerCase();

async function openGitMenu(page: Page, item: RegExp): Promise<void> {
  await page.getByTestId("git-menu").click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** 草稿顶栏分支胶囊的菜单里勾上 / 取消"在独立 worktree 里开始"（点了菜单就收回）。 */
async function toggleDraftWorktree(page: Page): Promise<void> {
  await page.getByTestId("draft-git-menu").click();
  await page.getByRole("menuitemcheckbox", { name: /在独立 worktree 里开始/ }).click();
}

/**
 * 在草稿里发第一条消息；withWorktree 时先在顶栏分支胶囊里勾上 worktree。setup 给了就处理项目 setup 脚本的确认对话框。返回新任务的 id。
 */
async function createTaskFromDraft(
  page: Page,
  text: string,
  withWorktree: boolean,
  setup?: "confirm",
): Promise<string> {
  if (withWorktree) {
    await toggleDraftWorktree(page);
    await expect(page.getByTestId("draft-git-menu")).toHaveAttribute("data-worktree", "true");
  }
  await page.getByTestId("composer-input").fill(text);
  await page.keyboard.press("Enter");
  if (setup === "confirm") await page.getByTestId("git-setup-confirm").click();
  const conversation = page.getByTestId("tsp-view");
  await expect(conversation).toBeVisible();
  const taskId = await conversation.getAttribute("data-task-id");
  expect(taskId).toBeTruthy();
  return taskId as string;
}

test("工作树任务：在 worktree 里运行 → 提交 → 合并 → 推送 → 丢弃 → 清理无主 worktree；截图", async () => {
  let repo = "";
  let bare = "";
  const session = await start(async (work) => {
    repo = await makeRepo(work);
    bare = path.join(work, "远端 仓库.git");
    await mkdir(bare);
    execFileSync("git", ["init", "--bare", "-b", "main", bare]);
    sh(repo, "remote", "add", "origin", bare);
    // setup 脚本：在新 worktree 里运行，写一个标记文件（只读主仓库里的这份，不必提交）。
    const setup =
      process.platform === "win32"
        ? { name: "setup.ps1", body: "Set-Content -Path setup-ran.txt -Value ok\n" }
        : { name: "setup.sh", body: "echo ok > setup-ran.txt\n" };
    await put(repo, `.omp-studio/${setup.name}`, setup.body);
    return repo;
  });
  const { page } = session;
  try {
    // ── 草稿顶栏的分支胶囊：显示项目当前分支，默认在主目录里做；菜单里勾上后胶囊写明"→ 新 worktree"，
    //    勾选项和悬停提示写明会运行 setup 脚本。输入框工具行里不再有 worktree 开关。
    const chip = page.getByTestId("draft-git-menu");
    await expect(page.getByTestId("draft-git-branch")).toHaveText("main");
    await expect(page.getByTestId("draft-git-worktree")).toHaveCount(0);
    await expect(page.getByTestId("draft-composer").getByText("Worktree")).toHaveCount(0);
    await chip.click();
    const item = page.getByRole("menuitemcheckbox", { name: /在独立 worktree 里开始/ });
    await expect(item).toHaveAttribute("aria-checked", "false");
    await expect(chip).toHaveAttribute("title", /\.omp-studio\/setup\.(ps1|sh)/);
    await item.click();
    await expect(page.getByTestId("draft-git-worktree")).toHaveText("→ 新 worktree");
    await expect(chip).toHaveAttribute("data-worktree", "true");
    await chip.click();
    await expect(item).toHaveAttribute("aria-checked", "true");
    await shoot(page, "draft-chip");
    await expect(item).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(item).toHaveCount(0);

    // ── 首次用 setup 脚本：先问；取消 = 不建 worktree、草稿保留、脚本没运行
    await page.getByTestId("composer-input").fill("在工作树里干活");
    await page.keyboard.press("Enter");
    const setupDialog = page.getByTestId("git-setup-dialog");
    await expect(setupDialog).toBeVisible();
    await expect(setupDialog).toContainText(".omp-studio/setup.");
    await shoot(page, "setup-dialog");
    await setupDialog.getByRole("button", { name: "取消" }).click();
    await expect(setupDialog).toHaveCount(0);
    await expect(page.getByTestId("toasts")).toContainText("没有创建 worktree");
    await expect(page.getByTestId("composer-input")).toHaveValue("在工作树里干活");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    expect(findStudioWorktree(repo)).toBeNull();
    await toggleDraftWorktree(page);

    // ── 创建：任务 cwd = worktree
    const taskId = await createTaskFromDraft(page, "在工作树里干活", true, "confirm");
    await expect(page.getByTestId("task-row-worktree")).toBeVisible();
    await expect(page.getByTestId("git-menu")).toHaveAttribute("title", /基于 main/);

    // ── 菜单收回：再点分支按钮 = 收回（只切换一次，不会收回又弹出）；点顶栏空白、Esc 也收回；菜单里没有"查看改动"（顶栏有评审按钮）
    const gitMenu = page.getByRole("menu", { name: "Git 操作" });
    await page.getByTestId("git-menu").click();
    await expect(gitMenu).toBeVisible();
    await expect(gitMenu.getByRole("menuitem", { name: /^查看改动/ })).toHaveCount(0);
    await shoot(page, "menu");
    await page.getByTestId("git-menu").click({ force: true });
    await expect(gitMenu).toHaveCount(0);
    await page.getByTestId("git-menu").click();
    await expect(gitMenu).toBeVisible();
    await page.mouse.click(600, 14);
    await expect(gitMenu).toHaveCount(0);
    await page.getByTestId("git-menu").click();
    await expect(gitMenu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gitMenu).toHaveCount(0);
    await expect(page.getByTestId("git-menu")).toBeFocused();
    const worktree = findStudioWorktree(repo);
    expect(worktree).not.toBeNull();
    const { dir, branch } = worktree as { dir: string; branch: string };
    await expect(page.getByTestId("git-branch")).toContainText(branch);
    expect(existsSync(path.join(dir, "setup-ran.txt"))).toBe(true);
    // 目录按 omp 的规则（OMP_WORKTREE_DIR）放，不在仓库旁边；omp 自己的 list 认得它。
    expect(real(path.dirname(dir))).toBe(real(path.join(session.work, "omp worktrees")));
    expect(
      execFileSync("omp", ["worktree", "list", "--json"], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, ...ompEnv(session.work) },
      }),
    ).toContain(branch);
    await expect
      .poll(() => readFile(session.cwdFile, "utf8").then((text) => text.trim().split(/\r?\n/).map(real)))
      .toContain(real(dir));
    const info = await page.evaluate((id) => globalThis.studio.getTaskWorktree(id as never), taskId);
    expect(info).toMatchObject({ branch, baseBranch: "main" });
    // 主仓库的工作区看不到 worktree（它在仓库之外）。
    expect(sh(repo, "status", "--porcelain")).not.toContain("worktrees");

    // ── 提交：在 worktree 里写文件，再用提交对话框提交（暂存全部）
    await writeFile(path.join(dir, "新文件 一.txt"), "来自工作树\n", "utf8");
    await openGitMenu(page, /^提交/);
    await expect(page.getByTestId("git-commit-dialog")).toBeVisible();
    // 提交前想看看改了什么：对话框里的"评审改动"关掉对话框、打开评审（里面能看到刚写的未跟踪文件），Esc 退出后可以接着提交。
    await page.getByTestId("git-commit-review").click();
    await expect(page.getByTestId("git-commit-dialog")).toHaveCount(0);
    await expect(page.getByTestId("review")).toBeVisible();
    await expect(
      page.locator('[data-testid=review-file][data-path="新文件 一.txt"][data-area=untracked]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("review")).toBeHidden();
    await openGitMenu(page, /^提交/);
    await expect(page.getByTestId("git-commit-dialog")).toBeVisible();
    await page.getByTestId("git-commit-message").fill("工作树里的提交");
    await shoot(page, "commit-dialog");
    await page.getByTestId("git-commit-confirm").click();
    await expect(page.getByTestId("toasts")).toContainText("已提交");
    await expect(page.getByTestId("git-commit-dialog")).toHaveCount(0);
    expect(sh(dir, "log", "-1", "--format=%s")).toBe("工作树里的提交");
    await expect(page.getByTestId("git-menu")).toHaveAttribute("title", /领先 1 个提交/);
    await expect(page.getByTestId("git-ahead")).toHaveText("↑1");

    // ── 合并回 main：文件出现在主目录
    await openGitMenu(page, /^合并回 main/);
    await expect(page.getByTestId("toasts")).toContainText("已合并到 main");
    expect(existsSync(path.join(repo, "新文件 一.txt"))).toBe(true);
    await expect(page.getByTestId("git-menu")).not.toHaveAttribute("title", /领先/);
    await expect(page.getByTestId("git-ahead")).toHaveCount(0);
    await openGitMenu(page, /^合并回 main/);
    await expect(page.getByTestId("toasts")).toContainText("没有新的提交可合并");

    // ── 推送到本地裸仓库（origin）：分支出现在远端
    await openGitMenu(page, /^推送$/);
    await expect(page.getByTestId("toasts")).toContainText(`已推送到 origin/${branch}`);
    expect(
      execFileSync("git", ["--git-dir", bare, "for-each-ref", "--format=%(refname:short)", "refs/heads"], {
        encoding: "utf8",
      }),
    ).toContain(branch);

    // ── 开 PR：这台机器没有 gh 时是类型化的 gh_unavailable（localized）；有 gh 时不真的去创建
    const hasGh = spawnSync("gh", ["--version"]).status === 0;
    if (!hasGh) {
      await openGitMenu(page, /^创建 PR/);
      await page.getByTestId("git-pr-title").fill("工作树 PR");
      await page.getByTestId("git-pr-confirm").click();
      await expect(page.getByTestId("toasts")).toContainText("找不到 gh 命令");
      await page.getByTestId("git-pr-dialog").getByRole("button", { name: "取消" }).click();
    }

    // ── 丢弃：先确认；任务归档、目录和分支都没了
    await openGitMenu(page, /^丢弃 worktree/);
    await expect(page.getByTestId("git-discard-dialog")).toContainText(branch);
    await page.getByTestId("git-discard-dialog").getByRole("button", { name: "取消" }).click();
    expect(existsSync(dir)).toBe(true);
    await openGitMenu(page, /^丢弃 worktree/);
    await shoot(page, "discard-dialog");
    await page.getByTestId("git-discard-confirm").click();
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await expect.poll(() => existsSync(dir)).toBe(false);
    expect(sh(repo, "branch", "--list", "studio/*")).toBe("");

    // ── 清理无主 worktree：干净且已合入的移除，有未合并提交的保留并报告原因
    const parent = path.join(path.dirname(repo), ".omp-studio-worktrees", path.basename(repo));
    sh(repo, "worktree", "add", "-b", "studio/orphan1", path.join(parent, "orphan1"), "HEAD");
    sh(repo, "worktree", "add", "-b", "studio/orphan2", path.join(parent, "orphan2"), "HEAD");
    await put(path.join(parent, "orphan2"), "孤儿.txt", "x\n");
    sh(path.join(parent, "orphan2"), "add", "-A");
    sh(path.join(parent, "orphan2"), "commit", "-m", "孤儿提交");
    // 文件夹折叠时 ⋯ 不显示（那一格是行数），项目菜单走右键文件夹头。
    await page.locator(".sb-group-head").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "清理无主 worktree" }).click();
    await expect(page.getByTestId("git-cleanup-removed")).toContainText("orphan1");
    await expect(page.getByTestId("git-cleanup-kept")).toContainText("orphan2");
    await expect(page.getByTestId("git-cleanup-kept")).toContainText("没合并的提交");
    await shoot(page, "cleanup-dialog");
    expect(existsSync(path.join(parent, "orphan1"))).toBe(false);
    expect(existsSync(path.join(parent, "orphan2"))).toBe(true);
  } finally {
    await session.cleanup();
  }
});

test("合并：有冲突时列出文件并撤销；工作树有未提交内容时被拒绝", async () => {
  let repo = "";
  const session = await start(async (work) => {
    repo = await makeRepo(work, "冲突 仓库");
    return repo;
  });
  const { page } = session;
  try {
    await createTaskFromDraft(page, "冲突", true);
    const { dir } = findStudioWorktree(repo) as { dir: string };

    // 未提交内容：合并被拒绝，提示在 toast 里
    await writeFile(path.join(dir, "草稿.txt"), "未提交\n", "utf8");
    await openGitMenu(page, /^合并回 main/);
    await expect(page.getByTestId("toasts")).toContainText("没提交的改动");
    await rm(path.join(dir, "草稿.txt"));

    // 两边改同一行：冲突。已撤销，两边工作区原样
    await writeFile(path.join(dir, "a.txt"), "工作树的版本\nbeta\n", "utf8");
    sh(dir, "commit", "-am", "工作树改 a");
    await writeFile(path.join(repo, "a.txt"), "主目录的版本\nbeta\n", "utf8");
    sh(repo, "commit", "-am", "主目录改 a");
    await openGitMenu(page, /^合并回 main/);
    await expect(page.getByTestId("git-conflict-dialog")).toBeVisible();
    await expect(page.getByTestId("git-conflict-files")).toContainText("a.txt");
    await shoot(page, "conflict-dialog");
    await page.getByTestId("git-conflict-dialog").getByRole("button", { name: "关闭" }).first().click();
    expect(sh(repo, "status", "--porcelain")).toBe("");
    expect(await readFile(path.join(repo, "a.txt"), "utf8")).toContain("主目录的版本");
  } finally {
    await session.cleanup();
  }
});

test("不是 git 仓库：输入框下面没有工作树开关，直接发送；顶栏没有分支按钮，从 git 任务切过来的第一帧也没有", async () => {
  let repo = "";
  const session = await start(async (work) => {
    repo = await makeRepo(work);
    const dir = path.join(work, "普通 目录");
    await mkdir(dir);
    return dir;
  });
  const { page, launched } = session;
  try {
    await expect(page.getByTestId("empty-project")).toBeVisible();
    await expect(page.getByTestId("draft-git-menu")).toHaveCount(0);
    await page.getByTestId("composer-input").fill("普通目录里的任务");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tsp-view")).toBeVisible();
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(0);
    await expect(page.getByTestId("topbar-terminal")).toBeVisible();
    await expect(page.getByTestId("git-menu")).toHaveCount(0);
    await expect(page.getByTestId("topbar-review")).toHaveCount(0);
    const plainTaskId = await page.getByTestId("tsp-view").getAttribute("data-task-id");

    // 再开一个 git 仓库里的任务：顶栏有分支按钮。
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, repo);
    await page.getByTestId("sidebar-open-folder").click();
    await expect(page.getByTestId("draft-git-menu")).toBeVisible();
    await page.getByTestId("composer-input").fill("仓库里的任务");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("git-menu")).toBeVisible();

    // 切回普通目录的任务：逐帧看，分支按钮和评审按钮一帧都不出现（不能先挂着上一个任务的分支，等状态回来再收掉）。
    await page.evaluate((plainId) => {
      const g = globalThis as unknown as {
        document: { querySelector(selector: string): unknown };
        requestAnimationFrame(callback: () => void): number;
        __gitFrames?: { seen: number; stop: boolean };
      };
      const state = { seen: 0, stop: false };
      g.__gitFrames = state;
      const tick = () => {
        const onPlain = g.document.querySelector(`[data-testid="tsp-view"][data-task-id="${plainId}"]`) !== null;
        if (onPlain && g.document.querySelector('[data-testid="git-menu"], [data-testid="topbar-review"]') !== null)
          state.seen++;
        if (!state.stop) g.requestAnimationFrame(tick);
      };
      tick();
    }, plainTaskId);
    expect(plainTaskId).toBeTruthy();
    await expandSidebarFolders(page);
    await page
      .locator(`[data-testid="task-row"]`)
      .filter({ hasText: "普通目录里的任务" })
      .locator(".sb-row-main")
      .click();
    await expect(page.getByTestId("tsp-view")).toHaveAttribute("data-task-id", plainTaskId as string);
    await page.waitForTimeout(800);
    const seen = await page.evaluate(() => {
      const g = globalThis as unknown as { __gitFrames: { seen: number; stop: boolean } };
      g.__gitFrames.stop = true;
      return g.__gitFrames.seen;
    });
    expect(seen).toBe(0);
    await expect(page.getByTestId("git-menu")).toHaveCount(0);
  } finally {
    await session.cleanup();
  }
});

test("仓库还没有提交：顶栏胶囊在，创建被拒绝后 worktree 勾选项禁用并写明原因，草稿保留；之后可以正常发送", async () => {
  const session = await start(async (work) => {
    const dir = path.join(work, "空 仓库");
    await mkdir(dir);
    sh(dir, "init", "-q");
    return dir;
  });
  const { page } = session;
  try {
    const chip = page.getByTestId("draft-git-menu");
    await toggleDraftWorktree(page);
    await page.getByTestId("composer-input").fill("不能用工作树");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toasts")).toContainText("还没有任何提交");
    await expect(page.getByTestId("draft-git-worktree")).toHaveCount(0);
    await expect(chip).toHaveAttribute("title", /不能用 worktree：.*还没有任何提交/);
    await chip.click();
    const item = page.getByRole("menuitemcheckbox", { name: /在独立 worktree 里开始/ });
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toHaveAttribute("aria-checked", "false");
    await expect(item).toHaveAttribute("title", /不能用 worktree：.*还没有任何提交/);
    await shoot(page, "chip-blocked");
    await expect(item).toBeVisible();
    // Esc 收回菜单，焦点回到胶囊；回输入框再发。
    await page.keyboard.press("Escape");
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId("draft-git-menu")).toBeFocused();
    await expect(page.getByTestId("composer-input")).toHaveValue("不能用工作树");
    await expect(page.getByTestId("task-row")).toHaveCount(0);

    await page.getByTestId("composer-input").press("Enter");
    await expect(page.getByTestId("tsp-view")).toBeVisible();
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(0);
  } finally {
    await session.cleanup();
  }
});

test("setup 脚本确认：同意后记住，同一份内容不再问；改了脚本再问；主进程不信渲染端（没确认直接建会被拒绝）", async () => {
  let repo = "";
  const win = process.platform === "win32";
  const scriptName = win ? "setup.ps1" : "setup.sh";
  const scriptBody = (marker: string) =>
    win ? `Set-Content -Path setup-ran.txt -Value ${marker}\n` : `echo ${marker} > setup-ran.txt\n`;
  const session = await start(async (work) => {
    repo = await makeRepo(work, "脚本 仓库");
    await put(repo, `.omp-studio/${scriptName}`, scriptBody("v1"));
    return repo;
  });
  const { page } = session;
  const dialog = page.getByTestId("git-setup-dialog");
  try {
    // 主进程强制：渲染端绕过对话框直接创建，脚本没确认过就拒绝，什么都不留，脚本没运行。
    const projectId = await page.evaluate(async () => (await globalThis.studio.listProjects())[0]?.id);
    expect(projectId).toBeTruthy();
    const rejected = await page.evaluate(
      (id) =>
        globalThis.studio.createTask({ projectId: id as never, worktree: true }).then(
          () => "created",
          (error: Error) => error.message,
        ),
      projectId,
    );
    expect(rejected).toMatch(/setup script not approved/);
    expect(findStudioWorktree(repo)).toBeNull();
    expect(sh(repo, "branch", "--list", "studio/*")).toBe("");
    const before = await page.evaluate((id) => globalThis.studio.getWorktreeSetupScript(id as never), projectId);
    expect(before).toMatchObject({ approved: false });

    // 首次：问 → 同意 → 脚本运行（v1）
    await createTaskFromDraft(page, "第一个", true, "confirm");
    const first = findStudioWorktree(repo) as { dir: string };
    expect((await readFile(path.join(first.dir, "setup-ran.txt"), "utf8")).trim()).toBe("v1");

    // 同一份内容：第二个任务不再问（项目分组旁的 ＋ 在这个仓库里开新任务；侧栏"新任务"是默认文件夹）
    await page.getByTestId("sidebar-project-new").first().click();
    await toggleDraftWorktree(page);
    await page.getByTestId("composer-input").fill("第二个");
    await page.keyboard.press("Enter");
    await expandSidebarFolders(page);
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(2);
    await expect(dialog).toHaveCount(0);

    // 改了脚本：再问；取消则不建
    await writeFile(path.join(repo, ".omp-studio", scriptName), scriptBody("v2"), "utf8");
    await page.getByTestId("sidebar-project-new").first().click();
    await toggleDraftWorktree(page);
    await page.getByTestId("composer-input").fill("第三个");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expandSidebarFolders(page);
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(2);
    // 再发一次并同意：运行的是 v2
    await page.keyboard.press("Enter");
    await page.getByTestId("git-setup-confirm").click();
    await expandSidebarFolders(page);
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(3);
    const worktrees = sh(repo, "worktree", "list", "--porcelain").match(/^worktree .+$/gm) ?? [];
    expect(worktrees).toHaveLength(4);
  } finally {
    await session.cleanup();
  }
});

// 阶段 4 worktree 与 git 操作的端到端：真实临时仓库（路径含空格和中文）+ 假 omp 回放。
// 覆盖：工作树胶囊 → 任务在 worktree 里运行 → 提交对话框 → 合并回基分支 → 推送到本地裸仓库 → 丢弃确认 → 清理无主 worktree；
// 冲突 / 被拒绝的合并；不是 git 仓库时胶囊的禁用。中英 × 深浅截图到 screenshots/。
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { findOmp, makeRepo, put, sh } from "../git-helpers.ts";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");
const fixture = path.join(root, "fixtures", "rpc", "simple-reply.ndjson");

interface Session {
  launched: LaunchedApp;
  page: Page;
  work: string;
  /** fake-omp 每次启动记下的工作目录。 */
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
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
    FAKE_OMP_CWD_FILE: cwdFile,
  });
  const { page } = launched;
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await page.getByTestId("sidebar-add-project").click();
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

/**
 * 在草稿里发第一条消息；withWorktree 时先打开工作树胶囊。setup 给了就处理项目 setup 脚本的确认对话框。返回新任务的 id。
 */
async function createTaskFromDraft(
  page: Page,
  text: string,
  withWorktree: boolean,
  setup?: "confirm",
): Promise<string> {
  if (withWorktree) {
    const chip = page.getByTestId("worktree-chip");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByTestId("composer-input").fill(text);
  await page.keyboard.press("Enter");
  if (setup === "confirm") await page.getByTestId("git-setup-confirm").click();
  const conversation = page.getByTestId("conversation");
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
    // ── 胶囊：默认关；打开后写明会运行 setup 脚本
    const chip = page.getByTestId("worktree-chip");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("worktree-setup-note")).toContainText("setup");
    await expect(chip).toHaveAttribute("title", /\.omp-studio\/setup\.(ps1|sh)/);
    await shoot(page, "composer-chip");

    // ── 首次用 setup 脚本：先问；取消 = 不建 worktree、草稿保留、脚本没运行
    await page.getByTestId("composer-input").fill("在工作树里干活");
    await page.keyboard.press("Enter");
    const setupDialog = page.getByTestId("git-setup-dialog");
    await expect(setupDialog).toBeVisible();
    await expect(setupDialog).toContainText(".omp-studio/setup.");
    await shoot(page, "setup-dialog");
    await setupDialog.getByRole("button", { name: "取消" }).click();
    await expect(setupDialog).toHaveCount(0);
    await expect(page.getByTestId("toasts")).toContainText("没有创建工作树");
    await expect(page.getByTestId("composer-input")).toHaveValue("在工作树里干活");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    expect(findStudioWorktree(repo)).toBeNull();
    await chip.click();

    // ── 创建：任务 cwd = worktree
    const taskId = await createTaskFromDraft(page, "在工作树里干活", true, "confirm");
    await expect(page.getByTestId("task-row-worktree")).toBeVisible();
    await expect(page.getByTestId("git-menu")).toHaveAttribute("title", /基于 main/);
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
    const hasGh = await page.evaluate(() => globalThis.studio.getGitTools().then((tools) => tools.gh));
    if (!hasGh) {
      await openGitMenu(page, /^创建 Pull Request/);
      await page.getByTestId("git-pr-title").fill("工作树 PR");
      await page.getByTestId("git-pr-confirm").click();
      await expect(page.getByTestId("toasts")).toContainText("找不到 gh 命令");
      await page.getByTestId("git-pr-dialog").getByRole("button", { name: "取消" }).click();
    }

    // ── 丢弃：先确认；任务归档、目录和分支都没了
    await openGitMenu(page, /^丢弃工作树/);
    await expect(page.getByTestId("git-discard-dialog")).toContainText(branch);
    await page.getByTestId("git-discard-dialog").getByRole("button", { name: "取消" }).click();
    expect(existsSync(dir)).toBe(true);
    await openGitMenu(page, /^丢弃工作树/);
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
    await page.getByRole("button", { name: "项目菜单" }).first().click();
    await page.getByRole("menuitem", { name: "清理无主工作树" }).click();
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

test("不是 git 仓库：创建被拒绝，胶囊禁用并写明原因，草稿保留；之后可以正常发送", async () => {
  const session = await start(async (work) => {
    const dir = path.join(work, "普通 目录");
    await mkdir(dir);
    return dir;
  });
  const { page } = session;
  try {
    const chip = page.getByTestId("worktree-chip");
    await chip.click();
    await page.getByTestId("composer-input").fill("不能用工作树");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("toasts")).toContainText("不是 git 仓库");
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect(chip).toHaveAttribute("title", /不能用工作树：.*不是 git 仓库/);
    await expect(page.getByTestId("composer-input")).toHaveValue("不能用工作树");
    await expect(page.getByTestId("task-row")).toHaveCount(0);
    await shoot(page, "chip-blocked");

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("conversation")).toBeVisible();
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(0);
    await expect(page.getByTestId("topbar-terminal")).toBeVisible();
    await expect(page.getByTestId("git-menu")).toHaveCount(0);
    await expect(page.getByTestId("topbar-review")).toHaveCount(0);
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

    // 同一份内容：第二个任务不再问
    await page
      .getByRole("button", { name: /新任务|New task/ })
      .first()
      .click();
    const chip = page.getByTestId("worktree-chip");
    await chip.click();
    await page.getByTestId("composer-input").fill("第二个");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(2);
    await expect(dialog).toHaveCount(0);

    // 改了脚本：再问；取消则不建
    await writeFile(path.join(repo, ".omp-studio", scriptName), scriptBody("v2"), "utf8");
    await page
      .getByRole("button", { name: /新任务|New task/ })
      .first()
      .click();
    await page.getByTestId("worktree-chip").click();
    await page.getByTestId("composer-input").fill("第三个");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(2);
    // 再发一次并同意：运行的是 v2
    await page.keyboard.press("Enter");
    await page.getByTestId("git-setup-confirm").click();
    await expect(page.getByTestId("task-row-worktree")).toHaveCount(3);
    const worktrees = sh(repo, "worktree", "list", "--porcelain").match(/^worktree .+$/gm) ?? [];
    expect(worktrees).toHaveLength(4);
  } finally {
    await session.cleanup();
  }
});

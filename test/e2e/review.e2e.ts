// 全屏评审端到端：临时 git 仓库（路径带空格和中文）+ 假 omp（fake-tsp-omp，伪终端里回放 fixtures/tsp/slash-status），
// 驱动真实的 主进程 → git IPC → 渲染进程：打开评审（顶栏评审按钮）、统一/并排、暂存一个 hunk、两条评论、发给 agent（断言 omp 收到的 send 事件文本）。
// 中英 × 深浅各截图到 screenshots/review-*.png。
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, testOmp, type LaunchedApp } from "./launch.ts";

const PATH_EDITED = "src/calc.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
}

const baseLines = Array.from({ length: 30 }, (_, i) => `export const value${i + 1} = ${i + 1};`);

/** 一行很长的 CSV（评审里会折成好几行）：改动是删掉它、换成短的两行——删除行要在旧行号列里显示行号。 */
const LONG_CSV = Array.from({ length: 24 }, (_, i) => `id${i},name${i},value${i},note${i}`).join(",");
const CSV_EDITED = "data.csv";

/** 提交一份基线，再造出：calc.ts 两处不相邻的改动（两个 hunk）、README 已暂存、一个未跟踪文本和一个未跟踪二进制。 */
async function makeRepo(parent: string): Promise<string> {
  const repo = path.join(parent, "评审 项目 目录");
  await mkdir(path.join(repo, "src"), { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "core.autocrlf", "false");
  await writeFile(path.join(repo, PATH_EDITED), baseLines.join("\n") + "\n");
  await writeFile(path.join(repo, "README.md"), "# demo\n");
  await writeFile(path.join(repo, CSV_EDITED), `id,name,value,note\n${LONG_CSV}\n${"tail,1,2,3\n".repeat(3)}`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const edited = [...baseLines];
  edited[2] = "export const value3 = 300;";
  edited[25] = "export const value26 = 2600;";
  await writeFile(path.join(repo, PATH_EDITED), edited.join("\n") + "\n");
  await writeFile(path.join(repo, "README.md"), "# demo\n\n评审用的示例。\n");
  await writeFile(
    path.join(repo, CSV_EDITED),
    `id,name,value,note\nid0,name0,value0,note0\nid1,name1,value1,note1\n${"tail,1,2,3\n".repeat(3)}`,
  );
  git(repo, "add", "README.md");
  await writeFile(path.join(repo, "新 文件.txt"), "第一行\n第二行\n");
  await writeFile(path.join(repo, "logo.bin"), Buffer.from([0, 1, 2, 0, 255, 0]));
  return repo;
}

interface Started {
  launched: LaunchedApp;
  repo: string;
  inputLog: string;
  cleanup(): Promise<void>;
}

async function start(options: { git: boolean }): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 评审 e2e-"));
  const repo = options.git ? await makeRepo(work) : path.join(work, "没有 git 的目录");
  if (!options.git) await mkdir(repo);
  const inputLog = path.join(work, "omp-input.jsonl");
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status", { log: inputLog }) });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, repo);
  await launched.page.setViewportSize({ width: 1280, height: 800 });
  return {
    launched,
    repo,
    inputLog,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

async function createAndSelectTask(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const project = await globalThis.studio.addProject();
    if (!project) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: project.id });
  });
  await openTaskRow(page);
}

async function openTask(page: Page): Promise<void> {
  await createAndSelectTask(page);
  await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("composer-input")).toBeVisible();
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
    await page.screenshot({ path: path.join(screenshotsDir, `review-${state}-${locale}-${scheme}.png`) });
  }
}

const gutter = (page: Page, line: number, side: "new" | "old" = "new") =>
  page.locator(`[data-testid=line-comment][data-side=${side}][data-line="${line}"]`);

const openFile = (page: Page, file: string, area: string) =>
  page.locator(`[data-testid=review-file][data-path="${file}"][data-area=${area}]`);

test("评审：文件树、统一/并排、暂存 hunk、两条评论、发给 agent", async () => {
  const { launched, repo, inputLog, cleanup } = await start({ git: true });
  try {
    const { page } = launched;
    await openTask(page);

    // 打开评审：顶栏的评审按钮。
    await page.getByTestId("topbar-review").click();
    const review = page.getByTestId("review");
    await expect(review).toBeVisible();
    await expect(page.getByTestId("review-branch")).toBeVisible();

    // 文件树三组：已暂存（README）、未暂存（calc.ts）、未跟踪（文本 + 二进制）。
    await expect(page.getByTestId("review-group")).toHaveCount(3);
    await expect(openFile(page, "README.md", "staged")).toBeVisible();
    await expect(openFile(page, PATH_EDITED, "unstaged")).toBeVisible();
    await expect(openFile(page, "新 文件.txt", "untracked")).toBeVisible();
    await expect(openFile(page, "logo.bin", "untracked")).toBeVisible();

    // 二进制文件：不显示内容。
    await openFile(page, "logo.bin", "untracked").click();
    await expect(page.getByTestId("diff-binary")).toBeVisible();

    // 未暂存的 calc.ts：两个 hunk，统一视图。
    await openFile(page, PATH_EDITED, "unstaged").click();
    await expect(page.getByTestId("hunk")).toHaveCount(2);
    await expect(page.locator(".rv-lines[data-mode=unified]")).toHaveCount(2);
    // 语法高亮（Shiki 异步加载语言包）：出现带颜色的片段。
    await expect(page.locator(".rv-code span[style*='color']").first()).toBeVisible({ timeout: 15_000 });

    // 并排：切换后每个 hunk 都是并排行，删除行在左、新增行在右。
    await page.getByTestId("mode-split").click();
    await expect(page.locator(".rv-lines[data-mode=split]")).toHaveCount(2);
    await expect(page.locator(".rv-half[data-kind=del]").first()).toContainText("value3 = 3;");
    await expect(page.locator(".rv-half[data-kind=add]").first()).toContainText("value3 = 300;");
    await shoot(page, "split");

    // 键盘：v 切回统一；j 切到下一个文件（未跟踪组按路径排序，logo.bin 在前）；k 回来；n 选中第一个 hunk。
    await page.keyboard.press("v");
    await expect(page.locator(".rv-lines[data-mode=unified]")).toHaveCount(2);
    await page.keyboard.press("j");
    await expect(openFile(page, "logo.bin", "untracked")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("k");
    await expect(openFile(page, PATH_EDITED, "unstaged")).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("n");
    await expect(page.locator("[data-testid=hunk][data-hunk='0']")).toHaveAttribute("data-active", "true");
    await page.keyboard.press("n");
    await expect(page.locator("[data-testid=hunk][data-hunk='1']")).toHaveAttribute("data-active", "true");

    // 暂存第一个 hunk：未暂存里只剩一个，已暂存多出 calc.ts；git 里也一致。
    await page.locator("[data-testid=hunk][data-hunk='0'] [data-testid=hunk-stage]").click();
    await expect(page.getByTestId("hunk")).toHaveCount(1);
    await expect(openFile(page, PATH_EDITED, "staged")).toBeVisible();
    expect(git(repo, "diff", "--cached", "--numstat")).toContain(PATH_EDITED);
    expect(git(repo, "diff", "--numstat")).toMatch(/1\s+1\s+src\/calc\.ts/);

    // 两条评论：第 26 行（单行）和第 23–25 行（Shift 点击扩展范围）。
    await gutter(page, 26).click();
    await expect(page.getByTestId("comment-box")).toBeVisible();
    await page.getByTestId("comment-input").fill("Why 2600? Use a named constant.");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByTestId("comment-card")).toHaveCount(1);
    await gutter(page, 23).click();
    await gutter(page, 25).click({ modifiers: ["Shift"] });
    await page.getByTestId("comment-input").fill("这三行是上下文，\n请补上注释。");
    await page.getByTestId("comment-submit").click();
    await expect(page.getByTestId("comment-card")).toHaveCount(2);
    await expect(page.getByTestId("comment-count")).toHaveText("2");
    await shoot(page, "comments");

    // 评论队列：两条，按行排序；Esc 退出评审后再打开仍在（队列跨关闭保留）。
    await expect(page.getByTestId("queued-comment")).toHaveCount(2);
    await shoot(page, "queue");
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await page.getByTestId("topbar-review").click();
    await expect(page.getByTestId("queued-comment")).toHaveCount(2);

    // 丢弃要确认：取消后 hunk 还在；确认丢弃未跟踪文件后文件从磁盘和树里消失。
    await openFile(page, PATH_EDITED, "unstaged").click();
    await page.getByTestId("hunk-discard").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(review).toBeVisible();
    await expect(page.getByTestId("hunk")).toHaveCount(1);
    await openFile(page, "新 文件.txt", "untracked").click();
    await page.getByTestId("file-discard").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button").last().click();
    await expect(openFile(page, "新 文件.txt", "untracked")).toHaveCount(0);
    await expect(stat(path.join(repo, "新 文件.txt"))).rejects.toThrow();

    // 发给 agent：关闭评审，队列清空，omp 收到一条带 文件:行范围 的 prompt。
    await page.getByTestId("review-send").click();
    await expect(review).toBeHidden();
    await expect
      .poll(async () => (await readFile(inputLog, "utf8").catch(() => "")).includes('"ev":"send"'), {
        timeout: 15_000,
      })
      .toBe(true);
    const prompts = (await readFile(inputLog, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind?: string; body?: { ev?: string; text?: string } })
      .filter((record) => record.kind === "tsp" && record.body?.ev === "send");
    expect(prompts).toHaveLength(1);
    const sent = prompts[0]?.body?.text ?? "";
    expect(sent).toContain(`${PATH_EDITED}:23-25`);
    expect(sent).toContain(`${PATH_EDITED}:26`);
    expect(sent).toContain("Why 2600? Use a named constant.");
    expect(sent).toContain("请补上注释。");
    expect(sent.indexOf(":23-25")).toBeLessThan(sent.indexOf(":26"));

    await page.getByTestId("topbar-review").click();
    await expect(page.getByTestId("queued-comment")).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("评审：删除行的旧行号一直在；悬停时加评论的 + 在行号左边，不顶掉也不遮住行号（长行折行也一样）", async () => {
  const { launched, cleanup } = await start({ git: true });
  try {
    const { page } = launched;
    await openTask(page);
    await page.getByTestId("topbar-review").click();
    await openFile(page, CSV_EDITED, "unstaged").click();

    // 评审盖住整个窗口：输入框所在的位置，最上面的元素在评审里面（输入框不透出来）。
    const composerBox = await page.getByTestId("composer-input").boundingBox();
    expect(composerBox).not.toBeNull();
    const covered = await page.evaluate(
      ({ x, y }) => {
        const doc = (
          globalThis as unknown as {
            document: { elementFromPoint(x: number, y: number): { closest(selector: string): unknown } | null };
          }
        ).document;
        return doc.elementFromPoint(x, y)?.closest("[data-testid=review]") != null;
      },
      {
        x: (composerBox?.x ?? 0) + (composerBox?.width ?? 0) / 2,
        y: (composerBox?.y ?? 0) + (composerBox?.height ?? 0) / 2,
      },
    );
    expect(covered).toBe(true);

    for (const mode of ["unified", "split"] as const) {
      if (mode === "split") await page.getByTestId("mode-split").click();
      const row = page.locator(mode === "unified" ? ".rv-row[data-kind=del]" : ".rv-half[data-kind=del]").first();
      await expect(row).toBeVisible();
      // 被删的是第 2 行（一整行长 CSV，折成好几行）：旧行号列写着 2，没有新行号。
      const button = row.locator("[data-testid=line-comment][data-side=old][data-line='2']");
      await expect(button).toBeVisible();
      await expect(button.locator(".rv-no-n")).toHaveText("2");
      expect(((await row.boundingBox())?.height ?? 0) > 3 * 18).toBe(true);

      // 悬停前后行号都看得见（不透明）；+ 只在悬停时出现，且整个在行号左边。
      const number = button.locator(".rv-no-n");
      const plus = button.locator(".rv-no-plus");
      await page.mouse.move(1, 1);
      await expect(number).toHaveCSS("opacity", "1");
      await expect(plus).toHaveCSS("opacity", "0");
      await button.hover();
      await expect(number).toHaveCSS("opacity", "1");
      await expect(plus).toHaveCSS("opacity", "1");
      const [numberBox, plusBox, rowBox] = await Promise.all([
        number.boundingBox(),
        plus.boundingBox(),
        row.boundingBox(),
      ]);
      expect(numberBox && plusBox && rowBox).toBeTruthy();
      if (!numberBox || !plusBox || !rowBox) return;
      expect(plusBox.x + plusBox.width).toBeLessThanOrEqual(numberBox.x + 0.5);
      // 长行折行时行号和 + 都贴着第一行，不是在整块的垂直中间。
      expect(numberBox.y - rowBox.y).toBeLessThan(6);
      expect(plusBox.y - rowBox.y).toBeLessThan(6);
      if (mode === "unified") await shoot(page, "gutter");
    }

    // 新增行只有一列行号（新行号）；上下文行也只有一列。
    await page.getByTestId("mode-unified").click();
    const add = page.locator(".rv-row[data-kind=add]").first();
    await expect(add.locator(".rv-no")).toHaveCount(1);
    await expect(add.locator(".rv-no")).toHaveText("2");
    const context = page.locator(".rv-row:not([data-kind=add]):not([data-kind=del])").last();
    await expect(context.locator(".rv-no")).toHaveCount(1);
    await expect(context.locator(".rv-no")).toHaveText(/^\d+$/);
  } finally {
    await cleanup();
  }
});

test("评审：文件树每行 +a −d、变更行左缘竖条、改动块/整个文件视图、折行、内嵌提交框", async () => {
  const { launched, repo, cleanup } = await start({ git: true });
  try {
    const { page } = launched;
    git(repo, "config", "user.name", "t");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "commit.gpgsign", "false");
    await openTask(page);
    await page.getByTestId("topbar-review").click();
    const review = page.getByTestId("review");
    await expect(review).toBeVisible();

    // 1. 文件树每行 +a −d（二进制没有）；状态字母还在。
    const counts = (file: string, area: string) => openFile(page, file, area).getByTestId("review-file-counts");
    await expect(counts(PATH_EDITED, "unstaged")).toHaveText("+2−2");
    await expect(counts("README.md", "staged")).toHaveText("+2−0");
    await expect(counts("新 文件.txt", "untracked")).toHaveText("+2−0");
    await expect(counts(CSV_EDITED, "unstaged")).toHaveText("+2−1");
    await expect(counts("logo.bin", "untracked")).toHaveCount(0);
    await expect(openFile(page, PATH_EDITED, "unstaged").locator(".rv-kind")).toHaveText("M");

    // 2. 新增 / 删除行左缘有彩色竖条（上下文行没有）；3. 统一视图只有一列行号。
    await openFile(page, PATH_EDITED, "unstaged").click();
    await expect(page.getByTestId("hunk")).toHaveCount(2);
    const barOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const view = globalThis as unknown as { getComputedStyle(target: unknown): { boxShadow: string } };
          return view.getComputedStyle(element).boxShadow;
        });
    const addBar = await barOf(".rv-row[data-kind=add]");
    const delBar = await barOf(".rv-row[data-kind=del]");
    const contextBar = await barOf(".rv-row:not([data-kind=add]):not([data-kind=del])");
    expect(addBar).not.toContain("rgba(0, 0, 0, 0)");
    expect(delBar).not.toContain("rgba(0, 0, 0, 0)");
    expect(addBar).not.toBe(delBar);
    expect(contextBar).toContain("rgba(0, 0, 0, 0)");
    await expect(page.locator(".rv-row[data-kind=add]").first().locator(".rv-no")).toHaveCount(1);
    await expect(page.locator(".rv-row[data-kind=add]").first().locator(".rv-no")).toHaveText("3");

    // 4. 整个文件视图：一个 hunk、没有 @@ 头和 hunk 级操作，30 行里两处替换 = 28 + 2×2 = 32 行；n / p 在改动块之间走。
    await expect(page.getByTestId("scope-hunks")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("scope-file").click();
    await expect(page.getByTestId("scope-file")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("hunk")).toHaveCount(1);
    await expect(page.locator(".rv-hunk-head")).toHaveCount(0);
    await expect(page.locator(".rv-row")).toHaveCount(32);
    await page.keyboard.press("n");
    await expect(page.locator(".rv-row[data-block-active]")).toHaveAttribute("data-block", "0");
    await page.keyboard.press("n");
    await expect(page.locator(".rv-row[data-block-active]")).toHaveAttribute("data-block", "1");
    await page.keyboard.press("p");
    await expect(page.locator(".rv-row[data-block-active]")).toHaveAttribute("data-block", "0");
    // 选择在评审关闭再打开后还在（会话内记住）；键盘 f 切回改动块。
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await page.getByTestId("topbar-review").click();
    await expect(page.getByTestId("scope-file")).toHaveAttribute("aria-pressed", "true");
    await openFile(page, PATH_EDITED, "unstaged").click();
    await page.keyboard.press("f");
    await expect(page.getByTestId("scope-hunks")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("hunk")).toHaveCount(2);

    // 折行开关：默认折行；关掉后代码不折行、hunk 自己横向滚动。
    const wrap = page.getByTestId("wrap-toggle");
    await expect(wrap).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".rv-hunk .rv-code").first()).toHaveCSS("white-space", "pre-wrap");
    await wrap.click();
    await expect(wrap).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".rv-hunk[data-wrap=off]")).toHaveCount(2);
    await expect(page.locator(".rv-hunk .rv-code").first()).toHaveCSS("white-space", "pre");
    await page.keyboard.press("w");
    await expect(wrap).toHaveAttribute("aria-pressed", "true");

    // 5. 内嵌提交框：没有摘要时不能提交；只提交已暂存的（README），其余仍在树里；提交信息 = 摘要 + 空行 + 说明。
    const summary = page.getByTestId("review-commit-summary");
    const submit = page.getByTestId("review-commit-submit");
    await expect(page.getByTestId("review-commit-staged")).toContainText("1");
    await expect(submit).toBeDisabled();
    await summary.fill("Add readme");
    await page.getByTestId("review-commit-description").fill("评审里提交。");
    await shoot(page, "commit");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(openFile(page, "README.md", "staged")).toHaveCount(0);
    await expect(openFile(page, PATH_EDITED, "unstaged")).toBeVisible();
    await expect(summary).toHaveValue("");
    expect(git(repo, "log", "-1", "--format=%B").trim()).toBe("Add readme\n\n评审里提交。");
    expect(git(repo, "show", "--name-only", "--format=", "HEAD").trim()).toBe("README.md");
  } finally {
    await cleanup();
  }
});

test("评审：不是 git 仓库的任务目录给出明确提示；快捷键 Ctrl+Shift+D 打开、Esc 退出", async () => {
  const { launched, cleanup } = await start({ git: false });
  try {
    const { page } = launched;
    await createAndSelectTask(page);
    await page.getByTestId("composer-input").focus();
    await page.keyboard.press("Control+Shift+D");
    await expect(page.getByTestId("review")).toBeVisible();
    await expect(page.getByTestId("review-not-git")).toBeVisible();
    await shoot(page, "not-git");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("review")).toBeHidden();
    await expect(page.getByTestId("composer-input")).toBeFocused();
  } finally {
    await cleanup();
  }
});

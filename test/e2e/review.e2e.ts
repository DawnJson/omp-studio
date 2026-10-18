// 全屏评审（PLAN 阶段 3）端到端：临时 git 仓库（路径带空格和中文）+ 假 omp 回放一次 edit 工具调用，
// 驱动真实的 主进程 → git IPC → 渲染进程：打开评审、统一/并排、暂存一个 hunk、两条评论、发给 agent（断言 omp 收到的 prompt 文本）。
// 中英 × 深浅各截图到 screenshots/review-*.png。
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");

const INTENT = "Bump the calc constants";
const CONCLUSION = "Changed two constants in calc.ts.";
const PATH_EDITED = "src/calc.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
}

const baseLines = Array.from({ length: 30 }, (_, i) => `export const value${i + 1} = ${i + 1};`);

/** 提交一份基线，再造出：calc.ts 两处不相邻的改动（两个 hunk）、README 已暂存、一个未跟踪文本和一个未跟踪二进制。 */
async function makeRepo(parent: string): Promise<string> {
  const repo = path.join(parent, "评审 项目 目录");
  await mkdir(path.join(repo, "src"), { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "core.autocrlf", "false");
  await writeFile(path.join(repo, PATH_EDITED), baseLines.join("\n") + "\n");
  await writeFile(path.join(repo, "README.md"), "# demo\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  const edited = [...baseLines];
  edited[2] = "export const value3 = 300;";
  edited[25] = "export const value26 = 2600;";
  await writeFile(path.join(repo, PATH_EDITED), edited.join("\n") + "\n");
  await writeFile(path.join(repo, "README.md"), "# demo\n\n评审用的示例。\n");
  git(repo, "add", "README.md");
  await writeFile(path.join(repo, "新 文件.txt"), "第一行\n第二行\n");
  await writeFile(path.join(repo, "logo.bin"), Buffer.from([0, 1, 2, 0, 255, 0]));
  return repo;
}

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const assistant = (content: unknown[], stopReason: string) => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  usage,
  stopReason,
  timestamp: 1792285889005,
});
const out = (frame: Record<string, unknown>) => JSON.stringify({ kind: "out", frame });

/**
 * 握手部分取自真实录制（bash-tool 的前 19 行：到第一个 prompt 的应答为止），后面手写：
 * 一次成功的 edit 调用（intent + 结论）、会话结束；再回放评审评论带来的第二个 prompt。
 */
async function editFixture(): Promise<string> {
  const recorded = (await readFile(path.join(root, "fixtures", "rpc", "bash-tool.ndjson"), "utf8"))
    .split("\n")
    .filter(Boolean);
  const args = { i: INTENT, path: PATH_EDITED };
  const call = { type: "toolCall", id: "call_edit_1", name: "edit", arguments: args, intent: INTENT };
  const userMessage = {
    role: "user",
    content: [{ type: "text", text: "bump the constants" }],
    attribution: "user",
    timestamp: 1792285888969,
  };
  const result = {
    content: [{ type: "text", text: "Updated src/calc.ts" }],
    details: {
      diff: "-export const value3 = 3;\n+export const value3 = 300;\n-export const value26 = 26;\n+export const value26 = 2600;",
    },
  };
  const toolResult = {
    role: "toolResult",
    toolCallId: "call_edit_1",
    toolName: "edit",
    content: result.content,
    details: result.details,
    isError: false,
    timestamp: 1792285890611,
  };
  const text = assistant([{ type: "text", text: CONCLUSION }], "stop");
  return (
    [
      ...recorded.slice(0, 19),
      out({ type: "agent_start" }),
      out({ type: "turn_start" }),
      out({ type: "message_start", message: userMessage, messageId: "msg-1" }),
      out({ type: "message_end", message: userMessage, messageId: "msg-1" }),
      out({ type: "message_start", message: assistant([call], "toolUse"), messageId: "msg-2" }),
      out({ type: "message_end", message: assistant([call], "toolUse"), messageId: "msg-2" }),
      out({ type: "tool_execution_start", toolCallId: "call_edit_1", toolName: "edit", args, intent: INTENT }),
      out({ type: "tool_execution_end", toolCallId: "call_edit_1", toolName: "edit", result, isError: false }),
      out({ type: "message_start", message: toolResult, messageId: "msg-3" }),
      out({ type: "message_end", message: toolResult, messageId: "msg-3" }),
      out({ type: "turn_end", message: assistant([call], "toolUse"), toolResults: [] }),
      out({ type: "turn_start" }),
      out({ type: "message_start", message: text, messageId: "msg-4" }),
      out({ type: "message_end", message: text, messageId: "msg-4" }),
      out({ type: "turn_end", message: text, toolResults: [] }),
      out({ type: "agent_end", messages: [], isTerminal: true, yielded: false }),
      out({ type: "prompt_result", id: "req-7", agentInvoked: true, status: "completed", sessionSettled: true }),
      out({ type: "session_settled" }),
      // 评审评论发出的 prompt
      JSON.stringify({ kind: "in", frame: { message: "(review comments)", id: "req-8", type: "prompt" } }),
      out({ id: "req-8", type: "response", command: "prompt", success: true }),
      out({ type: "agent_start" }),
      out({ type: "agent_end", messages: [], isTerminal: true, yielded: false }),
      out({ type: "prompt_result", id: "req-8", agentInvoked: true, status: "completed", sessionSettled: true }),
      out({ type: "session_settled" }),
    ].join("\n") + "\n"
  );
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
  const fixture = path.join(work, "edit.ndjson");
  const inputLog = path.join(work, "omp-input.log");
  await writeFile(fixture, await editFixture());
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture, inputLog] }),
  });
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
  await page.getByTestId("task-row").first().locator(".sb-row-main").click();
}

async function runTurn(page: Page): Promise<void> {
  await createAndSelectTask(page);
  const input = page.getByTestId("composer-input");
  await expect(input).toBeVisible();
  await input.fill("bump the constants");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("change-card")).toBeVisible({ timeout: 20_000 });
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

test("评审：文件树、统一/并排、暂存 hunk、两条评论、说明面板、发给 agent", async () => {
  const { launched, repo, inputLog, cleanup } = await start({ git: true });
  try {
    const { page } = launched;
    await runTurn(page);

    // 打开评审：改动卡片上的入口。
    await page.getByTestId("change-review").click();
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

    // 说明面板：这个文件被哪个 edit 工具改的（intent）和那一轮的结论。
    await page.getByTestId("tab-explain").click();
    await expect(page.getByTestId("explain-edit")).toContainText(INTENT);
    await expect(page.getByTestId("explain-conclusion")).toContainText(CONCLUSION);

    // 评论队列：两条，按行排序；Esc 退出评审后再打开仍在（队列跨关闭保留）。
    await page.getByTestId("tab-comments").click();
    await expect(page.getByTestId("queued-comment")).toHaveCount(2);
    await shoot(page, "queue");
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await page.getByTestId("change-review").click();
    await page.getByTestId("tab-comments").click();
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
      .poll(async () => (await readFile(inputLog, "utf8").catch(() => "")).split("\n").filter(Boolean).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    const prompts = (await readFile(inputLog, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; message?: string })
      .filter((frame) => frame.type === "prompt");
    expect(prompts).toHaveLength(2);
    const sent = prompts[1]?.message ?? "";
    expect(sent).toContain(`${PATH_EDITED}:23-25`);
    expect(sent).toContain(`${PATH_EDITED}:26`);
    expect(sent).toContain("Why 2600? Use a named constant.");
    expect(sent).toContain("请补上注释。");
    expect(sent.indexOf(":23-25")).toBeLessThan(sent.indexOf(":26"));

    await page.getByTestId("change-review").click();
    await page.getByTestId("tab-comments").click();
    await expect(page.getByTestId("queued-comment")).toHaveCount(0);
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

// TSP 任务的会话树面板、回溯和分叉（docs/architecture/session-tree.md）：假 omp 回放 omp 18.12.5 录的 fixtures/tsp/session-tree.jsonl
// （`/tree` → activate 用户消息 → 清空预填的输入框），会话文件是 omp 真实产出的 fixtures/omp-session/linear.jsonl。
// 假 omp 只有收到和录制一样的 send / activate / edit 才继续回放，所以"输入框里出现那条消息的文字"本身就证明主进程发对了事件。
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, setLocaleTheme, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
const BETA_TEXT = "Reply with exactly: BETA. No tools.";

interface Started {
  launched: LaunchedApp;
  /** 任务的会话文件（测试里往它追加条目，模拟 omp 写 label 条目）。 */
  sessionFile: string;
  /** 假 omp 收到的 TSP 事件（send / activate / edit / select / action）。 */
  received(): Promise<Record<string, unknown>[]>;
  cleanup(): Promise<void>;
}

async function start(
  fixture = "session-tree",
  session = "linear",
  { cards = 2, transform = (text: string) => text }: { cards?: number; transform?(text: string): string } = {},
): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp tree e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const sessionFile = path.join(work, "agent", "sessions", "--e2e--", "2026-10-21T18-14-31-448Z_linear.jsonl");
  await mkdir(path.dirname(sessionFile), { recursive: true });
  const text = await readFile(path.join(root, "fixtures", "omp-session", `${session}.jsonl`), "utf8");
  await writeFile(sessionFile, transform(text));
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, fixture, "--speed=20", `--log=${log}`],
    }),
    PI_CODING_AGENT_DIR: path.join(work, "agent"),
    FAKE_TSP_SESSION_FILE: sessionFile,
  });
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  await launched.page.getByTestId("sidebar-open-folder").click();
  await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  await launched.page.evaluate(async () => {
    const [first] = await globalThis.studio.listProjects();
    await globalThis.studio.createTask({ projectId: first!.id });
  });
  await openTaskRow(launched.page);
  // 录制是 `--resume` 一个会话：默认两轮、两张用户消息卡片画出来（压缩过的会话 omp 只画压缩点之后的内容，没有用户消息卡片）。
  await expect(launched.page.locator('[data-testid="tsp-view"] [data-role="omp.user"]')).toHaveCount(cards, {
    timeout: 30_000,
  });
  return {
    launched,
    sessionFile,
    async received() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
        .filter((record) => record.kind === "tsp" && record.body !== undefined)
        .map((record) => record.body as Record<string, unknown>)
        .filter((body) => ["send", "activate", "edit", "select", "action"].includes(String(body["ev"])));
    },
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
}

test("/tree：studio 的会话树面板列出会话文件里的用户消息；选一条回到它之前，omp 收到 /tree + activate，文字进输入框", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start();
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.fill("/tree");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("session-tree");
    await expect(panel).toBeVisible();
    const nodes = panel.getByTestId("session-tree-node");
    await expect(nodes).toHaveCount(2);
    await expect(nodes.nth(0)).toContainText("Reply with exactly: ALPHA. No tools.");
    await expect(nodes.nth(1)).toContainText(BETA_TEXT);
    // 最后一条是当前位置，光标停在它上面。
    await expect(nodes.nth(1)).toHaveAttribute("data-current", "true");
    await expect(nodes.nth(1)).toHaveAttribute("aria-selected", "true");
    // TSP 任务每行有"从这里分叉"。
    await expect(panel.getByTestId("session-tree-fork")).toHaveCount(2);

    await nodes.nth(1).click();
    await expect(panel).toHaveCount(0);
    await expect(input).toHaveValue(BETA_TEXT, { timeout: 20_000 });
    expect(await received()).toEqual([
      { ev: "send", sf: "s:1", id: "j.line/input", text: "/tree" },
      { ev: "activate", sf: "s:1", id: "s.^picker", item: "b772c2f5" },
      { ev: "edit", sf: "s:1", id: "j.line/input", from: 0, to: 35, text: "", cursor: 0, len: 35 },
    ]);
    // omp 回溯后只重画到新叶子：只剩 ALPHA 一张卡片；再打开面板，叶子在 ALPHA 上。
    await expect(page.locator('[data-testid="tsp-view"] [data-role="omp.user"]')).toHaveCount(1);
    await input.fill("/tree");
    await page.keyboard.press("Enter");
    await expect(panel.getByTestId("session-tree-node").nth(0)).toHaveAttribute("data-current", "true");
    await expect(panel.getByTestId("session-tree-node").nth(1)).toHaveAttribute("data-branch", "false");
  } finally {
    await cleanup();
  }
});

test("用户消息上 omp 的回退图标：studio 接管，打开会话树面板并对准那条消息，不把 rewind 发给 omp", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start();
  try {
    const { page } = launched;
    const first = page.locator('[data-testid="tsp-view"] [data-role="omp.user"]').nth(0);
    await first.hover();
    await first.locator('[data-role="omp.user.tool"][title^="Rewind"]').click();
    const panel = page.getByTestId("session-tree");
    await expect(panel).toBeVisible();
    // 点的是第一张卡片：光标在第一条用户消息（不是最后一条）。
    await expect(panel.getByTestId("session-tree-node").nth(0)).toHaveAttribute("aria-selected", "true");
    expect(await received()).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test('分叉：面板里点"从这里分叉"新建任务并选中，omp --fork 起的新进程收到 /tree + activate，文字在新任务的输入框里；原任务还在', async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start();
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.fill("/tree");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("session-tree");
    await expect(panel).toBeVisible();
    await panel.getByTestId("session-tree-node").nth(1).hover();
    await panel.getByTestId("session-tree-fork").nth(1).click();
    await expect(panel).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row")).toHaveCount(2);
    await expect(page.getByTestId("composer-input")).toHaveValue(BETA_TEXT, { timeout: 20_000 });
    // 被选中的是新任务（侧栏第二行之外的那个）：它的标题记着分叉。
    await expect(page.locator('[data-testid="task-row"][data-selected="true"]')).toHaveCount(1);
    const events = await received();
    expect(events.map((event) => event["ev"])).toEqual(["send", "activate", "edit"]);
    expect(events[1]).toMatchObject({ item: "b772c2f5" });
  } finally {
    await cleanup();
  }
});

test("回溯并摘要：勾选面板底部的开关再选一条消息，omp 收到 select + action summarize（它自己的 Shift+Enter），文字进输入框", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start("session-tree-summarize", "prompt");
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.fill("/tree");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("session-tree");
    await expect(panel).toBeVisible();
    await panel.getByTestId("session-tree-summarize").check();
    await panel.getByTestId("session-tree-node").nth(1).click();
    await expect(panel).toHaveCount(0, { timeout: 30_000 });
    await expect(input).toHaveValue(BETA_TEXT, { timeout: 20_000 });
    expect((await received()).map((event) => event["ev"])).toEqual(["send", "select", "action", "edit"]);
  } finally {
    await cleanup();
  }
});

async function shoot(page: Page, state: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await setLocaleTheme(page, locale, scheme);
    await page.screenshot({ path: path.join(screenshotsDir, `session-tree-${state}-${locale}-${scheme}.png`) });
  }
}

test("压缩过的会话：压缩点是分隔节点（带压缩前 token 数、不能回溯）；悬停一条用户消息提示会离开几轮；搜索框按文字过滤，Esc 先清搜索再关面板", async () => {
  test.setTimeout(120_000);
  // omp 18.12.5 录的 compaction.keepRecentTokens=5 + /compact：重新 --resume 后 omp 只画压缩点之后的内容，没有用户消息卡片。
  const { launched, received, cleanup } = await start("session-tree-compacted", "compacted", { cards: 0 });
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").fill("/tree");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("session-tree");
    await expect(panel).toBeVisible();
    const nodes = panel.getByTestId("session-tree-node");
    await expect(nodes).toHaveCount(3);
    const compaction = nodes.nth(2);
    await expect(compaction).toHaveAttribute("data-kind", "compaction");
    await expect(compaction).toHaveAttribute("data-current", "true");
    await expect(compaction).toContainText("8,934");
    // 只有两条用户消息有"从这里分叉"；点压缩点什么也不发生。
    await expect(panel.getByTestId("session-tree-fork")).toHaveCount(2);
    await compaction.click();
    await expect(panel).toBeVisible();
    expect(await received()).toEqual([]);

    // 回溯提示：回到 ALPHA 之前，当前对话里 ALPHA、BETA 两轮离开；回到 BETA 之前只有 BETA。
    const discard = panel.getByTestId("session-tree-discard");
    await nodes.nth(0).hover();
    await expect(discard).toHaveAttribute("data-count", "2");
    await nodes.nth(1).hover();
    await expect(discard).toHaveAttribute("data-count", "1");
    await shoot(page, "compaction");

    // 搜索：按消息文字过滤（不分大小写）；没有匹配时提示；Esc 先清搜索。
    const search = panel.getByTestId("session-tree-search");
    await search.fill("beta");
    await expect(nodes).toHaveCount(1);
    await expect(nodes.first()).toContainText(BETA_TEXT);
    await search.fill("zzz");
    await expect(panel.getByTestId("session-tree-nomatch")).toBeVisible();
    await shoot(page, "search-empty");
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(nodes).toHaveCount(3);
    await expect(panel).toBeVisible();
    await search.press("Escape");
    await expect(panel).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("回溯时摘要过的会话：branch_summary 是树里的摘要节点（徽标 + 摘要第一句），不能回溯；搜索也搜得到它", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("session-tree-summarize", "summarized");
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").fill("/tree");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("session-tree");
    const nodes = panel.getByTestId("session-tree-node");
    await expect(nodes).toHaveCount(3);
    const summary = nodes.nth(2);
    await expect(summary).toHaveAttribute("data-kind", "branch_summary");
    await expect(summary.getByTestId("session-tree-summary-badge")).toBeVisible();
    await expect(summary).toContainText('The user requested a single, exact response: "BETA".');
    await shoot(page, "branch-summary");
    await panel.getByTestId("session-tree-search").fill("exact response");
    await expect(nodes).toHaveCount(1);
    await expect(nodes.first()).toHaveAttribute("data-kind", "branch_summary");
  } finally {
    await cleanup();
  }
});

test("打标签（omp 18.12.6 录制）：行上的标签按钮 → 输入框 Enter，omp 收到 /tree → select → label → edit → label-save，之后树里那条消息带标签；搜索也搜标签", async () => {
  test.setTimeout(120_000);
  const labeled = await readFile(path.join(root, "fixtures", "omp-session", "labeled.jsonl"), "utf8");
  const labelRow = labeled.split("\n").find((row) => row.includes('"type":"label"')) as string;
  const { launched, sessionFile, received, cleanup } = await start("session-tree-label", "labeled", {
    cards: 0,
    // 录制是打标签之前的状态：会话文件里还没有 label 条目（omp 在 label-save 时才写它）。
    transform: (text) =>
      text
        .split("\n")
        .filter((row) => !row.includes('"type":"label"'))
        .join("\n"),
  });
  try {
    const { page } = launched;
    await page.getByTestId("composer-input").fill("/tree");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("session-tree");
    const nodes = panel.getByTestId("session-tree-node");
    await expect(nodes).toHaveCount(1);
    await expect(panel.getByTestId("session-tree-label")).toHaveCount(0);
    await nodes.first().hover();
    await panel.getByTestId("session-tree-label-edit").click();
    const input = panel.getByTestId("session-tree-label-input");
    await expect(input).toBeFocused();
    await input.fill("my label");
    await shoot(page, "label-edit");
    // 假 omp 不会写会话文件：模拟 omp 在 label-save 时追加 label 条目（面板在主进程驱动完之后重读树）。
    await appendFile(sessionFile, `${labelRow}\n`);
    await input.press("Enter");
    await expect(panel.getByTestId("session-tree-label")).toHaveText("my label", { timeout: 30_000 });
    await expect(input).toHaveCount(0);
    expect(await received()).toEqual([
      { ev: "send", sf: "s:1", id: "j.line/input", text: "/tree" },
      { ev: "select", sf: "s:1", id: "s.^picker", item: "93021031" },
      { ev: "action", sf: "s:1", id: "s.^picker", act: "label" },
      { ev: "edit", sf: "s:1", id: "t", from: 0, to: 0, text: "my label", cursor: 8, len: 0 },
      { ev: "action", sf: "s:1", id: "s.^picker", act: "label-save" },
    ]);
    await shoot(page, "label");
    await panel.getByTestId("session-tree-search").fill("my lab");
    await expect(nodes).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

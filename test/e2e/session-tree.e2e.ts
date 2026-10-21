// TSP 任务的会话树面板、回溯和分叉（docs/architecture/session-tree.md）：假 omp 回放 omp 18.12.5 录的 fixtures/tsp/session-tree.jsonl
// （`/tree` → activate 用户消息 → 清空预填的输入框），会话文件是 omp 真实产出的 fixtures/omp-session/linear.jsonl。
// 假 omp 只有收到和录制一样的 send / activate / edit 才继续回放，所以"输入框里出现那条消息的文字"本身就证明主进程发对了事件。
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, openTaskRow, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
const BETA_TEXT = "Reply with exactly: BETA. No tools.";

interface Started {
  launched: LaunchedApp;
  /** 假 omp 收到的 TSP 事件（send / activate / edit）。 */
  received(): Promise<Record<string, unknown>[]>;
  cleanup(): Promise<void>;
}

async function start(fixture = "session-tree", session = "linear"): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp tree e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const sessionFile = path.join(work, "agent", "sessions", "--e2e--", "2026-10-21T18-14-31-448Z_linear.jsonl");
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await copyFile(path.join(root, "fixtures", "omp-session", `${session}.jsonl`), sessionFile);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp(
    {
      STUDIO_TEST_OMP: JSON.stringify({
        command: process.execPath,
        args: [fakeOmp, fixture, "--speed=20", `--log=${log}`],
      }),
      PI_CODING_AGENT_DIR: path.join(work, "agent"),
      FAKE_TSP_SESSION_FILE: sessionFile,
    },
    { taskEngine: "tsp" },
  );
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
  // 录制是 `--resume` 一个两轮的会话：两张用户消息卡片画出来。
  await expect(launched.page.locator('[data-testid="tsp-view"] [data-role="omp.user"]')).toHaveCount(2, {
    timeout: 30_000,
  });
  return {
    launched,
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

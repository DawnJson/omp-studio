// 输入框（docs/architecture/composer-input.md）：斜杠菜单取任务目录的项目命令、运行中的发送下拉（"等这一轮结束再发" = /queue）、
// Ctrl+R 输入历史（重启后还在）、omp 往它自己输入框里写的文字回到 studio 输入框。
// 项目命令用真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR；其余用假 omp 回放 fixtures/tsp（假 omp 只在收到和录制一样的事件后才继续）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { findOmpOnPath } from "../../src/main/omp/discover.ts";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import { expandSidebarFolders, launchApp, openTaskRow, testOmp, type LaunchedApp } from "./launch.ts";

async function openFolder(launched: LaunchedApp, dir: string): Promise<void> {
  await launched.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, dir);
  await launched.page.getByTestId("sidebar-open-folder").click();
}

/** 草稿发第一句：任务建好后输入框在原位接着用。 */
async function sendFirst(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("stop-button").or(page.getByTestId("send-button"))).toBeVisible();
}

async function sentEvents(log: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
    .filter((record) => record.kind === "tsp" && record.body !== undefined)
    .map((record) => record.body as Record<string, unknown>);
}

test("斜杠菜单：任务目录里的项目命令出现；/plan 等终端版命令不被守卫拦；/exit 不在菜单里", async () => {
  test.skip((await findOmpOnPath().catch(() => null)) === null, "PATH 上没有 omp");
  test.setTimeout(120_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp composer e2e-"));
  const agentDir = path.join(work, "agent");
  const project = path.join(work, "项目 目录");
  await mkdir(agentDir, { recursive: true });
  await mkdir(path.join(project, ".omp", "commands"), { recursive: true });
  // omp 没有任何模型时 rpc-ui 直接退出（omp 18.14.0："No default model selected"），命令表也就读不到：给一个 auth: none 的本地 provider，不连任何服务。
  await writeFile(
    path.join(agentDir, "models.yml"),
    "providers:\n  slash-local:\n    baseUrl: http://127.0.0.1:9/v1\n    auth: none\n    api: openai-completions\n    models:\n      - id: slash-one\n",
    "utf8",
  );
  await writeFile(
    path.join(agentDir, "config.yml"),
    "startup:\n  setupWizard: false\nmodelRoles:\n  default: slash-local/slash-one\n",
    "utf8",
  );
  await writeFile(
    path.join(project, ".omp", "commands", "deploy-staging.md"),
    "---\ndescription: 部署到预发环境\n---\nDeploy $ARGUMENTS\n",
    "utf8",
  );
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page } = launched;
    await expect
      .poll(() => page.evaluate(() => globalThis.studio.getOmpStatus().then((status) => status.state)), {
        timeout: 30_000,
      })
      .toBe("ready");
    await openFolder(launched, project);
    await page.evaluate(async () => {
      const [first] = await globalThis.studio.listProjects();
      if (first) await globalThis.studio.createTask({ projectId: first.id });
    });
    await expandSidebarFolders(page);
    await openTaskRow(page);
    const input = page.getByTestId("composer-input");
    await input.fill("/");
    const menu = page.getByTestId("slash-menu");
    await expect(menu).toContainText("deploy-staging", { timeout: 60_000 });
    // TUI 才有的命令在菜单里；会结束 omp 进程的不列。
    await expect(menu).toContainText("/plan");
    await input.fill("/exit");
    await expect(page.getByTestId("slash-menu").getByText("/exit", { exact: true })).toHaveCount(0);
    // /plan 发送不触发"没有这个命令"的守卫。
    await input.fill("/plan");
    await input.press("Enter");
    await expect(page.getByTestId("slash-guard")).toHaveCount(0);
    await input.fill("/dep");
    await expect(page.getByTestId("slash-menu")).toContainText("deploy-staging");
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("运行中输入框右下角只有停止键；Ctrl+Enter 等这一轮结束再发，omp 收到 /queue <文字>；Ctrl+R 搜到发过的消息，重启后还在", async () => {
  test.setTimeout(150_000);
  const events = recordedUserEvents(loadTspFixture("queue-command")).filter((entry) => entry.event["ev"] === "send");
  const first = String(events[0]!.event["text"]);
  const queuedWire = String(events[1]!.event["text"]);
  const queuedText = queuedWire.replace(/^\/queue /, "");
  const work = await mkdtemp(path.join(os.tmpdir(), "omp composer e2e-"));
  const project = path.join(work, "项目 目录");
  const log = path.join(work, "omp-received.jsonl");
  await mkdir(project);
  const env = { STUDIO_TEST_OMP: testOmp("queue-command", { log }) };
  const launched = await launchApp(env);
  let second: LaunchedApp | null = null;
  try {
    const { page } = launched;
    await openFolder(launched, project);
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await sendFirst(page, first);
    const input = page.getByTestId("composer-input");
    await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 30_000 });
    await input.fill(queuedText);
    // 有内容也只有停止键：没有发送键和发送方式下拉（插话 / 稍后发走 Enter / Ctrl+Enter）。
    await expect(page.getByTestId("stop-button")).toBeVisible();
    await expect(page.getByTestId("send-button")).toHaveCount(0);
    await input.press("Control+Enter");
    await expect
      .poll(
        async () =>
          (await sentEvents(log)).filter((body) => body["ev"] === "send" && body["text"] === queuedWire).length,
      )
      .toBe(1);
    await expect(input).toHaveValue("");

    // 重启（同一个 userData、同一个 agent 目录）：历史是 studio 自己存的，Ctrl+R 仍然搜得到。
    await launched.app.close();
    second = await launchApp({
      ...env,
      STUDIO_USER_DATA: launched.userDataDir,
      PI_CODING_AGENT_DIR: launched.agentDir,
    });
    const again = second.page;
    await expandSidebarFolders(again);
    await openTaskRow(again);
    const field = again.getByTestId("composer-input");
    await field.focus();
    await field.press("Control+r");
    const search = again.getByTestId("history-search");
    await expect(search).toBeVisible();
    // 搜索按词（都要出现、不分先后）：第一句里也有 "one per line"，所以用这条独有的词。
    await again.getByTestId("history-query").fill("exactly ALPHA");
    await expect(again.getByTestId("history-row")).toHaveText([/^line one: reply with exactly ALPHA/]);
    await field.press("Control+r");
    await again.getByTestId("history-query").fill("exactly ALPHA");
    await again.keyboard.press("Enter");
    await expect(search).toHaveCount(0);
    await expect(field).toHaveValue(queuedText);
  } finally {
    await second?.close().catch(() => {});
    await launched.close().catch(() => {});
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("回填：omp 的历史选择器选中的文字（history-select 录制）进 studio 输入框，omp 那边被清空", async () => {
  test.setTimeout(90_000);
  const sent = recordedUserEvents(loadTspFixture("history-select")).find((entry) => entry.event["ev"] === "send");
  const text = String(sent!.event["text"]);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp composer e2e-"));
  const project = path.join(work, "项目 目录");
  const log = path.join(work, "omp-received.jsonl");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("history-select", { log }) });
  try {
    const { page } = launched;
    await openFolder(launched, project);
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    await sendFirst(page, text);
    // 假 omp 放到 Enter 选中那一帧：omp 的输入框里出现这句话，主进程搬进 studio 的输入框并发 edit 清空。
    const input = page.getByTestId("composer-input");
    await expect(input).toHaveValue(text, { timeout: 30_000 });
    await expect
      .poll(async () => (await sentEvents(log)).filter((body) => body["ev"] === "edit"))
      .toEqual([expect.objectContaining({ from: 0, to: text.length, text: "" })]);
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("点输入框外框里的空白（工具行空着的地方、文字区四周的留白）光标回到输入框，接着能打字；草稿和任务的输入框都是", async () => {
  test.setTimeout(90_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp composer e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("history-select") });
  try {
    const { page } = launched;
    await openFolder(launched, project);
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    const check = async (box: Locator) => {
      const input = box.getByTestId("composer-input");
      await input.fill("");
      // 工具行中间撑开的空白（.composer-spacer 没有高度，按坐标点它所在的那一段）。
      const spacer = (await box.locator(".composer-spacer").boundingBox())!;
      const tools = (await box.locator(".composer-tools").boundingBox())!;
      expect(spacer.width).toBeGreaterThan(40);
      await page.mouse.click(spacer.x + spacer.width / 2, tools.y + tools.height / 2);
      await expect(input).toBeFocused();
      await page.keyboard.type("ab");
      // 文字区左上角的留白（不在文本框上）：点了不丢焦点、光标还在，接着打。
      await box.getByTestId("composer-body").click({ position: { x: 2, y: 2 } });
      await expect(input).toBeFocused();
      await page.keyboard.type("c");
      await expect(input).toHaveValue("abc");
    };
    await check(page.getByTestId("draft-composer"));
    await page.evaluate(async () => {
      const [first] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: first!.id });
    });
    await openTaskRow(page);
    await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
    await check(page.getByTestId("composer-stack"));
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

// 提示词优化（发送键左边的 ✦，docs/architecture/prompt-enhance.md）：主进程在未打包时认 STUDIO_TEST_ENHANCE_OMP（JSON {command, args}），
// 这里指向假 `omp -p`（test/fake-omp/fake-omp-print.ts）：FAKE_PRINT_MODE_FILE 每次调用时读模式，FAKE_PRINT_LOG 记 cwd / 参数 / stdin，
// FAKE_PRINT_DELAY 让"优化中"停一会儿。任务那条用例的任务进程是假 TSP omp（回放 fixtures/tsp/queue-command.jsonl）。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import { launchApp, pasteText, testOmp } from "./launch.ts";

const fakePrintOmp = path.resolve(import.meta.dirname, "..", "fake-omp", "fake-omp-print.ts");

async function setupWork() {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp enhance e2e-"));
  const modeFile = path.join(work, "mode.txt");
  const log = path.join(work, "print-calls.jsonl");
  await writeFile(modeFile, "ok", "utf8");
  const env = {
    STUDIO_TEST_ENHANCE_OMP: JSON.stringify({ command: process.execPath, args: [fakePrintOmp] }),
    FAKE_PRINT_MODE_FILE: modeFile,
    FAKE_PRINT_LOG: log,
    FAKE_PRINT_DELAY: "1500",
  };
  const setMode = (mode: string) => writeFile(modeFile, mode, "utf8");
  const calls = async () =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { cwd: string; argv: string[]; stdin: string; pid: number });
  return { work, env, setMode, calls };
}

/** 文本框里的值去掉芯片用的零宽控制字符（composer-tokens.ts 的 view）。 */
const plainValue = async (input: Locator) => (await input.inputValue()).replace(/[\u2061-\u2064\u00a0]/g, " ");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitIdle(page: Page): Promise<void> {
  await expect(page.getByTestId("enhance-button")).not.toHaveAttribute("data-busy", /.*/);
}

test("草稿页：替换草稿、Ctrl+Z 回到原文；附件芯片保留；生成中改草稿 / 再点 / Esc 都取消且不覆盖；没有模型时提示、草稿不变", async () => {
  test.setTimeout(120_000);
  const { work, env, setMode, calls } = await setupWork();
  const launched = await launchApp(env);
  try {
    const { page } = launched;
    const input = page.getByTestId("draft-composer").getByTestId("composer-input");
    const button = page.getByTestId("draft-composer").getByTestId("enhance-button");
    await expect(input).toBeVisible();
    // 空草稿、斜杠命令不能优化；按钮在发送键左边。
    await expect(button).toBeDisabled();
    await input.fill("/compact 保留结论");
    await expect(button).toBeDisabled();
    await input.fill("make it blue");
    await expect(button).toBeEnabled();
    const [buttonBox, sendBox] = await Promise.all([
      button.boundingBox(),
      page.getByTestId("draft-composer").getByTestId("send-button").boundingBox(),
    ]);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(sendBox!.x);

    // 一次替换；Ctrl+Z 一步回到原文。
    await button.click();
    await expect(button).toHaveAttribute("data-busy", "");
    await expect(button).toHaveAttribute("aria-label", "停止优化");
    await expect(input).toHaveValue("make it blue (enhanced)", { timeout: 15_000 });
    await waitIdle(page);
    await expect(input).toBeFocused();
    await page.keyboard.press("Control+z");
    await expect(input).toHaveValue("make it blue");
    const [call] = await calls();
    expect(call!.stdin).toContain("<draft>\nmake it blue\n</draft>");
    expect(call!.argv).toEqual(expect.arrayContaining(["-p", "--no-session", "--no-tools", "--system-prompt"]));
    expect(call!.argv.join(" ")).not.toContain("make it blue");

    // 大段粘贴的芯片：结果里的占位符照样显示成芯片，撤回后芯片还在。
    await input.fill("看看这段 ");
    await pasteText(input, Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行`).join("\n"));
    const chips = page.getByTestId("draft-composer").locator(".composer-backdrop .composer-chip");
    await expect(chips).toHaveCount(1);
    await button.click();
    await expect.poll(() => plainValue(input), { timeout: 15_000 }).toContain("(enhanced)");
    await expect(chips).toHaveCount(1);
    await page.keyboard.press("Control+z");
    await expect.poll(() => plainValue(input)).not.toContain("(enhanced)");
    await expect(chips).toHaveCount(1);
    expect((await calls()).at(-1)!.stdin).toContain("[Paste #1, +30 lines]");

    // 生成中改了草稿：立刻取消（假 omp 进程被结束），结果不会覆盖。
    await setMode("hang");
    await input.fill("make it red");
    const before = (await calls()).length;
    await button.click();
    await expect(button).toHaveAttribute("data-busy", "");
    await expect.poll(async () => (await calls()).length).toBe(before + 1);
    await input.press("End");
    await input.pressSequentially(" now");
    await waitIdle(page);
    const editedPid = (await calls()).at(-1)!.pid;
    await expect.poll(() => alive(editedPid)).toBe(false);
    await expect(input).toHaveValue("make it red now");

    // 再点一次 = 停止（进程被结束）；Esc 也是。草稿不变。
    await button.click();
    await expect(button).toHaveAttribute("data-busy", "");
    await expect.poll(async () => (await calls()).length).toBe(before + 2);
    await button.click();
    await waitIdle(page);
    const stoppedPid = (await calls()).at(-1)!.pid;
    await expect.poll(() => alive(stoppedPid)).toBe(false);
    await button.click();
    await expect(button).toHaveAttribute("data-busy", "");
    await input.focus();
    await page.keyboard.press("Escape");
    await waitIdle(page);
    await expect(input).toHaveValue("make it red now");

    // 没有可用模型：提示 + "设置模型角色"，草稿不变。
    await setMode("nomodel");
    await button.click();
    await expect(page.getByTestId("toasts")).toContainText("没有可用的模型来优化提示词", { timeout: 15_000 });
    await expect(page.getByTestId("toasts")).toContainText("设置模型角色");
    await expect(input).toHaveValue("make it red now");
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("任务运行中：可以优化；Esc 先取消优化，不停止任务", async () => {
  test.setTimeout(150_000);
  const first = String(
    recordedUserEvents(loadTspFixture("queue-command")).find((entry) => entry.event["ev"] === "send")!.event["text"],
  );
  const { work, env, setMode } = await setupWork();
  const project = path.join(work, "项目 目录");
  const tspLog = path.join(work, "omp-received.jsonl");
  await mkdir(project);
  const launched = await launchApp({ ...env, STUDIO_TEST_OMP: testOmp("queue-command", { log: tspLog }) });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await expect(page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
    const input = page.getByTestId("composer-input");
    await input.fill(first);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 30_000 });

    await setMode("hang");
    await input.fill("修一下登录页的报错");
    const button = page.getByTestId("composer-stack").getByTestId("enhance-button");
    await button.click();
    await expect(button).toHaveAttribute("data-busy", "");
    await input.focus();
    await page.keyboard.press("Escape");
    await waitIdle(page);
    await expect(page.getByTestId("stop-button")).toBeVisible();
    await expect(input).toHaveValue("修一下登录页的报错");
    // 假 omp 没收到 Esc（停止任务 = 把 Esc 写给 omp）。
    const received = (await readFile(tspLog, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string; data?: string });
    expect(received.filter((entry) => entry.kind === "keys" && entry.data === "\x1b")).toEqual([]);

    // 运行中照样能替换。
    await setMode("ok");
    await button.click();
    await expect(input).toHaveValue("修一下登录页的报错 (enhanced)", { timeout: 15_000 });
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

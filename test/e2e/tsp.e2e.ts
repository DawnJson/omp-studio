// TSP 引擎的端到端(docs/architecture/tsp-migration.md):启动构建产物,任务引擎设为 tsp,STUDIO_TEST_OMP 指向
// fake-tsp-omp(在伪终端里回放 fixtures/tsp 的 omp 录制,不调真实模型),驱动真实的 主进程 → 伪终端 → IPC → 渲染进程。
// 假 omp 只有在收到和录制完全一样的事件(send / action / activate)后才继续回放,所以"界面走到下一步"本身就证明
// 渲染进程发对了事件;另外用 --log 断言它收到了什么。截图:完成 / 等你确认(审批) / 提问,中英 × 深浅。
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { parseSession } from "../../src/main/tsp/session-extras.ts";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import {
  copyFilesToClipboard,
  launchApp,
  openTaskRow,
  screenshotsDir,
  setLocaleTheme,
  type LaunchedApp,
} from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");

interface Started {
  launched: LaunchedApp;
  /** 假 omp 收到的 TSP 事件(不含 ack / resize 等终端自发的);`extra` = 再带上这些事件名(默认只有 send / action / activate / select)。 */
  received(extra?: readonly string[]): Promise<Record<string, unknown>[]>;
  /** 假 omp 收到的按键(写进伪终端的原始字节),按顺序。 */
  receivedKeys(): Promise<string[]>;
  cleanup(): Promise<void>;
}

async function start(fixture: string, env: Record<string, string> = {}, speed = 20): Promise<Started> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({
      command: process.execPath,
      args: [fakeOmp, fixture, `--speed=${speed}`, `--log=${log}`],
    }),
    ...env,
  });
  // 起到一半失败（点不到"打开文件夹"、空状态没出来）时调用方还拿不到 cleanup：这里自己收拾，不留 Electron 和临时目录。
  try {
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await launched.page.getByTestId("sidebar-open-folder").click();
    await expect(launched.page.getByTestId("empty-state")).toHaveAttribute("data-kind", "project");
  } catch (error) {
    await launched.close().catch(() => {});
    await rm(work, { recursive: true, force: true });
    throw error;
  }
  return {
    launched,
    async received(extra = []) {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as { kind: string; body?: Record<string, unknown> })
        .filter((record) => record.kind === "tsp" && record.body !== undefined)
        .map((record) => record.body as Record<string, unknown>)
        .filter((body) => ["send", "action", "activate", "select", ...extra].includes(String(body["ev"])));
    },
    async receivedKeys() {
      const text = await readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as { kind: string; data?: string })
        .filter((record) => record.kind === "keys" && typeof record.data === "string")
        .map((record) => record.data as string);
    },
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

/** 草稿输入框发第一句话:主进程等 omp 的输入框 sendable 后用 send 事件提交(任务建好以后同一个位置换成任务的 studio 输入框)。 */
async function sendFirst(page: Page, text: string): Promise<void> {
  await page.getByTestId("composer-input").fill(text);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
  // 草稿 → 任务：输入框在原位接着用，不重放换页淡入（否则从透明闪一下）。
  const stack = page.getByTestId("composer-stack");
  await expect(stack).toHaveAttribute("data-from-draft", "");
  await expect(stack).toHaveCSS("animation-name", "none");
  // 任务的输入框也写着工作目录（和草稿同一个位置），焦点一直在输入框上（焦点框不断）。
  await expect(stack.getByTestId("composer-folder")).toHaveText(/项目 目录$/);
  await expect(page.getByTestId("composer-input")).toBeFocused();
}

const role = (page: Page, name: string) => page.locator(`[data-testid="tsp-view"] [data-role="${name}"]`);

/** 页面里 getComputedStyle 用到的最小类型(e2e 的类型检查没有 DOM 类型)。 */
type PageStyle = {
  getComputedStyle(
    el: unknown,
    pseudo?: string,
  ): {
    opacity: string;
    content: string;
    height: string;
    flexGrow: string;
    display: string;
    fontSize: string;
    color: string;
  };
};

async function shoot(page: Page, state: string): Promise<void> {
  for (const [locale, scheme] of [
    ["zh-CN", "light"],
    ["zh-CN", "dark"],
    ["en", "light"],
    ["en", "dark"],
  ] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await setLocaleTheme(page, locale, scheme);
    await page.screenshot({ path: path.join(screenshotsDir, `tsp-${state}-${locale}-${scheme}.png`) });
  }
}

const TASK_PROMPT =
  "先用 todo 工具列出计划。然后用 task 工具并行派两个子代理:一个修 calc/ops.py 里的 bug,一个修 calc/text.py 里的 bug。子代理都完成后运行 python -m pytest -q 确认通过,最后用两句话总结。";

test("完整一轮:草稿的第一句话用 send 交给 omp;待办、子代理、bash、回答按 omp 的节点画出来,跑完侧栏回到空闲", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start("task");
  try {
    const { page } = launched;
    await sendFirst(page, TASK_PROMPT);
    const row = page.getByTestId("task-row").first();
    await expect(row).toHaveAttribute("data-status", "running", { timeout: 20_000 });
    // 待办：omp 的 HUD 药丸不画，studio 的待办板出现在输入框上方（数据来自 omp.hud.todo），点开是阶段与条目（阶段名没有罗马数字前缀）。
    const board = page.getByTestId("tsp-todo-bar").getByTestId("todo-board");
    await expect(board).toBeVisible({ timeout: 30_000 });
    await expect(role(page, "omp.hud.todo")).toHaveCount(0);
    // 输入框上方的状态行(照 Tern):运行图标 + 翻牌计时(role=timer,data-value 是完整文字)+ omp 状态行的那句话;omp 自己的状态行(含 Stop)不画。
    await expect(page.getByTestId("run-elapsed")).toHaveAttribute("data-value", /^\d+s$|^\d+m \d+s$/);
    await expect(page.getByTestId("run-activity")).not.toBeEmpty();
    await expect(role(page, "omp.working")).toHaveCount(0);
    await board.click();
    await expect(page.getByTestId("todo-popover")).toContainText("Inspect");
    await expect(page.getByTestId("todo-popover")).not.toContainText("I. Inspect");
    await page.keyboard.press("Escape");
    // 回放跑完:本轮用量出现,omp 的工作状态行消失,侧栏变回空闲。
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    await expect(row).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    // 录制最后待办 5/5 全部完成:待办板照 Tern 里的 omp,进度环整圈,当前项那里写"全部完成"(omp 过 todoClearDelay 才删节点,录制没录到)。
    await expect(board).toContainText("全部完成");
    await expect(board).toContainText("5/5");
    await expect(board.locator('[data-state="progress"] .todo-mark-arc')).toHaveAttribute("stroke-dasharray", "100 0");
    await expect(role(page, "omp.user").first()).toContainText("calc/ops.py");
    await expect(role(page, "omp.tool.todo").first()).toBeVisible();
    await expect(role(page, "omp.tool.bash").first()).toContainText("pytest");
    await expect(role(page, "omp.assistant").last()).toBeVisible();
    // omp 收到的提交就是草稿原文,发给它的是 send 事件(不是逐字按键)。
    expect(await received()).toEqual([expect.objectContaining({ ev: "send", id: "j.line/input", text: TASK_PROMPT })]);
    // 混合形态:过程区是 omp 的节点,输入框是 studio 的 Composer(模型胶囊、思考强度、发送在它上面),omp 自己的输入框卡片不画。
    await expect(page.getByTestId("composer-stack")).toBeVisible();
    await expect(page.getByTestId("model-chip")).toBeVisible();
    await expect(page.getByTestId("send-button")).toBeVisible();
    await expect(role(page, "omp.editor")).toHaveCount(0);
    await expect(page.locator('[data-testid="tsp-view"] .tspi-editor')).toHaveCount(0);
    // omp 自己的欢迎块(logo、"omp"、版本、小提示)不画;过程区顶部是 studio 的标题块(像素标志 + 任务所在文件夹),随对话滚动。
    await expect(role(page, "omp.welcome")).toHaveCount(0);
    await expect(
      page.locator('[data-testid="tsp-view"] [data-testid="studio-header"] [data-testid="pixel-logo"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="tsp-view"] [data-testid="studio-header-folder"]')).toContainText(
      "项目 目录",
    );
    // TSP 任务没有改动摘要：过程区里没有改动卡片，输入框上方也没有改动条（评审从顶栏按钮 / Ctrl Shift D / 提交对话框进）。
    await expect(page.locator('.tsp-scroller [data-testid="change-card"]')).toHaveCount(0);
    await expect(page.getByTestId("change-strip")).toHaveCount(0);
    // 在 studio 输入框里打字不会变成发给 omp 的按键。
    const before = (await received()).length;
    await page.getByTestId("composer-input").fill("还没发的草稿");
    await page.waitForTimeout(300);
    expect((await received()).length).toBe(before);
    await page.getByTestId("composer-input").fill("");
    // omp 一路改写上方的节点(折叠卡片、去掉思考中),用户没动过滚动:跑完仍贴在底部,看得到最后的回答。
    await expect(page.getByTestId("jump-latest")).toHaveCount(0);
    const distance = await page.evaluate(
      `(() => { const el = document.querySelector(".tsp-scroller"); return el.scrollHeight - el.clientHeight - el.scrollTop; })()`,
    );
    expect(distance).toBeLessThanOrEqual(2);
    await shoot(page, "done");
    // 切到另一个 TSP 任务：只剩一个过程区，画的是新任务（过程区和输入框同 key 时，React 会把上一个任务的过程区留在页面上）。
    const second = await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      return (await globalThis.studio.createTask({ projectId: project!.id })).id;
    });
    await page.locator(`[data-nav="task:${second}"]`).click();
    await expect(page.getByTestId("tsp-view")).toHaveCount(1);
    await expect(page.getByTestId("tsp-view")).toHaveAttribute("data-task-id", second);
  } finally {
    await cleanup();
  }
});

test("审批:omp 的审批门出现时任务是等你确认;底栏只剩 Details 且在标题那一行,Deny / Approve 不画;Ctrl+Enter 发出门上的批准 action,命令接着跑完", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("approval");
  try {
    const { page } = launched;
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    const gate = role(page, "omp.editor.ask.approval");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "needs_you");
    await expect(page.getByTestId("gate-slot")).toHaveCount(0);
    await expect(role(page, "omp.editor")).toHaveCount(0);
    // 和选项列表重复的 Deny / Approve 按钮不画；Details 和标题在同一行（不再单独吊在卡片右下角）。
    await expect(gate.locator('[data-id="t.actions/approve"], [data-id="t.actions/deny"]')).toHaveCount(0);
    await expect(gate.locator('[data-role="omp.approval.choice"]')).toHaveCount(3);
    const title = await gate.locator('[data-role="omp.approval.title"]').boundingBox();
    const details = await gate.locator('[data-id="t.actions/expand"]').boundingBox();
    expect(title && details).toBeTruthy();
    expect(Math.abs(title!.y + title!.height / 2 - (details!.y + details!.height / 2))).toBeLessThan(2);
    expect(details!.x).toBeGreaterThan(title!.x + title!.width);
    await shoot(page, "gate");
    // 输入框写的字 Enter 发出去 = omp 的"拒绝并说明理由":send 事件发到 omp 还在的输入框(假 omp 不会因多出的事件失败)。
    const input = page.getByTestId("composer-input");
    await expect(input).toHaveAttribute("placeholder", /Ctrl\+Enter/);
    await input.fill("先别跑这个");
    await input.press("Enter");
    await expect
      .poll(async () => (await received()).filter((event) => event["ev"] === "send" && event["text"] === "先别跑这个"))
      .toEqual([expect.objectContaining({ ev: "send", id: "j.line/input" })]);
    await input.press("Control+Enter");
    await expect(gate).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    expect((await received()).filter((event) => event["ev"] === "action")).toEqual([
      expect.objectContaining({ ev: "action", id: "t.actions/approve", act: "approve" }),
    ]);
  } finally {
    await cleanup();
  }
});

test("重开会话:顶栏标题旁的按钮;门开着时置灰,悬停出自绘提示写明原因(原生 title 拿掉);空闲时点它 omp 重新起一次进程、任务回到空闲;Ctrl+Shift+R 同样", async () => {
  test.setTimeout(90_000);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "omp restart e2e-"));
  const pidFile = path.join(scratch, "pids.txt");
  const sessionFile = path.join(scratch, "会话 文件.jsonl");
  await writeFile(sessionFile, "{}\n");
  const pids = async () =>
    (await readFile(pidFile, "utf8").catch(() => "")).split("\n").filter((line) => line.trim() !== "");
  const { launched, cleanup } = await start("approval", {
    FAKE_OMP_PID_FILE: pidFile,
    FAKE_TSP_SESSION_FILE: sessionFile,
  });
  try {
    const { page } = launched;
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    await expect(role(page, "omp.editor.ask.approval")).toBeVisible({ timeout: 30_000 });
    const restart = page.getByTestId("topbar-restart");
    await expect(restart).toBeDisabled();
    await restart.hover();
    const tip = page.getByTestId("tooltip");
    await expect(tip).toHaveText(/任务在等你回答|waiting for your answer/i);
    await expect(restart).not.toHaveAttribute("title", /.*/);
    await shoot(page, "restart-blocked");
    await page.getByTestId("composer-input").hover();
    await expect(tip).toHaveCount(0);
    await expect(restart).toHaveAttribute("title", /任务在等你回答|waiting for your answer/i);

    await page.getByTestId("composer-input").press("Control+Enter");
    const row = page.getByTestId("task-row").first();
    await expect(row).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    await expect(restart).toBeEnabled();
    // 进程数按增量算：rpc-ui 后台进程也走同一个假 omp，同样写 pid。
    const before = (await pids()).length;

    await restart.click();
    await expect(page.getByText(/已重开会话|Session restarted/)).toBeVisible({ timeout: 30_000 });
    expect(await pids()).toHaveLength(before + 1);
    await expect(row).toHaveAttribute("data-status", "idle");
    await expect(restart).toBeEnabled();

    await page.getByTestId("composer-input").press("Control+Shift+R");
    await expect.poll(pids, { timeout: 30_000 }).toHaveLength(before + 2);
    await expect(row).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
  } finally {
    await cleanup();
    await rm(scratch, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("审批门出现时焦点不从输入框被抢走：在输入框里打字的时候门到了，焦点和已输入的字都还在，Ctrl+Enter 批准", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("approval");
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    const approve = role(page, "omp.editor.ask.approval");
    // 门还没到：焦点在输入框，正在打字。
    await expect(approve).toHaveCount(0);
    await page.keyboard.type("先别跑");
    await expect(approve).toBeVisible({ timeout: 30_000 });
    // 门到了：焦点留在输入框（不是门的列表），打的字没丢，继续打也进输入框。
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("先别跑");
    await page.keyboard.type("这个");
    await expect(input).toHaveValue("先别跑这个");
    // Ctrl+Enter 批准：发出门上的 action。
    await page.keyboard.press("Control+Enter");
    await expect(approve).toHaveCount(0, { timeout: 30_000 });
    expect((await received()).filter((event) => event["ev"] === "action")).toEqual([
      expect.objectContaining({ ev: "action", id: "t.actions/approve", act: "approve" }),
    ]);
  } finally {
    await cleanup();
  }
});

/** 纯色 PNG（不依赖浏览器的画布）：粘贴图片用例里当截图。 */
function solidPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 位
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 往输入框派发一个带图片文件的 paste 事件（和粘贴截图同一条路径）。 */
async function pasteImage(page: Page, png: Buffer): Promise<void> {
  await page.evaluate((base64) => {
    const page = globalThis as unknown as {
      document: { querySelector(selector: string): { dispatchEvent(event: unknown): boolean } | null };
      ClipboardEvent: new (
        type: string,
        init: { clipboardData: unknown; bubbles: boolean; cancelable: boolean },
      ) => unknown;
    };
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    page.document
      .querySelector('[data-testid="composer-input"]')!
      .dispatchEvent(new page.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, png.toString("base64"));
}

test("输入框附件：粘贴图片 = 顶部卡片 + 文字里的 #1 芯片，大段粘贴折叠成芯片；发送后 omp 收到占位符、@路径和展开的原文", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("approval");
  try {
    const { page } = launched;
    // 草稿页的输入框（任务的输入框在模型不收图片时拒绝图片；假 omp 的模型目录里没有它，按不收图片算）。
    const input = page.getByTestId("composer-input");
    await input.click();
    await input.pressSequentially("对比 ");
    await pasteImage(page, solidPng(40, 30));
    // 附件卡片在输入框顶部：缩略图 + #1 + 尺寸；文字里是 #1 芯片，不是 omp 的占位符原文。
    const card = page.getByTestId("attachment");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("#1");
    await expect(card).toContainText("40×30");
    await expect(input).not.toHaveValue(/\[Image/);
    await expect(input).toHaveValue(/#1/);
    // 大段粘贴（30 行）折叠成 `#2 +30 行` 芯片（界面上所有附件共用一个编号：图片 #1，粘贴 #2），原文不在输入框里。
    const big = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    await launched.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), big);
    await page.keyboard.press("Control+V");
    await expect(input).toHaveValue(/#2\u00a0\+30\u00a0(行|lines)/);
    await expect(input).not.toHaveValue(/line 30/);
    await page.screenshot({ path: path.join(screenshotsDir, "composer-attachments.png") });
    // 发送第一句话（创建任务）：占位符里的图片尺寸、展开的原文、临时图片文件的 @"路径" 一起到 omp。
    await input.press("Enter");
    await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await received()).filter((event) => String(event["text"]).includes("[Image #1, 40x30]")))
      .toHaveLength(1);
    const sent = String((await received()).find((event) => String(event["text"]).includes("[Image #1"))!["text"]);
    const match = /^对比 \[Image #1, 40x30\] ([\s\S]*) @"([^"]*omp-studio-images[^"]*\.webp)"$/.exec(sent);
    expect(match, sent).not.toBeNull();
    expect(match![1]).toBe(big);
    expect(existsSync(match![2]!)).toBe(true);
    // 发出去之后任务的输入框是空的，没有附件卡片。
    await expect(page.getByTestId("composer-input")).toHaveValue("");
    await expect(card).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("输入框附件：删掉文字里的 #1 芯片就删掉对应的图片；Ctrl+Shift+V 原样粘贴不折叠；拖拽条调高度、双击还原", async () => {
  test.setTimeout(60_000);
  const { launched, cleanup } = await start("task");
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.click();
    await pasteImage(page, solidPng(64, 48));
    await expect(page.getByTestId("attachment")).toHaveCount(1);
    // 光标在芯片后面：Backspace 一步删掉整个芯片和附件（芯片是原子的）。
    await input.press("End");
    await input.press("Backspace"); // 芯片后面的空格
    await expect(page.getByTestId("attachment")).toHaveCount(1);
    await input.press("Backspace");
    await expect(page.getByTestId("attachment")).toHaveCount(0);
    await expect(input).toHaveValue("");
    // Ctrl+Shift+V：同样的大段文字，原样进输入框。
    const big = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    await launched.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), big);
    await page.keyboard.press("Control+Shift+V");
    await expect(input).toHaveValue(new RegExp(`line 30`));
    await input.fill("");
    // 拖拽条：向上拖高度变大，不超过主区的 60%；双击还原。
    const grip = page.getByTestId("composer-resize");
    const before = (await input.boundingBox())!.height;
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 160, { steps: 6 });
    await page.mouse.up();
    const grown = (await input.boundingBox())!.height;
    expect(grown).toBeGreaterThan(before + 100);
    const main = (await page.getByTestId("main-panel").boundingBox())!;
    expect(grown).toBeLessThanOrEqual(main.height * 0.6 + 1);
    await grip.dblclick();
    expect((await input.boundingBox())!.height).toBe(before);
  } finally {
    await cleanup();
  }
});

test('输入框附件：粘贴资源管理器复制的文件 = 文件卡片（图标、名字、大小、#1）+ 文字里的 #1 芯片；发送后 omp 收到内联的 @"路径"，路径从不进渲染进程', async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("approval");
  const dir = await mkdtemp(path.join(os.tmpdir(), "omp attach e2e-"));
  const file = path.join(dir, "报告 final.txt");
  await writeFile(file, "hello");
  const savedClipboard = await launched.app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.click();
    await input.pressSequentially("看 ");
    await copyFilesToClipboard([file]);
    await page.keyboard.press("Control+V");
    const card = page.getByTestId("attachment");
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("data-kind", "file");
    await expect(card).toContainText("#1");
    await expect(card).toContainText("报告 final.txt");
    await expect(card).toContainText("5 B");
    await expect(input).toHaveValue(/#1\s报告/);
    // 渲染进程里没有路径：输入框、卡片、页面文字里都找不到目录名。
    expect(await page.locator("body").innerText()).not.toContain("omp attach e2e-");
    await input.pressSequentially("谢谢");
    await page.screenshot({ path: path.join(screenshotsDir, "round-0.3.26", "composer-input-file-card.png") });
    await input.press("Enter");
    await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await received()).filter((event) => String(event["text"]).includes('@"')).length)
      .toBe(1);
    const sent = String((await received()).find((event) => String(event["text"]).includes('@"'))!["text"]);
    expect(sent).toBe(`看 @"${file.replaceAll("\\", "/")}" 谢谢`);
  } finally {
    await launched.app
      .evaluate(({ clipboard }, text) => clipboard.writeText(text), savedClipboard)
      .catch(() => undefined);
    await cleanup();
    await rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("提问:选项是 omp 的列表,双击一项发 activate;提问期间 studio 输入框不能发送,omp 收到答案后继续", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("ask");
  try {
    const { page } = launched;
    await sendFirst(page, "请用 ask 工具问我一个问题:三个选项 A 快 / B 稳 / C 省钱,只问这一个,然后等我回答。");
    const option = page.locator('[data-testid="tsp-view"] [data-id="t.q0/option:1"]');
    await expect(option).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "needs_you");
    // 门由 omp 画在过程区里,studio 不再挂门槽;输入框在提问期间不能发送,但能打字。
    await expect(page.getByTestId("gate-slot")).toHaveCount(0);
    await expect(role(page, "omp.editor.ask")).toBeVisible();
    await expect(role(page, "omp.editor")).toHaveCount(0);
    await page.getByTestId("composer-input").fill("先别发");
    await expect(page.getByTestId("send-button")).toBeDisabled();
    await page.getByTestId("composer-input").fill("");
    await shoot(page, "ask");
    await option.dblclick();
    await expect(option).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    expect((await received()).filter((event) => event["ev"] === "activate")).toEqual([
      expect.objectContaining({ ev: "activate", id: "t.q0", item: "t.q0/option:1" }),
    ]);
    // 提问被撤掉后焦点回到 studio 输入框。
    await expect(page.getByTestId("composer-input")).toBeFocused();
    await shoot(page, "ask-done");
  } finally {
    await cleanup();
  }
});

test("多题提问(omp 18.12.5 录制):多选题点高亮项是勾选不跳页;Review 页没有 list 也由对话框接键盘(Enter 写给 omp);按钮是真按钮,点 Submit 提交", async () => {
  test.setTimeout(90_000);
  const { launched, received, receivedKeys, cleanup } = await start("ask-multi");
  try {
    const { page } = launched;
    const prompt = recordedUserEvents(loadTspFixture("ask-multi")).find((entry) => entry.event["ev"] === "send")!.event[
      "text"
    ] as string;
    await sendFirst(page, prompt);
    const item = (id: string) => page.locator(`[data-testid="tsp-view"] [data-id="${id}"]`);
    await expect(item("s.q0/option:1")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "needs_you");
    // 底栏是真按钮。
    await expect(item("s.actions/submit")).toHaveJSProperty("tagName", "BUTTON");
    // 按钮里的快捷键是尾随小字、写 Windows 键名（不是 ⏎ ⌥ 这类符号）；门有外框；单选题的选项带单选圈。
    await expect(item("s.actions/submit")).toContainText("Enter");
    await expect(item("s.actions/hide")).toContainText("Alt+H");
    await expect(role(page, "omp.editor.ask")).toHaveCSS("border-top-width", "1px");
    await expect(item("s.q0/option:1").locator("input.ui-radio")).toHaveCount(1);
    // 单选:点没高亮的一项 = select(omp 直接作答并跳页)。
    await item("s.q0/option:1").click();
    // 多选:点已高亮的第一项(Logging)= select(勾选),不是 activate;Cache 同理。
    await expect(item("s.q1/option:0")).toHaveAttribute("data-role", "omp.ask.check", { timeout: 30_000 });
    await item("s.q1/option:0").click();
    await expect(item("s.q1/option:0").getByTestId("tspi-item-mark")).toBeChecked();
    await item("s.q1/option:2").click();
    await expect(item("s.q1/option:2").getByTestId("tspi-item-mark")).toBeChecked();
    // Next 按钮发 action submit,翻到第三题。
    await item("s.actions/submit").click();
    await item("s.q2/option:1").click();
    // Review 页:没有 list;焦点由对话框根节点拿着,Enter 写给 omp。
    await expect(role(page, "omp.ask.answers")).toBeVisible({ timeout: 30_000 });
    await expect(role(page, "omp.editor.ask")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(receivedKeys).toContain("\r");
    // 点 Submit 按钮提交,对话框消失,任务回到空闲。
    await item("s.actions/submit").click();
    await expect(role(page, "omp.editor.ask")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    expect(await received()).toEqual([
      expect.objectContaining({ ev: "send" }),
      { ev: "select", sf: "s:1", id: "s.q0", item: "s.q0/option:1" },
      { ev: "select", sf: "s:1", id: "s.q1", item: "s.q1/option:0" },
      { ev: "select", sf: "s:1", id: "s.q1", item: "s.q1/option:2" },
      { ev: "action", sf: "s:1", id: "s.actions/submit", act: "submit" },
      { ev: "select", sf: "s:1", id: "s.q2", item: "s.q2/option:1" },
      { ev: "action", sf: "s:1", id: "s.actions/submit", act: "submit" },
    ]);
  } finally {
    await cleanup();
  }
});

test("过程卡片:diff 的上下文行和增删行一样是一行(行号在左、文字在右),代码长行折行不出横向滚动条", async () => {
  test.setTimeout(90_000);
  // cards = approval 的录制,最后一帧多加了一张 edit 卡(diff,含空行和长行上下文)和一张 eval 卡(长代码行 + 输出 + 底栏)。
  const { launched, cleanup } = await start("cards");
  try {
    const { page } = launched;
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    const gate = role(page, "omp.editor.ask.approval");
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("composer-input").press("Control+Enter");
    const edit = role(page, "omp.tool.edit");
    await expect(edit).toBeVisible({ timeout: 30_000 });
    // 上下文行(第 8 行是长段落):行号和文字同一行开始,文字不掉到行号下面。
    const ctx = edit.locator('.tsp-dl[data-kind="ctx"]').nth(1);
    const [gutter, text] = await Promise.all([
      ctx.locator(".tsp-dg").first().boundingBox(),
      ctx.locator(".tsp-dt").boundingBox(),
    ]);
    expect(text!.y).toBe(gutter!.y);
    expect(text!.x).toBeGreaterThan(gutter!.x + gutter!.width);
    // 过程区的文字是 omp 原样的英文,中文界面也一样(不走 i18n)。
    await expect(edit.locator(".tsp-dsep")).toContainText("unchanged lines");
    // eval 的长代码行折行,代码块不能横向滚动。
    const code = role(page, "omp.tool.eval").locator(".tsp-code-body").first();
    await expect(code).toBeVisible();
    const overflow = await code.evaluate((el) => {
      const box = el as unknown as { scrollWidth: number; clientWidth: number };
      return box.scrollWidth - box.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    await edit.scrollIntoViewIfNeeded();
    await shoot(page, "cards");
  } finally {
    await cleanup();
  }
});

test("用户消息悬停:从气泡分步移向复制按钮的整条路上按钮都在,点击发出 copy-message;Tab 到按钮也显示", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start("task");
  try {
    const { page } = launched;
    await sendFirst(page, TASK_PROMPT);
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    const bubble = role(page, "omp.user").first();
    const tools = role(page, "omp.user.tools").first();
    const copy = tools.locator('[data-id$="/copy"]');
    await bubble.scrollIntoViewIfNeeded();
    // 没悬停:按钮不显示。
    await page.mouse.move(1, 1);
    await expect(tools).toHaveCSS("opacity", "0");
    // 鼠标先进气泡正文,再一小步一小步移到按钮中心:每一步都要保持显示(间隙不能断开悬停)。
    const box = (await bubble.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tools).toHaveCSS("opacity", "1");
    const target = (await copy.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const steps = 30;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      // evaluate 只把回调本身发进页面,所以 getComputedStyle 写在回调里;e2e 的类型检查没有 DOM 类型,经 globalThis 取。
      expect(await tools.evaluate((el) => (globalThis as unknown as PageStyle).getComputedStyle(el).opacity)).toBe("1");
    }
    await page.mouse.down();
    await page.mouse.up();
    await expect
      .poll(async () => (await received()).some((e) => e["ev"] === "action" && e["act"] === "copy-message"))
      .toBe(true);
    // 鼠标点过复制按钮后焦点留在它上面,但鼠标移走按钮行照样收起(只认键盘焦点)。
    await page.mouse.move(1, 1);
    await expect(tools).toHaveCSS("opacity", "0");
    // 键盘:Shift+Tab 离开、Tab 回到复制按钮,按钮行显示且有焦点;回车同样触发。
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(copy).toBeFocused();
    await expect(tools).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await received()).filter((e) => e["ev"] === "action" && e["act"] === "copy-message").length)
      .toBe(2);
  } finally {
    await cleanup();
  }
});

test("恢复会话:omp 不重发的每轮用量脚注补回;回顾只补最新一条、放回它的位置(之后还有新一轮也照样补),用 ※ 不用时钟图标", async () => {
  test.setTimeout(120_000);
  // 假 omp 回放的是 omp 18.12.4 `--resume` 一个 3 轮会话的实录:旧对话重发了,但没有 omp.turn.usage / omp.recap。
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp tsp resume agent "));
  const sessionFile = path.join(agentDir, "sessions", "--e2e--", "2026-10-20T01-17-16-019Z_resume.jsonl");
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await copyFile(path.join(root, "fixtures", "tsp", "resume-session.jsonl"), sessionFile);
  // omp 的空闲回顾只进 agent 目录的 history.db(session_recaps);会话 id 是会话文件头里的 id。
  // 两条:更早的一条在第 1 轮之后,最新一条在第 2 轮之后、第 3 轮开始之前——之后还有第 3 轮的消息,不能因此不显示。
  const starts = parseSession(await readFile(sessionFile, "utf8")).turnStarts;
  const secondsBetween = (a: number | undefined, b: number | undefined) => Math.floor(((a ?? 0) + (b ?? 0)) / 2 / 1000);
  const db = new DatabaseSync(path.join(agentDir, "history.db"));
  db.exec(
    "CREATE TABLE session_recaps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)))",
  );
  const insert = db.prepare("INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES (?, ?, ?, ?)");
  insert.run(
    "01a156e2-5573-752f-ae26-c89b4b0fd495",
    "E:/x",
    "更早的回顾:刚读完 calc.py。",
    secondsBetween(starts[0], starts[1]),
  );
  insert.run(
    "01a156e2-5573-752f-ae26-c89b4b0fd495",
    "E:/x",
    "目标是验证 calc.py。已读完三个文件,下一步等你的指示。",
    secondsBetween(starts[1], starts[2]),
  );
  db.close();
  const { launched, cleanup } = await start("resume", {
    PI_CODING_AGENT_DIR: agentDir,
    FAKE_TSP_SESSION_FILE: sessionFile,
  });
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    // 侧栏的项目文件夹默认折叠,openTaskRow 先展开再点任务行。
    await openTaskRow(page);
    await expect(role(page, "omp.user")).toHaveCount(3, { timeout: 30_000 });
    // 每轮末尾补一行用量:3 行,按会话文件算(第 1 轮 11.2s · 2859 tok · $0.0019),和 omp 实时那行同格式(不到半分钱写 <$0.01)。
    const usage = page.locator('[data-testid="tsp-view"] [data-role="omp.turn.usage"][data-restored]');
    await expect(usage).toHaveCount(3);
    await expect(usage.nth(0)).toHaveText("11.2s · 2.9K tok · <$0.01 this turn");
    await expect(usage.nth(1)).toHaveText("47.5s · 2.8K tok · <$0.01 this turn");
    await expect(usage.nth(2)).toHaveText("4.7s · 1.1K tok · <$0.01 this turn");
    await expect(usage.nth(2)).toHaveAttribute("title", /^This turn: 4\.7s · 1,097 tokens \(838 in · 259 out\)/);
    // 补的行在每轮最后一个助手消息里面(和 omp 实时的位置一样),不是游离在外。
    await expect(page.locator('[data-role="omp.assistant"] > [data-role="omp.turn.usage"]')).toHaveCount(3);
    // 回顾:整个对话里只有最新的一条,图标是 ※(不是时钟/回退图标),斜体淡色,悬停提示是 omp 原样的英文。
    const recap = role(page, "omp.recap");
    await expect(recap).toHaveCount(1);
    await expect(recap).toContainText("目标是验证 calc.py");
    await expect(recap.locator(".tsp-icon")).toHaveCount(0);
    expect(
      await recap.evaluate((el) => (globalThis as unknown as PageStyle).getComputedStyle(el, "::before").content),
    ).toBe('"※"');
    await expect(recap).toHaveCSS("font-style", "italic");
    await expect(recap).toHaveAttribute("title", "Recap while you were away");
    // 位置:第 2 轮之后、第 3 轮之前(前两个用户消息在它前面,第三个在它后面)。
    const relations = await recap.evaluate((el) => {
      type Node = { compareDocumentPosition(other: unknown): number };
      const users = [
        ...(
          globalThis as unknown as { document: { querySelectorAll(selector: string): Node[] } }
        ).document.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.user"]'),
      ];
      return users.map((user) => (el as unknown as Node).compareDocumentPosition(user) & 6);
    });
    // 4 = 这个用户消息在回顾后面,2 = 在前面。
    expect(relations).toEqual([2, 2, 4]);
    await recap.scrollIntoViewIfNeeded();
    await shoot(page, "resume");
  } finally {
    await cleanup();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// 对话线(假 omp 回放 resume:3 条用户消息)。窗口压矮,让三轮对话需要滚动。
test("对话线:每条用户消息一个刻度,点刻度把那条消息滚到对话区顶部、刻度标为当前;吸底时当前是最后一条", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("resume");
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 1200, height: 600 });
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    await expect(role(page, "omp.user")).toHaveCount(3, { timeout: 30_000 });
    const ticks = page.getByTestId("conversation-line-tick");
    await expect(ticks).toHaveCount(3);
    await expect(ticks.nth(2)).toHaveAttribute("aria-current", "location");
    // 消息顶边到对话区顶边的距离:跳过去后是 16(--space-4)。
    const landing = (index: number) =>
      page.evaluate((nth) => {
        type Box = { getBoundingClientRect(): { top: number } };
        const d = (
          globalThis as unknown as { document: { querySelector(s: string): Box; querySelectorAll(s: string): Box[] } }
        ).document;
        const scroller = d.querySelector('[data-testid="tsp-view"] .tsp-scroller');
        const card = d.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.user"]')[nth]!;
        return Math.round(card.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
      }, index);
    for (const index of [0, 1]) {
      await ticks.nth(index).click();
      await expect.poll(() => landing(index)).toBe(16);
      await expect(ticks.nth(index)).toHaveAttribute("aria-current", "location");
      await expect(page.locator('[data-testid="conversation-line-tick"][aria-current]')).toHaveCount(1);
    }
    // 刻度的说明(悬停提示 / 读屏)是那条消息的开头。
    const second = (await role(page, "omp.user").nth(1).locator(".md").innerText()).trim().slice(0, 10);
    await expect(ticks.nth(1)).toHaveAttribute("aria-label", new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await ticks.nth(1).hover();
    await shoot(page, "conversation-line");
  } finally {
    await cleanup();
  }
});

// resume 里:edit 卡的 diff 带 `lang:"python"`,wait 卡有 tone:"info"(两张)和 tone:"success"(一张),bash 卡 `lang:"bash"`。
test("过程卡片(resume 录制):diff 按 lang 有语法色并叠在增删底色上;omp 给了 info 的 wait 卡和中性卡区分开(栏色 + 描边),success 的不染", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("resume");
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    await expect(role(page, "omp.user")).toHaveCount(3, { timeout: 30_000 });
    // diff:语言包异步加载,token 带 --shiki 变量色;增行的底色还在。
    const diff = page.locator('[data-testid="tsp-view"] .tsp-diff').first();
    await expect(diff).toBeVisible();
    await expect(diff.locator('.tsp-dl[data-kind="add"] .tsp-dt span[style*="--shiki-token"]').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(diff.locator('.tsp-dl[data-kind="add"]').first()).not.toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    // tone:info 的 wait 卡:左栏(.tsp-tool-bar)画出来、图标染 info 色;tone:success 的那张没有栏(完成态中性)。
    const waits = role(page, "omp.tool.wait");
    await expect(waits).toHaveCount(3);
    await expect(waits.nth(0)).toHaveAttribute("data-tone", "info");
    await expect(waits.nth(0).locator(".tsp-tool-bar")).toBeVisible();
    await expect(waits.nth(2).locator(".tsp-tool-bar")).toBeHidden();
    const icon = async (index: number) =>
      waits
        .nth(index)
        .locator(".tsp-tool-ic")
        .evaluate((el) => (globalThis as unknown as PageStyle).getComputedStyle(el).color);
    expect(await icon(0)).not.toBe(await icon(2));
    await waits.first().scrollIntoViewIfNeeded();
    await shoot(page, "tool-tone-diff");
  } finally {
    await cleanup();
  }
});

// 搜索来源(假 omp 回放 resume 里的 web_search 卡片,5 个来源,第一个是 python-31117)。
test("搜索来源排成等宽卡片网格(照 Tern):一行三张、域名在标题上面;点卡片空白处也打开链接", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("resume");
  try {
    const { page, app } = launched;
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { opened: string[] }).opened = opened;
      shell.openExternal = async (url: string) => {
        opened.push(url);
      };
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    const sources = page.locator('[data-testid="tsp-view"] [data-role="omp.tool.source"]');
    await expect(sources).toHaveCount(5, { timeout: 30_000 });
    await sources.nth(0).scrollIntoViewIfNeeded();
    const box = async (index: number) => (await sources.nth(index).boundingBox())!;
    const [first, second, third, fourth] = [await box(0), await box(1), await box(2), await box(3)];
    expect(second.y).toBe(first.y);
    expect(third.y).toBe(first.y);
    expect(Math.abs(second.width - first.width)).toBeLessThanOrEqual(1);
    expect(fourth.y).toBeGreaterThan(first.y + first.height);
    expect(fourth.x).toBe(first.x);
    const domain = await sources.nth(0).getByText("python.org", { exact: true }).boundingBox();
    const title = await sources.nth(0).locator(".tsp-link").boundingBox();
    expect(domain!.y + domain!.height).toBeLessThanOrEqual(title!.y);
    // 点卡片右上角(域名文字右边的空白)
    await sources.nth(0).click({ position: { x: first.width - 8, y: 8 } });
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
      .toEqual(["https://www.python.org/downloads/release/python-31117"]);
  } finally {
    await cleanup();
  }
});

test("压缩分隔画成整行横线夹文字;切模型后 omp 的状态行留在对话里(不是一闪而过的弹层);点分隔展开摘要", async () => {
  test.setTimeout(120_000);
  // 假 omp 回放的是 omp 18.12.5 `--resume` 一个压缩过的会话:section omp.compaction(折叠)、启动时的状态行,
  // 末尾是切模型后的 "Session-only model: …"(录制里选择器的那几帧去掉了,免得假 omp 等输入)。
  const { launched, cleanup } = await start("compact");
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    const divider = role(page, "omp.compaction");
    await expect(divider).toBeVisible({ timeout: 30_000 });
    // 头文字是 omp 原样的英文,中文界面也一样。
    const head = divider.locator(".tsp-section-head");
    await expect(head).toContainText("Snap-compacted");
    await expect(head).toContainText("48K");
    await expect(head).toContainText("6.1K tokens");
    // 整行分隔:文字两侧各一段连贯横线(伪元素,撑满剩余宽度,1px 高),没有折叠箭头。
    const parts = await head.evaluate((el) => {
      const win = globalThis as unknown as PageStyle;
      const child = (selector: string) =>
        (el as unknown as { querySelector(s: string): unknown }).querySelector(selector);
      const before = win.getComputedStyle(el, "::before");
      const after = win.getComputedStyle(el, "::after");
      return {
        before: { content: before.content, height: before.height, flexGrow: before.flexGrow },
        after: { content: after.content, height: after.height, flexGrow: after.flexGrow },
        chevron: win.getComputedStyle(child(".tsp-chev")).display,
        fontSize: win.getComputedStyle(child(".tsp-head")).fontSize,
      };
    });
    for (const line of [parts.before, parts.after])
      expect(line).toEqual({ content: '""', height: "1px", flexGrow: "1" });
    expect(parts.chevron).toBe("none");
    // 文字 13px(--fs-sm):比过程里的小字(12px)大一号。
    expect(parts.fontSize).toBe("13px");
    // 摘要默认收着,点文字展开。
    await expect(divider.locator(".tsp-section-body")).toHaveCount(0);
    await head.click();
    await expect(divider.locator(".tsp-section-body")).toContainText("The user asked two questions");
    await head.click();
    await expect(divider.locator(".tsp-section-body")).toHaveCount(0);
    // 状态行:启动时的两条 + 切模型那条,都留在对话里,没有弹层。
    const notes = page.getByTestId("tsp-status-note");
    await expect(notes).toHaveCount(3);
    await expect(notes.nth(0)).toHaveText("Session compacted 1 time");
    await expect(notes.nth(2)).toHaveText(
      "Session-only model: deepseek/deepseek-v4-pro. Use Alt+M or /model for roles.",
    );
    await expect(page.locator(".toast")).toHaveCount(0);
    // 它们在最后一条助手回答的后面。
    const order = await notes.nth(2).evaluate((el) => {
      type Node = { compareDocumentPosition(other: unknown): number };
      const assistants = [
        ...(
          globalThis as unknown as { document: { querySelectorAll(selector: string): Node[] } }
        ).document.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.assistant"]'),
      ];
      const last = assistants[assistants.length - 1];
      return last === undefined ? -1 : (el as unknown as Node).compareDocumentPosition(last) & 2;
    });
    // 2 = 最后一条助手回答在状态行前面。
    expect(order).toBe(2);
    await notes.nth(2).scrollIntoViewIfNeeded();
    await shoot(page, "compact");
  } finally {
    await cleanup();
  }
});

const JOBS_PROMPT =
  "Run `npx playwright test` in the current directory as a background bash job (async/background mode, do not wait for it in the foreground). Right after starting it, reply only with the word STARTED and stop.";

test("后台作业对话框:omp 的测试进度和逐条用时柱状图(omp.job.widget)画出来,柱数 = series 长度,进度条显示 36/36", async () => {
  test.setTimeout(90_000);
  const { launched, cleanup } = await start("jobs-chart");
  try {
    const { page } = launched;
    await sendFirst(page, JOBS_PROMPT);
    // 录制(omp 18.12.5)里 /jobs 打开了两次:跑到一半(17/36)和跑完(36/36),第二次的 overlay 留到录制结束。
    const widget = role(page, "omp.job.widget");
    await expect(widget.locator("[role=meter]")).toBeVisible({ timeout: 60_000 });
    await expect(widget).toContainText("playwright · 36 tests", { timeout: 60_000 });
    await expect(widget).toContainText("36/36", { timeout: 60_000 });
    await expect(role(page, "omp.job.widget.stat")).toContainText("passed 36 · failed 0");
    // 柱状图:最后一帧的 series 有 21 项(omp 只留最近的一段),每项一根柱。
    await expect(widget.locator(".tsp-chart-bars i")).toHaveCount(21);
    await expect(widget.locator(".tsp-chart-sum")).toHaveText("test duration 711 ms");
  } finally {
    await cleanup();
  }
});

test("后台作业弹窗:卡片不超出 tsp-view、作业列表顶对齐;输入框有焦点时按 Esc 把 Esc 键写给 omp 一次", async () => {
  test.setTimeout(90_000);
  const { launched, received, receivedKeys, cleanup } = await start("jobs-chart");
  try {
    const { page } = launched;
    await sendFirst(page, JOBS_PROMPT);
    // 录制里第二次 /jobs 的 overlay(layer.ov-16)留到录制结束;前一个(layer.ov-z)omp 自己 del 了,界面上只有一层。
    const overlay = role(page, "omp.overlay.jobs");
    await expect(overlay).toHaveCount(1, { timeout: 60_000 });
    await expect(role(page, "omp.job.widget")).toContainText("36/36", { timeout: 60_000 });
    // 卡片装在 tsp-view 里,底部的 Close 够得着(max-height 100% + 内部滚动)。
    const card = overlay.locator(".tspi-ov-card");
    const viewBox = await page.getByTestId("tsp-view").boundingBox();
    const cardBox = await card.boundingBox();
    expect(viewBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(cardBox!.y).toBeGreaterThanOrEqual(viewBox!.y - 1);
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(viewBox!.y + viewBox!.height + 1);
    // 内容比卡片高时卡片体自己滚动:滚到底,Close 那一行就在视口里(不是被卡片切掉够不着)。
    await role(page, "omp.actions").scrollIntoViewIfNeeded();
    await expect(role(page, "omp.actions")).toBeInViewport({ ratio: 1 });
    // 列表和详情顶对齐(row 默认垂直居中会让列表漂到详情中间)。
    const masterBox = await role(page, "omp.jobs.master").boundingBox();
    const detailBox = await role(page, "omp.jobs.detail").boundingBox();
    expect(Math.abs(masterBox!.y - detailBox!.y)).toBeLessThanOrEqual(1);
    await shoot(page, "jobs-overlay");

    // Esc:焦点在 studio 输入框里,弹窗把 Esc 写给 omp(弹窗没有关闭动作,关它就是这个键),只写一次。
    const escCount = async () => (await receivedKeys()).join("").split("\x1b").length - 1;
    const before = await escCount();
    await page.getByTestId("composer-input").focus();
    await page.keyboard.press("Escape");
    await expect.poll(escCount).toBe(before + 1);

    // /jobs 由 studio 接管：不再有 studio 自己的弹层，直接打开 omp 的作业弹窗并选中作业。作业从 omp 的节点推出来
    // （hud 里运行中的 bg_1，再被 /jobs 弹窗里的 Done 校正）；跑完以后药丸没了，/jobs 选最近的那个。
    // 假 omp 把录制末尾的弹窗留着（真 omp 收到 Esc 就关了）：弹窗已经在，就只发 select，不再发 /jobs。
    // select 的 id 是作业列表、item 是它下面的列表项（omp 按 id 找组件，见 shared/tsp/jobs.ts 的 findJobsOverlayItem）。
    const selects = async () =>
      (await received()).filter(
        (body) =>
          body["ev"] === "select" &&
          String(body["id"]).endsWith(".split/master/jobs") &&
          body["item"] === `${String(body["id"])}/bg_1`,
      ).length;
    const jobsSent = async () =>
      (await received()).filter((body) => body["ev"] === "send" && String(body["text"]).startsWith("/jobs")).length;
    const sentBefore = await jobsSent();
    const selectsBefore = await selects();
    await expect(page.getByTestId("pill-jobs")).toHaveCount(0);
    const input = page.getByTestId("composer-input");
    await input.fill("/jobs");
    await page.keyboard.press("Enter");
    await expect.poll(selects).toBe(selectsBefore + 1);
    expect(await jobsSent()).toBe(sentBefore);
  } finally {
    await cleanup();
  }
});

test("待办浮层:/todo 打开,输入框里按 Esc 关掉并被消耗(不是停止任务),焦点留在输入框", async () => {
  test.setTimeout(120_000);
  const { launched, receivedKeys, cleanup } = await start("task");
  try {
    const { page } = launched;
    await sendFirst(page, TASK_PROMPT);
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    const input = page.getByTestId("composer-input");
    const todo = page.getByTestId("todo-popover");
    await input.focus();
    await input.fill("/todo");
    await page.keyboard.press("Enter");
    await expect(todo).toBeVisible();
    // Esc 从输入框发出:关掉浮层、焦点还在输入框、这个 Esc 不写给 omp。
    const before = (await receivedKeys()).join("");
    await input.focus();
    await page.keyboard.press("Escape");
    await expect(todo).toHaveCount(0);
    await expect(input).toBeFocused();
    expect((await receivedKeys()).join("")).toBe(before);
  } finally {
    await cleanup();
  }
});

test('输入框上方(照 Tern):药丸 [👥 N | ⚡ N] 每段个数大于 0 才出现、各自点各自的;状态行 = 运行图标 + 翻牌计时 + 活动文字 + 右端待办板;omp 自己的 HUD(▷ N、运行状态行)和旧的"后台任务"按钮都不画;顶栏的子代理按钮一直在', async () => {
  test.setTimeout(120_000);
  const jobs = await start("jobs-chart");
  try {
    const { page } = jobs.launched;
    await sendFirst(page, JOBS_PROMPT);
    // 一个后台 bash 在跑:只有右半段(⚡ 1),没有子代理那一段;状态行里有计时和活动文字。
    const pill = page.getByTestId("pill-jobs");
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await expect(pill).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("pill-agents")).toHaveCount(0);
    // 旧的"后台任务"按钮、omp 的 HUD(▷ 1 胶囊、运行状态行)一个都不画。
    await expect(page.getByTestId("jobs-pill-bash")).toHaveCount(0);
    await expect(page.getByTestId("tsp-jobs-bar")).toHaveCount(0);
    await expect(role(page, "omp.hud")).toHaveCount(0);
    await expect(role(page, "omp.hud.seg")).toHaveCount(0);
    await expect(role(page, "omp.working")).toHaveCount(0);
    // 点右半段 = 直接让 omp 打开它的作业弹窗（点 hud 的作业胶囊：动作 jobs.open），studio 不再有中间的列表弹层。
    await pill.click();
    await expect.poll(async () => (await jobs.received()).some((event) => event["act"] === "jobs.open")).toBe(true);
    // 没有子代理时药丸没有左半段,顶栏的子代理按钮仍在:点开是空状态;和文件面板共用右栏,开一个就关另一个。
    const agentsToggle = page.getByTestId("topbar-agents");
    await agentsToggle.click();
    await expect(page.getByTestId("agents-empty")).toBeVisible();
    await expect(agentsToggle).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("topbar-files").click();
    await expect(page.getByTestId("file-preview")).toBeVisible();
    await expect(page.getByTestId("agents-panel")).toHaveCount(0);
    await expect(agentsToggle).toHaveAttribute("aria-pressed", "false");
    await agentsToggle.click();
    await expect(page.getByTestId("agents-panel")).toBeVisible();
    await expect(page.getByTestId("file-preview")).toHaveCount(0);
    await agentsToggle.click();
    await expect(page.getByTestId("agents-panel")).toHaveCount(0);
    await shoot(page, "composer-pills");
  } finally {
    await jobs.cleanup();
  }
  const hub = await start("hub-steer");
  try {
    const { page } = hub.launched;
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("hub-steer"))[0]!.event["text"]));
    // 两个子代理在跑:只有左半段(👥 2);点它 = 打开右栏的子代理面板(不发给 omp)。
    const pill = page.getByTestId("pill-agents");
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await expect(pill).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("pill-jobs")).toHaveCount(0);
    await pill.click();
    await expect(page.getByTestId("agents-panel")).toBeVisible();
    expect((await hub.received()).some((event) => event["act"] === "agents.open")).toBe(false);
    // 从药丸打开的也是同一个面板:顶栏按钮跟着显示为按下。
    await expect(page.getByTestId("topbar-agents")).toHaveAttribute("aria-pressed", "true");
  } finally {
    await hub.cleanup();
  }
});

test("悬停药丸的作业那一段:上方出作业卡片代替悬停提示,内容是 omp hud 作业胶囊的悬停卡片,omp 的作业小部件给了进度就有进度条", async () => {
  test.setTimeout(120_000);
  // 2 倍速:录制里有进度的那段 22 秒,20 倍速只有一秒多,进度条出来前作业可能就跑完了。
  const { launched, cleanup } = await start("jobs-chart", {}, 2);
  try {
    const { page } = launched;
    await sendFirst(page, JOBS_PROMPT);
    const pill = page.getByTestId("pill-jobs");
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await pill.hover();
    const card = page.getByTestId("jobs-card");
    await expect(card.getByTestId("jobs-card-tile")).toHaveAttribute("data-job-id", "bg_1");
    await expect(card).toContainText("npx playwright test");
    await expect(card.locator("[role=meter]")).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(/done \d+/);
    await expect(card).toContainText(/passed \d+ · failed 0/);
    await expect(page.getByTestId("tooltip")).toHaveCount(0);
    await page.mouse.move(5, 5);
    await expect(card).toHaveCount(0);
    // 用 shoot 换主题后截出来卡片已经不在了：每种主题换好以后重新悬停再截。
    for (const [locale, scheme] of [
      ["zh-CN", "light"],
      ["zh-CN", "dark"],
      ["en", "light"],
      ["en", "dark"],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await setLocaleTheme(page, locale, scheme);
      await pill.hover();
      await expect(card.locator("[role=meter]")).toBeVisible();
      await page.screenshot({ path: path.join(screenshotsDir, `tsp-composer-jobs-card-${locale}-${scheme}.png`) });
      await page.mouse.move(5, 5);
    }
  } finally {
    await cleanup();
  }
});

test("小窗口(800×600 / 960×600):输入框整个在窗口里,工具行不被切掉——缩的是对话滚动区,不是输入框;药丸在状态行/输入框正上方、不重叠", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("hub-steer");
  try {
    const { page, app } = launched;
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("hub-steer"))[0]!.event["text"]));
    await expect(page.getByTestId("pill-agents")).toBeVisible({ timeout: 60_000 });
    for (const [width, height] of [
      [1200, 800],
      [960, 600],
      [800, 600],
    ] as const) {
      // setSize 设的是含窗口边框的外框；渲染进程的 innerWidth 等于主进程的内容宽度才算收到了新尺寸（resize 是异步的），再量布局。
      await app.evaluate(
        ({ BrowserWindow }, size: readonly [number, number]) => {
          const win = BrowserWindow.getAllWindows()[0]!;
          win.unmaximize();
          win.setSize(size[0], size[1]);
        },
        [width, height],
      );
      await expect
        .poll(async () => {
          const contentWidth =
            (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentSize()[0])) ?? 0;
          return (
            (await page.evaluate("window.innerWidth")) === contentWidth && contentWidth > 0 && contentWidth <= width
          );
        })
        .toBe(true);
      await expect.poll(() => page.evaluate("window.innerHeight")).toBeLessThanOrEqual(height);
      const inner = (await page.evaluate("window.innerHeight")) as number;
      const tools = await page.locator(".composer-tools").boundingBox();
      const composer = await page.locator(".composer").boundingBox();
      const pills = await page.getByTestId("status-pills").boundingBox();
      const view = await page.getByTestId("tsp-view").boundingBox();
      expect(tools).not.toBeNull();
      // 输入框整个在窗口里(工具行底边 + 面板下边距不越过窗口底)。
      expect(tools!.y + tools!.height).toBeLessThanOrEqual(inner);
      expect(composer!.y + composer!.height).toBeLessThanOrEqual(inner);
      // 药丸在输入框上方,和输入框、对话区都不重叠。
      expect(pills!.y + pills!.height).toBeLessThanOrEqual(composer!.y);
      expect(view!.y + view!.height).toBeLessThanOrEqual(pills!.y + 1);
      // 对话区还有可读的高度。
      expect(view!.height).toBeGreaterThan(120);
    }
  } finally {
    await cleanup();
  }
});

test("错误回合只留一份:错误文字只在卡片里(没有 dock 里的红色横幅),重试只有 studio 的按钮,omp 的 Retry F5 不画而 F5 仍转发;没有作业时 /jobs 给提示", async () => {
  test.setTimeout(90_000);
  const { launched, receivedKeys, cleanup } = await start("error-turn");
  try {
    const { page } = launched;
    await sendFirst(page, "Reply with exactly: hello");
    await expect(role(page, "omp.error")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("retry-turn")).toBeVisible();
    await expect(page.getByText(/Authentication Fails/)).toHaveCount(1);
    await expect(role(page, "omp.errorBanner")).toHaveCount(0);
    // 卡片上只剩复制错误、换模型两个 omp 动作。
    await expect(role(page, "omp.error.action")).toHaveCount(2);
    await expect(role(page, "omp.error")).not.toContainText("F5");
    const before = (await receivedKeys()).join("");
    await page.getByTestId("composer-input").focus();
    await page.keyboard.press("F5");
    await expect.poll(async () => (await receivedKeys()).join("").slice(before.length)).toBe("\x1b[15~");
    // 这个任务没有后台作业:/jobs 不打开浮层,给一条提示(和 /todo 没有待办时一样)。
    await page.getByTestId("composer-input").fill("/jobs");
    await page.keyboard.press("Enter");
    await expect(page.locator(".toast")).toContainText(/这个任务还没有后台任务|no background jobs/);
  } finally {
    await cleanup();
  }
});

test("omp 的快捷键(B18):输入框有焦点时 F5 / ⇧Tab / ⌃P / ⌃⇧P / ⌥P / ⌥⇧P / ⌃T / ⌃R / ⌥↑ 编码后写给 omp;studio 自己的键(⌥T、⌃L)和普通字符不转发,⌃O 是 studio 的展开/收起、自己写一次 ⌃O", async () => {
  test.setTimeout(90_000);
  const { launched, receivedKeys, cleanup } = await start("error-turn");
  try {
    const { page } = launched;
    await sendFirst(page, "Reply with exactly: hello");
    // 错误卡上的键帽是 omp 自己写的 `Retry F5` / `Switch model ⌥P`。
    await expect(role(page, "omp.error")).toBeVisible({ timeout: 30_000 });
    const input = page.getByTestId("composer-input");
    await input.focus();
    const before = (await receivedKeys()).join("");
    const ESC = "\x1b";
    const chords: [string, string][] = [
      ["F5", `${ESC}[15~`],
      ["Shift+Tab", `${ESC}[Z`],
      ["Control+p", "\x10"],
      ["Control+Shift+P", `${ESC}[112;6u`],
      ["Alt+p", `${ESC}p`],
      ["Alt+Shift+P", `${ESC}P`],
      ["Control+t", "\x14"],
      ["Control+r", "\x12"],
      ["Alt+ArrowUp", `${ESC}[1;3A`],
    ];
    for (const [chord] of chords) await page.keyboard.press(chord);
    const expected = chords.map(([, bytes]) => bytes).join("");
    const sent = async () => JSON.stringify((await receivedKeys()).join("").slice(before.length));
    await expect.poll(sent).toBe(JSON.stringify(expected));
    // 输入框里没有多出字符;studio 自己的键不写给 omp(⌥T 切思考、⌃L 聚焦输入框);⌃O 是 studio 的"展开/收起工具卡片"，
    // 它自己把 ⌃O(\x0f) 写给 omp 一次(use-task-commands.ts)，不是输入框把按键原样转发；普通字符 x 留在输入框里。
    await expect(input).toHaveValue("");
    for (const chord of ["Alt+t", "Control+l", "Control+o", "x"]) await page.keyboard.press(chord);
    await expect(input).toHaveValue("x");
    await page.keyboard.press("F5");
    await expect.poll(sent).toBe(JSON.stringify(`${expected}\x0f${ESC}[15~`));
  } finally {
    await cleanup();
  }
});

const GOAL_TEXT = "Run the shell command sleep 20 with the bash tool, then say done and mark the goal complete.";

test("目标条(TSP,omp 18.12.5 录制):/goal 由 studio 接管,目标条读输入框卡片上的 Goal 行;暂停 / 继续 / 放弃发 omp 的 /goal 命令,放弃点掉 omp 的确认选择器", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("goal-flow");
  try {
    const { page } = launched;
    await sendFirst(page, "Reply with the single word PONG and nothing else.");
    // 第一句话由主进程等 omp 输入框可发送后异步 send:等它到了 omp 再发 /goal,两者的先后才是确定的。
    await expect
      .poll(async () => (await received()).some((event) => event["ev"] === "send"), { timeout: 30_000 })
      .toBe(true);
    const strip = page.getByTestId("goal-strip");
    await expect(strip).toHaveCount(0);
    // 斜杠命令是 studio 的(不当消息发给模型):创建发出 omp 的 `/goal <文字>`,目标条出现。
    await page.getByTestId("composer-input").fill(`/goal ${GOAL_TEXT}`);
    await page.keyboard.press("Enter");
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await expect(strip).toHaveAttribute("data-status", "active");
    await expect(strip).toContainText(GOAL_TEXT);
    // omp 自己的输入框卡片(含那一行 Goal 标签)不画:目标只有 studio 的这一条。
    await expect(role(page, "omp.composer.fact")).toHaveCount(0);
    await strip.getByTestId("goal-pause").click();
    await expect(strip).toHaveAttribute("data-status", "paused");
    await expect(strip.getByTestId("goal-resume")).toBeVisible();
    await shoot(page, "goal");
    await strip.getByTestId("goal-resume").click();
    await expect(strip).toHaveAttribute("data-status", "active");
    // 放弃:omp 先问 "Drop goal?"(Yes / No 选择器),studio 点 Yes(activate item 0),目标条随事实行消失。
    await strip.getByTestId("goal-drop").click();
    await expect(strip).toHaveCount(0, { timeout: 30_000 });
    const sent = await received();
    expect(sent.filter((event) => event["ev"] === "send").map((event) => event["text"])).toEqual([
      "Reply with the single word PONG and nothing else.",
      `/goal ${GOAL_TEXT}`,
      "/goal pause",
      "/goal resume",
      "/goal drop",
    ]);
    expect(sent.filter((event) => event["ev"] === "activate")).toEqual([
      expect.objectContaining({ ev: "activate", item: "0" }),
    ]);
  } finally {
    await cleanup();
  }
});

// 子代理面板(omp 18.12.5 录制 hub-steer):👥 胶囊的点击被 studio 拦截,打开右栏的子代理面板而不是 omp 的 Agent Hub;
// 在面板里给 Beta 插话 = 主进程在后台走 Hub(agents.open → activate → send → focus:Main),期间面板显示"正在发给 Beta"、
// omp 的 Hub 一帧也不画出来;假 omp 只在事件和录制逐字相同时才往下放帧,所以走完就证明事件发对了。
test("子代理面板:👥 打开右栏面板(不画 omp 的 Hub),列出 Alpha / Beta;给 Beta 插话时显示正在发给 Beta,事件序列和录制一致,输入框恢复", async () => {
  test.setTimeout(120_000);
  const steerText = "Also say PINEAPPLE in your final reply.";
  const firstPrompt = String(recordedUserEvents(loadTspFixture("hub-steer"))[0]!.event["text"]);
  const { launched, received, cleanup } = await start("hub-steer");
  try {
    const { page } = launched;
    await sendFirst(page, firstPrompt);
    // 录制里两个后台子代理在跑时用户点了 👥(agents.open):假 omp 在这一步等事件。输入框上方药丸的左半段(👥 2)就是入口,omp 自己的 hud 胶囊不画。
    const pill = page.getByTestId("pill-agents");
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await shoot(page, "pills");
    await pill.click();
    const panel = page.getByTestId("agents-panel");
    await expect(panel).toBeVisible();
    // 点胶囊没有把 agents.open 发给 omp(被拦截):假 omp 收到的事件里还没有它。
    expect((await received()).some((event) => event["act"] === "agents.open")).toBe(false);
    await expect(panel.getByTestId("agents-row")).toHaveCount(2);
    await expect(panel.locator('[data-testid="agents-row"][data-name="Alpha"]')).toHaveAttribute(
      "data-status",
      "running",
    );
    await expect(panel.locator('[data-testid="agents-row"][data-name="Beta"]')).toHaveAttribute(
      "data-status",
      "running",
    );
    // 同一栏只开一个面板:文件面板没有同时出现。
    await expect(page.getByTestId("file-preview")).toHaveCount(0);
    await panel.locator('[data-testid="agents-row"][data-name="Beta"]').click();
    await expect(panel.getByTestId("agents-detail")).toHaveAttribute("data-name", "Beta");
    await shoot(page, "agents-panel");

    // 页面里盯着:插话期间"正在发给 Beta"出现过、omp 的 Hub(.tspi-picker)一次也没画过。
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: {
          querySelector(s: string): { getAttribute(n: string): string | null } | null;
          documentElement: unknown;
        };
        MutationObserver: new (cb: () => void) => { observe(target: unknown, o: object): void };
        __steer: { driving: string[]; hub: boolean };
      };
      g.__steer = { driving: [], hub: false };
      new g.MutationObserver(() => {
        const banner = g.document.querySelector('[data-testid="agents-driving"]');
        if (banner) {
          const text = `${banner.getAttribute("data-op")}:${banner.getAttribute("data-name")}`;
          if (!g.__steer.driving.includes(text)) g.__steer.driving.push(text);
        }
        if (g.document.querySelector('[data-testid="tsp-view"] .tspi-picker')) g.__steer.hub = true;
      }).observe(g.document.documentElement, { subtree: true, childList: true, attributes: true });
    });
    await panel.getByTestId("agents-steer-input").fill(steerText);
    await panel.getByTestId("agents-steer-input").press("Enter");

    // 假 omp 按录制放帧:收到 agents.open → activate(Beta) → send 之后才往下走;主进程接着发聚焦行的 focus:Main 退出聚焦。
    await expect
      .poll(
        async () => (await received()).map((event) => [event["ev"], event["act"] ?? event["item"] ?? event["text"]]),
        {
          timeout: 30_000,
        },
      )
      .toEqual([
        ["send", firstPrompt],
        ["action", "agents.open"],
        ["activate", "Beta"],
        ["send", steerText],
        ["action", "focus:Main"],
      ]);
    // 驱动结束:横幅消失,输入框可用,omp 的 Hub 没画过,聚焦行也退掉了。
    await expect(panel.getByTestId("agents-driving")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("composer-input")).toBeEnabled();
    const seen = await page.evaluate(
      () => (globalThis as unknown as { __steer: { driving: string[]; hub: boolean } }).__steer,
    );
    expect(seen.driving).toContain("steer:Beta");
    expect(seen.hub).toBe(false);
    await expect(role(page, "omp.composer.focus")).toHaveCount(0);
    // 插话框清空了(成功),面板还开着。
    await expect(panel.getByTestId("agents-steer-input")).toHaveValue("");
  } finally {
    await cleanup();
  }
});

// 子代理完成度(omp 18.12.6 录制 agent-progress,task.completionProbe):子代理跑满 2 分钟后 omp 问它完成了多少,
// 估计值进 `agent` 节点的 stats.done,同时在 wait 磁贴上画进度环 + 百分比。studio 照画磁贴,子代理面板的行和详情也显示。
test("子代理完成度(TSP):wait 磁贴画进度环和百分比,子代理面板的行和详情显示同一个估计", async () => {
  test.setTimeout(120_000);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "omp agents activity e2e-"));
  const sessionFile = path.join(scratch, "session.jsonl");
  await writeFile(sessionFile, "{}\n");
  const dir = path.join(scratch, "session");
  await mkdir(dir, { recursive: true });
  const row = (message: object) => JSON.stringify({ type: "message", message });
  const call = (id: string, name: string, args: object) => ({ type: "toolCall", id, name, arguments: args });
  const asst = (timestamp: number, content: object[], stopReason = "toolUse") => ({
    role: "assistant",
    content,
    timestamp,
    stopReason,
  });
  await writeFile(
    path.join(dir, "Alpha.jsonl"),
    [
      row(asst(2000, [call("a1", "read", { path: "src/a.ts" })])),
      row({ role: "toolResult", toolCallId: "a1", toolName: "read", isError: false, timestamp: 2100, content: [] }),
      row(asst(3000, [call("a2", "bash", { command: "npm test" })])),
      row({
        role: "toolResult",
        toolCallId: "a2",
        toolName: "bash",
        isError: true,
        timestamp: 3500,
        content: [{ type: "text", text: "exit code 1" }],
      }),
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "Beta.jsonl"),
    [
      row(asst(3200, [call("b1", "grep", { pattern: "TODO" })])),
      row(asst(4000, [{ type: "text", text: "All good" }], "stop")),
    ].join("\n"),
  );
  const { launched, cleanup } = await start("agent-progress", { FAKE_TSP_SESSION_FILE: sessionFile });
  try {
    const { page } = launched;
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("agent-progress"))[0]!.event["text"]));
    // omp 把 Task 卡片和里面的子代理行都发成 collapsed:true(preview "none":只剩标题),studio 照画;
    // 子代理进度在下面 wait 卡片的磁贴上,omp 发 preview "children",卡片收起时磁贴也一直显示(2026-10-22 仓库所有者)。
    const task = role(page, "omp.tool.task");
    const taskHead = task.locator(".tsp-tool-head");
    await expect(taskHead).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
    await expect(task.locator(".tsp-agent")).toHaveCount(0);
    const tiles = role(page, "omp.job.tiles").locator('[data-role="omp.job.tile"]');
    await expect(tiles).toHaveCount(2, { timeout: 30_000 });
    await expect(tiles.first()).toBeVisible();
    // 录制里探针点开过 Task 卡片(toggle collapsed:false),omp 收到才往下发:点一下回放才走得下去,看完再收起来。
    await taskHead.click();
    await expect(taskHead).toHaveAttribute("aria-expanded", "true");
    const rings = role(page, "omp.job.tile.ring");
    await expect(rings).toHaveCount(2, { timeout: 60_000 });
    await expect(rings.nth(0)).toContainText("66%");
    await expect(rings.nth(1)).toContainText("55%");
    await taskHead.click();
    await expect(taskHead).toHaveAttribute("aria-expanded", "false");
    await expect(tiles.first()).toBeVisible();
    await shoot(page, "agent-progress-tiles");
    await page.getByTestId("pill-agents").click();
    const panel = page.getByTestId("agents-panel");
    const beta = panel.locator('[data-testid="agents-row"][data-name="Beta"]');
    await expect(beta.getByTestId("agents-row-progress")).toHaveText("55%");
    await expect(
      panel.locator('[data-testid="agents-row"][data-name="Alpha"]').getByTestId("agents-row-progress"),
    ).toHaveText("66%");
    // 同 omp 的 Agent Hub:一打开就有选中项(列表第一个)和它的详情,对话记录默认展开。
    await expect(panel.getByTestId("agents-detail")).toHaveAttribute("data-name", "Alpha");
    await expect(panel.getByTestId("agents-record-toggle")).toHaveAttribute("aria-expanded", "true");
    await beta.click();
    await expect(panel.getByTestId("agents-detail")).toContainText("55%");
    await shoot(page, "agent-progress-panel");

    // Ctx(omp 的 agent.stats.context,录制里 0.0081 起、随回放涨到 8.6K):列表行显示细条 + 百分比,悬停提示带 omp 的 contextLabel("8.xK / 1M")。
    const ctx = panel.getByTestId("agents-row-ctx").first();
    await expect(ctx).toHaveAttribute("data-percent", "1");
    await expect(ctx).toHaveAttribute("title", /1% \(8\.\dK \/ 1M\)/);

    // Activity 页:读两个子代理的记录文件(假 session 目录里的 Alpha.jsonl / Beta.jsonl),按时间从新到旧;过滤 All / Errors / Responses / Tools。
    await panel.getByTestId("agents-tabs-activity").click();
    const rows = panel.getByTestId("agents-activity-row");
    await expect(rows).toHaveCount(5, { timeout: 20_000 });
    // 最新的在前:Beta 的回复(4000)→ Alpha 的出错(3500)→ Beta 的 grep(3200)→ Alpha 失败的 bash(3000)→ Alpha 的 read(2000)。
    await expect(rows.nth(0)).toHaveAttribute("data-agent", "Beta");
    await expect(rows.nth(0)).toHaveAttribute("data-kind", "response");
    await expect(rows.nth(1)).toHaveAttribute("data-kind", "error");
    await expect(rows.nth(1)).toContainText("exit code 1");
    await shoot(page, "agents-activity");
    await panel.getByTestId("agents-activity-filter-errors").click();
    await expect(rows).toHaveCount(1);
    await panel.getByTestId("agents-activity-filter-responses").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("All good");
    await panel.getByTestId("agents-activity-filter-tools").click();
    await expect(rows).toHaveCount(3);
    await shoot(page, "agents-activity-tools");
    // 点一行 = 回到 Agents 页并选中那个子代理。
    await panel.getByTestId("agents-activity-filter-all").click();
    await rows.nth(0).click();
    await expect(panel.getByTestId("agents-detail")).toHaveAttribute("data-name", "Beta");
    await expect(panel.getByTestId("agents-list")).toBeVisible();
  } finally {
    await cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

// 旁路提问面板(omp 18.12.5 录制 btw):omp 在 TSP 下把 /btw 画成 layer 里的 modal 弹窗,studio 的 BtwPanel 读它的问答、
// 不画 omp 的弹窗;提问 / 追问 / 取消都是主进程在后台对弹窗发的事件(action / select / edit),回答收尾后自动关弹窗。
// 假 omp 只在事件和录制逐字相同时才往下放帧,所以走完就证明事件发对了;话题 id 靠会话旁边的 btw-history/,
// 这里在假 omp 收到 `/btw <问题>` 时写(和真实 omp 一样)。
test("旁路提问面板(TSP):/btw 问 → 再问 → 对第一个话题追问 → 取消长回答,不画 omp 的弹窗,事件序列和录制一致", async () => {
  test.setTimeout(120_000);
  const events = recordedUserEvents(loadTspFixture("btw")).map((entry) => entry.event);
  const note = String(events[0]!["text"]);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "omp btw e2e-"));
  const sessionFile = path.join(scratch, "session.jsonl");
  await writeFile(sessionFile, "{}\n");
  const { launched, received, cleanup } = await start("btw", { FAKE_TSP_SESSION_FILE: sessionFile });
  const topics: Record<string, { id: string; answer: string; status: string }> = {
    "/btw Reply with exactly the word: pong": { id: "15af3d5a2937f9fd", answer: "pong", status: "complete" },
    "/btw Reply with exactly the word: ping": { id: "15af3d67d7b7f9ff", answer: "ping", status: "complete" },
    "/btw Write a 400 word essay about trees.": { id: "15af3d7a2c37fa00", answer: "# Trees", status: "cancelled" },
  };
  const written = new Set<string>();
  // omp 收到问题就把话题落到会话旁边的 btw-history/(测试进程里轮询假 omp 的收件记录来写)。
  const writer = setInterval(() => {
    void received().then(async (sent) => {
      for (const event of sent) {
        const text = event["text"];
        const topic = typeof text === "string" ? topics[text] : undefined;
        if (event["ev"] !== "send" || !topic || typeof text !== "string" || written.has(topic.id)) continue;
        written.add(topic.id);
        const dir = path.join(scratch, "session", "btw-history");
        await mkdir(dir, { recursive: true });
        const now = Date.now();
        await writeFile(
          path.join(dir, `entry-${topic.id}.json`),
          JSON.stringify({
            question: text.slice(5),
            answer: topic.answer,
            status: topic.status,
            createdAt: now,
            updatedAt: now,
            id: topic.id,
            leafId: "leaf",
          }),
        );
      }
    });
  }, 50);
  try {
    const { page } = launched;
    await sendFirst(page, note);
    // 第一句话由主进程等 omp 输入框可发送后异步 send:等它到了 omp 再问 /btw,事件先后才和录制一致。
    await expect
      .poll(async () => (await received()).some((event) => event["ev"] === "send"), { timeout: 30_000 })
      .toBe(true);
    // omp 的旁路提问弹窗一次也不能画出来(overlay 节点的 data-id 是 layer.ov-*)。
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown; documentElement: unknown };
        MutationObserver: new (cb: () => void) => { observe(target: unknown, o: object): void };
        __btwOverlay: boolean;
      };
      g.__btwOverlay = false;
      new g.MutationObserver(() => {
        if (g.document.querySelector('[data-testid="tsp-view"] [data-id^="layer.ov-"]')) g.__btwOverlay = true;
      }).observe(g.document.documentElement, { subtree: true, childList: true, attributes: true });
    });

    const panel = page.getByTestId("btw-panel");
    const composer = page.getByTestId("composer-input");
    const turns = panel.getByTestId("btw-turn");
    // 1) 输入框里 /btw <问题>:studio 接管(tsp: studio),打开面板、问 omp;主轮还在输出时就能问。
    await composer.fill("/btw Reply with exactly the word: pong");
    // 斜杠菜单只在"正在输入命令名"（没有空格）时开；带了问题的整句 fill 进去后菜单是关的，Enter 才是发送而不是选菜单项。
    await expect(page.getByTestId("slash-menu")).toHaveCount(0);
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await expect(turns).toHaveCount(1);
    await expect(turns.first()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
    await expect(turns.first()).toContainText("pong");
    // 2) 面板里"新话题"再问 ping:两个话题标签。
    await panel.getByTestId("btw-new-topic").click();
    await panel.getByTestId("btw-input").fill("Reply with exactly the word: ping");
    await panel.getByTestId("btw-input").press("Enter");
    await expect(panel.locator('[data-testid^="btw-topics-"]')).toHaveCount(2, { timeout: 30_000 });
    await expect(turns.first()).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
    await expect(turns.first()).toContainText("ping");
    // 3) 选回 pong 话题追问:主进程在后台开历史 → select → follow-up → 填字 → send。
    // 标签只截前 28 个字(两个话题的标签都是 "Reply with exactly the word:…"),完整问题在 title 上。
    await panel.locator('[data-testid^="btw-topics-"][title$="pong"]').click();
    await expect(turns.first()).toContainText("pong");
    await panel.getByTestId("btw-input").fill("Say gamma");
    await panel.getByTestId("btw-input").press("Enter");
    await expect(turns).toHaveCount(2, { timeout: 30_000 });
    await expect(turns.nth(1)).toHaveAttribute("data-status", "complete", { timeout: 30_000 });
    await expect(turns.nth(1)).toContainText("gamma");
    await shoot(page, "btw-panel");
    // 复制答案:头部的按钮把当前话题最新一问的答案写进系统剪贴板(渲染进程剪贴板),出"已复制"toast。
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText("原来的内容"));
    await panel.getByTestId("btw-copy-answer").click();
    await expect
      .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
      .toContain("gamma");
    await shoot(page, "btw-copy-answer");
    // 4) 长回答:回答中面板显示"取消提问",点它 → 已取消,保留已收到的部分。
    await panel.getByTestId("btw-new-topic").click();
    await panel.getByTestId("btw-input").fill("Write a 400 word essay about trees.");
    await panel.getByTestId("btw-input").press("Enter");
    await expect(panel.getByTestId("btw-cancel")).toBeVisible({ timeout: 30_000 });
    await panel.getByTestId("btw-cancel").click();
    await expect(turns.first()).toHaveAttribute("data-status", "cancelled", { timeout: 30_000 });
    await expect(turns.first()).toContainText("Trees");

    // omp 的弹窗没画过;假 omp 收到的事件和录制逐字相同(第一句主轮消息 + 提问 / 关弹窗 / 追问 / 取消)。
    expect(await page.evaluate(() => (globalThis as unknown as { __btwOverlay: boolean }).__btwOverlay)).toBe(false);
    await expect.poll(async () => (await received(["edit"])).length, { timeout: 30_000 }).toBe(events.length);
    expect(await received(["edit"])).toEqual(events);
    // 面板之外 omp 的主对话里没有 "/btw" 这句话。
    await expect(role(page, "omp.user").filter({ hasText: "/btw" })).toHaveCount(0);
  } finally {
    clearInterval(writer);
    await cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

test("排队消息按 Esc(omp 18.12.5 录制):任务停止,omp 写回它自己输入框的排队文字回到 studio 输入框,omp 的输入框被清空", async () => {
  test.setTimeout(90_000);
  // 假 omp 在收到 Esc 键之前不放最后一帧(那一帧删掉排队区、把排队文字写进 omp 的输入框,和真实 omp 按 Esc 时一样)。
  const [first, queued] = recordedUserEvents(loadTspFixture("queue-esc")).filter(
    (entry) => entry.event["ev"] === "send",
  );
  const queuedText = String(queued!.event["text"]);
  const { launched, received, receivedKeys, cleanup } = await start("queue-esc");
  try {
    const { page } = launched;
    await sendFirst(page, String(first!.event["text"]));
    const input = page.getByTestId("composer-input");
    // 运行中:Ctrl+Enter(稍后)发出第二句,它进 omp 的排队区;studio 输入框清空。
    await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 30_000 });
    await input.fill(queuedText);
    await input.press("Control+Enter");
    await expect
      .poll(
        async () => (await received()).filter((body) => body["ev"] === "send" && body["text"] === queuedText).length,
      )
      .toBe(1);
    await expect(input).toHaveValue("");
    // 排队区(dock 里的 omp.queue.item)画出了这句话 = 这一帧已到主进程和渲染进程(Esc 时没有排队消息就不会等输入框)。
    await expect(role(page, "omp.queue.item")).toContainText(queuedText, { timeout: 15_000 });
    expect(await receivedKeys()).not.toContain("\x1b");

    await input.press("Escape");
    await expect(input).toHaveValue(queuedText, { timeout: 15_000 });
    expect((await receivedKeys()).join("")).toContain("\x1b");
    // omp 的输入框被清空(edit 把整段排队文字替换成空),不会留着一份没人画的文字。
    await expect
      .poll(async () => (await received(["edit"])).filter((body) => body["ev"] === "edit"))
      .toEqual([expect.objectContaining({ from: 0, to: queuedText.length, text: "" })]);
    await expect(page.getByTestId("stop-button")).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await cleanup();
  }
});

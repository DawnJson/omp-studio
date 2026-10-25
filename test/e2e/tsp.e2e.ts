// TSP 引擎的端到端(docs/architecture/tsp-migration.md):启动构建产物,任务引擎设为 tsp,STUDIO_TEST_OMP 指向
// fake-tsp-omp(在伪终端里回放 fixtures/tsp 的 omp 录制,不调真实模型),驱动真实的 主进程 → 伪终端 → IPC → 渲染进程。
// 假 omp 只有在收到和录制完全一样的事件(send / action / activate)后才继续回放,所以"界面走到下一步"本身就证明
// 渲染进程发对了事件;另外用 --log 断言它收到了什么。
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { loadTspFixture, recordedUserEvents } from "../tsp-fixtures.ts";
import {
  copyFilesToClipboard,
  expectNoOverflow,
  launchApp,
  openTaskRow,
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

const TASK_PROMPT =
  "先用 todo 工具列出计划。然后用 task 工具并行派两个子代理:一个修 calc/ops.py 里的 bug,一个修 calc/text.py 里的 bug。子代理都完成后运行 python -m pytest -q 确认通过,最后用两句话总结。";

test("完整一轮:草稿的第一句话用 send 交给 omp;待办、子代理、bash、回答按 omp 的节点画出来,跑完侧栏回到空闲", async () => {
  test.setTimeout(120_000);
  const { launched, received, cleanup } = await start("task");
  try {
    const { page } = launched;
    // 工具卡跑完的 ✓ 只亮一下（画出、停 1.2s、淡出后卸掉），断言时早已不在：从发送前开始记下出现过的 ✓ 和它的动画。
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { body: unknown };
        MutationObserver: new (cb: () => void) => { observe(target: unknown, options: unknown): void };
        getComputedStyle(node: unknown): { animationName: string };
        drawnChecks: string[];
      };
      g.drawnChecks = [];
      const doc = g.document as unknown as {
        querySelectorAll(selector: string): Iterable<{ dataset: { seen?: string } }>;
      };
      new g.MutationObserver(() => {
        for (const path of doc.querySelectorAll(".tsp-tool-st > .tsp-draw-check path")) {
          if (path.dataset.seen !== undefined) continue;
          path.dataset.seen = "";
          g.drawnChecks.push(g.getComputedStyle(path).animationName);
        }
      }).observe(g.document.body, { childList: true, subtree: true });
    });
    // 界面语言默认跟系统;CI 的 macOS 机器是英文系统,发之前就切到中文(下面"全部完成"只在一个短窗口里断言)。
    await setLocaleTheme(page, "zh-CN", "light");
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
    // 录制最后待办 5/5 全部完成:待办板照 Tern 里的 omp,进度环整圈,当前项那里写"全部完成"。
    // omp 过 todoClearDelay 才删待办节点(录制里约 58 秒后,--speed=20 回放约 3 秒):只在这段时间里有,所以紧接着断言。
    await expect(board).toContainText("全部完成", { timeout: 60_000 });
    await expect(board).toContainText("5/5");
    await expect(board.locator('[data-state="progress"] .todo-mark-arc')).toHaveAttribute("stroke-dasharray", "100 0");
    // 回放跑完:本轮用量出现,omp 的工作状态行消失,侧栏变回空闲;omp 删掉待办节点后待办板跟着消失。
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    await expect(row).toHaveAttribute("data-status", "idle", { timeout: 20_000 });
    await expect(page.getByTestId("tsp-todo-bar")).toHaveCount(0, { timeout: 20_000 });
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
    // 工具卡跑完：✓ 用描边画出来（tsp-draw），停一下淡出后卸掉，最后和打开历史任务时一样没有 ✓；淡紫的运行底用 background-color 过渡褪掉。
    expect(await page.evaluate(() => (globalThis as unknown as { drawnChecks: string[] }).drawnChecks)).toContain(
      "tsp-draw",
    );
    await expect(page.getByTestId("tsp-view").getByTestId("tsp-tool-check")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-testid="tsp-view"] .tsp-tool.card.st-done').first()).toHaveCSS(
      "transition-property",
      "background-color",
    );
    // 切到另一个 TSP 任务：显示着的只有一个过程区，画的是新任务（过程区和输入框同 key 时，React 会把上一个任务的过程区留在页面上）。
    // 上一个任务的过程区藏着留在 DOM 里（App.tsx 的 KEPT_VIEWS），所以只数显示着的。
    const second = await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      return (await globalThis.studio.createTask({ projectId: project!.id })).id;
    });
    await page.locator(`[data-nav="task:${second}"]`).click();
    const visible = page.locator('[data-testid="tsp-view"]:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute("data-task-id", second);
  } finally {
    await cleanup();
  }
});

test("流式吸底:对话长过视口后,omp 每次长出新内容,画出来的那一帧就已经在底部(不先在底边下面画一帧再跳上来)", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("task");
  try {
    const { page } = launched;
    await page.setViewportSize({ width: 900, height: 560 });
    await sendFirst(page, TASK_PROMPT);
    // 在过程区的 ResizeObserver 之后再挂一个:同一帧里它在吸底处理之后、绘制之前运行,读到的就是这一帧画出来的位置。
    await page.evaluate(() => {
      type El = { scrollHeight: number; scrollTop: number; clientHeight: number; closest(selector: string): El | null };
      const g = globalThis as unknown as {
        document: { querySelector(selector: string): El };
        ResizeObserver: new (cb: () => void) => { observe(target: El): void };
        stickProbe: { overflowing: number; below: number[] };
      };
      const column = g.document.querySelector('[data-testid="tsp-view"] .tsp-column.tsp-main');
      const scroller = column.closest(".tsp-scroller") as El;
      const probe = { overflowing: 0, below: [] as number[] };
      g.stickProbe = probe;
      new g.ResizeObserver(() => {
        if (scroller.scrollHeight <= scroller.clientHeight) return;
        probe.overflowing += 1;
        const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (gap > 1) probe.below.push(Math.round(gap));
      }).observe(column);
    });
    await expect(role(page, "omp.turn.usage")).toBeVisible({ timeout: 60_000 });
    const probe = await page.evaluate(
      () => (globalThis as unknown as { stickProbe: { overflowing: number; below: number[] } }).stickProbe,
    );
    expect(probe.overflowing).toBeGreaterThan(5);
    expect(probe.below).toEqual([]);
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
    await expect.poll(pids, { timeout: 30_000 }).toHaveLength(before + 1);
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

/** 纯色 PNG（不依赖浏览器的画布）：粘贴图片用例里当图片。 */
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

/** 往输入框派发一个带图片文件的 paste 事件（和粘贴剪贴板里的图片同一条路径）。 */
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

test("输入框附件：大段粘贴折叠成芯片，原文不在输入框里；发送后 omp 收到展开的原文", async () => {
  test.setTimeout(90_000);
  const { launched, received, cleanup } = await start("approval");
  try {
    const { page } = launched;
    const input = page.getByTestId("composer-input");
    await input.click();
    await input.pressSequentially("对比 ");
    // 大段粘贴（30 行）折叠成 `#1 +30 行` 芯片，原文不在输入框里。
    const big = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n");
    await launched.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), big);
    await page.keyboard.press("Control+V");
    await expect(input).toHaveValue(/#1\u00a0\+30\u00a0(行|lines)/);
    await expect(input).not.toHaveValue(/line 30/);
    // 发送第一句话（创建任务）：展开的原文到 omp。
    await input.press("Enter");
    await expect(page.getByTestId("tsp-view")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await received()).filter((event) => String(event["text"]).includes("line 30")))
      .toHaveLength(1);
    const sent = String((await received()).find((event) => String(event["text"]).includes("line 30"))!["text"]);
    expect(sent.trimEnd()).toBe(`对比 ${big}`);
    await expect(page.getByTestId("composer-input")).toHaveValue("");
  } finally {
    await cleanup();
  }
});

test("发图片用 omp 自己的附件：输入框顶部卡片 + #1 芯片；发出去是 edit 文字、粘贴图片路径、action submit（没有 send），用户消息里是 omp 发来的图片", async () => {
  test.setTimeout(90_000);
  // omp 18.12.6 实录：edit → 括号粘贴路径 → 图片 chip → action submit → omp.user.images。
  const { launched, received, receivedKeys, cleanup } = await start("image-attach");
  try {
    const { page } = launched;
    // 草稿页的输入框（任务的输入框在模型不收图片时拒绝图片；假 omp 的模型目录里没有它，按不收图片算）。
    const input = page.getByTestId("composer-input");
    await input.click();
    await input.pressSequentially("Describe the color of this image in one short sentence.");
    await pasteImage(page, solidPng(40, 30));
    // 附件卡片在输入框顶部：缩略图 + #1 + 尺寸；文字里是 #1 芯片，不是占位符原文。
    const card = page.getByTestId("attachment");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("#1");
    await expect(card).toContainText("40×30");
    await expect(input).not.toHaveValue(/\[Image/);
    await expect(input).toHaveValue(/#1/);
    await input.press("Enter");
    // 用户消息里是 omp 自己画的图片（blob 在粘贴时就发来了），不是 "Read <路径> (image)" 工具行。
    await expect(role(page, "omp.user.images").getByTestId("tsp-img-frame")).toHaveCount(1, { timeout: 20_000 });
    const events = (await received(["edit"])).filter((event) =>
      ["send", "edit", "action"].includes(String(event["ev"])),
    );
    expect(events.map((event) => event["ev"])).toEqual(["edit", "action"]);
    expect(events[0]).toMatchObject({ text: "Describe the color of this image in one short sentence. " });
    expect(events[1]).toMatchObject({ act: "submit" });
    // 图片是一次括号粘贴：带引号的临时文件路径（正斜杠），文件在。
    const paste = (await receivedKeys()).find((data) => data.startsWith('\x1b[200~"')) ?? "";
    expect(paste.endsWith('"\x1b[201~'), paste).toBe(true);
    const file = paste.slice('\x1b[200~"'.length, -'"\x1b[201~'.length);
    expect(file).toMatch(/^[^"\\]+omp-studio-images[^"\\]+\.webp$/);
    expect(existsSync(file)).toBe(true);
    // 发出去之后输入框是空的，没有附件卡片。
    await expect(input).toHaveValue("");
    await expect(card).toHaveCount(0);
  } finally {
    await cleanup();
  }
});

test("排队的带图片插话点 Edit：文字和图片一起回到 studio 的输入框（#1 芯片 + 附件卡片），omp 的输入框被清空", async () => {
  test.setTimeout(90_000);
  // omp 18.12.6 实录：运行中发带图片的插话 → 排队区那条点 Edit → omp 把文字放回它的输入框、图片重新挂成 chip。
  const { launched, received, cleanup } = await start("queue-edit-image");
  try {
    const { page } = launched;
    const [first] = recordedUserEvents(loadTspFixture("queue-edit-image")).filter(
      (entry) => entry.event["ev"] === "send",
    );
    await sendFirst(page, String(first!.event["text"]));
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "running", { timeout: 20_000 });
    // 任务的输入框在模型不收图片时拒绝粘贴图片（假 omp 的模型目录里没有它）：直接走 preload 的发送，和输入框发出的是同一个调用。
    const taskId = await page.getByTestId("tsp-view").getAttribute("data-task-id");
    await page.evaluate(
      ([id, data]) =>
        (
          globalThis as unknown as {
            studio: { sendPrompt(taskId: string, input: unknown): Promise<void> };
          }
        ).studio.sendPrompt(id!, {
          text: "[Image #1, 40x30] what color is this image?",
          images: [{ mimeType: "image/png", data }],
          whenBusy: "steer",
        }),
      [taskId, solidPng(40, 30).toString("base64")] as const,
    );
    await role(page, "omp.queue.edit").first().click({ timeout: 20_000 });
    const input = page.getByTestId("composer-input");
    await expect(page.getByTestId("attachment")).toHaveCount(1, { timeout: 20_000 });
    await expect(input).toHaveValue(/#1/);
    await expect(input).toHaveValue(/what color is this image\?$/);
    await expect(input).not.toHaveValue(/\[Image/);
    await expect.poll(async () => (await received(["edit"])).some((event) => event["text"] === "")).toBe(true);
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
    // 运行中右下角只有停止键；按 Enter 也不发（字留在输入框里）。
    await expect(page.getByTestId("send-button")).toHaveCount(0);
    await page.getByTestId("composer-input").press("Enter");
    await expect(page.getByTestId("composer-input")).toHaveValue("先别发");
    await page.getByTestId("composer-input").fill("");
    await option.dblclick();
    await expect(option).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("task-row").first()).toHaveAttribute("data-status", "idle", { timeout: 30_000 });
    expect((await received()).filter((event) => event["ev"] === "activate")).toEqual([
      expect.objectContaining({ ev: "activate", id: "t.q0", item: "t.q0/option:1" }),
    ]);
    // 提问被撤掉后焦点回到 studio 输入框。
    await expect(page.getByTestId("composer-input")).toBeFocused();
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

test("恢复会话:omp 不重发的每轮用量脚注补回;history.db 里有回顾也不补(omp 恢复时不重放)", async () => {
  test.setTimeout(120_000);
  // 假 omp 回放的是 omp 18.12.4 `--resume` 一个 3 轮会话的实录:旧对话重发了,但没有 omp.turn.usage / omp.recap。
  const agentDir = await mkdtemp(path.join(os.tmpdir(), "omp tsp resume agent "));
  const sessionFile = path.join(agentDir, "sessions", "--e2e--", "2026-10-20T01-17-16-019Z_resume.jsonl");
  await mkdir(path.dirname(sessionFile), { recursive: true });
  await copyFile(path.join(root, "fixtures", "tsp", "resume-session.jsonl"), sessionFile);
  // omp 的空闲回顾只进 agent 目录的 history.db(session_recaps;会话 id 是会话文件头里的 id),恢复时不重放;studio 也不补。
  const db = new DatabaseSync(path.join(agentDir, "history.db"));
  db.exec(
    "CREATE TABLE session_recaps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)))",
  );
  const insert = db.prepare("INSERT INTO session_recaps (session_id, cwd, recap, created_at) VALUES (?, ?, ?, ?)");
  insert.run("01a156e2-5573-752f-ae26-c89b4b0fd495", "E:/x", "目标是验证 calc.py。", 1_792_000_000);
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
    // 回顾:history.db 里有,omp 没发,对话里就没有。
    await expect(role(page, "omp.recap")).toHaveCount(0);
  } finally {
    await cleanup();
    await rm(agentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// fixtures/tsp/recap.jsonl:omp 18.12.6 实录(recap.idleSeconds 1),两轮各在结束后空闲出一条回顾,omp 两条都留在 main 里。
test("空闲回顾:omp 发来的回顾用 ※ 斜体画在对话里;第二条来了第一条收起,只显示最新一条", async () => {
  test.setTimeout(90_000);
  const { launched, cleanup } = await start("recap");
  try {
    const { page } = launched;
    await sendFirst(page, "说一句话就好");
    const recap = role(page, "omp.recap");
    await expect(recap).toHaveCount(1, { timeout: 30_000 });
    await expect(recap).toContainText("No goal was set");
    // 图标是 ※(omp 节点里的 history 时钟图标不画),斜体,悬停提示是 omp 原样的英文。
    await expect(recap.locator(".tsp-icon")).toBeHidden();
    expect(
      await recap.evaluate((el) => (globalThis as unknown as PageStyle).getComputedStyle(el, "::before").content),
    ).toBe('"※"');
    await expect(recap).toHaveCSS("font-style", "italic");
    await expect(recap).toHaveAttribute("title", "Recap while you were away");
    // 发第二句不删已显示的回顾(omp 也不删);第二条回顾到了,第一条收起。
    await page.getByTestId("composer-input").fill("再说一句话就好");
    await page.keyboard.press("Enter");
    await expect(recap).toContainText("没有实际任务在跑", { timeout: 30_000 });
    await expect(recap).toHaveCount(1);
    // 它在第二条用户消息后面。
    const after = await recap.evaluate((el) => {
      type Node = { compareDocumentPosition(other: unknown): number };
      const users = (
        globalThis as unknown as { document: { querySelectorAll(selector: string): Node[] } }
      ).document.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.user"]');
      return [...users].map((user) => (el as unknown as Node).compareDocumentPosition(user) & 6);
    });
    // 2 = 这个用户消息在回顾前面。
    expect(after).toEqual([2, 2]);
  } finally {
    await cleanup();
  }
});

// omp 的费用段在有子代理花费时写成 "$0.01 (+0.42)"（omp 18.12.6 源码 status-line 的 cost 段；第一个数不含子代理）。
// 录制里没有花了钱的子代理，所以拿 resume 的实录把费用文字换成这个写法再回放。
test("费用：omp 费用段括号里的子代理花费照样显示，悬停说明它不算在前面的数里", async () => {
  test.setTimeout(90_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-cost-"));
  const fixture = path.join(work, "resume-subagents.jsonl");
  const text = await readFile(path.join(root, "fixtures", "tsp", "resume.jsonl"), "utf8");
  await writeFile(fixture, text.replaceAll("$0.01", "$0.01 (+0.42)"));
  const { launched, cleanup } = await start(fixture);
  try {
    const { page } = launched;
    await page.evaluate(async () => {
      const [project] = await globalThis.studio.listProjects();
      await globalThis.studio.createTask({ projectId: project!.id });
    });
    await openTaskRow(page);
    const cost = page.getByTestId("usage-cost");
    await expect(cost).toHaveText("$0.01 (+0.42)", { timeout: 20_000 });
    await expect(cost).toHaveAttribute("title", /\$0\.42/);
  } finally {
    await cleanup();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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
    // 落点高亮：跳过去后目标消息上播一次颜色动画（accent-soft 底 + accent 环）；减少动效下照样有，但不含任何位移。
    const flash = (reduced: boolean) =>
      page.evaluate(
        (nth) => {
          type Anim = { effect: { getKeyframes(): Record<string, unknown>[] } };
          type El = { getAnimations(): Anim[] };
          const d = (globalThis as unknown as { document: { querySelectorAll(s: string): El[] } }).document;
          const card = d.querySelectorAll('[data-testid="tsp-view"] [data-role="omp.user"]')[nth]!;
          const frames = card.getAnimations().flatMap((animation) => animation.effect.getKeyframes());
          return {
            count: frames.length,
            colored: frames.some((frame) => frame.boxShadow !== undefined && frame.backgroundColor !== undefined),
            moves: frames.some((frame) => frame.transform !== undefined || frame.translate !== undefined),
          };
        },
        reduced ? 2 : 0,
      );
    await ticks.nth(0).click();
    await expect.poll(async () => (await flash(false)).colored).toBe(true);
    expect((await flash(false)).moves).toBe(false);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await ticks.nth(2).click();
    await expect.poll(async () => (await flash(true)).colored).toBe(true);
    expect((await flash(true)).moves).toBe(false);
    // 刻度的说明(悬停提示 / 读屏)是那条消息的开头。
    const second = (await role(page, "omp.user").nth(1).locator(".md").innerText()).trim().slice(0, 10);
    await expect(ticks.nth(1)).toHaveAttribute("aria-label", new RegExp(second.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await ticks.nth(1).hover();
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
    // 四张卡片在同一帧里量：分开量时 omp 还在追加节点，过程区贴底滚动，前后几次读到的 y 不在同一个滚动位置。
    type Box = { x: number; y: number; width: number; height: number };
    const [first, second, third, fourth] = (await sources.evaluateAll((elements) =>
      elements.slice(0, 4).map((element) => {
        const rect = (
          element as unknown as { getBoundingClientRect(): { x: number; y: number; width: number; height: number } }
        ).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    )) as [Box, Box, Box, Box];
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
    // 状态行:启动时的两条和切模型那条是 omp 原地换文字的同一行(终端里也只剩最后一条),留在对话里,没有弹层。
    const notes = page.getByTestId("tsp-status-note");
    await expect(notes).toHaveText(["Session-only model: deepseek/deepseek-v4-pro. Use Alt+M or /model for roles."]);
    await expect(page.locator(".toast")).toHaveCount(0);
    // 它们在最后一条助手回答的后面。
    const order = await notes.nth(0).evaluate((el) => {
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
    await notes.nth(0).scrollIntoViewIfNeeded();
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
    // 底栏（摘要 + Close）钉在卡片底部，不随详情滚走：不滚动就整行可见。
    await expect(role(page, "omp.actions")).toBeInViewport({ ratio: 1 });
    // 详情比卡片高时自己滚动，里面的块不被压扁（overflow:hidden 的命令块曾被压成 0 高）。
    const command = await role(page, "omp.jobs.command").boundingBox();
    expect(command!.height).toBeGreaterThan(20);
    await expectNoOverflow(card);
    // 列表和详情顶对齐(row 默认垂直居中会让列表漂到详情中间)。
    const masterBox = await role(page, "omp.jobs.master").boundingBox();
    const detailBox = await role(page, "omp.jobs.detail").boundingBox();
    expect(Math.abs(masterBox!.y - detailBox!.y)).toBeLessThanOrEqual(1);

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

test("omp 的快捷键(B18):输入框有焦点时 F5 / ⇧Tab / ⌃P / ⌃⇧P / ⌥P / ⌥⇧P / ⌃T / ⌥↑ 编码后写给 omp;studio 自己的键(⌥T、⌃L、⌃R 历史搜索)和普通字符不转发,⌃O 是 studio 的展开/收起、自己写一次 ⌃O", async () => {
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
      // ⌃R 在输入框里是 studio 自己的历史搜索(Composer.tsx),不写给 omp,见下面。
      ["Alt+ArrowUp", `${ESC}[1;3A`],
    ];
    for (const [chord] of chords) await page.keyboard.press(chord);
    const expected = chords.map(([, bytes]) => bytes).join("");
    const sent = async () => JSON.stringify((await receivedKeys()).join("").slice(before.length));
    await expect.poll(sent).toBe(JSON.stringify(expected));
    // 输入框里没有多出字符;studio 自己的键不写给 omp(⌥T 切思考、⌃L 聚焦输入框);⌃O 是 studio 的"展开/收起工具卡片"，
    // 它自己把 ⌃O(\x0f) 写给 omp 一次(use-task-commands.ts)，不是输入框把按键原样转发；普通字符 x 留在输入框里。
    await expect(input).toHaveValue("");
    await page.keyboard.press("Control+r");
    await expect(page.getByTestId("history-search")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("history-search")).toHaveCount(0);
    await input.focus();
    for (const chord of ["Alt+t", "Control+l", "Control+o", "x"]) await page.keyboard.press(chord);
    await expect(input).toHaveValue("x");
    await page.keyboard.press("F5");
    await expect.poll(sent).toBe(JSON.stringify(`${expected}\x0f${ESC}[15~`));
  } finally {
    await cleanup();
  }
});

test("设置页盖着过程区:omp 的键(F5、⌃O)不写给 omp;返回后过程区原样、滚动位置不变,键照常转发", async () => {
  test.setTimeout(90_000);
  const { launched, receivedKeys, cleanup } = await start("cards");
  try {
    const { page } = launched;
    // 宽窗口：设置导航（含左上角返回）在侧栏位置；矮一点，让对话能滚。
    await page.setViewportSize({ width: 1200, height: 560 });
    await sendFirst(page, '用 bash 运行 python -c "print(1+1)",只运行这一条命令。');
    await expect(role(page, "omp.editor.ask.approval")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("composer-input").press("Control+Enter");
    await expect(role(page, "omp.tool.eval")).toBeVisible({ timeout: 30_000 });
    const scroller = page.locator('[data-testid="tsp-view"] .tsp-scroller');
    const scrollTop = () => scroller.evaluate((el) => (el as unknown as { scrollTop: number }).scrollTop);
    // 用滚轮离开底部（程序设 scrollTop 会被吸底拉回）：返回时不能被拉回最新。
    await scroller.hover();
    await page.mouse.wheel(0, -300);
    await expect.poll(scrollTop).toBeLessThan(
      await scroller.evaluate((el) => {
        const box = el as unknown as { scrollHeight: number; clientHeight: number };
        return box.scrollHeight - box.clientHeight - 100;
      }),
    );
    const top = await scrollTop();
    const before = (await receivedKeys()).join("");

    await page.keyboard.press("Control+Comma");
    await expect(page.getByTestId("settings-back")).toBeVisible();
    await expect(page.getByTestId("tsp-view")).toBeHidden();
    // 焦点不在任何控件上（body）时，omp 的键原本会转发给当前任务；⌃O 是 studio 的"展开/收起工具卡片"，原本也会写 ⌃O。
    await page.evaluate(() =>
      (globalThis as unknown as { document: { activeElement: { blur(): void } } }).document.activeElement.blur(),
    );
    await page.keyboard.press("F5");
    await page.keyboard.press("Control+o");

    await page.getByTestId("settings-back").click();
    await expect(role(page, "omp.tool.eval")).toBeVisible();
    expect(await scrollTop()).toBe(top);
    await page.getByTestId("composer-input").focus();
    await page.keyboard.press("F5");
    await expect
      .poll(async () => JSON.stringify((await receivedKeys()).join("").slice(before.length)))
      .toBe(JSON.stringify("\x1b[15~"));
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
    // 点行 = 进入对话(见下一条用例);行右端的"详情"按钮才进详情。
    await panel
      .locator('[data-testid="agents-row"][data-name="Beta"]')
      .locator("xpath=..")
      .getByTestId("agents-row-details")
      .click();
    await expect(panel.getByTestId("agents-detail")).toHaveAttribute("data-name", "Beta");

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

// 点子代理行 = 聚焦它的对话(同 omp Agent Hub 的 Enter;omp 18.12.6):主进程在后台 agents.open → activate(Beta),omp 的 Hub 一帧不画,
// 聚焦行出现后不恢复;面板收起、焦点回输入框,输入框上方出现"正在给 Beta 发消息";输入框发的话走 sendPrompt(omp 把它 steer 给 Beta),
// "回到主会话"发 focus:Main。详情从行右端的按钮进,详情头部也有"进入对话"。
test("子代理面板:点行进入子代理的对话(面板收起、聚焦提示出现、Hub 一帧没画),输入框发的话给 Beta,回到主会话;详情仍可从行上的按钮进", async () => {
  test.setTimeout(120_000);
  const steerText = "Also say PINEAPPLE in your final reply.";
  const firstPrompt = String(recordedUserEvents(loadTspFixture("hub-steer"))[0]!.event["text"]);
  const { launched, received, cleanup } = await start("hub-steer");
  try {
    const { page } = launched;
    await sendFirst(page, firstPrompt);
    await expect(page.getByTestId("pill-agents")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("pill-agents").click();
    const panel = page.getByTestId("agents-panel");
    await expect(panel.getByTestId("agents-row")).toHaveCount(2);
    // 行上有次要入口"详情",点它进详情,面板不收;详情头部有"进入对话"。
    const beta = panel.locator('[data-testid="agents-row"][data-name="Beta"]');
    const betaDetails = beta.locator("xpath=..").getByTestId("agents-row-details");
    await expect(betaDetails).toHaveAttribute("title", /详情|Details/);
    await betaDetails.click();
    await expect(panel.getByTestId("agents-detail")).toHaveAttribute("data-name", "Beta");
    await expect(panel.getByTestId("agents-focus")).toBeVisible();
    expect((await received()).some((event) => event["ev"] === "activate")).toBe(false);

    // 盯着页面:驱动期间"正在切到 Beta"出现过,omp 的 Hub 一次也没画。
    await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: {
          querySelector(s: string): { getAttribute(n: string): string | null } | null;
          documentElement: unknown;
        };
        MutationObserver: new (cb: () => void) => { observe(target: unknown, o: object): void };
        __focus: { driving: string[]; hub: boolean };
      };
      g.__focus = { driving: [], hub: false };
      new g.MutationObserver(() => {
        const banner = g.document.querySelector('[data-testid="agents-driving"]');
        if (banner) {
          const text = `${banner.getAttribute("data-op")}:${banner.getAttribute("data-name")}`;
          if (!g.__focus.driving.includes(text)) g.__focus.driving.push(text);
        }
        if (g.document.querySelector('[data-testid="tsp-view"] .tspi-picker')) g.__focus.hub = true;
      }).observe(g.document.documentElement, { subtree: true, childList: true, attributes: true });
    });
    await beta.click();
    // 假 omp 按录制放帧:收到 agents.open → activate(Beta) 才放出聚焦行;studio 不发 focus:Main(留在聚焦模式)。
    const banner = page.getByTestId("run-focus");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText(/Beta/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("composer-input")).toHaveAttribute("placeholder", /Beta/);
    await expect(page.getByTestId("composer-input")).toBeFocused();
    await expect(page.locator("[data-driving]")).toHaveCount(0);
    expect((await received()).map((event) => [event["ev"], event["act"] ?? event["item"] ?? event["text"]])).toEqual([
      ["send", firstPrompt],
      ["action", "agents.open"],
      ["activate", "Beta"],
    ]);
    const seen = await page.evaluate(
      () => (globalThis as unknown as { __focus: { driving: string[]; hub: boolean } }).__focus,
    );
    expect(seen.driving).toContain("focus:Beta");
    expect(seen.hub).toBe(false);

    // 聚焦中输入框发的话走普通的 send(omp 把它 steer 给 Beta):事件和录制里用户在聚焦后发的那条相同。
    await page.getByTestId("composer-input").fill(steerText);
    await page.getByTestId("composer-input").press("Enter");
    await expect.poll(async () => (await received()).at(-1)?.["text"], { timeout: 30_000 }).toBe(steerText);
    // 聚焦中再打开面板:列表看不到(omp 画的是 Beta 的会话),写明原因。
    await page.getByTestId("topbar-agents").click();
    await expect(page.getByTestId("agents-empty")).toContainText(/Beta/);
    await page.getByTestId("topbar-agents").click();
    await expect(page.getByTestId("agents-panel")).toHaveCount(0);

    await page.getByTestId("run-focus-back").click();
    await expect.poll(async () => (await received()).some((event) => event["act"] === "focus:Main")).toBe(true);
    await expect(banner).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("composer-input")).not.toHaveAttribute("placeholder", /Beta/);
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
    // 两格作业磁贴同一批出现:带入场动画(opacity + translateY),按批内序号错开 40ms(0 / 40),data-enter 是延迟毫秒数。
    for (const index of [0, 1]) {
      await expect(tiles.nth(index)).toHaveAttribute("data-enter", /^(0|40)$/);
      await expect(tiles.nth(index)).toHaveCSS("animation-name", "tsp-enter");
    }
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
    await beta.locator("xpath=..").getByTestId("agents-row-details").click();
    await expect(panel.getByTestId("agents-detail")).toContainText("55%");

    // Ctx(omp 的 agent.stats.context,录制里 0.0081 起、随回放涨到 8.6K):列表行显示细条 + 百分比,悬停提示带 omp 的 contextLabel("8.xK / 1M")。
    const ctx = panel.getByTestId("agents-row-ctx").first();
    await expect(ctx).toHaveAttribute("data-percent", "1");
    await expect(ctx).toHaveAttribute("title", /1% ?[（(]8\.\dK \/ 1M[）)]/);
    // 详情统计格一行三格;上下文("1% · 8.xK / 1M")单行,和费用一样高、没被截断。
    const stats = panel.getByTestId("agents-stat");
    const statBoxes = await stats.evaluateAll((elements) =>
      elements.map((node) => {
        type Box = { getBoundingClientRect(): { y: number; height: number } };
        const element = node as unknown as Box & { querySelector(selector: string): unknown };
        const value = element.querySelector("dd") as Box & {
          textContent: string;
          scrollWidth: number;
          clientWidth: number;
        };
        const rect = element.getBoundingClientRect();
        return {
          y: rect.y,
          text: value.textContent,
          height: value.getBoundingClientRect().height,
          clipped: value.scrollWidth > value.clientWidth,
        };
      }),
    );
    expect(statBoxes.length).toBeGreaterThan(3);
    expect(statBoxes[1]!.y).toBe(statBoxes[0]!.y);
    expect(statBoxes[2]!.y).toBe(statBoxes[0]!.y);
    expect(statBoxes[3]!.y).toBeGreaterThan(statBoxes[0]!.y);
    const contextStat = statBoxes.find((stat) => stat.text.includes(" / "))!;
    expect(contextStat.height).toBe(statBoxes[0]!.height);
    expect(contextStat.clipped).toBe(false);

    // Activity 页:读两个子代理的记录文件(假 session 目录里的 Alpha.jsonl / Beta.jsonl),按时间从新到旧;过滤 All / Errors / Responses / Tools。
    await panel.getByTestId("agents-tabs-activity").click();
    const rows = panel.getByTestId("agents-activity-row");
    await expect(rows).toHaveCount(5, { timeout: 20_000 });
    // 最新的在前:Beta 的回复(4000)→ Alpha 的出错(3500)→ Beta 的 grep(3200)→ Alpha 失败的 bash(3000)→ Alpha 的 read(2000)。
    await expect(rows.nth(0)).toHaveAttribute("data-agent", "Beta");
    await expect(rows.nth(0)).toHaveAttribute("data-kind", "response");
    await expect(rows.nth(1)).toHaveAttribute("data-kind", "error");
    await expect(rows.nth(1)).toContainText("exit code 1");
    await panel.getByTestId("agents-activity-filter-errors").click();
    await expect(rows).toHaveCount(1);
    await panel.getByTestId("agents-activity-filter-responses").click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("All good");
    await panel.getByTestId("agents-activity-filter-tools").click();
    await expect(rows).toHaveCount(3);
    // 点一行 = 回到 Agents 页并选中那个子代理。
    await panel.getByTestId("agents-activity-filter-all").click();
    await rows.nth(0).click();
    await expect(panel.getByTestId("agents-detail")).toHaveAttribute("data-name", "Beta");
    await expect(panel.getByTestId("agents-list")).toBeVisible();
    // 窄窗口、中英文下统计格不越界(放不下的值省略号,不撑出格子)。
    await page.setViewportSize({ width: 900, height: 700 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expectNoOverflow(panel.getByTestId("agents-detail"));
    }
  } finally {
    await cleanup();
    await rm(scratch, { recursive: true, force: true });
  }
});

// 减少动效:磁贴不错开(data-enter 恒为 0)、入场不位移(--travel-sm 为 0,keyframes 的 translateY 是 0),只留 --dur-fade 的淡入。
test("作业磁贴入场(TSP,减少动效):不错开、不位移", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("agent-progress");
  try {
    const { page } = launched;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("agent-progress"))[0]!.event["text"]));
    const tiles = role(page, "omp.job.tiles").locator('[data-role="omp.job.tile"]');
    await expect(tiles).toHaveCount(2, { timeout: 30_000 });
    for (const index of [0, 1]) {
      await expect(tiles.nth(index)).toHaveAttribute("data-enter", "0");
      await expect(tiles.nth(index)).toHaveCSS("animation-delay", "0s");
    }
    const travel = await tiles.first().evaluate((el) => {
      const win = globalThis as unknown as {
        getComputedStyle(node: unknown): { getPropertyValue(name: string): string };
      };
      return win.getComputedStyle(el).getPropertyValue("--travel-sm");
    });
    expect(travel.trim()).toBe("0px");
  } finally {
    await cleanup();
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
    // 复制答案:头部的按钮把当前话题最新一问的答案写进系统剪贴板(渲染进程剪贴板),出"已复制"toast。
    await launched.app.evaluate(({ clipboard }) => clipboard.writeText("原来的内容"));
    await panel.getByTestId("btw-copy-answer").click();
    await expect
      .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
      .toContain("gamma");
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

test("排队消息按 Esc(omp 18.12.6 录制,Ctrl+Enter = /queue):任务停止,omp 写回它自己输入框的排队文字回到 studio 输入框,omp 的输入框被清空", async () => {
  test.setTimeout(90_000);
  // 假 omp 在收到 Esc 键之前不放最后一帧(那一帧删掉排队区、把排队文字写进 omp 的输入框,和真实 omp 按 Esc 时一样)。
  // 运行中"稍后"发出的是 omp 的 `/queue <文字>`(录制里 omp 的 follow-up 队列);Esc 后写回输入框的是不带 /queue 的原文。
  const [first, queued] = recordedUserEvents(loadTspFixture("queue-follow-up-esc")).filter(
    (entry) => entry.event["ev"] === "send",
  );
  const wireText = String(queued!.event["text"]);
  const queuedText = wireText.replace(/^\/queue /, "");
  const { launched, received, receivedKeys, cleanup } = await start("queue-follow-up-esc");
  try {
    const { page } = launched;
    await sendFirst(page, String(first!.event["text"]));
    const input = page.getByTestId("composer-input");
    // 运行中:Ctrl+Enter(稍后)发出第二句,它进 omp 的排队区;studio 输入框清空。
    await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 30_000 });
    await input.fill(queuedText);
    await input.press("Control+Enter");
    await expect
      .poll(async () => (await received()).filter((body) => body["ev"] === "send" && body["text"] === wireText).length)
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

// 排队区一行：排队的文字（grow + 一行省略号）+ 右边的 ⌥↑ Edit。拿 queue-follow-up-esc 的实录把排队文字换成一长句再回放。
test("排队区：排队的文字很长时只截断它自己，右边的 ⌥↑ Edit 保持一行、不出界（窄窗口，中英文）", async () => {
  test.setTimeout(90_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-queue-"));
  const fixture = path.join(work, "queue-long.jsonl");
  const short = "queued-b2: reply with exactly OK";
  const long = `${short} ${"and keep every river fact short ".repeat(8).trim()}`;
  const text = await readFile(path.join(root, "fixtures", "tsp", "queue-follow-up-esc.jsonl"), "utf8");
  await writeFile(fixture, text.replaceAll(short, long));
  const [first] = recordedUserEvents(loadTspFixture("queue-follow-up-esc")).filter(
    (entry) => entry.event["ev"] === "send",
  );
  const { launched, cleanup } = await start(fixture);
  try {
    const { page } = launched;
    await sendFirst(page, String(first!.event["text"]));
    const input = page.getByTestId("composer-input");
    await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 30_000 });
    await input.fill(long);
    await input.press("Control+Enter");
    await expect(role(page, "omp.queue.item")).toHaveCount(1, { timeout: 15_000 });
    await page.setViewportSize({ width: 900, height: 700 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      const edit = role(page, "omp.queue.edit");
      const label = edit.getByText("Edit", { exact: true });
      // "Edit" 一行：高度不超过一行字，没有被挤成一个字母一行。
      expect((await label.boundingBox())!.height).toBeLessThan(24);
      await expectNoOverflow(role(page, "omp.queue.item"));
    }
  } finally {
    await cleanup();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("待办板(omp 18.12.6 录制 todo-commands):⋯ 菜单发 /todo drop,添加条目发 /todo append(阶段、任务都加引号),复制为 Markdown 和 omp 的 /todo 同文,已做完的阶段默认收起、展开全部", async () => {
  test.setTimeout(120_000);
  const todo = await start("todo-commands");
  try {
    const { page } = todo.launched;
    const commands = recordedUserEvents(loadTspFixture("todo-commands"))
      .map((entry) => String(entry.event["text"]))
      .slice(0, 7);
    expect(commands.at(-1)).toBe("/todo done");
    const taskId = await page.evaluate(async () => {
      const [p] = await globalThis.studio.listProjects();
      return (await globalThis.studio.createTask({ projectId: p!.id })).id;
    });
    await openTaskRow(page);
    // 回放里录的前 7 条命令：三次 append、start、done；每条等 omp 回应（假 omp 收到和录制一样的 send 才继续）。
    for (const text of commands) {
      await page.evaluate(
        ([id, body]) => globalThis.studio.sendPrompt(id as never, { text: body!, whenBusy: "steer" }),
        [taskId, text],
      );
    }
    const board = page.getByTestId("todo-board");
    await expect(board).toHaveText(/3\/3/, { timeout: 60_000 });
    await board.click();
    // 全部做完：三个阶段默认收起，只剩阶段头；展开全部之后三条都在。
    await expect(page.getByTestId("todo-phase")).toHaveCount(2);
    await expect(page.getByTestId("todo-item")).toHaveCount(0);
    await page.getByTestId("todo-expand-all").click();
    await expect(page.getByTestId("todo-item")).toHaveCount(3);

    // 复制为 Markdown：本地拼，剪贴板里和 omp `/todo` 弹出的 Markdown 同文（末尾多一个换行）。
    // Windows 上 Chromium 写系统剪贴板时把 \n 换成 \r\n，比较前换回来。
    await page.getByTestId("todo-copy").click();
    await expect
      .poll(async () =>
        (await todo.launched.app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, "\n"),
      )
      .toBe("# Alpha\n- [x] Write tests\n- [x] Fix bug\n\n# Beta\n- [x] Ship it\n");

    // ⋯ 菜单：已完成的条目只剩 放弃 / 删除；点放弃 → omp 收到 /todo drop <内容>。
    await page.getByTestId("todo-item-more").first().click();
    const menu = page.getByTestId("todo-item-menu");
    await expect(menu.getByTestId("todo-op-drop")).toBeVisible();
    await expect(menu.getByTestId("todo-op-done")).toHaveCount(0);
    await expect(page.getByTestId("todo-item-menu")).toBeVisible();
    await menu.getByTestId("todo-op-drop").click();
    await expect
      .poll(async () => (await todo.received()).map((event) => event["text"]))
      .toContain("/todo drop Write tests");

    // 添加条目：阶段可选；写了阶段就是 /todo append "阶段" "任务"。
    await page.getByTestId("todo-add").click();
    await page.getByTestId("todo-add-text").fill("write the docs");
    await page.getByTestId("todo-add-phase").fill("Alpha");
    await expect(page.getByTestId("todo-add-form")).toBeVisible();
    await page.getByTestId("todo-add-submit").click();
    await expect
      .poll(async () => (await todo.received()).map((event) => event["text"]))
      .toContain('/todo append "Alpha" "write the docs"');
  } finally {
    await todo.cleanup();
  }
});

test("Shell / Python 标签:输入框以 ! 或 $ 开头时工具行出现标签，点开的开关改输入框文字的前缀(! ↔ !!、$ ↔ $$)；普通消息没有标签", async () => {
  // 只要一个有输入框的任务。不用 jobs-chart：那份录制在 64 秒处有探针往 omp 输入框里敲的 "/jobs"，
  // 跑得慢时会被"omp 输入框的文字回到 studio 输入框"搬进来，和这里填的文字混在一起。
  const task = await start("error-turn");
  try {
    const { page } = task.launched;
    await sendFirst(page, "Reply with exactly: hello");
    const input = page.getByTestId("composer-input");
    const tag = page.getByTestId("shell-tag");
    await input.fill("hello");
    await expect(tag).toHaveCount(0);
    await input.fill("!ls -la");
    await expect(tag).toHaveText(/Shell/);
    await tag.click();
    const toggle = page.getByTestId("shell-in-context");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(input).toHaveValue("!!ls -la");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(input).toHaveValue("!ls -la");
    await input.fill("$ print(1)");
    await expect(tag).toHaveText(/Python/);
    if ((await page.getByTestId("shell-pop").count()) === 0) await tag.click();
    await expect(page.getByTestId("shell-pop")).toBeVisible();
    await page.getByTestId("shell-in-context").click();
    await expect(input).toHaveValue("$$ print(1)");
    // 单 $ 后面像 shell 命令的不是 Python：没有标签。
    await input.fill("$ git status");
    await expect(tag).toHaveCount(0);
  } finally {
    await task.cleanup();
  }
});

test("作业卡片标出类型:悬停药丸的作业那一段，每个作业块里有类型标签(bash)；药丸数 = 除子代理外的作业", async () => {
  test.setTimeout(120_000);
  const { launched, cleanup } = await start("jobs-chart", {}, 2);
  try {
    const { page } = launched;
    await sendFirst(page, JOBS_PROMPT);
    const pill = page.getByTestId("pill-jobs");
    await expect(pill).toBeVisible({ timeout: 60_000 });
    await expect(pill).toHaveAttribute("data-count", "1");
    const card = page.getByTestId("jobs-card");
    await pill.hover();
    await expect(card.getByTestId("jobs-card-type")).toHaveText("bash");
    await expect(card.getByTestId("jobs-card-type")).toHaveAttribute("data-type", "bash");
  } finally {
    await cleanup();
  }
});

test("作业药丸不数子代理(hub-steer):两个后台子代理在跑时只有 👥 2，没有 ⚡", async () => {
  const hub = await start("hub-steer");
  try {
    const { page } = hub.launched;
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("hub-steer"))[0]!.event["text"]));
    await expect(page.getByTestId("pill-agents")).toHaveAttribute("data-count", "2", { timeout: 60_000 });
    await expect(page.getByTestId("pill-jobs")).toHaveCount(0);
  } finally {
    await hub.cleanup();
  }
});

/** blob 的 id 必须是内容的 sha256（tsp-session.ts 校验，对不上就拒收）。 */
const sha = (png: Buffer) => createHash("sha256").update(png).digest("hex");

/** 在 cards 录制发出 send 之后,追加 blob 和一帧挂在 main 下的节点,写成 dir 下的临时录制。 */
async function writeCardsFixture(
  dir: string,
  pngs: readonly Buffer[],
  nodes: readonly { id: string; k: string; p: Record<string, unknown>; c?: unknown[] }[],
): Promise<string> {
  const lines = loadTspFixture("cards");
  const sendAt = lines.findIndex(
    (line) =>
      line.dir === "in" &&
      typeof line.body === "object" &&
      line.body !== null &&
      "ev" in line.body &&
      line.body.ev === "send",
  );
  const t = lines[sendAt]!.t;
  const rows = [
    ...lines.slice(0, sendAt + 1),
    ...pngs.map((png, n) => ({
      t: t + 1 + n,
      dir: "out",
      verb: "b",
      params: { id: sha(png), mime: "image/png" },
      body: png.toString("base64"),
    })),
    {
      t: t + 1 + pngs.length,
      dir: "out",
      verb: "f",
      body: { sf: "s:1", s: 8, ops: nodes.map((node) => ["add", node.id, "main", null, node]) },
    },
    { t: t + 2 + pngs.length, dir: "in", verb: "e", params: {}, body: { ev: "ack", sf: "s:1", s: 8 } },
  ];
  const file = path.join(dir, "cards-extra.jsonl");
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return file;
}

/** 一行两张 image 节点(同一个父节点,可以左右翻)。 */
async function writeImagesFixture(dir: string): Promise<string> {
  const wide = solidPng(160, 100);
  const tall = solidPng(100, 160);
  const image = (id: string, png: Buffer, alt: string) => ({ id, k: "image", p: { blob: sha(png), alt, w: 160 } });
  return writeCardsFixture(
    dir,
    [wide, tall],
    [
      {
        id: "e2e-imgs",
        k: "row",
        p: { gap: "md" },
        c: [image("e2e-i1", wide, "first"), image("e2e-i2", tall, "second")],
      },
    ],
  );
}

test("行号列:两位、四位行号不被折成一位一行;用户消息里的图装进 100×100 的框,比例不变", async () => {
  test.setTimeout(90_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp gutter-"));
  // omp 18.12.6 把 44×220 的截图放大成宽 200 的显示图(200×1000),w/h 照这个尺寸给,没有 max。
  const narrow = solidPng(200, 1000);
  const wide = solidPng(200, 100);
  const fixture = await writeCardsFixture(
    work,
    [narrow, wide],
    [
      { id: "e2e-code", k: "code", p: { text: "a\nb\nc", numbers: true, start: 9, wrap: true } },
      {
        id: "e2e-diff",
        k: "diff",
        p: {
          hunks: [
            { oldStart: 1, newStart: 1, lines: [" x"] },
            { oldStart: 998, newStart: 998, lines: [" a", " b", "-c", "+d"] },
          ],
        },
      },
      {
        id: "e2e-user-images",
        k: "row",
        p: { role: "omp.user.images" },
        c: [
          { id: "e2e-narrow", k: "image", p: { blob: sha(narrow), alt: "#1", w: 200, h: 1000 } },
          { id: "e2e-wide", k: "image", p: { blob: sha(wide), alt: "#2", w: 200, h: 100 } },
        ],
      },
    ],
  );
  const { launched, cleanup } = await start(fixture);
  try {
    const { page } = launched;
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("cards"))[0]!.event["text"]));
    const height = async (selector: string, text: string) =>
      (await page
        .locator(selector)
        .filter({ hasText: new RegExp(`^${text}$`) })
        .first()
        .boundingBox())!.height;
    // 折行的代码块里,行号 10 和 9 一样高(没被拆成 "1" "0" 两行)。
    const gut = '[data-id="e2e-code"] .tsp-gut';
    await expect(page.locator(gut)).toHaveCount(3, { timeout: 30_000 });
    expect(await height(gut, "10")).toBe(await height(gut, "9"));
    // diff 的行号到 1000:四位的和一位的一样高(原来列宽 4ch 含 padding,三位起就折行)。
    const dg = '[data-id="e2e-diff"] .tsp-dg';
    expect(await height(dg, "1000")).toBe(await height(dg, "1"));
    // 用户消息的图(2026-10-25 起 100×100 的框):窄图高 100、宽按 1:5 缩;宽图宽 100、高按 2:1 缩(都不被压扁)。
    const frames = role(page, "omp.user.images").getByTestId("tsp-img-frame");
    const tallBox = (await frames.nth(0).boundingBox())!;
    expect(tallBox.height).toBeCloseTo(100, 0);
    expect(tallBox.width).toBeCloseTo(20, 0);
    const wideBox = (await frames.nth(1).boundingBox())!;
    expect(wideBox.width).toBeCloseTo(100, 0);
    expect(wideBox.height).toBeCloseTo(50, 0);
    // 窄窗口、中英文下这三块都不越界。
    await page.setViewportSize({ width: 900, height: 700 });
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      for (const id of ["e2e-code", "e2e-diff", "e2e-user-images"]) {
        await expectNoOverflow(page.locator(`[data-id="${id}"]`));
      }
    }
  } finally {
    await cleanup();
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("回答里的裸网址可点:用系统浏览器打开,句末的中文句号不算网址", async () => {
  test.setTimeout(90_000);
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp link-"));
  const url = "https://doi.org/10.1007/978-3-031-94223-5_25";
  const fixture = await writeCardsFixture(
    work,
    [],
    [{ id: "e2e-bare-url", k: "md", p: { text: `- 或者直接打开 ${url} 。` } }],
  );
  const { launched, cleanup } = await start(fixture);
  try {
    const { page, app } = launched;
    await app.evaluate(({ shell }) => {
      const opened: string[] = [];
      (globalThis as unknown as { opened: string[] }).opened = opened;
      shell.openExternal = async (target: string) => {
        opened.push(target);
      };
    });
    await sendFirst(page, String(recordedUserEvents(loadTspFixture("cards"))[0]!.event["text"]));
    const link = page.locator('[data-id="e2e-bare-url"] a');
    await expect(link).toHaveText(url, { timeout: 30_000 });
    await link.click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([url]);
  } finally {
    await cleanup();
    await rm(work, { recursive: true, force: true, maxRetries: 5 });
  }
});

/** 页面里记下每次 document.startViewTransition 动起来后的伪元素动画（名字 + 时长），断言开合放大图的 View Transition。 */
interface RecordedTransition {
  animations: { pseudo: string; duration: number }[];
}
async function recordViewTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = globalThis as unknown as {
      document: {
        startViewTransition(update: () => void): { ready: Promise<void> };
        getAnimations(): { effect: { pseudoElement: string | null; getComputedTiming(): { duration: number } } }[];
      };
      __vt: RecordedTransition[];
    };
    w.__vt = [];
    const original = w.document.startViewTransition.bind(w.document);
    w.document.startViewTransition = (update) => {
      const transition = original(update);
      const record: RecordedTransition = { animations: [] };
      w.__vt.push(record);
      void transition.ready
        .then(() => {
          record.animations = w.document
            .getAnimations()
            .filter((a) => a.effect.pseudoElement?.startsWith("::view-transition"))
            .map((a) => ({ pseudo: a.effect.pseudoElement!, duration: Number(a.effect.getComputedTiming().duration) }));
        })
        .catch(() => {});
      return transition;
    };
  });
}
const recorded = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as { __vt: RecordedTransition[] }).__vt.map((r) => r.animations));

for (const reduced of [false, true]) {
  test(`对话里图片点开放大(${reduced ? "减少动效" : "默认"}):${reduced ? "只有淡入淡出,没有位移缩放" : "缩略图和大图共用 view-transition-name,时长 --dur-base;←/→ 切图不再变形;关时缩回缩略图"}`, async () => {
    test.setTimeout(120_000);
    const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp zoom-"));
    const fixture = await writeImagesFixture(work);
    const { launched, cleanup } = await start(fixture);
    try {
      const { page } = launched;
      if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
      await sendFirst(page, String(recordedUserEvents(loadTspFixture("cards"))[0]!.event["text"]));
      const thumbs = page.getByTestId("tsp-img-frame");
      await expect(thumbs).toHaveCount(2, { timeout: 30_000 });
      await recordViewTransitions(page);

      // 打开:点第一张缩略图。
      await thumbs.first().click();
      const zoom = page.getByTestId("tsp-zoom");
      await expect(zoom).toBeVisible();
      await expect.poll(async () => (await recorded(page))[0]?.length ?? 0).toBeGreaterThan(0);
      const opened = (await recorded(page))[0]!;
      const groups = opened.filter((a) => a.pseudo.includes("(tsp-zoom)"));
      const roots = opened.filter((a) => a.pseudo.includes("(root)"));
      expect(roots.length).toBeGreaterThan(0);
      if (reduced) {
        // 只有遮罩的淡入淡出(--dur-fade 100ms),没有缩略图 ⇄ 大图的位移缩放组。
        expect(groups).toEqual([]);
        for (const a of roots) expect(a.duration).toBe(100);
      } else {
        expect(groups.some((a) => a.pseudo === "::view-transition-group(tsp-zoom)" && a.duration === 200)).toBe(true);
        for (const a of roots) expect(a.duration).toBe(200);
      }
      // 动画结束后名字和根上的标记都清掉,不影响之后切主题的整窗淡入。
      await expect(page.locator("html")).not.toHaveAttribute("data-tsp-zoom-vt", /.*/);
      await expect(thumbs.first()).toHaveCSS("view-transition-name", "none");
      await expect(page.getByTestId("tsp-zoom-image")).toHaveCSS("view-transition-name", "none");

      // ←/→ 切图:只换图,不再起 view transition。
      const before = await page.getByTestId("tsp-zoom-image").getAttribute("src");
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => page.getByTestId("tsp-zoom-image").getAttribute("src")).not.toBe(before);
      expect(await recorded(page)).toHaveLength(1);

      // 关闭:缩回当前这张(第二张)的缩略图;减少动效下只淡出。
      await page.keyboard.press("Escape");
      await expect(zoom).toHaveCount(0);
      await expect.poll(async () => (await recorded(page))[1]?.length ?? 0).toBeGreaterThan(0);
      const closed = (await recorded(page))[1]!;
      const closeGroups = closed.filter((a) => a.pseudo.includes("(tsp-zoom)"));
      if (reduced) expect(closeGroups).toEqual([]);
      else
        expect(closeGroups.some((a) => a.pseudo === "::view-transition-group(tsp-zoom)" && a.duration === 200)).toBe(
          true,
        );
      await expect(page.locator("html")).not.toHaveAttribute("data-tsp-zoom-vt", /.*/);
      await expect(thumbs.nth(1)).toHaveCSS("view-transition-name", "none");
    } finally {
      await cleanup();
      await rm(work, { recursive: true, force: true });
    }
  });
}

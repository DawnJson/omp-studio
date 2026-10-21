// 对话流 + 输入框 + 门的端到端：启动构建产物，STUDIO_TEST_OMP 指向假 omp 回放 fixtures/rpc（不调真实模型），
// 驱动真实的 主进程 → IPC → 渲染进程。流式中 / 完成 / 等你确认三态，中英 × 深浅各截一张图到 screenshots/。
// 流式中和等你确认用"截断的录制"造出来：假 omp 回放到截断处就停住，界面停在那个状态。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, openTaskRow, screenshotsDir, type LaunchedApp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const fixtureDir = path.join(root, "fixtures", "rpc");
const fakeOmp = path.join(root, "test", "fake-omp", "fake-omp.ts");

interface Line {
  kind: string;
  frame?: {
    type?: string;
    method?: string;
    message?: { role?: string; content?: { type: string; text?: string }[] };
    assistantMessageEvent?: { type?: string };
  };
}

async function readFixture(name: string): Promise<{ raw: string[]; lines: Line[] }> {
  const raw = (await readFile(path.join(fixtureDir, `${name}.ndjson`), "utf8")).split("\n").filter(Boolean);
  return { raw, lines: raw.map((line): Line => JSON.parse(line)) };
}

/** 回放到第 n 个 text_delta 就停住（流式中）。 */
async function streamingFixture(name: string, deltas: number): Promise<string> {
  const { raw, lines } = await readFixture(name);
  let seen = 0;
  const cut = lines.findIndex((line) => line.frame?.assistantMessageEvent?.type === "text_delta" && ++seen === deltas);
  expect(cut).toBeGreaterThan(0);
  return raw.slice(0, cut + 1).join("\n") + "\n";
}

/** 慢速回放：工具开始执行前和结束后各等一会，让"Worked for Ns · M tool calls"这一行真实出现。 */
async function slowFixture(name: string): Promise<string> {
  const { raw, lines } = await readFixture(name);
  const out: string[] = [];
  lines.forEach((line, index) => {
    const type = line.frame?.type;
    if (line.kind === "out" && type === "tool_execution_end") out.push(JSON.stringify({ kind: "delay", ms: 2500 }));
    out.push(raw[index] as string);
  });
  return out.join("\n") + "\n";
}

/** 回放到审批请求就停住（等你确认）。 */
async function gateFixture(name: string): Promise<string> {
  const { raw, lines } = await readFixture(name);
  const cut = lines.findIndex((line) => line.frame?.method === "select");
  expect(cut).toBeGreaterThan(0);
  return raw.slice(0, cut + 1).join("\n") + "\n";
}

/** fixture 里最后一条助手 message_end 的文字：回放后界面上的最终内容必须和它一致。 */
async function finalAnswer(name: string): Promise<string> {
  const { lines } = await readFixture(name);
  const ends = lines.filter((line) => line.frame?.type === "message_end" && line.frame.message?.role === "assistant");
  const texts = ends.map((line) =>
    (line.frame?.message?.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim(),
  );
  return texts.filter((text) => text !== "").at(-1) ?? "";
}

/** 渲染后的文字里没有 Markdown 标记，对照时把标记去掉。 */
const plain = (markdown: string) => markdown.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

async function start(
  fixtureText: string | null,
  fixtureName: string,
): Promise<{ launched: LaunchedApp; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 对话 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const fixture =
    fixtureText === null ? path.join(fixtureDir, `${fixtureName}.ndjson`) : path.join(work, `${fixtureName}.ndjson`);
  if (fixtureText !== null) await writeFile(fixture, fixtureText);
  const launched = await launchApp({
    STUDIO_TEST_OMP: JSON.stringify({ command: process.execPath, args: [fakeOmp, fixture] }),
  });
  // 项目目录选择框由主进程弹系统对话框，测试里直接替换成返回临时目录。
  await launched.app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, project);
  return {
    launched,
    async cleanup() {
      await launched.close();
      await rm(work, { recursive: true, force: true });
    },
  };
}

async function openNewTaskAndSend(page: Page, prompt: string): Promise<void> {
  await page.evaluate(async () => {
    const project = await globalThis.studio.addProject();
    if (!project) throw new Error("addProject 没有返回项目");
    await globalThis.studio.createTask({ projectId: project.id });
  });
  await openTaskRow(page);
  const input = page.getByTestId("composer-input");
  await expect(input).toBeVisible();
  await input.fill(prompt);
  await page.keyboard.press("Enter");
}

/** 在渲染进程里对选择器命中的第一个元素执行一段函数源码（本工程的 e2e 类型检查没有 DOM 类型）。 */
function inPage<T>(page: Page, selector: string, fn: string): Promise<T> {
  return page.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return (${fn})(el); })()`,
  ) as Promise<T>;
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
    await page.screenshot({ path: path.join(screenshotsDir, `conversation-${state}-${locale}-${scheme}.png`) });
  }
}

test("流式中：工具调用直接列在对话里，输入框上方是计时 + 当前活动；正在流的文字 + 停止按钮", async () => {
  const { launched, cleanup } = await start(await streamingFixture("bash-tool", 4), "streaming");
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    // 像 omp：运行中的工具调用不折叠，每个一行（图标 + 工具名 + 参数）。
    const live = page.getByTestId("process-live");
    await expect(live).toBeVisible();
    await expect(live.locator(".step-tool .step-name")).toContainText("Bash");
    // 输入框上方左边：本次运行已用时间 + 当前活动。
    const status = page.getByTestId("run-status-main");
    await expect(status).toBeVisible();
    await expect(status.locator(".run-elapsed")).toHaveText(/^\d+s$/);
    await expect(page.getByTestId("assistant-message")).toHaveAttribute("data-live", "true");
    await expect(page.getByTestId("stop-button")).toBeVisible();
    // 流式期间的滚动容器吸底。
    const stuck = await inPage<boolean>(
      page,
      ".scroller",
      "(el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1",
    );
    expect(stuck).toBe(true);
    await expect(page.locator(".scroller")).toHaveAttribute("aria-busy", "true");
    await shoot(page, "streaming");
  } finally {
    await cleanup();
  }
});

test("完成：过程默认展开，结论在前，最终内容与 fixture 的 message_end 一致", async () => {
  const { launched, cleanup } = await start(null, "bash-tool");
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    const answer = page.getByTestId("assistant-message");
    await expect(answer).toBeVisible({ timeout: 20_000 });
    await expect(answer).not.toHaveAttribute("data-live", "true", { timeout: 20_000 });
    expect(plain((await answer.textContent()) ?? "")).toContain(plain(await finalAnswer("bash-tool")));
    // 回放瞬间跑完（不足 1 秒）也显示工具卡，只是标题里没有时长。
    await expect(page.getByTestId("process-done")).toBeVisible();
    await expect(page.locator(".details .step-tool")).toHaveCount(1);
    const stuck = await inPage<boolean>(
      page,
      ".scroller",
      "(el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1",
    );
    expect(stuck).toBe(true);
    await shoot(page, "done");
  } finally {
    await cleanup();
  }
});

test("慢速回放：标题行显示 Worked for Ns · M tool calls（中文界面也是英文），工具块默认展开（bash 是带命令、输出和状态脚的卡片），可收起整个过程", async () => {
  const { launched, cleanup } = await start(await slowFixture("bash-tool"), "slow");
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    const done = page.getByTestId("process-done");
    await expect(done).toBeVisible({ timeout: 20_000 });
    // 运行过程的文案和 Tern 里的 omp 一样是英文，中文界面也不翻译。
    await expect(done).toContainText("Worked for");
    await expect(done).toContainText(/1/);
    // 像 Tern：结束后默认展开，bash 是一张卡片：命令 + 输出 + 状态脚（完成）。
    await expect(page.locator(".step-tool")).toHaveCount(1);
    await expect(page.locator(".step-tool .step-name")).toContainText("Bash");
    const card = page.locator(".step-tool .bash-card");
    await expect(card).toContainText("omp-studio");
    await expect(card.locator(".bash-foot")).toContainText(/(完成|Done)/);
    await shoot(page, "expanded");
    // 标题行收起整个过程。
    await done.locator(".process-row").click();
    await expect(page.locator(".details")).toHaveCount(0);
    await shoot(page, "folded");
  } finally {
    await cleanup();
  }
});

test("等你确认：门停靠在输入框上方，Enter 不会隐式允许，数字键选第 N 项", async () => {
  const { launched, cleanup } = await start(await gateFixture("approval-select"), "gate");
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    const gate = page.getByTestId("gate");
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await expect(gate).toHaveAttribute("data-approval", "true");
    await expect(page.getByTestId("run-status-main")).toContainText("paused");
    // 门在输入框正上方、同一个底部栈里。
    const gateBox = await gate.boundingBox();
    const composerBox = await page.getByTestId("composer-input").boundingBox();
    expect((gateBox?.y ?? 0) + (gateBox?.height ?? 0)).toBeLessThanOrEqual(composerBox?.y ?? 0);
    // 选项原样来自 omp：Approve / Approve bash for this session / Deny，按钮三个。
    await expect(gate.getByRole("button")).toHaveCount(3);
    await shoot(page, "gate");
  } finally {
    await cleanup();
  }
});

test("审批：批准后回放继续，最终内容与 fixture 一致", async () => {
  const { launched, cleanup } = await start(null, "approval-select");
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    const gate = page.getByTestId("gate");
    await expect(gate).toBeVisible({ timeout: 20_000 });
    await gate.getByRole("button").first().click(); // Approve → value 必须是 omp 给的原文
    await expect(gate).toHaveCount(0);
    const answer = page.getByTestId("assistant-message");
    await expect(answer).toContainText(plain(await finalAnswer("approval-select")).slice(0, 6), { timeout: 20_000 });
    expect(plain((await answer.textContent()) ?? "")).toContain(plain(await finalAnswer("approval-select")));
  } finally {
    await cleanup();
  }
});

test("缩放窗口保住阅读位置：滚到中间，宽度 1200→800→1200，锚点块偏移变化 ≤2px", async () => {
  const { launched, cleanup } = await start(null, "bash-tool");
  try {
    const { page, app } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    await expect(page.getByTestId("assistant-message")).toBeVisible({ timeout: 20_000 });
    // 塞 80 段长文字撑出可滚动的高度，并且窄窗口下会重排。
    await inPage<void>(
      page,
      ".column",
      `(column) => {
      for (let i = 0; i < 80; i += 1) {
        const p = document.createElement("p");
        p.setAttribute("data-anchor", "");
        p.id = "filler-" + i;
        p.textContent = "段落 " + i + "：" + "这是一段用来撑高的文字，窗口变窄时会折行，从而让上方内容的高度变化。".repeat(4);
        column.insertBefore(p, column.firstChild);
      }
    }`,
    );
    await inPage<void>(
      page,
      ".scroller",
      '(el) => { el.scrollTop = document.getElementById("filler-40").offsetTop - el.offsetTop; }',
    );
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, -1); // 用户主动上滚：脱离吸底
    await page.waitForTimeout(150);
    const offset = () =>
      page.evaluate(
        '(() => { const p = document.getElementById("filler-40"); const s = document.querySelector(".scroller"); return p.getBoundingClientRect().top - s.getBoundingClientRect().top; })()',
      ) as Promise<number>;
    const before = await offset();
    const resize = (width: number) =>
      app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]?.setSize(w, 800), width);
    await resize(800);
    await page.waitForTimeout(300);
    await resize(1200);
    await page.waitForTimeout(300);
    expect(Math.abs((await offset()) - before)).toBeLessThanOrEqual(2);
  } finally {
    await cleanup();
  }
});

test("斜杠菜单、草稿落盘、可见的覆盖式滚动条", async () => {
  const { launched, cleanup } = await start(null, "bash-tool");
  try {
    const { page, userDataDir } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    await expect(page.getByTestId("assistant-message")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("assistant-message")).not.toHaveAttribute("data-live", "true");

    // 斜杠菜单：键盘补全，Esc 关闭。
    const input = page.getByTestId("composer-input");
    await input.click();
    await input.fill("/sec");
    const menu = page.getByTestId("slash-menu");
    await expect(menu).toBeVisible({ timeout: 10_000 });
    await expect(menu).toContainText("/security");
    await page.keyboard.press("Tab");
    await expect(input).toHaveValue("/security ");
    await expect(menu).toHaveCount(0);
    await input.fill("/sec");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // 草稿存进主进程（userData/drafts.json），防抖后落盘。
    await input.fill("打了一半的消息");
    await expect
      .poll(async () => readFile(path.join(userDataDir, "drafts.json"), "utf8").catch(() => ""), { timeout: 5000 })
      .toContain("打了一半的消息");

    // 覆盖式滚动条：内容超出时 hover 出现，拖动滑块能滚动。
    await inPage<void>(
      page,
      ".column",
      `(column) => {
      for (let i = 0; i < 60; i += 1) {
        const p = document.createElement("p");
        p.textContent = "段落 " + i + "：" + "撑高用的文字。".repeat(20);
        column.insertBefore(p, column.firstChild);
      }
    }`,
    );
    await inPage<void>(page, ".scroller", "(el) => { el.scrollTop = 0; }");
    await page.mouse.move(600, 300);
    const bar = page.locator(".osb");
    await expect(bar).toHaveAttribute("data-visible", "true", { timeout: 3000 });
    const thumb = await page.locator(".osb-thumb").boundingBox();
    expect(thumb?.height).toBeGreaterThan(20);
    await page.mouse.move((thumb?.x ?? 0) + 3, (thumb?.y ?? 0) + 5);
    await page.mouse.down();
    await page.mouse.move((thumb?.x ?? 0) + 3, (thumb?.y ?? 0) + 200, { steps: 5 });
    await page.mouse.up();
    expect(await inPage<number>(page, ".scroller", "(el) => el.scrollTop")).toBeGreaterThan(100);
    await shoot(page, "scrollbar");
  } finally {
    await cleanup();
  }
});

test("等你确认期间输入框上方状态行的文字节点不被替换（不重挂载、不重放淡入）", async () => {
  const { launched, cleanup } = await start(await gateFixture("approval-select"), "gate-nodes");
  try {
    const { page } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    await expect(page.getByTestId("gate")).toBeVisible({ timeout: 20_000 });
    const status = page.getByTestId("run-status-main");
    await expect(status).toContainText("paused");
    await inPage<void>(
      page,
      "[data-testid=run-status-main]",
      `(el) => {
      window.__replaced = 0;
      new MutationObserver((records) => {
        for (const record of records) for (const node of [...record.removedNodes, ...record.addedNodes]) if (node.nodeType === 1 && node.classList.contains("run-activity")) window.__replaced += 1;
      }).observe(el, { childList: true, subtree: true });
    }`,
    );
    await page.waitForTimeout(3500); // 等待文字至少更新 3 次
    expect(await page.evaluate("window.__replaced")).toBe(0);
  } finally {
    await cleanup();
  }
});

test("停止请求失败后按钮会复位；Ctrl O 展开/收起最近的过程行", async () => {
  const { launched, cleanup } = await start(await slowFixture("bash-tool"), "stop-reset");
  try {
    const { page, app } = launched;
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("studio:stopTask");
      ipcMain.handle("studio:stopTask", () => {
        throw new Error("stop failed");
      });
    });
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    const stop = page.getByTestId("stop-button");
    await expect(stop).toBeVisible({ timeout: 10_000 });
    await stop.click();
    await expect(page.getByTestId("toasts").getByRole("alert")).toBeVisible();
    // 失败后不能停在"正在停止"：按钮重新可点。
    await expect(page.getByTestId("stop-button")).toBeEnabled();

    await expect(page.getByTestId("process-done")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".details")).toHaveCount(1);
    await page.locator(".scroller").focus();
    await page.keyboard.press("Control+o");
    await expect(page.locator(".details")).toHaveCount(0);
    await page.keyboard.press("Control+o");
    await expect(page.locator(".details")).toHaveCount(1);
  } finally {
    await cleanup();
  }
});

test("刷新页面时防抖中的草稿被立刻冲刷，最后几个字不丢", async () => {
  const { launched, cleanup } = await start(null, "bash-tool");
  try {
    const { page, userDataDir } = launched;
    await openNewTaskAndSend(page, "用 bash 工具运行 echo omp-studio");
    await expect(page.getByTestId("assistant-message")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("composer-input").fill("刷新前最后几个字");
    await page.reload(); // 不等 400ms 防抖
    await expect
      .poll(async () => readFile(path.join(userDataDir, "drafts.json"), "utf8").catch(() => ""), { timeout: 5000 })
      .toContain("刷新前最后几个字");
  } finally {
    await cleanup();
  }
});

// 浏览器面板（spec §4.29、docs/architecture/browser.md）：用户在右栏打开网页；omp 通过 studio 给的 CDP 地址操作同一个页面，
// 连上时面板自动打开、不抢输入框的焦点；omp 关不掉用户的页面；弹窗打开时页面藏起来，不挡住弹窗。
// 假 omp 只把 STUDIO_BROWSER_CDP 写进文件，测试自己当 omp 连上去（照 puppeteer 25 的连法）。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { expectNoOverflow, launchApp, openTaskRow, setLocaleTheme, testOmp, type LaunchedApp } from "./launch.ts";

/** 本机的两个测试页面。 */
async function startSite(): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    const title = request.url === "/two" ? "第二页" : "第一页";
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>${title}</title><p>${title}</p>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function start(): Promise<{ launched: LaunchedApp; browserFile: string; cleanup(): Promise<void> }> {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp 浏览器 e2e-"));
  const project = path.join(work, "项目 目录");
  await mkdir(project);
  const browserFile = path.join(work, "cdp.txt");
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("slash-status"), FAKE_OMP_BROWSER_FILE: browserFile });
  try {
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await launched.page.evaluate(async () => {
      const added = await globalThis.studio.addProject();
      if (!added) throw new Error("addProject 没有返回项目");
      await globalThis.studio.createTask({ projectId: added.id });
    });
    await openTaskRow(launched.page);
  } catch (error) {
    await launched.close();
    throw error;
  }
  return {
    launched,
    browserFile,
    cleanup: () => rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

/** 主进程里浏览器页面视图的位置和显隐（挂在主窗口 contentView 下）。 */
const pageView = (launched: LaunchedApp) =>
  launched.app.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children[0];
    return view === undefined ? null : { bounds: view.getBounds(), visible: view.getVisible() };
  });

/** 照 omp（puppeteer 25）的连法当一个 CDP 客户端：根会话 setAutoAttach 拿到 tab，tab 里再 setAutoAttach 拿到 page。 */
async function connectAsOmp(cdpUrl: string) {
  const version = (await (await fetch(`${cdpUrl}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  const inbox: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  socket.addEventListener("message", (event) => {
    inbox.push(JSON.parse(String(event.data)) as Record<string, unknown>);
    for (const wake of waiters.splice(0)) wake();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连不上")));
  });
  const until = async (match: (message: Record<string, unknown>) => boolean) => {
    for (;;) {
      const found = inbox.find(match);
      if (found) return found;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  let nextId = 0;
  const call = async (method: string, params: object = {}, sessionId?: string) => {
    nextId += 1;
    const id = nextId;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return until((message) => message["id"] === id);
  };
  const attached = (type: string) =>
    until(
      (message) =>
        message["method"] === "Target.attachedToTarget" &&
        (message["params"] as { targetInfo: { type: string } }).targetInfo.type === type,
    ).then((message) => (message["params"] as { sessionId: string }).sessionId);
  await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const tab = await attached("tab");
  await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, tab);
  const page = await attached("page");
  return { call, page, close: () => socket.close() };
}

test("浏览器面板：用户打开网页，omp 连上同一个页面，面板跟着显示 AI 的操作", async () => {
  const site = await startSite();
  const { launched, browserFile, cleanup } = await start();
  const { page } = launched;
  try {
    // 打开面板，在地址栏输入地址：页面视图盖在占位区上。
    await page.getByTestId("topbar-browser").click();
    const panel = page.getByTestId("browser-panel");
    await expect(panel).toBeVisible();
    const address = page.getByTestId("browser-address");
    // 用户打开、还没有页面：焦点直接在地址栏。
    await expect(address).toBeFocused();
    await address.fill(site.url.replace("http://", ""));
    await address.press("Enter");
    await expect(address).toHaveValue(site.url);
    // 面板用 transform 滑入，没停下时量到的占位区偏右：等滑入动画放完再量。
    await panel.evaluate(async (element) => {
      const animated = element as unknown as { getAnimations(): { finished: Promise<unknown> }[] };
      await Promise.all(animated.getAnimations().map((animation) => animation.finished));
    });
    const slot = (await page.getByTestId("browser-view").boundingBox())!;
    await expect
      .poll(() => pageView(launched))
      .toEqual({
        visible: true,
        bounds: {
          x: Math.round(slot.x),
          y: Math.round(slot.y),
          width: Math.round(slot.width),
          height: Math.round(slot.height),
        },
      });
    // 左缘的拖拽条不在页面视图下面：原生视图压住的地方点不到应用页面，拖不动（Playwright 的鼠标直接发给应用页面，拖一下看不出来）。
    const resizer = (await panel.getByRole("separator").boundingBox())!;
    expect(Math.round(slot.x)).toBeGreaterThanOrEqual(Math.round(resizer.x + resizer.width));
    // 右边和下边也留出和左边一样的间距，页面不压住面板的圆角和描边。
    const frame = (await panel.boundingBox())!;
    const inset = slot.x - frame.x;
    expect(Math.round(frame.x + frame.width - (slot.x + slot.width))).toBe(Math.round(inset));
    expect(Math.round(frame.y + frame.height - (slot.y + slot.height))).toBe(Math.round(inset));
    // 头部按钮的悬停提示画在上方：画在下方会落在原生页面下面，看不见。
    await page.getByTestId("browser-close").hover();
    await expect(page.getByTestId("tooltip")).toBeVisible();
    const tip = (await page.getByTestId("tooltip").boundingBox())!;
    expect(tip.y + tip.height).toBeLessThanOrEqual(slot.y);
    await page.mouse.move(0, frame.y + frame.height / 2);

    // 命令面板（带遮罩）打开时页面藏起来，不挡住它；关掉后回来。
    await page.keyboard.press("Control+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect.poll(async () => (await pageView(launched))?.visible).toBe(false);
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await pageView(launched))?.visible).toBe(true);

    // 关掉面板，焦点回到输入框；omp 连上来：面板自动打开，输入框的焦点不被抢走。
    await page.getByTestId("browser-close").click();
    await expect(panel).toHaveCount(0);
    await page.getByTestId("composer-input").focus();
    const cdpUrl = (await readFile(browserFile, "utf8")).trim().split("\n").at(-1)!;
    expect(cdpUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const omp = await connectAsOmp(cdpUrl);
    try {
      await expect(panel).toBeVisible();
      await expect(page.getByTestId("composer-input")).toBeFocused();

      // omp 看到的就是用户打开的页面；它跳转，地址栏跟着变。
      const title = await omp.call("Runtime.evaluate", { expression: "document.title", returnByValue: true }, omp.page);
      expect(title["result"]).toMatchObject({ result: { value: "第一页" } });
      await omp.call("Page.navigate", { url: `${site.url}two` }, omp.page);
      await expect(address).toHaveValue(`${site.url}two`);

      // omp 关不掉用户的页面。
      const closed = await omp.call("Page.close", {}, omp.page);
      expect(closed["error"]).toMatchObject({ code: -32000 });
      await expect(address).toHaveValue(`${site.url}two`);
    } finally {
      omp.close();
    }
  } finally {
    await launched.close();
    await cleanup();
    await site.close();
  }
});

test("浏览器面板：面板没打开过时 omp 连上来，页面目标有地址（puppeteer 才认它是可用的标签页）", async () => {
  const { launched, browserFile, cleanup } = await start();
  try {
    await expect.poll(async () => (await readFile(browserFile, "utf8").catch(() => "")).trim()).not.toBe("");
    const cdpUrl = (await readFile(browserFile, "utf8")).trim().split("\n").at(-1)!;
    const omp = await connectAsOmp(cdpUrl);
    try {
      await expect
        .poll(async () => {
          const reply = await omp.call("Target.getTargets");
          const infos = (reply["result"] as { targetInfos: { type: string; url: string }[] }).targetInfos;
          return infos.find((info) => info.type === "page")?.url;
        })
        .toBe("about:blank");
      // about:blank 不显示在地址栏里。
      await expect(launched.page.getByTestId("browser-address")).toHaveValue("");
    } finally {
      omp.close();
    }
  } finally {
    await launched.close();
    await cleanup();
  }
});

test("浏览器面板：窄窗口、中英文下头部不越界", async () => {
  const { launched, cleanup } = await start();
  const { page } = launched;
  try {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.getByTestId("topbar-browser").click();
    const panel = page.getByTestId("browser-panel");
    for (const locale of ["zh-CN", "en"] as const) {
      await setLocaleTheme(page, locale, "light");
      await expect(panel).toBeVisible();
      await expectNoOverflow(panel);
    }
  } finally {
    await launched.close();
    await cleanup();
  }
});

// TSP `web` 节点（hello 声明了 `web`）：回答里单独一行的 `<iframe src>`，omp 19.2.1 发成 web 节点（录制 fixtures/tsp/web.jsonl，
// 地址写成占位 http://127.0.0.1:1/，用例换成本地服务的真实端口后用临时副本回放）。守着：不点不交互、点了拿焦点、Esc 离开、
// 网页里没有 preload / Node、不能导航到 file: 也不能改顶层页面（docs/architecture/security.md「回答里的内嵌网页」）。
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { launchApp, testOmp } from "./launch.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const PLACEHOLDER = "http://127.0.0.1:1/";
const PROMPT = (base: string) =>
  `Reply with exactly this HTML line and nothing else, no code fence: <iframe src="${base}page.html" title="Probe page"></iframe>`;

async function serve(): Promise<{ server: Server; base: string }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      request.url === "/page.html"
        ? '<!doctype html><title>Probe</title><h1>probe page</h1><a id="next" href="/next.html">next</a>'
        : "<!doctype html><title>Next</title><h1>next page</h1>",
    );
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

async function webFrame(page: Page, base: string): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().startsWith(base))).toBe(true);
  return page.frames().find((frame) => frame.url().startsWith(base)) as Frame;
}

const frameFocused = (page: Page) =>
  page.evaluate(() => {
    const g = globalThis as unknown as { document: { activeElement: { tagName?: string } | null } };
    return g.document.activeElement?.tagName === "IFRAME";
  });

test("回答里内嵌的网页：不点不交互，点了拿焦点、Esc 离开；网页里没有 preload / Node，导航不出网页、改不了顶层页面", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp web-"));
  const project = path.join(work, "项目");
  await mkdir(project);
  const { server, base } = await serve();
  const fixture = path.join(work, "web.jsonl");
  const recorded = await readFile(path.join(root, "fixtures", "tsp", "web.jsonl"), "utf8");
  await writeFile(fixture, recorded.replaceAll(PLACEHOLDER, base), "utf8");
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp(fixture) });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await page.getByTestId("composer-input").fill(PROMPT(base));
    await page.keyboard.press("Enter");

    const web = page.getByTestId("tsp-web");
    await expect(web).toHaveAttribute("data-mode", "live", { timeout: 20_000 });
    await expect(web).toHaveAttribute("data-role", "omp.embed");
    const frame = await webFrame(page, base);
    await expect
      .poll(() => frame.evaluate(() => (globalThis as unknown as { document: { title: string } }).document.title))
      .toBe("Probe");

    // 没有 preload（StudioApi）也没有 Node。
    expect(
      await frame.evaluate(() => {
        const g = globalThis as unknown as Record<string, unknown>;
        return [typeof g["studio"], typeof g["require"], typeof g["process"]];
      }),
    ).toEqual(["undefined", "undefined", "undefined"]);

    // 不交互：透明层盖着，焦点不在网页里。
    await expect(page.getByTestId("tsp-web-shield")).toBeVisible();
    expect(await frameFocused(page)).toBe(false);

    // 点一下：拿焦点，透明层撤掉。
    await page.getByTestId("tsp-web-shield").click();
    await expect(web).toHaveAttribute("data-mode", "focused");
    await expect(page.getByTestId("tsp-web-shield")).toHaveCount(0);
    await expect.poll(() => frameFocused(page)).toBe(true);

    // Esc 在网页里：退回不交互（主进程转来 frameEscape），焦点回到框上。按键走 webContents.sendInputEvent（和真实键盘一样经过
    // before-input-event）：Playwright 的 keyboard.press 走 CDP Input.dispatchKeyEvent，不触发 before-input-event（实测）。
    await launched.app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    });
    await expect(web).toHaveAttribute("data-mode", "live");
    await expect(page.getByTestId("tsp-web-shield")).toBeVisible();
    expect(await frameFocused(page)).toBe(false);

    // 改顶层页面：sandbox 没给 allow-top-navigation，抛错，应用页面不动。
    const appUrl = page.url();
    const topError = await frame.evaluate((target) => {
      try {
        (globalThis as unknown as { top: { location: { href: string } } }).top.location.href = target;
        return "no error";
      } catch (error) {
        return String(error);
      }
    }, `${base}next.html`);
    expect(topError).not.toBe("no error");
    expect(page.url()).toBe(appUrl);

    // 导航到 studio-preview:（Chromium 自己放行，只有主进程的 will-frame-navigate 拦）和 file:：框还停在网页上。
    for (const target of ["studio-preview://00000000-0000-0000-0000-000000000000/", "file:///C:/Windows/win.ini"]) {
      await frame.evaluate((href) => {
        (globalThis as unknown as { location: { href: string } }).location.href = href;
      }, target);
      // oxlint-disable-next-line eslint/no-restricted-properties -- 被拦下的导航没有信号可等，留一段时间让它真要发生就发生
      await page.waitForTimeout(500);
      expect(frame.url()).toBe(`${base}page.html`);
    }

    // 网页里点链接去别的网页照常走（透明层盖着，用网页自己的点击）。
    await frame.evaluate(() =>
      (globalThis as unknown as { document: { querySelector(s: string): { click(): void } | null } }).document
        .querySelector("a")
        ?.click(),
    );
    await expect.poll(() => frame.url()).toBe(`${base}next.html`);
  } finally {
    await launched.close();
    server.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// 主区背景图（docs/architecture/themes.md「主区背景图」）：主题插图画在主区面板上；自选图片复制进 userData/backdrops，
// 经 app://studio/@backdrop/<文件名> 读，换图后旧文件删掉；假图片被拒；协议不放出 backdrops 之外的文件。
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, setLocaleTheme, type LaunchedApp } from "./launch.ts";

/** 一张 1×1 的真 PNG（颜色不同、内容就不同）。 */
function onePixelPng(rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8; // 位深
  header[9] = 2; // 真彩色
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, ...rgb]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");

async function launch(): Promise<LaunchedApp> {
  const launched = await launchApp();
  try {
    await launched.page.setViewportSize({ width: 1200, height: 800 });
    await expect(launched.page.getByTestId("app-root")).toBeVisible();
    await setLocaleTheme(launched.page, "zh-CN", "light");
  } catch (error) {
    await launched.close();
    throw error;
  }
  return launched;
}

function panelBackground(page: Page): Promise<string> {
  return page.getByTestId("main-panel").evaluate((element) => {
    const g = globalThis as unknown as { getComputedStyle(e: unknown): { backgroundImage: string } };
    return g.getComputedStyle(element).backgroundImage;
  });
}

/** 在页面里 fetch：返回状态码和字节数。 */
function fetchInPage(page: Page, url: string): Promise<{ status: number; bytes: number }> {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  }, url);
}

/** 让主进程的文件对话框直接"选中"这个文件。 */
async function stubPick(launched: LaunchedApp, file: string): Promise<void> {
  await launched.app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, file);
}

test("主题插图：有插图的主题画在主区面板上，浅色主题不画", async () => {
  const launched = await launch();
  try {
    const { page } = launched;
    const panel = page.getByTestId("main-panel");
    await expect(panel).not.toHaveAttribute("data-backdrop");

    await page.evaluate(() => globalThis.studio.setTheme("whale-dark"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "whale-dark");
    await expect(panel).toHaveAttribute("data-backdrop", "theme");
    await expect(panel).toHaveAttribute("data-backdrop-strength", "medium");
    // 构建后插图名带哈希（whale-dark-<hash>.svg）；地址要真的取得到，不只是写进了样式。
    const art = /url\("([^"]*whale-dark[^"]*\.svg)"\)/.exec(await panelBackground(page))?.[1];
    expect(art, "background-image 里没有 whale-dark 的插图").toBeDefined();
    expect((await fetchInPage(page, art ?? "")).status).toBe(200);

    await page.evaluate(() => globalThis.studio.setBackdropStrength("high"));
    await expect(panel).toHaveAttribute("data-backdrop-strength", "high");

    await page.evaluate(() => globalThis.studio.setTheme("light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(panel).not.toHaveAttribute("data-backdrop");
    await expect(panel).not.toHaveAttribute("data-backdrop-strength");
    expect(await panelBackground(page)).toBe("none");
  } finally {
    await launched.close();
  }
});

test("自选图片：复制进 userData/backdrops、经 app:// 读出；换图删旧图；假图片被拒；协议不越界", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp studio 背景图 e2e-"));
  const removeWork = () => rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const launched = await launch().catch(async (error: unknown) => {
    await removeWork();
    throw error;
  });
  try {
    const { page } = launched;
    const panel = page.getByTestId("main-panel");
    const backdrops = path.join(launched.userDataDir, "backdrops");
    const first = onePixelPng([200, 40, 40]);
    const second = onePixelPng([40, 40, 200]);
    const firstFile = path.join(work, "我的 壁纸 一.png");
    const secondFile = path.join(work, "我的 壁纸 二.png");
    const fakeFile = path.join(work, "其实是 文本.png");
    await writeFile(firstFile, first);
    await writeFile(secondFile, second);
    await writeFile(fakeFile, "这不是图片\n");

    await page.keyboard.press("Control+,");
    await expect(page.getByTestId("settings")).toBeVisible();
    await page.getByTestId("settings-nav-general").click();

    // 还没选过图：点"自选图片"就弹对话框选图
    await stubPick(launched, firstFile);
    await page.getByTestId("setting-backdrop-custom").click();
    await expect(panel).toHaveAttribute("data-backdrop", "custom");
    const firstUrl = `app://studio/@backdrop/${sha256(first)}.png`;
    await expect.poll(() => panelBackground(page)).toContain(`url("${firstUrl}")`);
    expect(await fetchInPage(page, firstUrl)).toEqual({ status: 200, bytes: first.length });
    expect(await readdir(backdrops)).toEqual([`${sha256(first)}.png`]);

    // 换一张：旧文件没人引用了，删掉
    await stubPick(launched, secondFile);
    await page.getByTestId("setting-backdrop-choose").click();
    const secondUrl = `app://studio/@backdrop/${sha256(second)}.png`;
    await expect.poll(() => panelBackground(page)).toContain(`url("${secondUrl}")`);
    expect(await fetchInPage(page, secondUrl)).toEqual({ status: 200, bytes: second.length });
    await expect.poll(() => readdir(backdrops)).toEqual([`${sha256(second)}.png`]);
    expect((await fetchInPage(page, firstUrl)).status).toBe(404);

    // 扩展名是 .png、内容是文本：拒绝，报错，设置和目录都不变
    await stubPick(launched, fakeFile);
    await page.getByTestId("setting-backdrop-choose").click();
    await expect(page.getByTestId("toasts")).toContainText("这个文件不是能用的图片");
    expect(await page.evaluate(() => globalThis.studio.getSettings().then((s) => s.customBackdrop))).toBe(
      `${sha256(second)}.png`,
    );
    expect(await panelBackground(page)).toContain(`url("${secondUrl}")`);
    expect(await readdir(backdrops)).toEqual([`${sha256(second)}.png`]);

    // 协议：../ 折叠后落回 renderer 目录（那里没有 settings.json）；不合规的名字、不存在的合规名字都是 404
    for (const url of [
      "app://studio/@backdrop/../settings.json",
      "app://studio/@backdrop/..%2fsettings.json",
      "app://studio/@backdrop/settings.json",
      `app://studio/@backdrop/${sha256(second).toUpperCase()}.png`,
      `app://studio/@backdrop/${"0".repeat(64)}.png`,
    ])
      expect((await fetchInPage(page, url)).status, url).toBe(404);
  } finally {
    await launched.close();
    await removeWork();
  }
});

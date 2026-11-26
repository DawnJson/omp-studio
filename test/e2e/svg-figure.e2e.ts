// 回复里的 ```svg 图按 studio 的主题画（docs/architecture/conversation.md「svg 图」）：omp 在 TSP 里只发它按自己终端主题
// 栅格化的 PNG，studio 从会话文件找回源码自己画，切主题跟着换色。
// 真实 omp（PATH 上的）+ 临时 PI_CODING_AGENT_DIR + 本地假的 OpenAI 兼容服务（回一段带两张 svg 图的回复）；不连任何真实服务。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startFakeOpenAi } from "../fake-openai/server.ts";
import { launchApp, setLocaleTheme } from "./launch.ts";

const REPLY = [
  "两张图：",
  "",
  "```svg",
  '<svg viewBox="0 0 200 40" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="196" height="36" rx="4" fill="var(--surface)" stroke="var(--border)"/><text x="10" y="26" fill="var(--fg)">第一张</text></svg>',
  "```",
  "",
  "中间的说明。",
  "",
  "```svg",
  '<svg viewBox="0 0 100 20" xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="8" fill="var(--accent)"/></svg>',
  "```",
].join("\n");

/** 页面上第 n 张图的 svg 源码（`data:` URL 解开）；还是 omp 的 PNG（`blob:`）时为 null。 */
function figureSvg(page: Page, nth: number): Promise<string | null> {
  return page
    .locator('[data-testid="tsp-view"] [data-role="omp.figure.svg"] img')
    .nth(nth)
    .evaluate((img) => {
      const src = (img as unknown as { src: string }).src;
      return src.startsWith("data:image/svg+xml") ? decodeURIComponent(src.slice(src.indexOf(",") + 1)) : null;
    });
}

const token = (page: Page, name: string) =>
  page.evaluate(
    (variable) =>
      (globalThis as unknown as { getComputedStyle(el: unknown): { getPropertyValue(n: string): string } })
        .getComputedStyle(
          (globalThis as unknown as { document: { documentElement: unknown } }).document.documentElement,
        )
        .getPropertyValue(variable)
        .trim(),
    name,
  );

test("svg 图：omp 发来的 PNG 换成 studio 按当前主题画的 svg，两张图各是各的；切到深色跟着换色", async () => {
  test.setTimeout(120_000);
  const fake = await startFakeOpenAi({ models: ["fake-chat"], reply: REPLY });
  const work = await mkdtemp(path.join(os.tmpdir(), "omp svg figure "));
  const agentDir = path.join(work, "agent");
  const project = path.join(work, "项目 目录");
  await mkdir(agentDir, { recursive: true });
  await mkdir(project);
  await writeFile(
    path.join(agentDir, "models.yml"),
    `providers:\n  fake:\n    baseUrl: ${fake.baseUrl}\n    apiKey: sk-fake\n    api: openai-completions\n    models:\n      - id: fake-chat\n        name: Fake Chat\n`,
    "utf8",
  );
  await writeFile(
    path.join(agentDir, "config.yml"),
    "modelRoles:\n  default: fake/fake-chat\nstartup:\n  setupWizard: false\n",
    "utf8",
  );
  const launched = await launchApp({ PI_CODING_AGENT_DIR: agentDir });
  try {
    const { page, app } = launched;
    await setLocaleTheme(page, "zh-CN", "light");
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await page.getByTestId("composer-input").fill("画两张图");
    await page.keyboard.press("Enter");

    const figures = page.locator('[data-testid="tsp-view"] [data-role="omp.figure.svg"] img');
    await expect(figures).toHaveCount(2, { timeout: 60_000 });
    await expect.poll(() => figureSvg(page, 0), { timeout: 30_000 }).toContain("第一张");
    const first = (await figureSvg(page, 0)) ?? "";
    const second = (await figureSvg(page, 1)) ?? "";
    expect(first).not.toContain("var(");
    expect(first).toContain(`fill="${await token(page, "--text")}"`);
    expect(second).toContain(`fill="${await token(page, "--accent")}"`);

    await setLocaleTheme(page, "zh-CN", "dark");
    const darkText = await token(page, "--text");
    await expect.poll(() => figureSvg(page, 0)).toContain(`fill="${darkText}"`);
  } finally {
    await launched.close();
    await fake.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

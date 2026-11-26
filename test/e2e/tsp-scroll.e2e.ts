// TSP `scroll` 操作（hello 声明了 `scroll`）：omp 的报告弹窗（omp 19.2.1 录制 fixtures/tsp/scroll-report.jsonl，原本是 /changelog，
// 第一句话换成普通文字，三次翻页键和对应的 scroll 帧见录制末尾）里按 PageDown / PageUp，键写给 omp，omp 回 scroll 操作，
// 弹窗正文所在的滚动容器跟着滚。焦点留在 studio 的输入框上（弹窗开着时用户通常就在这里）。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { launchApp, testOmp } from "./launch.ts";

const BODY = "layer/report/0/body";

/** 正文最近的、真的在滚的祖先的 scrollTop。 */
function bodyScrollTop(page: Page): Promise<number> {
  return page.evaluate((id) => {
    const g = globalThis as unknown as {
      document: { querySelector(s: string): { parentElement: unknown } | null };
      getComputedStyle(el: unknown): { overflowY: string };
    };
    type El = { parentElement: El | null; scrollHeight: number; clientHeight: number; scrollTop: number };
    for (let at = g.document.querySelector(`[data-id="${id}"]`) as El | null; at !== null; at = at.parentElement) {
      const overflow = g.getComputedStyle(at).overflowY;
      if (at.scrollHeight > at.clientHeight && (overflow === "auto" || overflow === "scroll")) return at.scrollTop;
    }
    return -1;
  }, BODY);
}

test("报告弹窗里按 PageDown / PageUp：键交给 omp，omp 的 scroll 操作滚动弹窗正文", async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), "omp tsp scroll-"));
  const project = path.join(work, "项目");
  await mkdir(project);
  const log = path.join(work, "omp-received.jsonl");
  const launched = await launchApp({ STUDIO_TEST_OMP: testOmp("scroll-report", { log }) });
  try {
    const { page } = launched;
    await launched.app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    await page.getByTestId("sidebar-open-folder").click();
    await page.getByTestId("composer-input").fill("show the report");
    await page.keyboard.press("Enter");
    const overlay = page.locator('[data-testid="tsp-view"] [data-role="omp.overlay.report"]');
    await expect(overlay).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("composer-input")).toBeFocused();
    await expect.poll(() => bodyScrollTop(page)).toBe(0);

    await page.keyboard.press("PageDown");
    await expect.poll(() => bodyScrollTop(page)).toBeGreaterThan(0);
    const first = await bodyScrollTop(page);
    await page.keyboard.press("PageDown");
    await expect.poll(() => bodyScrollTop(page)).toBeGreaterThan(first);
    await page.keyboard.press("PageUp");
    await expect.poll(() => bodyScrollTop(page)).toBe(first);
    // 弹窗还开着（PageUp / PageDown 不是 Esc），任务也没被当成停止。
    await expect(overlay).toBeVisible();
    const keys = (await readFile(log, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { kind: string; data?: string })
      .filter((record) => record.kind === "keys")
      .map((record) => record.data);
    expect(keys).toEqual(["\x1b[6~", "\x1b[6~", "\x1b[5~"]);
  } finally {
    await launched.close();
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

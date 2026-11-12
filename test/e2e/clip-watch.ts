// 截断巡检：每个 e2e 用例的整个过程里，定时找"被父级裁掉一截的内容"（#12：旁路提问面板被长对话挤成一条，文字上下被裁）。
// launchApp 起好窗口后装上，close() 时取结果，用 expect.soft 记失败（不盖掉用例自己的错误）。
//
// 算截断的：overflow 是 hidden / clip 的元素，内容比可见区域高（或宽）出 2px 以上，并且连续 CLIP_STREAK 次采样都这样
// （展开 / 收起动画、换页淡入中间的帧不算）。不算的：overflow 是 auto / scroll（本来就滚）、横向的 text-overflow: ellipsis、
// -webkit-line-clamp（有意截断，完整内容在 title 或展开按钮里）、输入框、xterm 内部、aria-hidden 的装饰、带 data-clip 的元素（有意裁剪，属性值写原因）。
import { expect, type Page } from "@playwright/test";

const CLIP_INTERVAL_MS = 400;
const CLIP_STREAK = 3;

interface ClipWindow {
  __clipWatch?: { found: Record<string, string>; stop(): void };
}

export async function installClipWatch(page: Page): Promise<void> {
  await page.evaluate(
    ({ interval, streak }) => {
      interface Rect {
        width: number;
        height: number;
      }
      interface El {
        tagName: string;
        className: unknown;
        scrollHeight: number;
        clientHeight: number;
        scrollWidth: number;
        clientWidth: number;
        parentElement: El | null;
        getAttribute(name: string): string | null;
        closest(selector: string): El | null;
        getBoundingClientRect(): Rect;
      }
      interface Style {
        overflowX: string;
        overflowY: string;
        textOverflow: string;
        visibility: string;
        getPropertyValue(name: string): string;
      }
      const g = globalThis as unknown as ClipWindow & {
        document: { hidden: boolean; querySelectorAll(selector: string): ArrayLike<El> };
        getComputedStyle(el: El): Style;
        setInterval(fn: () => void, ms: number): number;
        clearInterval(id: number): void;
      };
      if (g.__clipWatch) return;
      const label = (el: El): string => {
        const id = el.getAttribute("data-testid");
        const role = el.getAttribute("data-role");
        const cls =
          typeof el.className === "string" && el.className !== "" ? `.${el.className.split(/\s+/).join(".")}` : "";
        return `${el.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ""}${role ? `[data-role=${role}]` : ""}${cls}`;
      };
      const where = (el: El): string => {
        const chain: string[] = [];
        for (let at: El | null = el.parentElement; at !== null && chain.length < 3; at = at.parentElement) {
          const id = at.getAttribute("data-testid");
          if (id) chain.push(id);
        }
        return chain.length > 0 ? ` (在 ${chain.join(" < ")} 里)` : "";
      };
      const streaks = new Map<El, number>();
      const found: Record<string, string> = {};
      const sample = () => {
        // 窗口藏起来时动画停在半路（折叠区域的展开帧会一直裁着），这段不算，计数从头来。
        if (g.document.hidden) {
          streaks.clear();
          return;
        }
        const seen = new Set<El>();
        for (const el of Array.from(g.document.querySelectorAll("body *"))) {
          const tall = el.scrollHeight > el.clientHeight + 2;
          const wide = el.scrollWidth > el.clientWidth + 2;
          if (!tall && !wide) continue;
          // 输入框里的字本来就横向滚；aria-hidden 的是装饰（骨架的扫光等），没有会丢的内容。
          if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) continue;
          if (el.closest('[data-clip], .xterm, [aria-hidden="true"]') !== null) continue;
          const style = g.getComputedStyle(el);
          if (style.visibility === "hidden") continue;
          const lineClamp = style.getPropertyValue("-webkit-line-clamp");
          const clippedY =
            tall && ["hidden", "clip"].includes(style.overflowY) && (lineClamp === "" || lineClamp === "none");
          const clippedX = wide && ["hidden", "clip"].includes(style.overflowX) && style.textOverflow !== "ellipsis";
          if (!clippedY && !clippedX) continue;
          const rect = el.getBoundingClientRect();
          // 读屏专用的 .sr-only 本来就压成 1px。
          if (rect.width <= 1 || rect.height <= 1) continue;
          seen.add(el);
          const count = (streaks.get(el) ?? 0) + 1;
          streaks.set(el, count);
          if (count < streak) continue;
          const key = label(el);
          if (found[key] !== undefined) continue;
          const parts: string[] = [];
          if (clippedY) parts.push(`高 ${el.clientHeight}px，内容 ${el.scrollHeight}px`);
          if (clippedX) parts.push(`宽 ${el.clientWidth}px，内容 ${el.scrollWidth}px`);
          found[key] = `${parts.join("；")}${where(el)}`;
        }
        for (const el of streaks.keys()) if (!seen.has(el)) streaks.delete(el);
      };
      const timer = g.setInterval(sample, interval);
      g.__clipWatch = { found, stop: () => g.clearInterval(timer) };
    },
    { interval: CLIP_INTERVAL_MS, streak: CLIP_STREAK },
  );
}

/** 取出巡检到的截断（窗口已经关了、页面没了时返回空：这次没法查）。 */
export async function takeClipFindings(page: Page): Promise<string[]> {
  const found = await page
    .evaluate(() => {
      const watch = (globalThis as unknown as ClipWindow).__clipWatch;
      watch?.stop();
      return watch?.found ?? {};
    })
    .catch(() => ({}));
  return Object.entries(found).map(([el, detail]) => `${el}: ${detail}`);
}

/** 用例结束时：有截断就记一条 soft 失败（用例自己已经失败时不盖掉原来的错误）。 */
export function expectNoClipping(findings: string[]): void {
  expect.soft(findings, "内容被裁掉了一截（test/e2e/clip-watch.ts）").toEqual([]);
}

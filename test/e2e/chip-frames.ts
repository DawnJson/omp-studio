// 模型胶囊的逐帧记录（在页面里跑）：每个动画帧读 [data-testid=model-chip] 的文本和宽度、草稿所在文件夹，只记变化；另记长任务时长。
import type { Page } from "@playwright/test";

export interface Frame {
  at: number;
  text: string;
  width: number;
  /** 草稿所在项目的文件夹名（排查用）。 */
  project: string;
}
export interface Recording {
  frames: Frame[];
  longTasks: number[];
}

interface PageGlobals {
  document: {
    querySelector(selector: string): { textContent: string | null; getBoundingClientRect(): { width: number } } | null;
  };
  requestAnimationFrame(callback: () => void): number;
  PerformanceObserver: new (callback: (list: { getEntries(): { duration: number }[] }) => void) => {
    observe(options: { entryTypes: string[] }): void;
  };
  __chip?: Recording & { stop: boolean };
}

/** 回调会被序列化进页面，不能引用外面的东西。 */
function install(): void {
  const g = globalThis as unknown as PageGlobals;
  const recording: Recording & { stop: boolean } = { frames: [], longTasks: [], stop: false };
  g.__chip = recording;
  new g.PerformanceObserver((list) => {
    for (const entry of list.getEntries()) recording.longTasks.push(Math.round(entry.duration));
  }).observe({ entryTypes: ["longtask"] });
  const tick = () => {
    const chip = g.document.querySelector('[data-testid="model-chip"]');
    const text = chip === null ? "" : (chip.textContent ?? "");
    const label = g.document.querySelector('[data-testid="empty-project"]');
    const project = (label?.textContent ?? "").slice(-4);
    const width = chip === null ? 0 : Math.round(chip.getBoundingClientRect().width);
    const last = recording.frames[recording.frames.length - 1];
    if (last === undefined || last.text !== text || last.width !== width || last.project !== project)
      recording.frames.push({ at: Math.round(performance.now()), text, width, project });
    if (!recording.stop) g.requestAnimationFrame(tick);
  };
  tick();
}

/** 页面里开始逐帧记录。 */
export async function startRecording(page: Page): Promise<void> {
  await page.evaluate(install);
}

export async function readRecording(page: Page): Promise<Recording> {
  return page.evaluate(() => {
    const g = globalThis as unknown as PageGlobals;
    const recording = g.__chip!;
    recording.stop = true;
    return { frames: recording.frames, longTasks: recording.longTasks };
  });
}

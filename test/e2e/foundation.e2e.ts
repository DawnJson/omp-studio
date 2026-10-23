import { expect, test } from "@playwright/test";
import { launchApp } from "./launch.ts";

test("窗口能起来，渲染进程只有 window.studio，拿不到 Node 和 ipcRenderer", async () => {
  const launched = await launchApp();
  try {
    const { page } = launched;
    await expect(page.getByTestId("app-root")).toBeAttached();

    const exposed = await page.evaluate(() => ({
      studioFunctions: Object.values(globalThis.studio).every((member) => typeof member === "function"),
      hasInvoke: typeof globalThis.studio.listTasks === "function",
      hasSubscribe: typeof globalThis.studio.onTaskState === "function",
      leaks: ["require", "process", "ipcRenderer"].filter((name) => name in globalThis),
    }));
    expect(exposed).toEqual({ studioFunctions: true, hasInvoke: true, hasSubscribe: true, leaks: [] });
  } finally {
    await launched.close();
  }
});

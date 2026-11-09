import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseConversationWidth } from "../src/main/window/window-state.ts";

const hoisted = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => hoisted.userData },
  screen: { getAllDisplays: () => [] },
}));

/** window-state 把读到的状态缓存在模块里：每个用例 resetModules 后动态导入一份新模块，才会再读一次磁盘（静态导入做不到）。 */
async function loadShell(shell: unknown) {
  await writeFile(path.join(hoisted.userData, "window-state.json"), JSON.stringify({ shell }), "utf8");
  vi.resetModules();
  const { getShellState } = await import("../src/main/window/window-state.ts");
  return getShellState();
}

describe("window-state：对话列宽度", () => {
  beforeEach(async () => {
    hoisted.userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-window-state-"));
  });
  afterEach(async () => {
    await rm(hoisted.userData, { recursive: true, force: true, maxRetries: 5 });
  });

  it("没存过 / 存的是 null：默认（null）", async () => {
    expect((await loadShell({})).conversationWidth).toBeNull();
    expect((await loadShell({ conversationWidth: null })).conversationWidth).toBeNull();
  });

  it("10–100 之间的百分比原样读回，最多两位小数", async () => {
    expect((await loadShell({ conversationWidth: 95 })).conversationWidth).toBe(95);
    expect((await loadShell({ conversationWidth: 10 })).conversationWidth).toBe(10);
    expect((await loadShell({ conversationWidth: 100 })).conversationWidth).toBe(100);
    expect((await loadShell({ conversationWidth: 62.345 })).conversationWidth).toBe(62.35);
  });

  it("越界、不是数字：按默认，不影响别的字段", async () => {
    for (const bad of [5, 9.99, 100.5, "80", Number.NaN, true]) {
      const shell = await loadShell({ conversationWidth: bad, sidebarWidth: 300 });
      expect(shell.conversationWidth).toBeNull();
      expect(shell.sidebarWidth).toBe(300);
    }
  });

  it("IPC 写入：越界抛错，null 和合法值放行", () => {
    expect(parseConversationWidth(null)).toBeNull();
    expect(parseConversationWidth(87.5)).toBe(87.5);
    expect(() => parseConversationWidth(101)).toThrow(/conversationWidth/);
    expect(() => parseConversationWidth(undefined)).toThrow(/conversationWidth/);
  });
});

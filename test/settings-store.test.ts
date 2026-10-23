import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StudioSettings } from "../src/shared/ipc.ts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => hoisted.userData, getLocale: () => "en-US" },
  nativeTheme: { themeSource: "system" },
}));
vi.mock("../src/main/ipc/events.ts", () => ({ emitEvent: vi.fn() }));
vi.mock("../src/main/window/main-window.ts", () => ({ getMainWindow: () => null, isAppUrl: () => false }));

// vi.mock 提升到导入之前，被测模块必须在 mock 之后才加载：这里只能动态导入。
const { getSettings, loadSettings } = await import("../src/main/settings/settings-store.ts");
const { parseFontSize } = await import("../src/main/ipc/validate.ts");

async function loadWith(content: unknown): Promise<StudioSettings> {
  await writeFile(path.join(hoisted.userData, "settings.json"), JSON.stringify(content));
  loadSettings();
  return getSettings();
}

describe("settings.json 的 fontSize", () => {
  beforeAll(async () => {
    hoisted.userData = await mkdtemp(path.join(os.tmpdir(), "omp-studio-settings-"));
  });
  afterAll(async () => {
    await rm(hoisted.userData, { recursive: true, force: true });
  });

  it("合法档位原样保留", async () => {
    for (const size of [12, 14, 15, 18, 22]) expect((await loadWith({ fontSize: size })).fontSize).toBe(size);
  });

  it("缺失、非档位、类型不对的值回落到 15，其它字段不受影响", async () => {
    for (const bad of [undefined, 0, 11, 23, 15.5, 100, -15, "15", null, true, {}, [15], Number.NaN]) {
      const settings = await loadWith({ fontSize: bad, theme: "dark" });
      expect(settings.fontSize).toBe(15);
      expect(settings.theme).toBe("dark");
    }
  });

  it("整个文件不是对象时全部用默认值", async () => {
    expect((await loadWith([18])).fontSize).toBe(15);
  });

  it("IPC 入口校验：只收档位", () => {
    expect(parseFontSize(18)).toBe(18);
    for (const bad of [0, 11, 23, "18", null, undefined, 15.5]) expect(() => parseFontSize(bad)).toThrow();
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySetupWizardDefault, isSetupWizardExplicit } from "../src/main/omp-config/setup-wizard-default.ts";
import { awaitStartupDefaults, registerStartupDefaults } from "../src/main/omp-config/startup-defaults.ts";

describe("isSetupWizardExplicit：只读 agent 目录的 config.yml", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "wizard-default-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const config = (text: string) => writeFile(path.join(dir, "config.yml"), text, "utf8");

  it("没有 config.yml、空文件、没有这个键 → 没设过", async () => {
    expect(await isSetupWizardExplicit(dir)).toBe(false);
    await config("");
    expect(await isSetupWizardExplicit(dir)).toBe(false);
    await config("startup:\n  checkUpdate: false\ngoal:\n  continuationModes: [rpc]\n");
    expect(await isSetupWizardExplicit(dir)).toBe(false);
  });
  it("omp config set 写出的形状（true 或 false）→ 设过", async () => {
    await config("startup:\n  setupWizard: true\n");
    expect(await isSetupWizardExplicit(dir)).toBe(true);
    await config("startup:\n  setupWizard: false\n");
    expect(await isSetupWizardExplicit(dir)).toBe(true);
  });
  it("平铺的键、行内映射 → 设过", async () => {
    await config('"startup.setupWizard": true\n');
    expect(await isSetupWizardExplicit(dir)).toBe(true);
    await config("startup: { setupWizard: true }\n");
    expect(await isSetupWizardExplicit(dir)).toBe(true);
  });
  it("解析不了 → 当作设过，不去碰", async () => {
    await config("startup: [unclosed\n");
    expect(await isSetupWizardExplicit(dir)).toBe(true);
  });
});

describe("applySetupWizardDefault", () => {
  const run = async (explicit: boolean) => {
    let writes = 0;
    const outcome = await applySetupWizardDefault({
      isExplicit: () => Promise.resolve(explicit),
      write: () => {
        writes += 1;
        return Promise.resolve();
      },
    });
    return { outcome, writes };
  };
  it("没设过 → 写一次", async () => {
    expect(await run(false)).toEqual({ outcome: "written", writes: 1 });
  });
  it("设过（包括明确设成 true）→ 什么也不写", async () => {
    expect(await run(true)).toEqual({ outcome: "explicit", writes: 0 });
  });
});

describe("awaitStartupDefaults", () => {
  afterEach(() => vi.useRealTimers());
  it("等到登记的 promise 完成", async () => {
    const gate = Promise.withResolvers<void>();
    registerStartupDefaults(gate.promise);
    let released = false;
    const waiting = awaitStartupDefaults(60_000).then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    gate.resolve();
    await waiting;
    expect(released).toBe(true);
  });
  it("卡住时到上限就放行", async () => {
    vi.useFakeTimers();
    registerStartupDefaults(new Promise<void>(() => undefined));
    const waiting = awaitStartupDefaults(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await waiting;
  });
});

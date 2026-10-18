// 更新服务的状态机和调度：定时、手动检查、下载进度、安装顺序、没配置更新源。
// electron-updater 用假实现，不需要 Electron；时间用假计时器。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "../src/shared/ipc.ts";
import { UpdateService, type Updater, type UpdaterEvents } from "../src/main/update/service.ts";

class FakeUpdater implements Updater {
  autoDownload = false;
  checks = 0;
  checksToFail: Error | null = null;
  installed = false;
  #listeners = new Map<string, ((payload: never) => void)[]>();

  on<K extends keyof UpdaterEvents>(event: K, listener: (payload: UpdaterEvents[K]) => void): unknown {
    const list = this.#listeners.get(event) ?? [];
    list.push(listener as (payload: never) => void);
    this.#listeners.set(event, list);
    return this;
  }

  async checkForUpdates(): Promise<unknown> {
    this.checks += 1;
    if (this.checksToFail !== null) throw this.checksToFail;
    return null;
  }

  quitAndInstall(): void {
    this.installed = true;
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) (listener as (value: unknown) => void)(payload);
  }
}

function createService(options: { enabled?: boolean; prepareInstall?: () => Promise<void> } = {}) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const calls: string[] = [];
  const service = new UpdateService({
    currentVersion: "0.1.0",
    enabled: options.enabled ?? true,
    disabledReason: "no-feed",
    updater,
    emit: (state) => states.push(state),
    prepareInstall: async () => {
      calls.push("prepareInstall");
      await options.prepareInstall?.();
    },
    checkIntervalMs: 60 * 60 * 1000,
    startupDelayMs: 10_000,
    now: () => 1_000_000,
  });
  return { service, updater, states, calls };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("UpdateService", () => {
  it("启动后先等一会儿再检查，之后每小时一次", async () => {
    const { service, updater } = createService();
    service.start();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(updater.checks).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checks).toBe(1);

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(updater.checks).toBe(2);

    service.dispose();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(updater.checks).toBe(2);
  });

  it("发现新版本后进入下载态，事件带进度，下载完可以安装", async () => {
    const { service, updater, calls } = createService();
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("download-progress", { percent: 42.6 });
    expect(service.state().phase).toBe("downloading");
    expect(service.state().percent).toBe(43);
    expect(service.state().latestVersion).toBe("0.2.0");

    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(service.state()).toMatchObject({ phase: "downloaded", percent: 100, latestVersion: "0.2.0" });

    await service.install();
    expect(calls).toEqual(["prepareInstall"]);
    expect(updater.installed).toBe(true);
  });

  it("安装前等退出流程跑完，再交给 electron-updater", async () => {
    const order: string[] = [];
    const { service, updater, calls } = createService({
      prepareInstall: async () => {
        await Promise.resolve();
        order.push("shutdown-done");
      },
    });
    const quit = vi.spyOn(updater, "quitAndInstall").mockImplementation(() => {
      order.push("quitAndInstall");
    });
    updater.emit("update-downloaded", { version: "0.2.0" });

    await service.install();

    expect(calls).toEqual(["prepareInstall"]);
    expect(order).toEqual(["shutdown-done", "quitAndInstall"]);
    expect(quit).toHaveBeenCalledWith(false, true);
  });

  it("没有已下载的更新时安装直接失败，不跑退出流程", async () => {
    const { service, calls, updater } = createService();
    await expect(service.install()).rejects.toThrow("没有已下载的更新");
    expect(calls).toEqual([]);
    expect(updater.installed).toBe(false);
  });

  it("已是最新版本时记下检查时间", async () => {
    const { service, updater } = createService();
    await service.check(true);
    updater.emit("update-not-available", { version: "0.1.0" });
    expect(service.state()).toMatchObject({ phase: "up-to-date", lastCheckedAt: 1_000_000, latestVersion: null });
  });

  it("检查失败进入 error，并通过事件推给界面", async () => {
    const { service, updater, states } = createService();
    updater.checksToFail = new Error("getaddrinfo ENOTFOUND updates.example");
    await service.check(true);
    expect(service.state()).toMatchObject({ phase: "error", error: "getaddrinfo ENOTFOUND updates.example" });
    expect(states.at(-1)?.phase).toBe("error");
  });

  it("electron-updater 发 error 事件时同样进入 error", async () => {
    const { service, updater } = createService();
    await service.check(true);
    updater.emit("error", new Error("sha512 mismatch"));
    expect(service.state()).toMatchObject({ phase: "error", error: "sha512 mismatch", lastCheckedAt: 1_000_000 });
  });

  it("检查中重复触发不会发第二次请求", async () => {
    const { service, updater } = createService();
    const first = service.check(true);
    const second = service.check(true);
    await Promise.all([first, second]);
    expect(updater.checks).toBe(1);
  });

  it("下载中手动检查不会重新开始", async () => {
    const { service, updater } = createService();
    updater.emit("update-available", { version: "0.2.0" });
    await service.check(true);
    expect(updater.checks).toBe(0);
  });

  it("没配置更新源时是 disabled，不启动定时器也不发请求", async () => {
    const { service, updater } = createService({ enabled: false });
    expect(service.state()).toMatchObject({ phase: "disabled", disabledReason: "no-feed" });
    service.start();
    await service.check(true);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(updater.checks).toBe(0);
    service.dispose();
  });
});

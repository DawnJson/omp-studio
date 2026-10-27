import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OmpStatus } from "../src/shared/ipc.ts";
import { UnsupportedOmpLauncherError, type OmpInstall } from "../src/main/omp/discover.ts";
import { OmpManager, type ManagerDeps } from "../src/main/omp-manager/manager.ts";
import { takeoverKey } from "../src/main/omp-manager/takeover-state.ts";

const bytes = randomBytes(100_000);
let server: http.Server;
let baseUrl: string;
let scratch: string;
let counter = 0;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 流程 "));
  server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/")) {
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          build: { version: "18.12.1" },
          file: { name: "omp.exe", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
          download: "/d/omp.exe",
        }),
      );
      return;
    }
    response.writeHead(200, { "content-length": bytes.length }).end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await rm(scratch, { recursive: true, force: true });
});

interface Harness {
  manager: OmpManager;
  statuses: OmpStatus[];
  userPathAdds: string[];
  stateFile: string;
}

/** onPath: PATH 上 omp 的情况；installs 记录每个 exe 的版本和管理者。spawnsReady：启动准备（默认已做完）。 */
function harness(
  onPath: { kind: "none" } | { kind: "script"; path: string } | { kind: "exe"; install: OmpInstall },
  reuseDir?: string,
  spawnsReady: Promise<void> = Promise.resolve(),
): Harness & { lookups: string[] } {
  const dir = reuseDir ?? path.join(scratch, `用例 ${++counter}`);
  const statuses: OmpStatus[] = [];
  const lookups: string[] = [];
  const userPathAdds: string[] = [];
  const userPathEntries: string[] = [];
  const deps: ManagerDeps = {
    root: path.join(dir, "omp"),
    stateFile: path.join(dir, "state.json"),
    fetch: (url, init) => fetch(url, init as RequestInit),
    baseUrl,
    findOnPath: () => {
      lookups.push("PATH");
      if (onPath.kind === "script") throw new UnsupportedOmpLauncherError(onPath.path);
      return Promise.resolve(onPath.kind === "exe" ? onPath.install.path : null);
    },
    inspect: (exePath) =>
      onPath.kind === "exe" && exePath === onPath.install.path
        ? Promise.resolve(onPath.install)
        : Promise.resolve({ path: exePath, version: "18.12.1", manager: { id: "omp-studio", name: "omp-studio" } }),
    userPath: {
      contains: (dir) => userPathEntries.includes(dir),
      addFront: (dir) => {
        userPathAdds.push(dir);
        userPathEntries.push(dir);
      },
    },
    emit: (status) => statuses.push(status),
    runUpdate: () => Promise.resolve({ exitCode: 0, output: "" }),
    spawnsReady: () => {
      lookups.push("gate");
      return spawnsReady;
    },
  };
  return { manager: new OmpManager(deps), statuses, userPathAdds, stateFile: deps.stateFile, lookups };
}

const userExe: OmpInstall = { path: "C:\\Users\\某 人\\omp\\omp.exe", version: "18.8.7", manager: null };
const ternExe: OmpInstall = {
  path: "C:\\Tern\\omp\\bin\\omp.exe",
  version: "18.12.0",
  manager: { id: "tern", name: "Tern" },
};

describe("OmpManager", () => {
  it("does not look for omp or run it before the startup preparation (spawn gate) is done", async () => {
    const gate = Promise.withResolvers<void>();
    const h = harness({ kind: "exe", install: ternExe }, undefined, gate.promise);
    const running = h.manager.start();
    await expect.poll(() => h.lookups).toEqual(["gate"]);
    expect(h.manager.status.state).toBe("discovering");
    gate.resolve();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    expect(h.lookups).toEqual(["gate", "PATH"]);
    await h.manager.answerTakeover(false);
    await running;
  });

  it("asks about a Tern-managed omp; on yes installs its own copy first on the user PATH and leaves Tern's files alone", async () => {
    const h = harness({ kind: "exe", install: ternExe });
    const running = h.manager.start();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    expect(h.manager.status).toMatchObject({ path: ternExe.path, managerName: "Tern", launchable: true });
    await h.manager.answerTakeover(true);
    await running;
    expect(h.manager.status).toMatchObject({
      state: "ready",
      path: h.manager.layout.binExe,
      source: { kind: "studio_managed", onUserPath: true },
    });
    expect(h.userPathAdds).toEqual([h.manager.layout.binDir]);
  });

  it("keeps using Tern's omp as managed by Tern when the takeover is declined: no download, no PATH change", async () => {
    const h = harness({ kind: "exe", install: ternExe });
    const running = h.manager.start();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    await h.manager.answerTakeover(false);
    await running;
    expect(h.manager.status).toMatchObject({
      state: "ready",
      path: ternExe.path,
      source: { kind: "managed_by_other", managerName: "Tern" },
    });
    expect(h.statuses.some((s) => s.state === "installing")).toBe(false);
    expect(h.userPathAdds).toEqual([]);
  });

  it("flags a newer build on a kept (not taken over) omp right after start, without downloading or touching it", async () => {
    const h = harness({ kind: "exe", install: ternExe });
    const running = h.manager.start();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    await h.manager.answerTakeover(false);
    await running;
    await expect.poll(() => h.manager.status).toMatchObject({ state: "ready", availableVersion: "18.12.1" });
    expect(h.manager.status).toMatchObject({ version: "18.12.0", path: ternExe.path });
    expect(h.statuses.some((s) => s.state === "installing")).toBe(false);
    // 手动检查：同样只报有新版本，不下载。
    await expect(h.manager.checkUpdate()).resolves.toEqual({ installedVersion: null, availableVersion: "18.12.1" });
    await h.manager.stop();
  });

  it("waits in `missing` with the build's size and source instead of downloading; the install click downloads and puts bin first on the user PATH without asking again", async () => {
    const h = harness({ kind: "none" });
    await h.manager.start();
    expect(h.manager.status).toEqual({
      state: "missing",
      version: "18.12.1",
      sizeBytes: bytes.length,
      source: new URL(baseUrl).host,
    });
    expect(h.statuses.some((s) => s.state === "installing")).toBe(false);
    expect(h.userPathAdds).toEqual([]);

    await h.manager.installOmp();
    expect(h.statuses.some((s) => s.state === "installing")).toBe(true);
    expect(h.manager.status).toMatchObject({
      state: "ready",
      version: "18.12.1",
      source: { kind: "studio_managed", onUserPath: true },
    });
    expect(h.userPathAdds).toEqual([h.manager.layout.binDir]);
    expect(await readFile(h.manager.layout.binExe)).toEqual(bytes);
  });

  it("asks before taking over a user-installed omp, and on yes installs a copy and puts bin first on the user PATH", async () => {
    const h = harness({ kind: "exe", install: userExe });
    const running = h.manager.start();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    expect(h.manager.status).toMatchObject({ path: userExe.path, version: "18.8.7", launchable: true });
    await h.manager.answerTakeover(true);
    await running;
    expect(h.manager.status).toMatchObject({ state: "ready", source: { kind: "studio_managed", onUserPath: true } });
    expect(h.userPathAdds).toEqual([h.manager.layout.binDir]);
    expect(JSON.parse(await readFile(h.stateFile, "utf8")).takeover).toEqual({
      [takeoverKey(userExe.path)]: "accepted",
    });
  });

  it("keeps the user's omp and the user PATH untouched when the takeover is declined", async () => {
    const h = harness({ kind: "exe", install: userExe });
    const running = h.manager.start();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    await h.manager.answerTakeover(false);
    await running;
    expect(h.manager.status).toMatchObject({
      state: "ready",
      path: userExe.path,
      source: { kind: "user_installed" },
      belowMinimum: true,
    });
    expect(h.userPathAdds).toEqual([]);
  });

  it("reports a declined script launcher as unusable and makes waiting callers fail instead of hang", async () => {
    const h = harness({ kind: "script", path: "C:\\npm\\omp.cmd" });
    const running = h.manager.start();
    const waiting = h.manager.ensureReady();
    const settled = waiting.catch((error: unknown) => error);
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    expect(h.manager.status).toMatchObject({ launchable: false, version: null });
    await h.manager.answerTakeover(false);
    await running;
    expect(h.manager.status).toEqual({ state: "unusable", path: "C:\\npm\\omp.cmd", reason: "script_launcher" });
    expect(await settled).toBeInstanceOf(Error);
  });

  it("refuses omp update on anything but a user-installed omp that was kept", async () => {
    const h = harness({ kind: "exe", install: ternExe });
    const running = h.manager.start();
    await expect.poll(() => h.manager.status.state).toBe("ask_takeover");
    await h.manager.answerTakeover(false);
    await running;
    await expect(h.manager.upgradePathOmp()).rejects.toThrow(/only run for an omp the user installed/);
  });

  it("ensureReady hands managed callers the bin dir to put on the child PATH, others nothing", async () => {
    const managed = harness({ kind: "none" });
    await managed.manager.start();
    await managed.manager.installOmp();
    expect(await managed.manager.ensureReady()).toEqual({
      path: managed.manager.layout.binExe,
      managedBin: managed.manager.layout.binDir,
    });
    const tern = harness({ kind: "exe", install: ternExe });
    const ready = tern.manager.ensureReady();
    await expect.poll(() => tern.manager.status.state).toBe("ask_takeover");
    await tern.manager.answerTakeover(false);
    expect(await ready).toEqual({ path: ternExe.path, managedBin: null });
  });

  it("does not add bin back to the user PATH on a later start after the user removed it; the settings page can add it again", async () => {
    const first = harness({ kind: "exe", install: userExe });
    const running = first.manager.start();
    await expect.poll(() => first.manager.status.state).toBe("ask_takeover");
    await first.manager.answerTakeover(true);
    await running;
    expect(first.userPathAdds).toHaveLength(1);

    // 重启：同一个自管目录和状态文件，但用户已经把 bin 从 PATH 里删了。
    const second = harness({ kind: "exe", install: userExe }, path.dirname(first.stateFile));
    await second.manager.start();
    expect(second.userPathAdds).toEqual([]);
    expect(second.manager.status).toMatchObject({
      state: "ready",
      source: { kind: "studio_managed", onUserPath: false },
    });
    await second.manager.addManagedOmpToPath();
    expect(second.userPathAdds).toEqual([second.manager.layout.binDir]);
  });

  it("runs a single install when the button is clicked twice", async () => {
    const h = harness({ kind: "none" });
    await h.manager.start();
    const a = h.manager.installOmp();
    const b = h.manager.installOmp();
    expect(b).toBe(a);
    await a;
    expect(
      h.statuses.filter((s) => s.state === "installing" && s.receivedBytes === 0 && s.totalBytes === null),
    ).toHaveLength(1);
  });

  it("takes over an update.lock whose owner process is gone, instead of refusing for 30 minutes", async () => {
    const h = harness({ kind: "none" });
    await h.manager.start();
    await mkdir(h.manager.layout.root, { recursive: true });
    await writeFile(path.join(h.manager.layout.root, "update.lock"), "2147483646");
    await h.manager.installOmp();
    expect(h.manager.status.state).toBe("ready");
    expect(await readdir(h.manager.layout.root)).not.toContain("update.lock");
  });

  it("stop() aborts a running download and leaves no update.lock behind", async () => {
    const h = harness({ kind: "none" });
    await h.manager.start();
    const installing = h.manager.installOmp();
    await expect.poll(() => h.statuses.some((s) => s.state === "installing")).toBe(true);
    await h.manager.stop();
    await installing;
    expect(await readdir(h.manager.layout.root).catch(() => [])).not.toContain("update.lock");
  });
});

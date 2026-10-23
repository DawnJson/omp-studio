// 应用内终端登录（src/main/login/terminal-login.ts）：真实的 node-pty，假 omp（test/fake-omp/fake-tsp-omp.ts）回放 omp 18.12.6 的登录录制
// （fixtures/tsp/login-*.jsonl）。验证：登录完成 / 取消 / 失败各自得到什么结果、进程结束路径（结果出来时临时 omp 已经被关掉）、
// 渲染进程传来的 providerId 不可信（不在 omp 的登录 provider 里的一律拒绝、不起进程）、`send` 事件不收。
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TERMINAL_LOGIN_ID, type LoginOutcome, type TspBatch } from "../src/shared/ipc.ts";
import { TerminalLogin, type TerminalLoginDeps } from "../src/main/login/terminal-login.ts";
import { loadTspFixture, tspFixtureDir } from "./tsp-fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const fakeTsp = path.join(root, "test", "fake-omp", "fake-tsp-omp.ts");
const PROVIDERS = ["github-copilot", "perplexity", "lm-studio"];
let scratch: string;
let counter = 0;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio-login-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
});

interface Harness {
  login: TerminalLogin;
  batches: TspBatch[];
  /** launch 被调用的次数（被拒绝的 id 不该起进程）。 */
  launches(): number;
  pidFile: string;
  /** 假 omp 收到的每条 TSP 事件（--log）。 */
  log: string;
}

/** `fixture` 是 fixtures/tsp 里的名字或绝对路径；`overrides.launch` 给了就用它顶替假 omp 的启动方式。 */
function harness(fixture: string, overrides: Partial<TerminalLoginDeps> = {}): Harness {
  counter += 1;
  const pidFile = path.join(scratch, `pid-${counter}.txt`);
  const log = path.join(scratch, `log-${counter}.jsonl`);
  const batches: TspBatch[] = [];
  let launches = 0;
  const login = new TerminalLogin({
    providerIds: () => Promise.resolve(PROVIDERS),
    launch: () => {
      launches += 1;
      return Promise.resolve({
        command: process.execPath,
        args: [fakeTsp, fixture, "--speed=100", `--log=${log}`],
        cwd: scratch,
        env: { ...process.env, FAKE_OMP_PID_FILE: pidFile },
      });
    },
    appVersion: "9.9.9",
    appearance: () => ({ dark: true, reduceMotion: false }),
    onBatch: (batch) => batches.push(batch),
    session: { assignJob: () => () => undefined },
    ...overrides,
  });
  return { login, batches, launches: () => launches, pidFile, log };
}

// 假 omp 在另一个进程里，没有事件可等：只能轮询它的文档快照和 pid 文件（同 tsp-session.test.ts 的 waitForLog）。

async function waitFor<T>(check: () => T | null | undefined | false, what: string, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** 登录窗开着（快照里有 omp.overlay.login 节点）。 */
function overlayOpen(login: TerminalLogin): boolean {
  return login
    .snapshot()
    .document.surfaces.some((surface) =>
      surface.nodes.some((node) => node.k === "overlay" && String(node.p["role"]).startsWith("omp.overlay.login")),
    );
}

function pidsOf(file: string): number[] {
  return existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map(Number)
    : [];
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 点登录窗里的 Continue（录制里用户点的就是它）。 */
function clickContinue(login: TerminalLogin): void {
  login.sendEvent({ ev: "action", sf: "s:1", id: "r.^sheet/0/actions/submit", act: "submit" });
}

describe("TerminalLogin：providerId 不可信", () => {
  it("不在 omp 登录 provider 列表里的 id 被拒绝，也不起进程", async () => {
    const h = harness("login-github-copilot");
    for (const bad of [
      "",
      "nope",
      "github-copilot --model x",
      "../../evil",
      "GITHUB-COPILOT",
      "github-copilot\n/exit",
    ]) {
      await expect(h.login.start(bad), JSON.stringify(bad)).rejects.toThrow("unknown login provider");
    }
    expect(h.launches()).toBe(0);
    expect(pidsOf(h.pidFile)).toEqual([]);
  });

  it("`send` 事件不收：登录窗不需要它，不能让渲染进程把临时 omp 当成会话用；没有登录时任何输入都被拒", async () => {
    const h = harness("login-github-copilot");
    expect(() => h.login.sendEvent({ ev: "action", sf: "s:1", id: "x", act: "cancel" })).toThrow(
      "no terminal login is in progress",
    );
    expect(() => h.login.sendKeys("\x1b")).toThrow("no terminal login is in progress");
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    expect(() => h.login.sendEvent({ ev: "send", sf: "s:1", id: "3.line/input", text: "/exit" })).toThrow(
      "only accepts clicks and input",
    );
    await h.login.cancel();
    await outcome;
  });
});

describe("TerminalLogin：取消和进程结束", () => {
  it("取消：start 以 cancelled 结束，那一刻临时 omp 进程已经没了；录制里的 /login 命令按 provider 发出", async () => {
    const h = harness("login-github-copilot");
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    const [pid] = pidsOf(h.pidFile);
    expect(pid).toBeDefined();
    expect(alive(pid as number)).toBe(true);

    await h.login.cancel();
    expect(await outcome).toEqual({ ok: false, message: "cancelled" });
    expect(alive(pid as number)).toBe(false);
    // 对话框重开拿到的是空文档，序号接在这个进程之后（旧镜像会发现丢帧、重新拉快照）。
    const after = h.login.snapshot();
    expect(after.document.surfaces).toEqual([]);
    expect(after.seq).toBeGreaterThan(
      Math.max(...h.batches.map((batch) => batch.firstSeq + batch.messages.length - 1)),
    );

    const sent = readFileSync(h.log, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { kind: string; verb?: string; body?: Record<string, unknown> });
    expect(sent.find((record) => record.body?.["ev"] === "send")?.body).toMatchObject({
      sf: "s:1",
      id: "3.line/input",
      text: "/login github-copilot",
    });
  });

  it("批次都带登录会话的固定 id，序号连续", async () => {
    const h = harness("login-github-copilot");
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    await h.login.cancel();
    await outcome;
    expect(h.batches.length).toBeGreaterThan(0);
    expect(h.batches.every((batch) => batch.taskId === TERMINAL_LOGIN_ID)).toBe(true);
    let next = h.batches[0]!.firstSeq;
    for (const batch of h.batches) {
      expect(batch.firstSeq).toBe(next);
      next += batch.messages.length;
    }
  });

  it("用户在登录窗点 omp 自己的取消：结果是 cancelled，进程被关", async () => {
    const h = harness("login-github-copilot");
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    const [pid] = pidsOf(h.pidFile);
    clickContinue(h.login);
    // 设备码页出现（录制里 Continue 之后 omp 画出设备码）。
    await waitFor(
      () =>
        h.login
          .snapshot()
          .document.surfaces.some((surface) =>
            surface.nodes.some((node) => node.p["role"] === "omp.login.code" && node.p["href"] === "WDJB-MJHT"),
          ),
      "the device code",
    );
    h.login.sendEvent({ ev: "action", sf: "s:1", id: "r.^sheet/0/actions/cancel", act: "cancel" });
    expect(await outcome).toEqual({ ok: false, message: "cancelled" });
    expect(alive(pid as number)).toBe(false);
  });

  it("新的登录顶掉还没结束的旧登录：旧的以 cancelled 结束、旧进程关掉，新的照常进行", async () => {
    const h = harness("login-github-copilot");
    const first = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the first sign-in window");
    const [oldPid] = pidsOf(h.pidFile);
    // 假 omp 只认录制里的 `/login github-copilot`，所以第二次也用同一个 provider。
    const second = h.login.start("github-copilot");
    expect(await first).toEqual({ ok: false, message: "cancelled" });
    expect(alive(oldPid as number)).toBe(false);
    await waitFor(() => pidsOf(h.pidFile).length === 2 && overlayOpen(h.login), "the second sign-in window");
    await h.login.cancel();
    expect(await second).toEqual({ ok: false, message: "cancelled" });
    for (const pid of pidsOf(h.pidFile)) expect(alive(pid)).toBe(false);
  });

  it("关闭应用（shutdown）和取消一样关进程", async () => {
    const h = harness("login-github-copilot");
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    const [pid] = pidsOf(h.pidFile);
    await h.login.shutdown();
    expect(await outcome).toEqual({ ok: false, message: "cancelled" });
    expect(alive(pid as number)).toBe(false);
  });
});

describe("TerminalLogin：失败和完成", () => {
  it("失败：omp 报 Login failed，原因原样返回，进程被关", async () => {
    const h = harness("login-failed");
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    const [pid] = pidsOf(h.pidFile);
    clickContinue(h.login);
    expect(await outcome).toEqual({
      ok: false,
      message: "ECONNREFUSED: Unable to connect. Is the computer able to access the url?",
    });
    expect(alive(pid as number)).toBe(false);
  });

  it("完成：omp 报 Successfully logged in，结果带 providerId，进程被关（成功帧是照 omp 源码改的，见 tsp-login-flow.test.ts）", async () => {
    const lines = loadTspFixture("login-failed");
    const last = lines.findLast((line) => line.dir === "out" && line.verb === "f");
    if (last?.verb !== "f") throw new Error("the last recorded line should be the result frame");
    const frame = last.body as { ops: unknown[][] };
    frame.ops = frame.ops.map((op) => {
      const node = op[4] as { k?: string; p?: Record<string, unknown> } | undefined;
      return op[0] === "add" && node?.k === "text"
        ? [
            ...op.slice(0, 4),
            {
              ...node,
              p: { wrap: "word", spans: [{ t: "✔ Successfully logged in to github-copilot", s: "success" }] },
            },
          ]
        : op;
    });
    const fixture = path.join(scratch, "login-success.jsonl");
    await writeFile(fixture, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const h = harness(fixture);
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    const [pid] = pidsOf(h.pidFile);
    clickContinue(h.login);
    expect(await outcome).toEqual({ ok: true, providerId: "github-copilot" } satisfies LoginOutcome);
    expect(alive(pid as number)).toBe(false);
  });

  it("omp 在握手前就退出：失败，原因带退出码", async () => {
    const h = harness("login-failed", {
      launch: () =>
        Promise.resolve({
          command: process.execPath,
          args: ["-e", "process.exit(3)"],
          cwd: scratch,
          env: { ...process.env },
        }),
    });
    const outcome = await h.login.start("github-copilot");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.message).toBe("omp exited (3)");
  });

  it("omp 一直不进入 TSP：握手超时算失败，不留进程", async () => {
    const h = harness("login-failed", {
      launch: () =>
        Promise.resolve({
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 60000)"],
          cwd: scratch,
          env: { ...process.env, FAKE_OMP_PID_FILE: path.join(scratch, "hang-pid.txt") },
        }),
      session: { assignJob: () => () => undefined, helloTimeoutMs: 300 },
    });
    const outcome = await h.login.start("github-copilot");
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? "" : outcome.message).toMatch(/did not start the TSP handshake/);
  });

  it("登录窗关了、却没有任何结果文字（omp 措辞变了）：宽限期后算失败，不让对话框空着", async () => {
    // 录制里取消那一帧去掉"Login cancelled"（toast 的 set）：登录窗被删、没有结果。
    const lines = loadTspFixture("login-github-copilot");
    for (const line of lines) {
      const body = line.body as { ops?: unknown[][] };
      if (line.dir === "out" && line.verb === "f" && Array.isArray(body.ops))
        body.ops = body.ops.filter((op) => !(op[0] === "set" && op[1] === "q"));
    }
    const fixture = path.join(scratch, "login-silent-close.jsonl");
    await writeFile(fixture, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const h = harness(fixture, { resultGraceMs: 100 });
    const outcome = h.login.start("github-copilot");
    await waitFor(() => overlayOpen(h.login), "the sign-in window");
    clickContinue(h.login);
    await waitFor(
      () => h.login.snapshot().document.surfaces.some((s) => s.nodes.some((n) => n.p["role"] === "omp.login.code")),
      "the device code",
    );
    h.login.sendEvent({ ev: "action", sf: "s:1", id: "r.^sheet/0/actions/cancel", act: "cancel" });
    expect(await outcome).toEqual({ ok: false, message: "omp closed the sign-in window without reporting a result" });
  });
});

describe("录制本身", () => {
  it("fixtures/tsp 的登录录制里没有真实设备码", () => {
    for (const name of ["login-github-copilot", "login-failed"]) {
      const text = readFileSync(path.join(tspFixtureDir, `${name}.jsonl`), "utf8");
      expect(text).not.toContain("942E-9500");
      expect(text).not.toMatch(/someone|AppData|C:\\\\Users/i);
    }
  });
});

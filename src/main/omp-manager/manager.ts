// omp 管理的状态机：发现 → （问接管）→ （下载）→ ready。决策规则在 resolve.ts，下载和换 exe 在 installer.ts，
// 这里串起来、维护 OmpStatus 并推给渲染进程。所有外部依赖（PATH、注册表、网络、状态文件）都从 deps 传入，
// 应用里的接线在 index.ts，测试用假的。
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { OmpStatus, OmpSource, OmpUpgradeResult } from "../../shared/ipc.ts";
import { UnsupportedOmpLauncherError, type OmpInstall } from "../omp/discover.ts";
import { DEFAULT_BUILD_URL, fetchBuild, type FetchFn } from "./build-service.ts";
import { installBuild, managedLayout, sweepOldBinaries, type ManagedLayout } from "./installer.ts";
import { resolveOmp, type Decision, type PathScan } from "./resolve.ts";
import { readState, writeState, takeoverKey, type OmpStudioState } from "./takeover-state.ts";
import { compareVersions, isBelowMinimum } from "./version.ts";

export interface UserPathAccess {
  contains(dir: string): boolean;
  /** 把 dir 放到用户 PATH 最前面；写之前把原值交给 backup。 */
  addFront(dir: string): void;
}

export interface ManagerDeps {
  /** 自管目录（含 bin、versions、manager.json）。 */
  root: string;
  stateFile: string;
  fetch: FetchFn;
  baseUrl?: string | undefined;
  findOnPath(): Promise<string | null>;
  inspect(exePath: string): Promise<OmpInstall>;
  /** null = 这个平台不改用户 PATH。 */
  userPath: UserPathAccess | null;
  emit(status: OmpStatus): void;
  /** 对 PATH 上的 omp 执行 `omp update`。 */
  runUpdate(exePath: string): Promise<OmpUpgradeResult>;
}

/** 后台更新的检查间隔。 */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const LOCK_STALE_MS = 30 * 60 * 1000;

export class OmpManager {
  readonly #deps: ManagerDeps;
  readonly #layout: ManagedLayout;
  #status: OmpStatus = { state: "discovering" };
  #running: Promise<void> | null = null;
  #takeoverAnswer: PromiseWithResolvers<boolean> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #waiters: PromiseWithResolvers<void>[] = [];
  #lastProgressAt = 0;
  #started = false;
  #installing: Promise<void> | null = null;
  #consentPathNow = false;
  #abort: AbortController | null = null;
  /** 本次运行里后台更新装上的版本（给 stagedUpdate）。 */
  #stagedUpdate: string | null = null;

  constructor(deps: ManagerDeps) {
    this.#deps = deps;
    this.#layout = managedLayout(deps.root);
  }

  get status(): OmpStatus {
    return this.#status;
  }

  get layout(): ManagedLayout {
    return this.#layout;
  }

  #set(status: OmpStatus): void {
    this.#status = status;
    this.#deps.emit(status);
    if (status.state === "ready") this.#settleWaiters(null);
    else if (status.state === "error" || status.state === "unusable") this.#settleWaiters(new Error(status.state === "error" ? status.message : "omp on PATH is a script launcher that omp-studio cannot start"));
  }

  #settleWaiters(error: Error | null): void {
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  /** 启动（或重试）发现流程。同一时间只跑一个；重复调用返回同一个 promise。 */
  start(): Promise<void> {
    this.#started = true;
    this.#running ??= this.#run().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  /** 第一次调用时启动发现流程，之后什么都不做（getOmpStatus、ensureReady 都从这里进）。 */
  startOnce(): void {
    if (!this.#started) void this.start();
  }

  /** 等到有可用的 omp：ready 时返回可执行文件路径，出错或用户拒绝后不可用时 reject。询问接管、下载期间一直等。 */
  async ensureReady(): Promise<{ path: string; managedBin: string | null }> {
    this.startOnce();
    const current = this.#status;
    if (current.state === "error") throw new Error(current.message);
    if (current.state === "unusable") throw new Error("omp on PATH is a script launcher that omp-studio cannot start");
    if (current.state !== "ready") {
      const waiter = Promise.withResolvers<void>();
      this.#waiters.push(waiter);
      await waiter.promise;
    }
    const status = this.#status;
    if (status.state !== "ready") throw new Error("omp is not ready");
    return { path: status.path, managedBin: status.source.kind === "studio_managed" ? this.#layout.binDir : null };
  }

  async #run(): Promise<void> {
    this.#set({ state: "discovering" });
    try {
      await sweepOldBinaries(this.#layout);
      const scan = await this.#scan();
      const managed = await this.#inspectManaged();
      const state = await readState(this.#deps.stateFile);
      await this.#apply(resolveOmp({ scan, managed, state }), managed, state);
    } catch (error) {
      this.#fail("discover", error);
    }
  }

  async #scan(): Promise<PathScan> {
    let found: string | null;
    try {
      found = await this.#deps.findOnPath();
    } catch (error) {
      if (error instanceof UnsupportedOmpLauncherError) return { kind: "script", path: error.path };
      throw error;
    }
    return found === null ? { kind: "none" } : { kind: "exe", install: await this.#deps.inspect(found) };
  }

  /** 自管副本的 bin/omp.exe。没装过是 null；装坏了（跑不起来）也按没装处理，之后会重新下载覆盖它。 */
  async #inspectManaged(): Promise<OmpInstall | null> {
    if (!(await stat(this.#layout.binExe).then((s) => s.isFile(), () => false))) return null;
    return this.#deps.inspect(this.#layout.binExe).catch(() => null);
  }

  #fail(stage: "discover" | "download" | "verify" | "install" | "path", error: unknown): void {
    this.#set({ state: "error", stage, message: error instanceof Error ? error.message : String(error) });
  }

  async #apply(decision: Decision, managed: OmpInstall | null, state: OmpStudioState): Promise<void> {
    switch (decision.action) {
      case "use":
        this.#ready(decision.path, decision.version, decision.source);
        break;
      case "unusable":
        this.#set({ state: "unusable", path: decision.path, reason: "script_launcher" });
        break;
      case "ask_takeover": {
        this.#set({ state: "ask_takeover", path: decision.path, version: decision.version, launchable: decision.launchable });
        this.#takeoverAnswer = Promise.withResolvers<boolean>();
        const accepted = await this.#takeoverAnswer.promise;
        this.#takeoverAnswer = null;
        state.takeover[takeoverKey(decision.path)] = accepted ? "accepted" : "declined";
        this.#consentPathNow = accepted;
        await writeState(this.#deps.stateFile, state);
        // 回答记下后重新决定：同意 → 自管；拒绝 → 用用户那份，脚本形式则 unusable。
        await this.#apply(resolveOmp({ scan: await this.#scan(), managed, state }), managed, state);
        break;
      }
      case "use_managed":
        await this.#useManaged(decision.reason, managed, state);
        break;
    }
  }

  async #useManaged(reason: "missing" | "takeover", managed: OmpInstall | null, state: OmpStudioState, downloadConfirmed = false): Promise<void> {
    let install = managed;
    if (install === null) {
      // PATH 上没有 omp：下载 220 MB 要用户点了才开始（spec 4.22 状态 E）。用户同意过接管则已经是授权。
      if (reason === "missing" && !downloadConfirmed) {
        await this.#setMissing();
        return;
      }
      install = await this.#downloadAndInstall();
      if (install === null) return;
    }
    const { userPath } = this.#deps;
    // 照 Tern 做管理者：用户点了"下载并安装"或同意接管的这一次，直接把 bin 放到用户 PATH 最前面，不再另问。
    // 之后启动发现 bin 被移走就不再悄悄加回：onUserPath 为 false，设置 → omp 页提供"加入 PATH"按钮（addManagedOmpToPath）。
    if ((this.#consentPathNow || downloadConfirmed) && userPath) {
      try {
        userPath.addFront(this.#layout.binDir);
      } catch (error) {
        this.#fail("path", error);
        return;
      } finally {
        this.#consentPathNow = false;
      }
    }
    this.#ready(install.path, install.version, { kind: "studio_managed", onUserPath: userPath?.contains(this.#layout.binDir) ?? false });
  }

  /** 状态 missing：向构建服务问一下版本和大小给界面写上；问不到也照样等用户点按钮（大小显示为未知）。 */
  async #setMissing(): Promise<void> {
    const source = new URL(this.#deps.baseUrl ?? DEFAULT_BUILD_URL).host;
    const build = await fetchBuild({ fetch: this.#deps.fetch, baseUrl: this.#deps.baseUrl }).catch(() => null);
    this.#set({ state: "missing", version: build?.version ?? null, sizeBytes: build?.file.size ?? null, source });
  }

  /** 用户点了"下载并安装"。连点复用正在进行的那次。 */
  installOmp(): Promise<void> {
    if (this.#installing) return this.#installing;
    if (this.#status.state !== "missing") return Promise.reject(new Error("omp is not waiting to be installed"));
    const run = readState(this.#deps.stateFile)
      .then((state) => this.#useManaged("missing", null, state, true))
      .finally(() => {
        this.#installing = null;
      });
    this.#installing = run;
    return run;
  }

  /** 取消下载，回到 missing。没有在下载时什么都不做。 */
  cancelInstall(): void {
    this.#abort?.abort();
  }

  /** 下载安装最新版。失败时设置 error 状态并返回 null；用户取消时回到 missing 并返回 null。 */
  async #downloadAndInstall(): Promise<OmpInstall | null> {
    this.#set({ state: "installing", version: null, receivedBytes: 0, totalBytes: null });
    const abort = new AbortController();
    this.#abort = abort;
    try {
      const build = await fetchBuild({ fetch: this.#deps.fetch, baseUrl: this.#deps.baseUrl, signal: abort.signal });
      this.#set({ state: "installing", version: build.version, receivedBytes: 0, totalBytes: build.file.size });
      await this.#withLock(() =>
        installBuild(this.#layout, {
          fetch: this.#deps.fetch,
          build,
          signal: abort.signal,
          onProgress: (receivedBytes, totalBytes) => {
            const now = Date.now();
            if (now - this.#lastProgressAt < 100 && receivedBytes < totalBytes) return;
            this.#lastProgressAt = now;
            this.#set({ state: "installing", version: build.version, receivedBytes, totalBytes });
          },
        }),
      );
      return await this.#deps.inspect(this.#layout.binExe);
    } catch (error) {
      if (abort.signal.aborted) {
        await this.#setMissing();
        return null;
      }
      this.#fail(error instanceof Error && error.name === "VerifyError" ? "verify" : error instanceof Error && error.name === "BuildServiceError" ? "download" : "install", error);
      return null;
    } finally {
      this.#abort = null;
    }
  }

  #ready(exePath: string, version: string, source: OmpSource): void {
    this.#set({ state: "ready", source, path: exePath, version, belowMinimum: isBelowMinimum(version), stagedUpdate: this.#stagedUpdate });
    if (source.kind === "studio_managed") this.#startAutoUpdate();
  }

  /** `omp update` 之后、PATH 变化之后重新读一次状态。 */
  async #refreshReady(patch: (status: Extract<OmpStatus, { state: "ready" }>) => OmpStatus): Promise<void> {
    if (this.#status.state === "ready") this.#set(patch(this.#status));
  }

  async answerTakeover(accept: boolean): Promise<void> {
    if (!this.#takeoverAnswer) throw new Error("omp-studio is not asking about taking over omp");
    this.#takeoverAnswer.resolve(accept);
    // start() 的 promise 在回答后继续跑；这里等它走完，下载失败等也能在返回前体现在 status 里。
    await this.#running;
  }

  /** 设置 → omp：自管 omp 的 bin 不在用户 PATH 上（比如用户手动删了）时，再放回最前面。 */
  async addManagedOmpToPath(): Promise<void> {
    const status = this.#status;
    if (status.state !== "ready" || status.source.kind !== "studio_managed") throw new Error("only the omp that omp-studio manages can be added to the user PATH");
    if (!this.#deps.userPath) throw new Error("this platform does not support editing the user PATH");
    this.#deps.userPath.addFront(this.#layout.binDir);
    await this.#refreshReady((current) => ({ ...current, source: { kind: "studio_managed", onUserPath: true } }));
  }

  /** 出错后重新跑发现流程；unusable（拒绝了脚本形式的接管）时忘掉那次拒绝，让用户重新选择。 */
  async retry(): Promise<void> {
    const status = this.#status;
    if (status.state === "installing" || status.state === "discovering" || status.state === "ask_takeover") return this.#running ?? undefined;
    if (status.state === "unusable") {
      const state = await readState(this.#deps.stateFile);
      delete state.takeover[takeoverKey(status.path)];
      await writeState(this.#deps.stateFile, state);
    }
    return this.start();
  }

  /** 对 PATH 上用户自装（拒绝了接管）的 omp 执行 `omp update`，之后重新读版本。 */
  async upgradePathOmp(): Promise<OmpUpgradeResult> {
    const status = this.#status;
    if (status.state !== "ready" || status.source.kind !== "user_installed") throw new Error("omp update is only run for an omp the user installed and kept");
    const result = await this.#deps.runUpdate(status.path);
    const install = await this.#deps.inspect(status.path);
    await this.#refreshReady((current) => ({ ...current, version: install.version, belowMinimum: isBelowMinimum(install.version) }));
    return result;
  }

  /** 自管时向构建服务查一次；有新版就下载、校验、换 bin/omp.exe。返回装上的版本，已最新返回 null。 */
  async checkUpdate(): Promise<string | null> {
    const status = this.#status;
    if (status.state !== "ready" || status.source.kind !== "studio_managed") throw new Error("only the omp that omp-studio manages is updated by omp-studio");
    const build = await fetchBuild({ fetch: this.#deps.fetch, baseUrl: this.#deps.baseUrl });
    if (compareVersions(build.version, status.version) <= 0) return null;
    // 后台下载不切到 installing（那会把界面换成准备页），做完直接把 ready 的版本换掉。
    await this.#withLock(() => installBuild(this.#layout, { fetch: this.#deps.fetch, build }));
    const install = await this.#deps.inspect(this.#layout.binExe);
    this.#stagedUpdate = install.version;
    await this.#refreshReady((current) => ({ ...current, version: install.version, belowMinimum: isBelowMinimum(install.version), stagedUpdate: install.version }));
    return install.version;
  }

  #startAutoUpdate(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      // 后台检查失败不打断用户，下个小时再试；手动"检查更新"会把错误显示出来。
      this.checkUpdate().catch((error: unknown) => console.warn("omp background update check failed", error instanceof Error ? error.message : error));
    }, UPDATE_INTERVAL_MS);
    this.#timer.unref();
  }

  /** 退出时调用：停定时器，取消进行中的下载并等它清理完（释放 update.lock）。 */
  async stop(): Promise<void> {
    clearInterval(this.#timer ?? undefined);
    this.#timer = null;
    this.#abort?.abort();
    await this.#installing?.catch(() => {});
  }

  /** `<root>/update.lock`：open("wx") 独占，内容是持有者的 pid。持有者进程已经不在（崩溃、强杀）就直接接管；超过 30 分钟的也当残留清掉。 */
  async #withLock<T>(job: () => Promise<T>): Promise<T> {
    await mkdir(this.#layout.root, { recursive: true });
    const lock = path.join(this.#layout.root, "update.lock");
    const acquire = async () => {
      const opened = await open(lock, "wx");
      await opened.writeFile(String(process.pid));
      return opened;
    };
    let handle;
    try {
      handle = await acquire();
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const owner = Number.parseInt(await readFile(lock, "utf8").catch(() => ""), 10);
      const age = Date.now() - (await stat(lock)).mtimeMs;
      const alive = Number.isInteger(owner) && owner > 0 && isProcessAlive(owner);
      if (alive && age < LOCK_STALE_MS) throw new Error("another omp-studio is updating omp right now");
      await rm(lock, { force: true });
      handle = await acquire();
    }
    try {
      return await job();
    } finally {
      await handle.close();
      await rm(lock, { force: true });
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM：进程在，只是没权限发信号。
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

/** 对 PATH 上的 omp 执行 `omp update`（不用 shell），输出原样返回。 */
export function runOmpUpdate(exePath: string): Promise<OmpUpgradeResult> {
  const { promise, resolve } = Promise.withResolvers<OmpUpgradeResult>();
  execFile(exePath, ["update"], { timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
    const output = `${stdout}${stderr}`.trim();
    if (!error) resolve({ exitCode: 0, output });
    else resolve({ exitCode: typeof error.code === "number" ? error.code : null, output: output || error.message });
  });
  return promise;
}

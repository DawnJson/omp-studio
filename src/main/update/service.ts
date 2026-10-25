// omp-studio 自身的更新服务：检查（启动后延迟、每小时、手动）、下载进度、安装。
// 这里只做状态机和时间调度；electron-updater 通过 Updater 接口注入，测试用假实现（不需要 Electron）。
import type { UpdateState } from "../../shared/ipc.ts";

export interface UpdaterEvents {
  "checking-for-update": void;
  "update-available": { version: string };
  "update-not-available": { version: string };
  "download-progress": { percent: number };
  "update-downloaded": { version: string };
  error: Error;
}

export interface Updater {
  autoDownload: boolean;
  on<K extends keyof UpdaterEvents>(event: K, listener: (payload: UpdaterEvents[K]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  /** 是否启用更新；开发版和没配置更新源时为 false。 */
  enabled: boolean;
  /** enabled 为 false 时给界面的原因。 */
  disabledReason: "not-packaged" | "no-feed" | "manual-only";
  updater: Updater;
  /** 把状态推给界面。 */
  emit: (state: UpdateState) => void;
  /** 安装前跑退出流程（关掉 omp 子进程）。 */
  prepareInstall: () => Promise<void>;
  checkIntervalMs?: number;
  startupDelayMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}

const HOUR = 60 * 60 * 1000;

export class UpdateService {
  #state: UpdateState;
  #options: UpdateServiceOptions;
  #updater: Updater;
  #timer: NodeJS.Timeout | undefined;
  #startupTimer: NodeJS.Timeout | undefined;
  #installing = false;

  constructor(options: UpdateServiceOptions) {
    this.#options = options;
    this.#updater = options.updater;
    this.#state = {
      currentVersion: options.currentVersion,
      latestVersion: null,
      phase: options.enabled ? "idle" : "disabled",
      percent: 0,
      lastCheckedAt: null,
      error: null,
      disabledReason: options.enabled ? null : options.disabledReason,
    };
    if (!options.enabled) return;
    this.#updater.autoDownload = true;
    this.#updater.on("checking-for-update", () => this.#set({ phase: "checking", error: null }));
    this.#updater.on("update-available", (info) =>
      this.#set({ phase: "downloading", latestVersion: info.version, percent: 0, error: null }),
    );
    this.#updater.on("update-not-available", () =>
      this.#set({
        phase: "up-to-date",
        latestVersion: null,
        percent: 0,
        lastCheckedAt: this.#options.now?.() ?? Date.now(),
      }),
    );
    this.#updater.on("download-progress", (progress) => {
      // 有些版本在 update-available 之前就发进度；照样进入下载态。
      this.#set({ phase: "downloading", percent: clampPercent(progress.percent) });
    });
    this.#updater.on("update-downloaded", (info) =>
      this.#set({
        phase: "downloaded",
        latestVersion: info.version,
        percent: 100,
        lastCheckedAt: this.#options.now?.() ?? Date.now(),
      }),
    );
    this.#updater.on("error", (error) =>
      this.#set({ phase: "error", error: error.message, lastCheckedAt: this.#options.now?.() ?? Date.now() }),
    );
  }

  state(): UpdateState {
    return this.#state;
  }

  /** 启动定时检查：先等 startupDelayMs，之后每 checkIntervalMs 一次。不立即检查，免得和启动抢资源。 */
  start(): void {
    if (!this.#options.enabled || this.#timer !== undefined || this.#startupTimer !== undefined) return;
    const delay = this.#options.startupDelayMs ?? 10_000;
    this.#startupTimer = setTimeout(() => {
      this.#startupTimer = undefined;
      void this.check(false);
    }, delay);
    this.#timer = setInterval(() => void this.check(false), this.#options.checkIntervalMs ?? HOUR);
  }

  /**
   * 检查一次。手动检查在已下载或下载中时直接返回，避免重下。
   * 返回时只保证请求已发出；后续状态由 electron-updater 的事件驱动。
   */
  async check(manual: boolean): Promise<void> {
    if (!this.#options.enabled || this.#installing) return;
    if (this.#state.phase === "checking" || this.#state.phase === "downloading") return;
    if (manual && this.#state.phase === "downloaded") return;
    this.#set({ phase: "checking", error: null });
    try {
      await this.#updater.checkForUpdates();
      // 极少数情况下 checkForUpdates 不带任何事件就结束了（例如更新器判定不活跃）；
      // 停在进行中会让按钮一直不可用、定时检查也一直被挡住。
      if (this.state().phase === "checking")
        this.#set({ phase: "idle", lastCheckedAt: this.#options.now?.() ?? Date.now() });
    } catch (error) {
      // electron-updater 对网络错误通常同时发 error 事件；这里兜住没有事件的那种（如没配置更新源）。
      if (this.state().phase === "checking") {
        this.#set({
          phase: "error",
          error: error instanceof Error ? error.message : String(error),
          lastCheckedAt: this.#options.now?.() ?? Date.now(),
        });
      }
    }
  }

  /** 安装已下载的更新；必须等退出流程把 omp 关干净再交给 electron-updater。 */
  async install(): Promise<void> {
    if (this.#installing || this.#state.phase !== "downloaded") throw new Error("没有已下载的更新");
    this.#installing = true;
    this.dispose();
    await this.#options.prepareInstall();
    // 静默（/S）+ 装完重启（--force-run）：安装器是向导式的，不静默会把欢迎页、进度页、完成页都弹出来等用户点。
    this.#updater.quitAndInstall(true, true);
  }

  dispose(): void {
    clearInterval(this.#timer);
    clearTimeout(this.#startupTimer);
    this.#timer = undefined;
    this.#startupTimer = undefined;
  }

  #set(patch: Partial<UpdateState>): void {
    this.#state = { ...this.#state, ...patch };
    this.#options.log?.(`update: ${this.#state.phase}${this.#state.error === null ? "" : ` (${this.#state.error})`}`);
    this.#options.emit(this.#state);
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

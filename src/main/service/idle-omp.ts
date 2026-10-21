// 一个按需启动、空闲后关闭的 `omp --mode rpc-ui --no-session` 进程：服务进程（service-omp.ts）和项目目录里的短命进程
// （project-omp.ts）共用。进程放进应用的 Job Object（Runtime 的约定），所有退出路径都经 close()。
// 不依赖 electron：cwd、启动参数、Job 都由调用方注入，单元测试可以直接用 fake omp。
import { OmpConnection, type OmpLaunch } from "../omp/omp-connection.ts";

export interface IdleOmpOptions {
  /** 启动前取 cwd（可以做 mkdir 之类的准备）。 */
  cwd: () => Promise<string>;
  /** 按 cwd 组启动参数（`noSession: true`）。 */
  launch: (cwd: string) => Promise<OmpLaunch>;
  /** 把进程放进 Job Object；放不进去会抛，进程随即被关掉。 */
  assignJob: (pid: number | undefined) => void;
  /** 没有操作在做之后多久关。 */
  idleCloseMs: number;
}

export class IdleOmp {
  readonly #options: IdleOmpOptions;
  /** 启动中或已就绪的连接。 */
  #pending: Promise<OmpConnection> | null = null;
  /** 已 spawn 的连接（退出时据此判断是不是当前这个）。 */
  #live: OmpConnection | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 正在进行的操作数（做事期间不能因空闲被关）。 */
  #busy = 0;
  /** close() 每调用一次加一：启动到一半时被关掉的进程据此自己收尾。 */
  #generation = 0;
  /** 空闲计时到点、进程真的被关掉时回调（池据此丢掉这个条目）。 */
  onIdleClosed: (() => void) | null = null;

  constructor(options: IdleOmpOptions) {
    this.#options = options;
  }

  /** 是否有进程在跑、启动中或有操作在做。 */
  get active(): boolean {
    return this.#pending !== null || this.#busy > 0;
  }

  async #start(): Promise<OmpConnection> {
    const generation = this.#generation;
    const cwd = await this.#options.cwd();
    const launch = await this.#options.launch(cwd);
    // 启动准备期间已经 close()（退出、取消登录）：不再起进程。
    if (generation !== this.#generation) throw new Error("the omp process was closed while starting");
    const connection = OmpConnection.spawn(launch);
    try {
      // 同一个同步段里放进 Job Object：主进程被强杀时由系统回收。
      this.#options.assignJob(connection.pid);
    } catch (error) {
      // 放不进 Job：这个进程没有兜底，不留着它。
      await connection.close(1_000);
      throw error;
    }
    this.#live = connection;
    void connection.exited.then(() => {
      if (this.#live === connection) {
        this.#live = null;
        this.#pending = null;
      }
    });
    try {
      await connection.ready;
    } catch (error) {
      await connection.close(1_000);
      throw error;
    }
    if (generation !== this.#generation) {
      await connection.close(1_000);
      throw new Error("the omp process was closed while starting");
    }
    return connection;
  }

  /** 在进程上做一件事；进程没起就先起。做完重新计空闲。 */
  async use<T>(job: (connection: OmpConnection) => Promise<T>): Promise<T> {
    clearTimeout(this.#idleTimer ?? undefined);
    this.#busy++;
    try {
      const pending = (this.#pending ??= this.#start());
      let connection: OmpConnection;
      try {
        connection = await pending;
      } catch (error) {
        // 启动失败：下次重新起，不留一个失败的 promise。
        if (this.#pending === pending) this.#pending = null;
        throw error;
      }
      return await job(connection);
    } finally {
      this.#busy--;
      if (this.#busy === 0) {
        this.#idleTimer = setTimeout(() => {
          void this.close().then(() => this.onIdleClosed?.());
        }, this.#options.idleCloseMs);
        this.#idleTimer.unref();
      }
    }
  }

  /** 关掉进程（应用退出、空闲回收）。 */
  async close(): Promise<void> {
    clearTimeout(this.#idleTimer ?? undefined);
    this.#generation++;
    const live = this.#live;
    this.#live = null;
    this.#pending = null;
    await live?.close(3_000);
  }
}

// 服务进程：登录、列 provider、设置页列模型这类不属于任何任务的操作用的 omp（arch.md 2.5）。
// `omp --mode rpc-ui --no-session`，cwd 是 userData/service/，按需启动，空闲 5 分钟关掉。
import { app } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { buildOmpLaunch } from "../omp/launch.ts";
import { OmpConnection } from "../omp/omp-connection.ts";
import { assignToAppJob } from "../platform/win32/job-object.ts";

const IDLE_CLOSE_MS = 5 * 60 * 1000;

class ServiceOmp {
  /** 启动中或已就绪的连接。 */
  #pending: Promise<OmpConnection> | null = null;
  /** 已 spawn 的连接（退出时据此判断是不是当前这个）。 */
  #live: OmpConnection | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 正在进行的操作数（登录期间不能因空闲被关）。 */
  #busy = 0;
  /** close() 每调用一次加一：启动到一半时被关掉的进程据此自己收尾。 */
  #generation = 0;

  async #start(): Promise<OmpConnection> {
    const generation = this.#generation;
    const cwd = path.join(app.getPath("userData"), "service");
    await mkdir(cwd, { recursive: true });
    const launch = await buildOmpLaunch({ cwd, noSession: true });
    // 启动准备期间已经 close()（退出、取消登录）：不再起进程。
    if (generation !== this.#generation) throw new Error("the service process was closed while starting");
    const connection = OmpConnection.spawn(launch);
    try {
      // 同一个同步段里放进 Job Object（Runtime 的约定）：主进程被强杀时由系统回收。
      assignToAppJob(connection.pid);
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
      throw new Error("the service process was closed while starting");
    }
    return connection;
  }

  /** 在服务进程上做一件事；进程没起就先起。做完重新计 5 分钟空闲。 */
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
        this.#idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
        this.#idleTimer.unref();
      }
    }
  }

  /** 关掉服务进程（应用退出、取消卡住的登录、空闲回收）。 */
  async close(): Promise<void> {
    clearTimeout(this.#idleTimer ?? undefined);
    this.#generation++;
    const live = this.#live;
    this.#live = null;
    this.#pending = null;
    await live?.close(3_000);
  }
}

export const serviceOmp = new ServiceOmp();

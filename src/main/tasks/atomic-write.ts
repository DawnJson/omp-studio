// 原子写文件：先写临时文件再改名。
// Windows 上 rename 覆盖一个刚被读过/写过的文件，会因杀毒软件、索引服务短暂持有句柄而失败（EPERM/EBUSY/EACCES），
// 几十毫秒后就能成功；这是 Windows 文件系统的已知行为，不是调用方的错误，所以只对这三个错误码做有限次重试。
// 其它错误（ENOENT、磁盘满…）立即抛出。自己写临时文件的地方（要设文件权限、同步写）用 renameWithRetry / renameWithRetrySync。
import { renameSync, rmSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
export const RENAME_ATTEMPTS = 8;
const RENAME_BACKOFF_MS = 25;

export interface AtomicWriteOps {
  rename(from: string, to: string): Promise<void>;
  /** 测试注入；默认真实等待。 */
  sleep(ms: number): Promise<void>;
}

const realOps: AtomicWriteOps = {
  rename,
  sleep: (ms) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  },
};

function isTransient(error: unknown): boolean {
  return error instanceof Error && "code" in error && TRANSIENT_CODES.has(String(error.code));
}

/** 把临时文件改名成目标文件，遇到 Windows 的短暂占用重试；最终失败时删掉临时文件再抛出。 */
export async function renameWithRetry(temp: string, file: string, ops: AtomicWriteOps = realOps): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await ops.rename(temp, file);
      return;
    } catch (error) {
      if (!isTransient(error) || attempt >= RENAME_ATTEMPTS) {
        await rm(temp, { force: true });
        throw error;
      }
      await ops.sleep(RENAME_BACKOFF_MS * attempt);
    }
  }
}

/** 同步版（设置这类在 IPC 里同步保存的小文件）：重试间隔用 Atomics.wait 阻塞等待，通常第一次重试就成功。 */
export function renameWithRetrySync(temp: string, file: string): void {
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(temp, file);
      return;
    } catch (error) {
      if (!isTransient(error) || attempt >= RENAME_ATTEMPTS) {
        rmSync(temp, { force: true });
        throw error;
      }
      Atomics.wait(pause, 0, 0, RENAME_BACKOFF_MS * attempt);
    }
  }
}

export async function writeFileAtomic(
  file: string,
  content: string,
  tempSuffix: string,
  ops: AtomicWriteOps = realOps,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${tempSuffix}.tmp`;
  await writeFile(temp, content, "utf8");
  await renameWithRetry(temp, file, ops);
}

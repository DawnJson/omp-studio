// 原子写文件：先写临时文件再改名。
// Windows 上 rename 覆盖一个刚被读过/写过的文件，会因杀毒软件、索引服务短暂持有句柄而失败（EPERM/EBUSY/EACCES），
// 几十毫秒后就能成功；这是 Windows 文件系统的已知行为，不是调用方的错误，所以只对这三个错误码做有限次重试。
// 其它错误（ENOENT、磁盘满…）立即抛出。
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

export async function writeFileAtomic(
  file: string,
  content: string,
  tempSuffix: string,
  ops: AtomicWriteOps = realOps,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${tempSuffix}.tmp`;
  await writeFile(temp, content, "utf8");
  for (let attempt = 1; ; attempt++) {
    try {
      await ops.rename(temp, file);
      return;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (!TRANSIENT_CODES.has(code) || attempt >= RENAME_ATTEMPTS) {
        await rm(temp, { force: true });
        throw error;
      }
      await ops.sleep(RENAME_BACKOFF_MS * attempt);
    }
  }
}

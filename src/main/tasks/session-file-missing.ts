// 会话文件"确实不在了"的判定：任务对账（TaskPool.pruneMissingSessions）、起进程前（TspRunner 的 session_missing）、
// `/delete` 之后确认删掉（TspCommands.deleteSession）共用。只认 ENOENT / ENOTDIR；权限、被占用这类错误不算不在。
import { stat } from "node:fs/promises";

/** stat 报的错是"路径不在"（ENOENT，或路径中间某一级不是目录 ENOTDIR）。 */
export function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** 会话文件确实不在；文件在、或读不了（EPERM、EBUSY…）都是 false。 */
export async function sessionFileMissing(file: string): Promise<boolean> {
  try {
    await stat(file);
    return false;
  } catch (error) {
    return isMissingFileError(error);
  }
}

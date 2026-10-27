// 结束一个进程和它的所有后代（node-pty / child.kill() 只关根进程）：Windows 见 win32/process-tree.ts，其他平台见 posix/process-tree.ts。
import { killPosixProcessTree } from "./posix/process-tree.ts";
import { killWin32ProcessTree } from "./win32/process-tree.ts";

/** 结束 pid 和它的所有后代；结束后 resolve，永不 reject。 */
export function killProcessTree(pid: number): Promise<void> {
  return process.platform === "win32" ? killWin32ProcessTree(pid) : killPosixProcessTree(pid);
}

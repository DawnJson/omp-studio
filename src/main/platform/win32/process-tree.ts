// Windows 上结束一个进程和它的所有后代：`taskkill /T /F`。POSIX 的对应实现见 posix/process-tree.ts。
import { execFile } from "node:child_process";
import path from "node:path";

/**
 * 结束 root 和它的所有后代，taskkill 结束（或超时）后 resolve，永不 reject。
 * taskkill 用绝对路径：不带路径时 Windows 会先在当前目录里找。进程已经自己退出时命令会失败，忽略即可。
 */
export function killWin32ProcessTree(root: number): Promise<void> {
  const taskkill = path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
  const done = Promise.withResolvers<void>();
  execFile(taskkill, ["/T", "/F", "/PID", String(root)], { windowsHide: true, timeout: 5000 }, () => done.resolve());
  return done.promise;
}

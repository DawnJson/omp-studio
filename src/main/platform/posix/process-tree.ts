// POSIX（macOS / Linux）上结束一个进程和它的所有后代，对应 Windows 的 `taskkill /T /F`。
// `ps -A -o pid=,ppid=,pgid=` 的输出格式按 BSD ps 的文档写，procps（Linux）同样支持；解析和后代计算是纯函数，有单测。
// 见 docs/architecture/terminal.md "POSIX（macOS / Linux）的进程结束和看门狗"。
import { execFile } from "node:child_process";
import { log } from "../../log/log.ts";

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
}

/** 解析 `ps -A -o pid=,ppid=,pgid=` 的输出：每行三个整数，前后和中间的空白数量不定；空行和对不上格式的行跳过。 */
export function parsePsTable(output: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (match === null) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]) });
  }
  return rows;
}

/**
 * root 要结束的全部进程：root 自己、按父子关系的所有后代、以及 root 开的进程组（pgid === root）里的其余成员
 * （父进程先死的孙进程被 launchd 收养，按父子关系找不到，但还留在原来的组里）。
 * root 自己不在表里（已经退出）时同样成立：组还有成员的话它们还会被找到。
 * root 不是组长时不碰它所在的组：那可能是 Electron 自己的组，整组杀掉会杀到主进程。
 * pid ≤ 1 和 `selfPid` 永远不会出现在结果里；root 是 ≤ 1 或 selfPid 时什么也不杀。
 */
export function collectTreePids(rows: readonly ProcessRow[], root: number, selfPid: number = process.pid): number[] {
  if (root <= 1 || root === selfPid) return [];
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const siblings = children.get(row.ppid);
    if (siblings) siblings.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const found = new Set<number>();
  const addWithDescendants = (start: number): void => {
    const queue = [start];
    for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
      if (found.has(next)) continue;
      found.add(next);
      queue.push(...(children.get(next) ?? []));
    }
  };
  addWithDescendants(root);
  // pgid === root 的进程都在 root 开的组里（组 id 等于组长的 pid，组还有成员时这个 pid 不会被复用）；
  // 组成员也可能带着自己的后代，所以每个成员同样连同后代一起加。
  for (const row of rows) if (row.pgid === root) addWithDescendants(row.pid);
  return [...found].filter((pid) => pid > 1 && pid !== selfPid);
}

function listProcesses(): Promise<ProcessRow[]> {
  const { promise, resolve, reject } = Promise.withResolvers<ProcessRow[]>();
  execFile(
    "/bin/ps",
    ["-A", "-o", "pid=,ppid=,pgid="],
    { timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
    (error, stdout) => {
      if (error) reject(error);
      else resolve(parsePsTable(stdout));
    },
  );
  return promise;
}

/**
 * SIGKILL root 和它的所有后代。永不 reject：`ps` 失败时记日志，退化成只杀 root；
 * kill 遇到 ESRCH（进程刚好自己退出了）忽略，别的错误（EPERM 等）记日志。
 */
export async function killPosixProcessTree(root: number): Promise<void> {
  let pids = [root];
  try {
    pids = collectTreePids(await listProcesses(), root);
  } catch (error) {
    log.warn("process tree: listing processes with ps failed; killing the root process only", {
      message: String(error),
    });
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
      log.warn("process tree: kill failed", { pid, message: String(error) });
    }
  }
}

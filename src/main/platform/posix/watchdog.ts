// 主进程被强杀（kill -9、崩溃）时结束 omp 的进程组和组里进程的所有后代，对应 Windows 的 Job Object KILL_ON_JOB_CLOSE。
// macOS 没有 Job Object，也没有 PR_SET_PDEATHSIG；Linux 的 PDEATHSIG 只能在子进程里设（node 的 spawn 和 node-pty 都不给入口）。
// 两边一样：给每个 omp 子进程起一个独立进程组里的 `sh` 看门狗，每秒 `kill -0 <主进程 pid>`，主进程不在了就动手。
// 见 docs/architecture/terminal.md "POSIX 的进程结束和看门狗"。
import { spawn } from "node:child_process";
import { log } from "../../log/log.ts";

/**
 * 看门狗脚本，参数 $1 = 主进程 pid，$2 = 要看守的进程组 id。
 * - 主进程没了：先 SIGSTOP 整个组（不再起新进程），按 `ps` 的父子关系找出组里各进程的所有后代，再 SIGKILL 组和这些后代。
 *   omp 的 bash 工具让命令自己开进程组（2026-10-26 WSL 实测：`python3 -c "time.sleep(600)"` 的 pgid 是它自己），
 *   只杀组时它被 init 收养留下来。规则和正常退出用的 `collectTreePids`（process-tree.ts）一样：组成员连同后代。
 * - 组已经空了就自己退出（子进程正常结束时不用单独通知看门狗，也不会去杀可能被复用的 pid）。
 * - 刚 spawn 时组可能还没建好（pty 的子进程要先 setsid）：一次都没见过组时容忍 5 秒。
 * - 信号一律写 `kill -s <信号> --`：Debian / Ubuntu 的 /bin/sh 是 dash，它的 `kill -0 -- -<组>` 把 `--` 当成 pid
 *   报 "Illegal number" 并让整个脚本退出（dash 源码 jobs.c 的 killcmd：只有 `-s` 走选项解析、认 `--`），bash 两种写法都认。
 */
const WATCHDOG_SCRIPT = `seen=0; miss=0
while kill -s 0 "$1" 2>/dev/null; do
  if kill -s 0 -- "-$2" 2>/dev/null; then
    seen=1
  else
    [ "$seen" = 1 ] && exit 0
    miss=$((miss + 1))
    [ "$miss" -ge 5 ] && exit 0
  fi
  sleep 1
done
kill -s STOP -- "-$2" 2>/dev/null
tree=$(ps -A -o pid=,ppid=,pgid= | awk -v group="$2" '
  { pid[NR] = $1; parent[NR] = $2; if ($3 == group) keep[$1] = 1 }
  END {
    do {
      added = 0
      for (i = 1; i <= NR; i++) if (!(pid[i] in keep) && (parent[i] in keep)) { keep[pid[i]] = 1; added = 1 }
    } while (added)
    for (p in keep) if (p + 0 > 1) print p
  }')
kill -s KILL -- "-$2" 2>/dev/null
for p in $tree; do kill -s KILL "$p" 2>/dev/null; done
exit 0
`;

/** 看门狗的命令行。参数全是整数，不拼用户输入。 */
export function watchdogCommand(mainPid: number, pgid: number): { file: string; args: string[] } {
  if (!Number.isInteger(mainPid) || !Number.isInteger(pgid) || mainPid <= 1 || pgid <= 1) {
    throw new Error(`invalid watchdog pids: main ${mainPid}, group ${pgid}`);
  }
  return { file: "/bin/sh", args: ["-c", WATCHDOG_SCRIPT, "omp-studio-watchdog", String(mainPid), String(pgid)] };
}

/**
 * 给 pid 起的进程组（pid 必须是组长：pty 的子进程是 session leader，rpc-ui 的 omp 用 `detached: true` 起）起看门狗。
 * 返回释放函数：结束看门狗（可重复调用）。失败（pid 为空、spawn 抛错）抛错，由调用方决定是否继续。
 */
export function startWatchdog(pid: number | undefined): () => void {
  if (pid === undefined) throw new Error("cannot watch a process without a pid");
  const { file, args } = watchdogCommand(process.pid, pid);
  const dog = spawn(file, args, { detached: true, stdio: "ignore" });
  let exited = false;
  dog.once("exit", () => {
    exited = true;
  });
  dog.once("error", (error) => {
    exited = true;
    log.warn("watchdog: failed to run", { message: String(error) });
  });
  dog.unref();
  return () => {
    if (exited || dog.pid === undefined) return;
    exited = true;
    try {
      process.kill(dog.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        log.warn("watchdog: stopping failed", { message: String(error) });
    }
  };
}

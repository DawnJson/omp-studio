// 应用级 Job Object：主进程无论怎么死（包括被强杀），系统关闭句柄时整棵 omp 进程树一起结束。
// 原理、嵌套 job 和剩余的竞争窗口见 docs/architecture/task-model.md "进程树兜底"。
import { loadWin32, win32Constants } from "./ffi.ts";

let job: number | null = null;

/** 建一个只设 KILL_ON_JOB_CLOSE 的 Job（不设 breakaway 标志）；最后一个句柄关掉时系统结束 Job 里所有进程。 */
function createKillOnCloseJob(): number {
  const { kernel32 } = loadWin32();
  const handle = kernel32.CreateJobObjectW(null);
  if (handle === 0) throw new Error(`CreateJobObjectW failed (error ${kernel32.lastError()})`);
  const ok = kernel32.SetInformationJobObject(handle, win32Constants.JobObjectExtendedLimitInformation, {
    BasicLimitInformation: {
      PerProcessUserTimeLimit: 0,
      PerJobUserTimeLimit: 0,
      LimitFlags: win32Constants.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      MinimumWorkingSetSize: 0,
      MaximumWorkingSetSize: 0,
      ActiveProcessLimit: 0,
      Affinity: 0,
      PriorityClass: 0,
      SchedulingClass: 0,
    },
    IoInfo: {
      ReadOperationCount: 0,
      WriteOperationCount: 0,
      OtherOperationCount: 0,
      ReadTransferCount: 0,
      WriteTransferCount: 0,
      OtherTransferCount: 0,
    },
    ProcessMemoryLimit: 0,
    JobMemoryLimit: 0,
    PeakProcessMemoryUsed: 0,
    PeakJobMemoryUsed: 0,
  });
  if (!ok) {
    const code = kernel32.lastError();
    kernel32.CloseHandle(handle);
    throw new Error(`SetInformationJobObject failed (error ${code})`);
  }
  return handle;
}

/** 第一次调用时建应用 Job；句柄在进程生命周期内一直持有。 */
function appJob(): number {
  job ??= createKillOnCloseJob();
  return job;
}

/**
 * 把刚 spawn 的进程放进应用 Job。要在 spawn 返回后的同一个同步代码段里调用，缩小孙进程先于 assign 出生的窗口。
 * 非 Windows 是空操作，返回 false。失败（进程已退出等）抛错，由调用方决定是否继续——不静默吞掉，否则兜底悄悄失效。
 */
export function assignToAppJob(pid: number | undefined): boolean {
  if (process.platform !== "win32") return false;
  if (pid === undefined) throw new Error("cannot assign a process without a pid to the job object");
  assignHandle(appJob(), pid);
  return true;
}

/**
 * 给 pid 单独建一个 KILL_ON_JOB_CLOSE Job 并放进去，返回释放函数（关句柄；此时 Job 里还活着的进程被系统结束，可重复调用）。
 * 为什么不用应用 Job：Windows 的嵌套 Job 要求进程所在的 Job 链和目标 Job 的父链兼容。
 * 商店版 pwsh.exe（WindowsApps 别名）由系统在自己的 Job 里拉起，已经有了父 Job 的应用 Job 再收它会 ACCESS_DENIED(5)；
 * 全新的空 Job 则随这个进程挂到它现有的 Job 下面，总能成功。主进程被强杀时句柄随进程关闭，效果和应用 Job 一样。
 * 非 Windows 是空操作。
 */
export function assignToOwnJob(pid: number | undefined): () => void {
  if (process.platform !== "win32") return () => undefined;
  if (pid === undefined) throw new Error("cannot assign a process without a pid to the job object");
  const { kernel32 } = loadWin32();
  const own = createKillOnCloseJob();
  try {
    assignHandle(own, pid);
  } catch (error) {
    kernel32.CloseHandle(own);
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    kernel32.CloseHandle(own);
  };
}

function assignHandle(target: number, pid: number): void {
  const { kernel32 } = loadWin32();
  const process_ = kernel32.OpenProcess(
    win32Constants.PROCESS_SET_QUOTA | win32Constants.PROCESS_TERMINATE,
    false,
    pid,
  );
  if (process_ === 0) throw new Error(`OpenProcess(${pid}) failed (error ${kernel32.lastError()})`);
  try {
    if (!kernel32.AssignProcessToJobObject(target, process_)) {
      throw new Error(`AssignProcessToJobObject(${pid}) failed (error ${kernel32.lastError()})`);
    }
  } finally {
    kernel32.CloseHandle(process_);
  }
}

/** 测试用：pid 是否在应用 Job 里。 */
export function isInAppJob(pid: number): boolean {
  const { kernel32 } = loadWin32();
  const process_ = kernel32.OpenProcess(win32Constants.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (process_ === 0) throw new Error(`OpenProcess(${pid}) failed (error ${kernel32.lastError()})`);
  try {
    return kernel32.IsProcessInJob(process_, appJob()) === true;
  } finally {
    kernel32.CloseHandle(process_);
  }
}

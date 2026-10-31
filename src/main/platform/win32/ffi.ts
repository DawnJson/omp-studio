// koffi 载入 kernel32 / advapi32 / user32 / dwmapi：整个主进程唯一一处 koffi.load（docs/architecture/security.md「子进程和原生调用」）。
// job-object.ts（Job Object）和 user-path.ts（用户 PATH 注册表 + 环境变量广播）只 import 这里导出的函数，不自己载入 DLL。
// 句柄一律用 `uintptr`（number）：Win32 句柄是内核对象表的索引，远小于 2^53；HKEY 的预定义值（0x80000001…）同样放得下。
// 懒加载：只有第一次调用 `loadWin32()` 时才载入 koffi，非 Windows 平台和单元测试 import 本文件没有副作用。
import koffi from "koffi";

export const win32Constants = {
  // 注册表根键（winreg.h）
  HKEY_CURRENT_USER: 0x80000001,
  // 访问权限
  KEY_QUERY_VALUE: 0x0001,
  KEY_SET_VALUE: 0x0002,
  KEY_CREATE_SUB_KEY: 0x0004,
  KEY_WRITE: 0x20006,
  // 值类型
  REG_SZ: 1,
  REG_EXPAND_SZ: 2,
  // LSTATUS
  ERROR_SUCCESS: 0,
  ERROR_FILE_NOT_FOUND: 2,
  // 广播环境变量变化
  HWND_BROADCAST: 0xffff,
  WM_SETTINGCHANGE: 0x001a,
  SMTO_ABORTIFHUNG: 0x0002,
  // Job Object
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: 0x2000,
  JobObjectExtendedLimitInformation: 9,
  PROCESS_TERMINATE: 0x0001,
  PROCESS_SET_QUOTA: 0x0100,
  PROCESS_QUERY_LIMITED_INFORMATION: 0x1000,
} as const;

/** `uintptr` 在 koffi 里返回 number，超出安全整数范围才是 bigint；句柄不会超出，统一成 number。 */
type Handle = number;

interface JobExtendedLimitInformation {
  BasicLimitInformation: {
    PerProcessUserTimeLimit: bigint | number;
    PerJobUserTimeLimit: bigint | number;
    LimitFlags: number;
    MinimumWorkingSetSize: bigint | number;
    MaximumWorkingSetSize: bigint | number;
    ActiveProcessLimit: number;
    Affinity: bigint | number;
    PriorityClass: number;
    SchedulingClass: number;
  };
  IoInfo: Record<string, bigint | number>;
  ProcessMemoryLimit: bigint | number;
  JobMemoryLimit: bigint | number;
  PeakProcessMemoryUsed: bigint | number;
  PeakJobMemoryUsed: bigint | number;
}

export interface Win32Api {
  kernel32: {
    /** 失败返回 0。匿名 Job：name 传 null。 */
    CreateJobObjectW(name: string | null): Handle;
    SetInformationJobObject(job: Handle, infoClass: number, info: JobExtendedLimitInformation): boolean;
    AssignProcessToJobObject(job: Handle, process: Handle): boolean;
    IsProcessInJob(process: Handle, job: Handle | null): boolean | null;
    /** 失败返回 0。 */
    OpenProcess(desiredAccess: number, inheritHandle: boolean, pid: number): Handle;
    CloseHandle(handle: Handle): boolean;
    /** koffi 在每次调用后保存系统错误码，这里取最近一次调用的 GetLastError。 */
    lastError(): number;
  };
  advapi32: {
    /** 返回 LSTATUS（0 成功）和打开的 HKEY。 */
    RegOpenKeyExW(hKey: Handle, subKey: string, samDesired: number): { status: number; key: Handle };
    /** 键不存在时创建。 */
    RegCreateKeyExW(hKey: Handle, subKey: string, samDesired: number): { status: number; key: Handle };
    /** 读原始值和类型，不展开 `%VAR%`。ERROR_FILE_NOT_FOUND 时 data 为 null。 */
    RegQueryValueExW(hKey: Handle, valueName: string): { status: number; type: number; data: Buffer | null };
    /** data 是 UTF-16LE 字节，必须包含结尾的 NUL（REG_SZ / REG_EXPAND_SZ 的要求）。 */
    RegSetValueExW(hKey: Handle, valueName: string, type: number, data: Buffer): number;
    RegCloseKey(hKey: Handle): number;
  };
  user32: {
    /** 广播 `WM_SETTINGCHANGE`，lParam 是字符串（如 "Environment"）；在线程池里执行，不阻塞主线程。返回 SendMessageTimeoutW 的结果（0 = 失败或超时）。 */
    broadcastSettingChangeAsync(setting: string, timeoutMs: number): Promise<number>;
  };
  dwmapi: {
    /** 隐藏（cloak）窗口：系统不再画它、点不到它，窗口本身仍算显示着。返回 HRESULT（0 成功）。 */
    cloakWindow(hwnd: Handle): number;
  };
}

let api: Win32Api | undefined;

export function loadWin32(): Win32Api {
  if (process.platform !== "win32") throw new Error("Win32 API is only available on Windows");
  api ??= createApi();
  return api;
}

function createApi(): Win32Api {
  const kernel32 = koffi.load("kernel32.dll");
  const advapi32 = koffi.load("advapi32.dll");
  const user32 = koffi.load("user32.dll");
  const dwmapi = koffi.load("dwmapi.dll");

  // ───── kernel32 ─────
  const IoCounters = koffi.struct("IO_COUNTERS", {
    ReadOperationCount: "uint64",
    WriteOperationCount: "uint64",
    OtherOperationCount: "uint64",
    ReadTransferCount: "uint64",
    WriteTransferCount: "uint64",
    OtherTransferCount: "uint64",
  });
  const BasicLimit = koffi.struct("JOBOBJECT_BASIC_LIMIT_INFORMATION", {
    PerProcessUserTimeLimit: "int64",
    PerJobUserTimeLimit: "int64",
    LimitFlags: "uint32",
    MinimumWorkingSetSize: "size_t",
    MaximumWorkingSetSize: "size_t",
    ActiveProcessLimit: "uint32",
    Affinity: "uintptr",
    PriorityClass: "uint32",
    SchedulingClass: "uint32",
  });
  const ExtendedLimit = koffi.struct("JOBOBJECT_EXTENDED_LIMIT_INFORMATION", {
    BasicLimitInformation: BasicLimit,
    IoInfo: IoCounters,
    ProcessMemoryLimit: "size_t",
    JobMemoryLimit: "size_t",
    PeakProcessMemoryUsed: "size_t",
    PeakJobMemoryUsed: "size_t",
  });

  const CreateJobObjectW = kernel32.func("uintptr CreateJobObjectW(void *attributes, str16 name)");
  const SetInformationJobObject = kernel32.func(
    "bool SetInformationJobObject(uintptr job, int infoClass, _In_ JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32 size)",
  );
  const AssignProcessToJobObject = kernel32.func("bool AssignProcessToJobObject(uintptr job, uintptr process)");
  const IsProcessInJob = kernel32.func("bool IsProcessInJob(uintptr process, uintptr job, _Out_ int *result)");
  const OpenProcess = kernel32.func("uintptr OpenProcess(uint32 access, bool inherit, uint32 pid)");
  const CloseHandle = kernel32.func("bool CloseHandle(uintptr handle)");
  // koffi.errno() 读的是 C 运行库的 errno，Win32 调用失败时恒为 0；真正的错误码要调 GetLastError。
  // 必须紧跟在失败的那次调用之后读（中间别插别的 Win32 调用）。
  const GetLastError = kernel32.func("uint32 GetLastError()");

  // ───── advapi32 ─────
  const RegOpenKeyExW = advapi32.func(
    "int32 RegOpenKeyExW(uintptr key, str16 subKey, uint32 options, uint32 sam, _Out_ uintptr *result)",
  );
  const RegCreateKeyExW = advapi32.func(
    "int32 RegCreateKeyExW(uintptr key, str16 subKey, uint32 reserved, void *className, uint32 options, uint32 sam, void *attributes, _Out_ uintptr *result, _Out_ uint32 *disposition)",
  );
  const RegQueryValueExW = advapi32.func(
    "int32 RegQueryValueExW(uintptr key, str16 name, void *reserved, _Out_ uint32 *type, void *data, _Inout_ uint32 *size)",
  );
  const RegSetValueExW = advapi32.func(
    "int32 RegSetValueExW(uintptr key, str16 name, uint32 reserved, uint32 type, void *data, uint32 size)",
  );
  const RegCloseKey = advapi32.func("int32 RegCloseKey(uintptr key)");

  // ───── user32 ─────
  const SendMessageTimeoutW = user32.func(
    "intptr SendMessageTimeoutW(uintptr hwnd, uint32 msg, uintptr wParam, str16 lParam, uint32 flags, uint32 timeout, _Out_ uintptr *result)",
  );

  // ───── dwmapi ─────
  const DwmSetWindowAttribute = dwmapi.func(
    "int32 DwmSetWindowAttribute(uintptr hwnd, uint32 attribute, _In_ int32 *value, uint32 size)",
  );

  const c = win32Constants;
  const num = (value: number | bigint) => Number(value);

  return {
    kernel32: {
      CreateJobObjectW: (name) => num(CreateJobObjectW(null, name)),
      SetInformationJobObject: (job, infoClass, info) =>
        SetInformationJobObject(job, infoClass, info, koffi.sizeof(ExtendedLimit)),
      AssignProcessToJobObject: (job, process) => AssignProcessToJobObject(job, process),
      IsProcessInJob: (process, job) => {
        const out = [0];
        const ok = IsProcessInJob(process, job ?? 0, out);
        return ok ? out[0] !== 0 : null;
      },
      OpenProcess: (access, inherit, pid) => num(OpenProcess(access, inherit, pid)),
      CloseHandle: (handle) => CloseHandle(handle),
      lastError: () => GetLastError(),
    },
    advapi32: {
      RegOpenKeyExW: (hKey, subKey, sam) => {
        const out = [0];
        const status = RegOpenKeyExW(hKey, subKey, 0, sam, out);
        return { status, key: num(out[0] ?? 0) };
      },
      RegCreateKeyExW: (hKey, subKey, sam) => {
        const out = [0];
        const status = RegCreateKeyExW(hKey, subKey, 0, null, 0, sam, null, out, [0]);
        return { status, key: num(out[0] ?? 0) };
      },
      RegQueryValueExW: (hKey, valueName) => {
        const type = [0];
        const size = [0];
        let status = RegQueryValueExW(hKey, valueName, null, type, null, size);
        if (status !== c.ERROR_SUCCESS) return { status, type: 0, data: null };
        // 两次调用之间值可能变长（ERROR_MORE_DATA = 234），多读几次直到装得下。
        for (;;) {
          const data = Buffer.alloc(size[0] ?? 0);
          status = RegQueryValueExW(hKey, valueName, null, type, data, size);
          if (status === 234) continue;
          return {
            status,
            type: type[0] ?? 0,
            data: status === c.ERROR_SUCCESS ? data.subarray(0, size[0] ?? 0) : null,
          };
        }
      },
      RegSetValueExW: (hKey, valueName, type, data) => RegSetValueExW(hKey, valueName, 0, type, data, data.length),
      RegCloseKey: (hKey) => RegCloseKey(hKey),
    },
    user32: {
      // koffi 的 .async 在线程池里调用，不占主线程（挂起的窗口最长会让 SendMessageTimeoutW 卡 timeoutMs）。
      broadcastSettingChangeAsync: (setting, timeoutMs) => {
        const { promise, resolve, reject } = Promise.withResolvers<number>();
        SendMessageTimeoutW.async(
          c.HWND_BROADCAST,
          c.WM_SETTINGCHANGE,
          0,
          setting,
          c.SMTO_ABORTIFHUNG,
          timeoutMs,
          [0],
          (error: Error | null, result: number | bigint) => (error ? reject(error) : resolve(num(result))),
        );
        return promise;
      },
    },
    dwmapi: {
      // DWMWA_CLOAK = 13，值是 BOOL（4 字节）。
      cloakWindow: (hwnd) => DwmSetWindowAttribute(hwnd, 13, [1], 4),
    },
  };
}

// 终端起哪个 shell、带什么环境变量。纯函数，平台和环境由调用方传入，单元测试直接用。
import path from "node:path";
import { prependToPath } from "../omp/launch-args.ts";

export interface ShellChoice {
  /** 可执行文件的绝对路径（找不到时是裸名，交给系统报错）。 */
  file: string;
  args: string[];
  /** 给界面显示的名字，如 `pwsh.exe`。 */
  name: string;
}

export interface ShellProbe {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** 在 PATH 里找可执行文件，返回绝对路径；没有返回 null。 */
  which(command: string): string | null;
}

/**
 * Windows：PATH 上有 pwsh.exe 用它（PowerShell 7），否则 powershell.exe（系统自带 5.1，不在 PATH 时用 System32 里的）。
 * 其他平台：$SHELL，没有就 /bin/bash。
 */
export function resolveShell(probe: ShellProbe): ShellChoice {
  if (probe.platform === "win32") {
    const pwsh = probe.which("pwsh.exe");
    if (pwsh !== null) return { file: pwsh, args: ["-NoLogo"], name: "pwsh.exe" };
    const system = path.win32.join(
      probe.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return { file: probe.which("powershell.exe") ?? system, args: ["-NoLogo"], name: "powershell.exe" };
  }
  const file = probe.env["SHELL"] || "/bin/bash";
  return { file, args: [], name: path.posix.basename(file) };
}

/**
 * 终端的环境：进程环境 + 自管 omp 的 bin 前置（终端里敲 `omp` 和 omp-studio 用的是同一个）+ TERM。
 * 值为 undefined 的项去掉：node-pty 在 Windows 上会把它们拼成字符串 "undefined"。
 */
export function buildTerminalEnv(base: NodeJS.ProcessEnv, managedOmpBin: string | null): Record<string, string> {
  const withPath = managedOmpBin === null ? base : prependToPath(base, managedOmpBin);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(withPath)) if (value !== undefined) env[key] = value;
  env["TERM"] = "xterm-256color";
  env["COLORTERM"] = "truecolor";
  return env;
}

// 终端起哪个 shell、带什么环境变量。纯函数，平台和环境由调用方传入，单元测试直接用。
// 用户可以在设置里指定 shell（StudioSettings.terminalShell，绝对路径；只来自 detectShells 的列表或主进程的文件对话框）。
import path from "node:path";
import type { TerminalShellOption } from "../../shared/ipc.ts";
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

/** 检测可用 shell 要的额外能力：文件在不在、/etc/shells 的内容（读不到为空串）。 */
export interface DetectProbe extends ShellProbe {
  exists(file: string): boolean;
  etcShells(): string;
}

/** 设置里选的 shell 文件已经不在了：不悄悄换回默认（同 cwd 规则），面板按错误显示、按任意键重试。 */
export class ShellMissingError extends Error {
  override name = "ShellMissingError";
  constructor(file: string) {
    super(`the terminal shell set in Settings no longer exists: ${file}`);
  }
}

function pathOf(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * 按可执行文件名定启动参数：pwsh / powershell `-NoLogo`；bash / zsh / fish / sh 作登录 shell `-l`
 * （Windows 上的 bash 是 Git Bash：`--login -i`，和开始菜单里的 Git Bash 一样读 ~/.bash_profile 并进交互模式）；cmd、wsl 和别的不带参数。
 */
export function shellArgs(platform: NodeJS.Platform, file: string): string[] {
  const base = pathOf(platform)
    .basename(file)
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (base === "pwsh" || base === "powershell") return ["-NoLogo"];
  if (base === "bash" && platform === "win32") return ["--login", "-i"];
  if (base === "bash" || base === "zsh" || base === "fish" || base === "sh") return ["-l"];
  return [];
}

/**
 * 设置里可选的 shell（只列存在的，按下面的顺序，同一路径只列一次）。
 * Windows：PATH 上的 pwsh、Windows PowerShell（PATH 上的或 System32 里的）、%ComSpec%（cmd）、git.exe 旁边的 Git Bash
 * （`<Git>\cmd\git.exe` → `<Git>\bin\bash.exe`；`<Git>\mingw64\bin\git.exe` 往上两级）、System32\wsl.exe。
 * 其他平台：/etc/shells 里列着且存在的。
 */
export function detectShells(probe: DetectProbe): TerminalShellOption[] {
  const found: TerminalShellOption[] = [];
  const add = (name: string, file: string | null) => {
    if (file === null || !probe.exists(file)) return;
    const key = probe.platform === "win32" ? file.toLowerCase() : file;
    if (found.some((option) => (probe.platform === "win32" ? option.path.toLowerCase() : option.path) === key)) return;
    found.push({ name, path: file });
  };
  if (probe.platform === "win32") {
    const system32 = path.win32.join(probe.env["SystemRoot"] ?? "C:\\Windows", "System32");
    add("PowerShell", probe.which("pwsh.exe"));
    add(
      "Windows PowerShell",
      probe.which("powershell.exe") ?? path.win32.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
    );
    add("Command Prompt", probe.env["ComSpec"] ?? path.win32.join(system32, "cmd.exe"));
    const git = probe.which("git.exe");
    if (git !== null) {
      const dir = path.win32.dirname(git);
      const candidates = [
        path.win32.join(dir, "..", "bin", "bash.exe"),
        path.win32.join(dir, "..", "..", "bin", "bash.exe"),
      ];
      add("Git Bash", candidates.find((file) => probe.exists(file)) ?? null);
    }
    add("WSL", path.win32.join(system32, "wsl.exe"));
    return found;
  }
  for (const line of probe.etcShells().split(/\r?\n/)) {
    const file = line.trim();
    if (file.startsWith("/")) add(path.posix.basename(file), file);
  }
  return found;
}

/**
 * `preferred`（设置里选的 shell，绝对路径）为 null 时：
 * Windows：PATH 上有 pwsh.exe 用它（PowerShell 7），否则 powershell.exe（系统自带 5.1，不在 PATH 时用 System32 里的）。
 * 其他平台：$SHELL（没有就 /bin/bash），带 `-l` 作登录 shell。
 * 有值时就用它（参数按文件名，shellArgs）；文件不在了抛 ShellMissingError。
 */
export function resolveShell(
  probe: ShellProbe & { exists(file: string): boolean },
  preferred: string | null,
): ShellChoice {
  if (preferred !== null) {
    if (!probe.exists(preferred)) throw new ShellMissingError(preferred);
    return {
      file: preferred,
      args: shellArgs(probe.platform, preferred),
      name: pathOf(probe.platform).basename(preferred),
    };
  }
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
  // -l：登录 shell，读 ~/.zprofile / ~/.bash_profile，brew、bun、~/.local/bin 才在 PATH 里（和 Terminal.app 开的终端一致）。
  return { file, args: ["-l"], name: path.posix.basename(file) };
}

/**
 * 终端的环境：进程环境 + 自管 omp 的 bin 前置（终端里敲 `omp` 和 omp-studio 用的是同一个）+ TERM。
 * 值为 undefined 的项去掉：node-pty 在 Windows 上会把它们拼成字符串 "undefined"。
 */
export function buildTerminalEnv(base: NodeJS.ProcessEnv, managedOmpBin: string | null): Record<string, string> {
  const withPath = prependToPath(base, managedOmpBin);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(withPath)) if (value !== undefined) env[key] = value;
  env["TERM"] = "xterm-256color";
  env["COLORTERM"] = "truecolor";
  return env;
}

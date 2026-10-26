// 从 Finder / Dock 启动的 mac 应用，PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，找不到 Homebrew、bun、~/.local/bin 里的 omp / git / gh。
// Linux 从桌面（应用菜单、文件管理器）启动时 PATH 来自桌面会话，通常只读过 ~/.profile、没读 ~/.bashrc / ~/.zshrc：
// bun 这类安装脚本写进 rc 文件的目录同样缺。启动时问一次用户的登录 shell，把它的 PATH 合并进 process.env.PATH。
// mac 没有实测（推测）。见 docs/architecture/terminal.md "macOS / Linux 的 PATH"。
import { execFile } from "node:child_process";
import path from "node:path";
import { log } from "../../log/log.ts";

const START_MARKER = "__OMP_STUDIO_PATH_START__";
const END_MARKER = "__OMP_STUDIO_PATH_END__";
const TIMEOUT_MS = 3_000;

/** 登录 shell 要跑的命令：PATH 前后打标记，登录 shell 自己会往 stdout 打 motd、nvm 提示之类的杂质。 */
const PRINT_PATH_COMMAND = `printf '%s' '${START_MARKER}'; printf '%s' "$PATH"; printf '%s' '${END_MARKER}'`;

/** 取出两个标记之间的内容（用最后一对：杂质里不会有标记，但 rc 文件可能把命令输出两遍）。没有标记或内容为空返回 null。 */
export function parseLoginPath(output: string): string | null {
  const end = output.lastIndexOf(END_MARKER);
  if (end === -1) return null;
  const start = output.lastIndexOf(START_MARKER, end);
  if (start === -1) return null;
  const value = output.slice(start + START_MARKER.length, end).trim();
  return value === "" ? null : value;
}

/** 把登录 shell 的条目放在前面，再接上当前 PATH 里登录 shell 没有的条目；空条目丢掉，重复条目只留第一个。 */
export function mergePaths(loginPath: string, currentPath: string | undefined): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const entry of [...loginPath.split(path.posix.delimiter), ...(currentPath ?? "").split(path.posix.delimiter)]) {
    if (entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    merged.push(entry);
  }
  return merged.join(path.posix.delimiter);
}

function runLoginShell(shell: string): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  // -i：zsh 把 PATH 写在 ~/.zshrc 的用户也能取到；-l：~/.zprofile。参数是数组，不经 shell 拼接。
  execFile(
    shell,
    ["-ilc", PRINT_PATH_COMMAND],
    { timeout: TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 },
    (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    },
  );
  return promise;
}

/**
 * 只在 darwin / linux 执行：用 $SHELL（没有就 mac 的 /bin/zsh、Linux 的 /bin/bash）取登录 shell 的 PATH 并合并进 process.env.PATH。
 * 最多等 3 秒；超时或失败记日志，继续用原 PATH。
 */
export async function fixLoginPath(platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== "darwin" && platform !== "linux") return;
  const shell = process.env["SHELL"] || (platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  try {
    const loginPath = parseLoginPath(await runLoginShell(shell));
    if (loginPath === null) {
      log.warn("login path: the login shell printed no PATH; keeping the current one", {
        shell: path.posix.basename(shell),
      });
      return;
    }
    process.env["PATH"] = mergePaths(loginPath, process.env["PATH"]);
  } catch (error) {
    log.warn("login path: reading PATH from the login shell failed; keeping the current one", {
      shell: path.posix.basename(shell),
      message: String(error),
    });
  }
}

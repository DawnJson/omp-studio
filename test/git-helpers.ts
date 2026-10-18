// git 测试的公共工具：在真实的临时仓库里跑。目录名带空格和中文（开发机上就有这种路径）。
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  }).replace(/\r?\n$/, "");
}

export async function makeScratch(label: string): Promise<string> {
  // realpath：Windows 的临时目录可能是 8.3 短名，git 报告的是长名，路径比较要一致。
  return realpath(await mkdtemp(path.join(os.tmpdir(), `omp-studio ${label} 测试-`)));
}

export async function put(root: string, rel: string, content: string | Buffer): Promise<void> {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

/** 40 行的文本，用来产生相隔很远的两个 hunk。 */
export const FORTY_LINES = `${Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行`).join("\n")}\n`;

/** 建一个有一次提交的仓库：src 目录/文件 一.txt（40 行）、a.txt、bin.dat（二进制）。 */
export async function makeRepo(scratch: string, name = "仓库 一"): Promise<string> {
  const dir = path.join(scratch, name);
  await mkdir(dir, { recursive: true });
  sh(dir, "init", "-b", "main");
  sh(dir, "config", "user.name", "测试 用户");
  sh(dir, "config", "user.email", "test@example.com");
  sh(dir, "config", "core.autocrlf", "false");
  sh(dir, "config", "commit.gpgsign", "false");
  await put(dir, "src 目录/文件 一.txt", FORTY_LINES);
  await put(dir, "a.txt", "alpha\nbeta\n");
  await put(dir, "bin.dat", Buffer.from([0, 1, 2, 3, 0, 255]));
  sh(dir, "add", "-A");
  sh(dir, "commit", "-m", "初始提交");
  return dir;
}

/** PATH 上的 omp（真实 worktree 创建走 `omp worktree add`）；没有则为 null，相关用例 skip。 */
export function findOmp(): string | null {
  try {
    const found = execFileSync(process.platform === "win32" ? "where" : "which", ["omp"], { encoding: "utf8" });
    return (
      found
        .split(/\r?\n/)
        .find((line) => line.trim() !== "")
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

/**
 * 把 omp 的家目录、agent 目录、worktree 目录都指到临时目录：测试不碰真实的 ~/.omp（含 ~/.omp/wt）。
 * 返回 worktree 目录和还原函数。
 */
export async function isolateOmp(scratch: string): Promise<{ worktreesDir: string; restore: () => void }> {
  const worktreesDir = path.join(scratch, "omp wt 目录");
  const names = ["OMP_WORKTREE_DIR", "PI_CODING_AGENT_DIR", "USERPROFILE", "HOME"] as const;
  const saved = names.map((name) => [name, process.env[name]] as const);
  const home = path.join(scratch, "omp home");
  await mkdir(home, { recursive: true });
  process.env["OMP_WORKTREE_DIR"] = worktreesDir;
  process.env["PI_CODING_AGENT_DIR"] = path.join(scratch, "omp agent");
  process.env["USERPROFILE"] = home;
  process.env["HOME"] = home;
  return {
    worktreesDir,
    restore: () => {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}

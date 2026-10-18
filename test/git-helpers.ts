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

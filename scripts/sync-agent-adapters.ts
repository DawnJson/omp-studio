// 把 .agents/skills/<name> 镜像到 .claude/skills/<name>：Codex 和 omp 读 .agents/skills，Claude Code 只读 .claude/skills。
// Windows 上建目录联接（junction，不要管理员权限；符号链接要开发者模式），其他平台建相对符号链接；建不了就复制一份。
// git 不跟踪联接和链接（core.symlinks=false 时还会检出成一行文本），所以 .claude/skills/ 被 gitignore，由 postinstall 每次重建。
// 用法：node scripts/sync-agent-adapters.ts        建立或修好镜像（幂等）
//       node scripts/sync-agent-adapters.ts --check  只检查，和 .agents/skills 不一致就列出来并以 1 退出
import type { Stats } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

async function lstatOrNull(file: string): Promise<Stats | null> {
  return lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

async function realpathOrNull(file: string): Promise<string | null> {
  return realpath(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

/** 目录里所有文件的相对路径（正斜杠）→ 内容。 */
async function readTree(dir: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files.set(path.relative(dir, file).split(path.sep).join("/"), await readFile(file));
  }
  return files;
}

async function sameTree(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([readTree(a), readTree(b)]);
  if (left.size !== right.size) return false;
  for (const [name, content] of left) {
    const other = right.get(name);
    if (other === undefined || !other.equals(content)) return false;
  }
  return true;
}

/** 镜像项和源一致时返回 null，否则返回原因。 */
async function drift(source: string, target: string): Promise<string | null> {
  const info = await lstatOrNull(target);
  if (info === null) return "缺少";
  if (info.isSymbolicLink()) {
    return (await realpathOrNull(target)) === (await realpath(source)) ? null : "链接指向别处";
  }
  if (!info.isDirectory()) return "不是目录";
  return (await sameTree(source, target)) ? null : "复制的内容和源不一致";
}

async function link(source: string, target: string): Promise<string> {
  try {
    if (process.platform === "win32") await symlink(source, target, "junction");
    else await symlink(path.relative(path.dirname(target), source), target, "dir");
    return "链接";
  } catch (error) {
    await cp(source, target, { recursive: true });
    return `复制（建链接失败：${(error as NodeJS.ErrnoException).code ?? String(error)}）`;
  }
}

/** 本脚本建过的镜像名单（`.claude/skills` 里）：源里删掉的 skill 按它清掉，复制出来的也认得；名单外的普通目录可能是个人 skill，不碰。 */
const MANIFEST = ".studio-mirror.json";

async function readManaged(targetDir: string): Promise<string[]> {
  const text = await readFile(path.join(targetDir, MANIFEST), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "[]";
    throw error;
  });
  return JSON.parse(text) as string[];
}

/** 删镜像项：链接只删链接本身，不碰它指向的 .agents/skills。 */
async function removeEntry(target: string, info: Stats): Promise<void> {
  if (info.isSymbolicLink()) await unlink(target);
  else await rm(target, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * 同步 root 下的 skill 镜像，返回每一处问题或改动（一行一条）。
 * check 为 true 时只检查不改；.claude/skills 里多出来的链接和名单里的复制件（源已删）算不一致，别的普通目录不动，可能是个人 skill。
 */
export async function syncSkills(root: string, check: boolean): Promise<string[]> {
  const sourceDir = path.join(root, ".agents", "skills");
  const targetDir = path.join(root, ".claude", "skills");
  const names = (await readdir(sourceDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  const lines: string[] = [];
  if (!check) await mkdir(targetDir, { recursive: true });

  for (const name of names) {
    const source = path.join(sourceDir, name);
    const target = path.join(targetDir, name);
    const reason = await drift(source, target);
    if (reason === null) continue;
    const shown = `.claude/skills/${name}`;
    if (check) {
      lines.push(`${shown}: ${reason}`);
      continue;
    }
    const info = await lstatOrNull(target);
    if (info !== null) await removeEntry(target, info);
    lines.push(`${shown}: ${reason} → ${await link(source, target)}`);
  }

  const managed = await readManaged(targetDir);
  for (const entry of await readdir(targetDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (entry.name === MANIFEST || names.includes(entry.name)) continue;
    if (!entry.isSymbolicLink() && !managed.includes(entry.name)) continue;
    const shown = `.claude/skills/${entry.name}`;
    if (check) {
      lines.push(`${shown}: .agents/skills 里已没有这个 skill`);
      continue;
    }
    const target = path.join(targetDir, entry.name);
    await removeEntry(target, await lstat(target));
    lines.push(`${shown}: .agents/skills 里已没有这个 skill → 删除`);
  }
  if (!check && JSON.stringify(managed) !== JSON.stringify(names)) {
    await writeFile(path.join(targetDir, MANIFEST), `${JSON.stringify(names)}\n`);
  }
  return lines;
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const lines = await syncSkills(path.resolve(import.meta.dirname, ".."), check);
  for (const line of lines) console.log(line);
  if (check && lines.length > 0) {
    console.log("运行 node scripts/sync-agent-adapters.ts 修复");
    process.exitCode = 1;
  }
}

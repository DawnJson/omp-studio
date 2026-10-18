// 渲染进程传来的"相对任务 cwd 的路径"：只允许落在 cwd 之内（不是绝对路径、不含 .. 越界、符号链接解析后仍在 cwd 内）。
import { realpath } from "node:fs/promises";
import path from "node:path";

/** 词法校验并返回绝对路径；越界抛错。不碰磁盘，单测直接用。 */
export function resolveInside(cwd: string, relPath: string): string {
  if (relPath === "" || relPath.includes("\0")) throw new Error("invalid path");
  if (path.isAbsolute(relPath) || path.win32.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) throw new Error("path must be relative to the task directory");
  const resolved = path.resolve(cwd, relPath);
  const relative = path.relative(cwd, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escapes the task directory");
  return resolved;
}

/** 词法校验 + 解析符号链接后再校验一次（文件必须存在）。 */
export async function resolveInsideReal(cwd: string, relPath: string): Promise<string> {
  const lexical = resolveInside(cwd, relPath);
  const [realCwd, realFile] = await Promise.all([realpath(cwd), realpath(lexical)]);
  const relative = path.relative(realCwd, realFile);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path escapes the task directory");
  return realFile;
}

/**
 * 白名单：只有这些扩展名才交给系统默认程序打开，其余一律只能"在文件夹中显示"。
 * 理由：默认程序打开 = 双击，而 Windows 上很多扩展名的默认动作是执行（.py/.pyw 走 py 启动器，.js/.vbs/.wsf 走 WSH，
 * .rb/.pl/.ps1、.jar、.chm、.msc、.pif、.scf、.settingcontent-ms、.lnk……），黑名单永远列不全，
 * 而 agent 刚写出来的文件正是最可能被点的。所以只放没有执行语义的：纯文本和配置、不带宏的文档、图片、
 * 编译型语言的源码（默认无关联或只关联编辑器）。.py/.js/.sh/.html/.svg 有意不在里面。
 * 这是对"双击行为"的判断：用户改过文件关联时无法覆盖；.py 的默认关联我没有在真机上逐一核实，所以宁可不放。
 */
const openableExtensions = new Set([
  ".txt", ".md", ".markdown", ".log", ".csv", ".tsv", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".lock",
  ".css", ".scss", ".less", ".ts", ".tsx", ".jsx", ".mts", ".cts", ".rs", ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".sql", ".diff", ".patch",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf", ".docx", ".xlsx", ".pptx",
]);

/** 在白名单里才可以用系统默认程序直接打开；否则只能"在文件夹中显示"。 */
export function canOpenDirectly(file: string): boolean {
  return openableExtensions.has(path.extname(file).toLowerCase());
}

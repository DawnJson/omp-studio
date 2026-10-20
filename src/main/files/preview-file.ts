// 右侧文件预览的读取：路径校验复用 task-file-path（只允许落在任务 cwd 内），按扩展名/内容分类，限制大小。
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { PreviewFile } from "../../shared/ipc.ts";
import { canOpenDirectly, resolveInside, resolveInsideReal } from "../ipc/task-file-path.ts";

const previewTextMaxBytes = 2 * 1024 * 1024;
const previewImageMaxBytes = 20 * 1024 * 1024;

const imageMime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

const isHtml = (ext: string): boolean => ext === ".html" || ext === ".htm";

/** 绝对路径落在 cwd 内时换算成相对路径（agent 的工具参数常是绝对路径）；其余原样交给 resolveInside 校验。 */
function toRelative(cwd: string, input: string): string {
  if (!path.isAbsolute(input)) return input;
  const relative = path.relative(cwd, input);
  return relative === "" || relative.startsWith("..") || path.isAbsolute(relative) ? input : relative;
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export async function readPreviewFile(cwd: string, input: string): Promise<PreviewFile> {
  const relPath = toRelative(cwd, input);
  const normalized = path.normalize(relPath);
  // 词法校验先于磁盘访问：越界直接抛错，不泄露文件是否存在。
  resolveInside(cwd, normalized);
  let file: string;
  try {
    file = await resolveInsideReal(cwd, normalized);
  } catch (error) {
    if (isMissing(error)) return { kind: "missing", path: normalized, size: 0, canOpen: false };
    throw error;
  }
  const info = await stat(file);
  if (!info.isFile()) return { kind: "missing", path: normalized, size: 0, canOpen: false };
  const ext = path.extname(file).toLowerCase();
  const base = { path: normalized, size: info.size, canOpen: canOpenDirectly(file) };

  const mime = imageMime[ext];
  if (mime !== undefined) {
    if (info.size > previewImageMaxBytes) return { ...base, kind: "too_large" };
    const bytes = await readFile(file);
    return { ...base, kind: "image", dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  }
  if (info.size > previewTextMaxBytes) return { ...base, kind: "too_large" };
  const bytes = await readFile(file);
  // 前 8000 字节含 NUL 视为二进制（和 git 的判断一致）。
  if (bytes.subarray(0, 8000).includes(0)) return { ...base, kind: "binary" };
  return { ...base, kind: isHtml(ext) ? "html" : "text", text: bytes.toString("utf8") };
}

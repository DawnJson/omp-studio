// 右侧文件预览的读取：路径校验复用 task-file-path（只允许落在任务 cwd 内），按扩展名/内容分类，限制大小。
// 位图不在这里读：登记校验过的实际路径，返回 studio-preview:// 地址，<img> 从协议按流读（preview-image.ts）。
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { previewUrl, type PreviewFile } from "../../shared/ipc.ts";
import {
  assertLocalFilePath,
  canOpenDirectly,
  resolveInside,
  resolveInsideReal,
  toRelative,
} from "../ipc/task-file-path.ts";
import { isMissing } from "./list-directory.ts";
import { previewImageMaxBytes, registerPreviewImage } from "./preview-image.ts";

const previewTextMaxBytes = 2 * 1024 * 1024;

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
  assertLocalFilePath(file);
  const info = await stat(file);
  if (!info.isFile()) return { kind: "missing", path: normalized, size: 0, canOpen: false };
  const ext = path.extname(file).toLowerCase();
  const base = { path: normalized, size: info.size, canOpen: canOpenDirectly(file) };

  const mime = imageMime[ext];
  if (mime !== undefined) {
    if (info.size > previewImageMaxBytes) return { ...base, kind: "too_large" };
    // svg 仍给 data URL：源码视图要原文，也不让带脚本的文档出现在协议地址上。
    if (ext !== ".svg") return { ...base, kind: "image", imageUrl: previewUrl(registerPreviewImage(file, mime)) };
    const bytes = await readFile(file);
    return { ...base, kind: "image", imageUrl: `data:${mime};base64,${bytes.toString("base64")}` };
  }
  if (info.size > previewTextMaxBytes) return { ...base, kind: "too_large" };
  const bytes = await readFile(file);
  // 前 8000 字节含 NUL 视为二进制（和 git 的判断一致）。
  if (bytes.subarray(0, 8000).includes(0)) return { ...base, kind: "binary" };
  return { ...base, kind: isHtml(ext) ? "html" : "text", text: bytes.toString("utf8") };
}

// 预览图片的地址：readPreviewFile 校验过的图片登记成 studio-preview://<token>/（token = crypto.randomUUID()），
// <img> 直接从协议按流读文件，不在主线程读整张图、转 base64、再经 IPC 发一条几十 MB 的字符串。
// 只登记已经通过 resolveInsideReal / assertLocalFilePath 的实际路径；取图时再核对一次（实际路径没变、仍是普通文件、不超上限），
// 目录被换成链接、文件被换成目录或变大都拒绝。不写盘、不给渲染进程路径；条数有上限，主窗口重载或关闭时全部清掉。
// 不依赖 electron：协议的登记在 window/preview-protocol.ts。
import { randomUUID } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { Readable } from "node:stream";

export const previewImageMaxBytes = 20 * 1024 * 1024;
/** 同时有效的图片地址上限：回答里每张本地图片挂载时各登记一次；超过时丢最早的（已经显示出来的图不受影响）。 */
const maxImages = 256;

interface PreviewImage {
  file: string;
  mime: string;
}

const images = new Map<string, PreviewImage>();

/** file 必须是校验过的实际路径（realpath）。返回 token；地址由调用方用 previewUrl(token) 拼。 */
export function registerPreviewImage(file: string, mime: string): string {
  const token = randomUUID();
  images.set(token, { file, mime });
  if (images.size > maxImages) images.delete(images.keys().next().value!);
  return token;
}

export function releaseAllPreviewImages(): void {
  images.clear();
}

/** token 对应的图片按流返回；不认识的 token、文件没了、实际路径变了、不是普通文件、超过上限返回 null（协议回 404）。 */
export async function previewImageResponse(token: string): Promise<Response | null> {
  const image = images.get(token);
  if (image === undefined) return null;
  const { file, mime } = image;
  let handle;
  try {
    if ((await realpath(file)) !== file) return null;
    handle = await open(file, "r");
  } catch {
    return null;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > previewImageMaxBytes) {
      await handle.close();
      return null;
    }
  } catch {
    await handle.close();
    return null;
  }
  // 读到上限为止：取图途中文件变大也不多读。流读完或出错时自动关掉文件。
  const body = Readable.toWeb(handle.createReadStream({ end: previewImageMaxBytes - 1 })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": mime,
      "Content-Security-Policy": "default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

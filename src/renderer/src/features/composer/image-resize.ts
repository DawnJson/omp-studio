// 贴图：长边缩到 1568px，转 WebP（arch 3.1：入站帧不超过 1 MiB，不分块）。
import type { PromptImage } from "../../../../shared/ipc.ts";

const MAX_EDGE = 1568;

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function fileToPromptImage(file: Blob): Promise<PromptImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas 2d unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
  return { mimeType: "image/webp", data: await blobToBase64(out) };
}

export function imageSrc(image: PromptImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

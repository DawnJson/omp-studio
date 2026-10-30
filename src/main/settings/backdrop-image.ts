// 主区自选背景图：用户在文件对话框里选一张图，复制进 userData/backdrops（按内容 sha256 命名），设置里只记文件名；
// 页面经 app://studio/@backdrop/<文件名> 读（app-protocol.ts）。扩展名不可信，按文件头确认真是对应格式。
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import { backdropFilePattern, limits } from "../../shared/ipc.ts";
import { renameWithRetry } from "../tasks/atomic-write.ts";
import { getSettings, updateSettings } from "./settings-store.ts";

type ImageFormat = "png" | "jpg" | "webp" | "gif" | "avif";

const extensionFormats: Record<string, ImageFormat> = {
  png: "png",
  jpg: "jpg",
  jpeg: "jpg",
  webp: "webp",
  gif: "gif",
  avif: "avif",
};

export function backdropsDir(): string {
  return path.join(app.getPath("userData"), "backdrops");
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** 文件头魔数对得上 format 吗。AVIF 是 ISO BMFF：ftyp 盒的主品牌或兼容品牌里有 avif / avis。 */
function hasSignature(bytes: Uint8Array, format: ImageFormat): boolean {
  switch (format) {
    case "png":
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
    case "jpg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "gif":
      return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a";
    case "webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    case "avif": {
      if (ascii(bytes, 4, 8) !== "ftyp") return false;
      const boxEnd = Math.min(
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0),
        bytes.length,
      );
      // 主品牌在 8..12，12..16 是版本号，之后到盒尾是兼容品牌，每个 4 字节。
      const brands = [ascii(bytes, 8, 12)];
      for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(ascii(bytes, at, at + 4));
      return brands.includes("avif") || brands.includes("avis");
    }
  }
}

/** 把 source 复制进 dir，返回文件名（<sha256>.<png|jpg|webp|gif|avif>）。超过大小上限、格式不支持、内容和扩展名对不上时抛错。 */
export async function importBackdropImage(source: string, dir: string): Promise<string> {
  const format = extensionFormats[path.extname(source).slice(1).toLowerCase()];
  if (format === undefined) throw new Error(`backdrop file is not a supported image type: ${path.basename(source)}`);
  const tooLarge = `backdrop image is too large (over ${limits.backdropMaxBytes / 1024 / 1024} MB)`;
  // 先看大小再读：不把一个几 GB 的文件整个读进内存。读到的长度再查一次（两步之间文件可能被换掉）。
  if ((await stat(source)).size > limits.backdropMaxBytes) throw new Error(tooLarge);
  const bytes = await readFile(source);
  if (bytes.length > limits.backdropMaxBytes) throw new Error(tooLarge);
  if (!hasSignature(bytes, format))
    throw new Error(`backdrop file is not a valid ${format} image: ${path.basename(source)}`);
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${format}`;
  const file = path.join(dir, name);
  await mkdir(dir, { recursive: true });
  // 自己写临时文件（内容是二进制，writeFileAtomic 只收文本），改名照仓库统一的 renameWithRetry。
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await renameWithRetry(temp, file);
  return name;
}

/** 设置里"自选图片"：弹对话框选图，复制进来并把背景图切到 custom；不再被引用的旧图删掉。用户取消返回 false。 */
export async function chooseBackdropImage(window: BrowserWindow | null): Promise<boolean> {
  const options = {
    properties: ["openFile" as const],
    filters: [{ name: "Images", extensions: Object.keys(extensionFormats) }],
  };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  const source = result.filePaths[0];
  if (result.canceled || source === undefined) return false;
  const dir = backdropsDir();
  const name = await importBackdropImage(source, dir);
  const previous = getSettings().customBackdrop;
  updateSettings({ customBackdrop: name, backdrop: "custom" });
  if (previous !== null && previous !== name && backdropFilePattern.test(previous))
    await rm(path.join(dir, previous), { force: true });
  return true;
}

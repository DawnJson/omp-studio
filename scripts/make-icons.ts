// 从标志数据（src/shared/ui/pixel-pi.ts）生成应用图标和托盘图标，产物提交进仓库：
//   resources/icon.ico：应用图标（exe、安装包、窗口、任务栏）。深色圆角方块上放像素 π（同 omp 官网图标的做法），
//                       16–256 共 9 个尺寸，每个尺寸单独按整数倍画，不靠缩放，小图标也不糊。
//   resources/tray.png：托盘图标，64×64 透明底，π 每像素 4×4；系统缩到 16 / 32 时正好整数倍。
// 用法：node scripts/make-icons.ts（改了 pixel-pi.ts 之后重跑）。
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { cellRects, markHeight, markWidth, piCells, shadow } from "../src/shared/ui/pixel-pi.ts";

const root = path.resolve(import.meta.dirname, "..");
/** 图标底色：近黑带一点紫，和 π 的粉紫渐变同一色系（omp 官网图标是 #0f0a14）。 */
const tileColor = "#15101b";

type Rgba = [number, number, number, number];
const hex = (value: string, alpha = 1): Rgba => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
  alpha,
];

class Canvas {
  readonly size: number;
  readonly data: Float64Array;
  constructor(size: number) {
    this.size = size;
    this.data = new Float64Array(size * size * 4);
  }
  /** 非预乘 RGBA，src-over 混合；coverage 是这一像素被覆盖的面积比例。 */
  blend(x: number, y: number, [r, g, b, a]: Rgba, coverage: number): void {
    const alpha = a * coverage;
    if (alpha <= 0) return;
    const i = (y * this.size + x) * 4;
    const d = this.data;
    const outA = alpha + d[3 + i]! * (1 - alpha);
    if (outA === 0) return;
    for (const [k, c] of [r, g, b].entries()) d[i + k] = (c * alpha + d[i + k]! * d[i + 3]! * (1 - alpha)) / outA;
    d[i + 3] = outA;
  }
  /** 填一个设备坐标里的矩形（可以是小数），边缘按覆盖面积混合。 */
  rect(x0: number, y0: number, x1: number, y1: number, color: Rgba): void {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        const cover = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0));
        if (cover > 0) this.blend(x, y, color, cover);
      }
  }
  /** 圆角方块铺满画布：每像素 4×4 采样算覆盖率。 */
  roundedTile(radius: number, color: Rgba): void {
    const n = this.size;
    const inside = (px: number, py: number) => {
      const cx = Math.min(Math.max(px, radius), n - radius);
      const cy = Math.min(Math.max(py, radius), n - radius);
      return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
    };
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let hits = 0;
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
        this.blend(x, y, color, hits / 16);
      }
  }
  /** 画标志：先淡影后 π；unit = 每个标志像素占几个设备像素，(ox, oy) 是左上角。 */
  mark(unit: number, ox: number, oy: number): void {
    for (const [dx, dy, alpha] of [
      [shadow.dx, shadow.dy, shadow.opacity],
      [0, 0, 1],
    ] as const)
      for (const cell of piCells)
        for (const [x, y, w, h] of cellRects(cell))
          this.rect(
            ox + (x + dx) * unit,
            oy + (y + dy) * unit,
            ox + (x + dx + w) * unit,
            oy + (y + dy + h) * unit,
            hex(cell.color, alpha),
          );
  }
  png(): Buffer {
    const n = this.size;
    const raw = Buffer.alloc((n * 4 + 1) * n);
    for (let y = 0; y < n; y++) {
      raw[y * (n * 4 + 1)] = 0;
      for (let x = 0; x < n * 4; x++) {
        const v = this.data[y * n * 4 + x]!;
        raw[y * (n * 4 + 1) + 1 + x] = Math.round(x % 4 === 3 ? v * 255 : v);
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(n, 0);
    header.writeUInt32BE(n, 4);
    header.set([8, 6, 0, 0, 0], 8); // 8 位 RGBA，非隔行
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** 应用图标的一个尺寸：圆角方块 + 居中的 π。π 宽约占八成，取不超过它的最大整数倍（32px 时每像素 2×2，16px 时 1×1）。 */
function appIcon(size: number): Buffer {
  const canvas = new Canvas(size);
  canvas.roundedTile(size * 0.22, hex(tileColor));
  const unit = Math.max(1, Math.floor((size * 0.82) / markWidth));
  canvas.mark(unit, Math.round((size - markWidth * unit) / 2), Math.round((size - markHeight * unit) / 2));
  return canvas.png();
}

/** 托盘图标：透明底，只有 π。 */
function trayIcon(size: number): Buffer {
  const canvas = new Canvas(size);
  const unit = Math.floor(size / markWidth);
  canvas.mark(unit, Math.round((size - markWidth * unit) / 2), Math.round((size - markHeight * unit) / 2));
  return canvas.png();
}

/** ICO：目录里每项直接放 PNG（Windows Vista 起支持）。 */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
await writeFile(path.join(root, "resources", "icon.ico"), ico(sizes.map((size) => ({ size, png: appIcon(size) }))));
await writeFile(path.join(root, "resources", "tray.png"), trayIcon(64));
console.log(`resources/icon.ico（${sizes.join("、")}）和 resources/tray.png（64）已生成`);

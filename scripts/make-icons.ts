// 从标志数据（src/shared/ui/pixel-pi.ts）生成应用图标和托盘图标，产物提交进仓库：
//   resources/icon.ico：应用图标（exe、安装包、窗口、任务栏）。透明底，只有像素 π 和它的淡影，和界面里的标志一样
//                       画在什么底上就透出什么底；16–256 共 11 个尺寸，每个尺寸单独画（见 markIcon），不靠缩放。
//   resources/tray.png：托盘图标，64×64 透明底，π 每像素 4×4；系统缩到 16 / 32 时正好整数倍。
//   resources/icon.icns：macOS 应用图标（ic07–ic14 的 PNG 条目，32–1024），画法同 icon.ico。
//   resources/trayTemplate.png / trayTemplate@2x.png：macOS 菜单栏模板图（18 / 36px），只有黑色 + alpha，不画淡影。
//   docs/images/icon.png：README 顶部的图标，256×256，画法同 icon.ico。
//   resources/installerSidebar.bmp / installerHeader.bmp：Windows 安装向导的侧边大图和标题横幅（见 wizardImage）。
// 用法：node scripts/make-icons.ts（改了 pixel-pi.ts 之后重跑）。
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { cellRects, markHeight, markWidth, piCells, shadow } from "../src/shared/ui/pixel-pi.ts";

const root = path.resolve(import.meta.dirname, "..");

type Rgba = [number, number, number, number];
const hex = (value: string, alpha = 1): Rgba => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
  alpha,
];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
  constructor(width: number, height = width) {
    this.width = width;
    this.height = height;
    this.data = new Float64Array(width * height * 4);
  }
  /** 非预乘 RGBA，src-over 混合；coverage 是这一像素被覆盖的面积比例。 */
  blend(x: number, y: number, [r, g, b, a]: Rgba, coverage: number): void {
    const alpha = a * coverage;
    if (alpha <= 0) return;
    const i = (y * this.width + x) * 4;
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
  /**
   * 画标志：先淡影后 π；unit = 每个标志像素占几个设备像素，(ox, oy) 是左上角。
   * template = macOS 菜单栏模板图：只有黑色 + alpha（系统按菜单栏明暗反色），不画淡影（淡影的半透明在反色后会糊成一片）。
   */
  mark(unit: number, ox: number, oy: number, template = false): void {
    for (const [dx, dy, alpha] of template
      ? ([[0, 0, 1]] as const)
      : ([
          [shadow.dx, shadow.dy, shadow.opacity],
          [0, 0, 1],
        ] as const))
      for (const cell of piCells)
        for (const [x, y, w, h] of cellRects(cell))
          this.rect(
            ox + (x + dx) * unit,
            oy + (y + dy) * unit,
            ox + (x + dx + w) * unit,
            oy + (y + dy + h) * unit,
            template ? ([0, 0, 0, alpha] as Rgba) : hex(cell.color, alpha),
          );
  }
  png(): Buffer {
    const { width, height } = this;
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (width * 4 + 1)] = 0;
      for (let x = 0; x < width * 4; x++) {
        const v = this.data[y * width * 4 + x]!;
        raw[y * (width * 4 + 1) + 1 + x] = Math.round(x % 4 === 3 ? v * 255 : v);
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8); // 8 位 RGBA，非隔行
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
  /** 24 位 BMP（NSIS 的向导图片只认这种，没有透明）：自下而上逐行 BGR，每行补齐到 4 字节；先填满再画，所以不会有透明像素。 */
  bmp(): Buffer {
    const { width, height } = this;
    const stride = Math.ceil((width * 3) / 4) * 4;
    const file = Buffer.alloc(54 + stride * height);
    file.write("BM", 0, "ascii");
    file.writeUInt32LE(file.length, 2);
    file.writeUInt32LE(54, 10);
    file.writeUInt32LE(40, 14);
    file.writeInt32LE(width, 18);
    file.writeInt32LE(height, 22);
    file.writeUInt16LE(1, 26);
    file.writeUInt16LE(24, 28);
    file.writeUInt32LE(stride * height, 34);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const o = 54 + (height - 1 - y) * stride + x * 3;
        for (const [k, c] of [2, 1, 0].entries()) file[o + k] = Math.round(this.data[i + c]!);
      }
    return file;
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

/**
 * 一个尺寸的图标：透明底，π 居中、尽量铺满宽度。每个标志像素占整数个设备像素最清楚（16px 时 1×1，32px 时 2×2）；
 * 整数倍铺不到四分之三宽时（20、24、36px）改按半像素放大，边上带一点过渡，换来不显小（任务栏在 100% 缩放下用 24px 那张）。
 * template = true 时画成菜单栏模板图（纯黑 + alpha，无淡影）。
 */
function markIcon(size: number, template = false): Buffer {
  const canvas = new Canvas(size);
  const whole = Math.max(1, Math.floor(size / markWidth));
  const unit = whole * markWidth >= size * 0.75 ? whole : Math.floor((size / markWidth) * 2) / 2;
  canvas.mark(unit, Math.round((size - markWidth * unit) / 2), Math.round((size - markHeight * unit) / 2), template);
  return canvas.png();
}

/**
 * 安装向导的图片（electron-builder.yml 的 nsis.installerSidebar / installerHeader），24 位 BMP、不透明：
 *   侧边大图 164×314（欢迎页、完成页左边一栏，卸载向导同用）：应用侧栏的底色 --bg-sidebar，π 每像素 6×6、水平居中、放在上三分之一，
 *     右边一像素 --border 色的分隔线，和应用里侧栏与正文的分界一样。
 *   标题横幅 150×57（其余每页标题栏的右侧，标题栏是白底）：白底，π 每像素 3×3，靠右、垂直居中。
 */
function wizardImage(width: number, height: number, background: string, unit: number, x: number, divider: boolean) {
  const canvas = new Canvas(width, height);
  canvas.rect(0, 0, width, height, hex(background));
  if (divider) canvas.rect(width - 1, 0, width, height, hex("#141412", 0.14));
  canvas.mark(
    unit,
    x,
    Math.round(height > 100 ? height / 3 - (markHeight * unit) / 2 : (height - markHeight * unit) / 2),
  );
  return canvas.bmp();
}
const sidebar = wizardImage(164, 314, "#efefed", 6, Math.round((164 - markWidth * 6) / 2), true);
const header = wizardImage(150, 57, "#ffffff", 3, 150 - markWidth * 3 - 14, false);

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

/**
 * ICNS：'icns' 头（魔数 + 总长，大端）后接若干条目，每条 = 4 字节类型 + 4 字节条目总长（含这 8 字节）+ PNG。
 * ic07/ic08/ic09/ic10 是 128/256/512/1024，ic11–ic14 是 16/32/128/256 的 @2x（像素 32/64/256/512）。
 */
function icns(entries: { type: string; size: number }[]): Buffer {
  const body = entries.map(({ type, size }) => {
    const png = markIcon(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const total = 8 + body.reduce((sum, b) => sum + b.length, 0);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...body]);
}

const sizes = [16, 20, 24, 30, 32, 36, 40, 48, 64, 128, 256];
const icnsEntries = [
  { type: "ic11", size: 32 },
  { type: "ic12", size: 64 },
  { type: "ic07", size: 128 },
  { type: "ic13", size: 256 },
  { type: "ic08", size: 256 },
  { type: "ic14", size: 512 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 },
];
await writeFile(path.join(root, "resources", "icon.ico"), ico(sizes.map((size) => ({ size, png: markIcon(size) }))));
await writeFile(path.join(root, "resources", "tray.png"), markIcon(64));
await writeFile(path.join(root, "resources", "icon.icns"), icns(icnsEntries));
await writeFile(path.join(root, "resources", "trayTemplate.png"), markIcon(18, true));
await writeFile(path.join(root, "resources", "trayTemplate@2x.png"), markIcon(36, true));
await writeFile(path.join(root, "docs", "images", "icon.png"), markIcon(256));
await writeFile(path.join(root, "resources", "installerSidebar.bmp"), sidebar);
await writeFile(path.join(root, "resources", "installerHeader.bmp"), header);
console.log(
  `resources/icon.ico（${sizes.join("、")}）、tray.png（64）、icon.icns（${icnsEntries.map((e) => e.type).join("、")}）、` +
    "trayTemplate.png（18）、trayTemplate@2x.png（36）、docs/images/icon.png（256）、" +
    "installerSidebar.bmp（164×314）和 installerHeader.bmp（150×57）已生成",
);

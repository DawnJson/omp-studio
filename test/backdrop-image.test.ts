import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { backdropFilePattern, limits } from "../src/shared/ipc.ts";

vi.mock("electron", () => ({
  app: { getPath: () => os.tmpdir() },
  dialog: {},
  nativeTheme: { themeSource: "system" },
}));
vi.mock("../src/main/ipc/events.ts", () => ({ emitEvent: vi.fn() }));
vi.mock("../src/main/window/main-window.ts", () => ({ getMainWindow: () => null, isAppUrl: () => false }));

// vi.mock 提升到导入之前，被测模块必须在 mock 之后才加载：这里只能动态导入。
const { importBackdropImage } = await import("../src/main/settings/backdrop-image.ts");

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
// ftyp 盒：长度 28，主品牌 mif1，版本 0，兼容品牌 mif1 / avif / miaf
const avif = Buffer.concat([
  Buffer.from([0, 0, 0, 28]),
  Buffer.from("ftypmif1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("mif1avifmiaf"),
]);

let root = "";
let source = "";
let dir = "";

beforeAll(async () => {
  // 来源和目标路径都带空格和中文。
  root = await mkdtemp(path.join(os.tmpdir(), "omp studio 背景 "));
  source = path.join(root, "我的 图片");
  dir = path.join(root, "用户 数据", "backdrops");
  await mkdir(source, { recursive: true });
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function sample(name: string, content: Buffer): Promise<string> {
  const file = path.join(source, name);
  await writeFile(file, content);
  return file;
}

describe("importBackdropImage", () => {
  it.each([
    ["壁纸 一.png", png, "png"],
    ["照片 二.JPEG", jpeg, "jpg"],
    ["照片 三.jpg", jpeg, "jpg"],
    ["动图 四.gif", gif, "gif"],
    ["图 五.webp", webp, "webp"],
    ["图 六.avif", avif, "avif"],
  ])("%s 按内容 sha256 命名、扩展名规范成 %s 后复制进来", async (name, content, ext) => {
    const imported = await importBackdropImage(await sample(name, content), dir);
    expect(imported).toBe(`${createHash("sha256").update(content).digest("hex")}.${ext}`);
    expect(imported).toMatch(backdropFilePattern);
    expect(await readFile(path.join(dir, imported))).toEqual(content);
  });

  it("同一张图再选一次还是同一个文件，目录里没有临时文件", async () => {
    const file = await sample("重复 的.png", png);
    expect(await importBackdropImage(file, dir)).toBe(await importBackdropImage(file, dir));
    expect((await readdir(dir)).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it.each([
    ["其实是文本.png", Buffer.from("not an image at all")],
    ["其实是 png.jpg", png],
    ["空的.webp", Buffer.alloc(0)],
    ["只有 RIFF.webp", Buffer.from("RIFF\x14\x00\x00\x00WAVE", "latin1")],
    ["heic 不是 avif.avif", Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from("ftypheic\0\0\0\0mif1")])],
  ])("%s 的内容不是对应格式：拒绝，不写进目录", async (name, content) => {
    const before = await readdir(dir).catch(() => []);
    await expect(importBackdropImage(await sample(name, content), dir)).rejects.toThrow(/is not a valid \w+ image/);
    expect(await readdir(dir).catch(() => [])).toEqual(before);
  });

  it("不支持的扩展名：拒绝", async () => {
    await expect(importBackdropImage(await sample("图.bmp", png), dir)).rejects.toThrow(/not a supported image type/);
  });

  it("超过大小上限：不读内容就拒绝", async () => {
    const file = path.join(source, "太大 的.png");
    await writeFile(file, png);
    const handle = await open(file, "r+");
    await handle.truncate(limits.backdropMaxBytes + 1);
    await handle.close();
    await expect(importBackdropImage(file, dir)).rejects.toThrow(/too large \(over 20 MB\)/);
  });
});

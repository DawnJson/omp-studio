import { mkdir, mkdtemp, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPreviewFile } from "../src/main/files/preview-file.ts";
import { previewImageMaxBytes, registerPreviewImage } from "../src/main/files/preview-image.ts";
import {
  previewResponse,
  registerPreview,
  releaseAllPreviews,
  releasePreview,
} from "../src/main/window/preview-protocol.ts";

vi.mock("electron", () => ({ net: {}, protocol: {}, app: { getPath: () => "C:\\Users\\someone\\AppData" } }));

const get = (url: string, method = "GET") => previewResponse(new Request(url, { method }));
const uuidUrl = /^studio-preview:\/\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/$/;

// 防的是：猜到 / 留着旧地址就能读到别的预览网页，以及页面的 CSP 被放宽（能联网、能被别的页面嵌入）。
describe("studio-preview 协议", () => {
  it("已登记的 token 返回网页，带固定 CSP", async () => {
    const token = registerPreview("<h1>hi</h1>");
    const response = await get(`studio-preview://${token}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<h1>hi</h1>");
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; " +
        "font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; " +
        "frame-ancestors app://studio",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    releasePreview(token);
  });

  it("token 是随机 UUID，每次不同", () => {
    const a = registerPreview("");
    const b = registerPreview("");
    expect(`studio-preview://${a}/`).toMatch(uuidUrl);
    expect(a).not.toBe(b);
    releaseAllPreviews();
  });

  it("不认识的 token 404", async () => {
    expect((await get("studio-preview://00000000-0000-4000-8000-000000000000/")).status).toBe(404);
  });

  it("放手后同一地址 404；全部清掉后也 404", async () => {
    const released = registerPreview("<p>a</p>");
    releasePreview(released);
    expect((await get(`studio-preview://${released}/`)).status).toBe(404);
    const cleared = registerPreview("<p>b</p>");
    releaseAllPreviews();
    expect((await get(`studio-preview://${cleared}/`)).status).toBe(404);
  });

  it("子路径、非 GET 404", async () => {
    const token = registerPreview("<p>c</p>");
    expect((await get(`studio-preview://${token}/other.html`)).status).toBe(404);
    expect((await get(`studio-preview://${token}/`, "POST")).status).toBe(404);
    releasePreview(token);
  });
});

// 位图：readPreviewFile 只登记校验过的实际路径，协议按 token 流式给字节；没登记的路径、事后被换掉的文件都拿不到。
describe("studio-preview 协议：预览位图", () => {
  let scratch = "";
  let root = "";
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
  beforeEach(async () => {
    scratch = await mkdtemp(path.join(os.tmpdir(), "omp-preview-image-"));
    root = path.join(scratch, "项目 目录");
    await mkdir(path.join(root, "子 目录"), { recursive: true });
    await writeFile(path.join(root, "子 目录", "截图 1.png"), png);
  });
  afterEach(async () => {
    releaseAllPreviews();
    await rm(scratch, { recursive: true, force: true });
  });

  it("位图给协议地址，按流返回原字节和图片类型；svg 仍是 data URL", async () => {
    const file = await readPreviewFile(root, path.join("子 目录", "截图 1.png"));
    expect(file.kind).toBe("image");
    expect(file.imageUrl).toMatch(uuidUrl);
    const response = await get(file.imageUrl!);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);

    await writeFile(path.join(root, "a.svg"), "<svg/>");
    expect((await readPreviewFile(root, "a.svg")).imageUrl).toBe(
      `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`,
    );
  });

  it("地址里写路径、没登记的 token、清掉后的 token 都 404", async () => {
    const real = path.join(root, "子 目录", "截图 1.png");
    expect((await get(`studio-preview://${encodeURIComponent(real)}/`)).status).toBe(404);
    expect((await get(`studio-preview://00000000-0000-4000-8000-000000000000/`)).status).toBe(404);
    const { imageUrl } = await readPreviewFile(root, real);
    releaseAllPreviews();
    expect((await get(imageUrl!)).status).toBe(404);
  });

  it("登记后文件被删、变大超限、父目录被换成指向外面的链接：404", async () => {
    const real = path.join(root, "子 目录", "截图 1.png");
    const removed = (await readPreviewFile(root, real)).imageUrl!;
    const grown = (await readPreviewFile(root, real)).imageUrl!;
    await truncate(real, previewImageMaxBytes + 1);
    expect((await get(grown)).status).toBe(404);

    // 外面放一张同名图，把子目录换成指向外面的目录链接（Windows 上用 junction，不需要管理员权限）。
    const outside = path.join(scratch, "外面");
    await mkdir(outside);
    await writeFile(path.join(outside, "截图 1.png"), png);
    await rename(path.join(root, "子 目录"), path.join(root, "旧"));
    await symlink(outside, path.join(root, "子 目录"), "junction");
    expect((await get(removed)).status).toBe(404);
    await rm(path.join(root, "子 目录"));
    expect((await get(removed)).status).toBe(404);
  });

  it("登记条数有上限：最早的地址失效", async () => {
    const real = path.join(root, "子 目录", "截图 1.png");
    const first = registerPreviewImage(real, "image/png");
    for (let i = 0; i < 256; i += 1) registerPreviewImage(real, "image/png");
    expect((await get(`studio-preview://${first}/`)).status).toBe(404);
  });
});

import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BuildServiceError,
  buildTarget,
  downloadVerified,
  fetchBuild,
  VerifyError,
  type BuildInfo,
} from "../src/main/omp-manager/build-service.ts";
import {
  installBuild,
  managedLayout,
  pruneVersions,
  sweepOldBinaries,
  type ManagedLayout,
} from "../src/main/omp-manager/installer.ts";
import { encodeSingleStreamPatch } from "./hpatch-encoder.ts";

let server: http.Server;
let baseUrl: string;
let scratch: string;
/** 假构建服务当前发布的内容。patch：带 from_version 来问时附上的补丁（from 是补丁的起点 exe）。 */
const published = {
  version: "18.12.1",
  bytes: randomBytes(300_000),
  corrupt: false,
  missing: false,
  patch: null as { from: Buffer; bytes: Buffer } | null,
  fullDownloads: 0,
};

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 安装 "));
  server = http.createServer((request, response) => {
    if (request.url?.startsWith("/api/products/omp/")) {
      if (published.missing) {
        response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "no_build" }));
        return;
      }
      const patch = request.url.includes("from_version=") && published.patch;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          build: { version: published.version },
          file: {
            name: "omp-windows-x64.exe",
            size: published.bytes.length,
            sha256: sha256(published.bytes).toUpperCase(),
          },
          download: "/d/omp/omp.exe",
          ...(patch && {
            patch: {
              format: "file",
              from_sha256: sha256(patch.from),
              size: patch.bytes.length,
              sha256: sha256(patch.bytes),
              url: "/d/omp/omp.patch",
            },
          }),
        }),
      );
      return;
    }
    if (request.url === "/d/omp/omp.patch" && published.patch) {
      response.writeHead(200, { "content-length": published.patch.bytes.length }).end(published.patch.bytes);
      return;
    }
    // 下载：corrupt 时改一个字节，长度不变，只有 sha256 能发现。
    published.fullDownloads++;
    const body = Buffer.from(published.bytes);
    if (published.corrupt) body[10] = (body[10] ?? 0) ^ 0xff;
    response.writeHead(200, { "content-length": body.length }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await rm(scratch, { recursive: true, force: true });
});

const fetchOptions = () => ({
  fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal | undefined }) =>
    fetch(url, init as RequestInit),
  baseUrl,
});
const full = (build: BuildInfo) => ({ url: build.downloadUrl, size: build.file.size, sha256: build.file.sha256 });

describe("fetchBuild", () => {
  it("reads version, size and sha256 (lower-cased) and resolves the signed download link against the service", async () => {
    published.missing = false;
    const build = await fetchBuild({ ...fetchOptions(), target: buildTarget("win32", "x64") });
    expect(build.version).toBe("18.12.1");
    expect(build.file.sha256).toBe(sha256(published.bytes));
    expect(build.downloadUrl).toBe(`${baseUrl}/d/omp/omp.exe`);
  });

  it("reports a target with no published build as no_build, not as a crash", async () => {
    published.missing = true;
    await expect(fetchBuild(fetchOptions())).rejects.toMatchObject({
      name: "BuildServiceError",
      kind: "no_build",
    } satisfies Partial<BuildServiceError>);
    published.missing = false;
  });
});

describe("downloadVerified", () => {
  it("throws VerifyError and leaves no file when the bytes are corrupted but the size is right", async () => {
    published.corrupt = true;
    const dest = path.join(scratch, "坏的 omp.exe");
    const build = await fetchBuild(fetchOptions());
    await expect(downloadVerified({ ...fetchOptions(), source: full(build), dest })).rejects.toBeInstanceOf(
      VerifyError,
    );
    published.corrupt = false;
    expect(
      await stat(dest).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(
      await stat(`${dest}.partial`).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  it("rejects a size mismatch even when the hash was computed over what arrived", async () => {
    const build = await fetchBuild(fetchOptions());
    const dest = path.join(scratch, "短的.exe");
    await expect(
      downloadVerified({ ...fetchOptions(), source: { ...full(build), size: build.file.size + 1 }, dest }),
    ).rejects.toThrow(/size mismatch/);
  });

  it("reports progress up to the full size", async () => {
    const build = await fetchBuild(fetchOptions());
    let last = 0;
    await downloadVerified({
      ...fetchOptions(),
      source: full(build),
      dest: path.join(scratch, "进度.exe"),
      onProgress: (received) => (last = received),
    });
    expect(last).toBe(published.bytes.length);
  });
});

describe("installBuild", () => {
  it("installs into versions/ and bin/, writes manager.json, and swaps bin/omp.exe by renaming the running one away", async () => {
    const root = path.join(scratch, "安装 目录", "omp");
    const layout = managedLayout(root);
    await mkdir(layout.binDir, { recursive: true });
    await writeFile(layout.binExe, "old-version-bytes");

    published.version = "18.12.1";
    await installBuild(layout, { ...fetchOptions(), build: await fetchBuild(fetchOptions()) });

    expect(await readFile(layout.binExe)).toEqual(published.bytes);
    expect(JSON.parse(await readFile(layout.managerJson, "utf8"))).toEqual({
      manager: "omp-studio",
      name: "omp-studio",
    });
    const binNames = await readdir(layout.binDir);
    // 旧 exe 改了名留在 bin 里（可能还有进程在用），不是被覆盖。
    expect(binNames.some((name) => name.startsWith(`.${path.basename(layout.binExe)}.old-`))).toBe(true);
    expect(await readdir(layout.versionsDir)).toEqual([`18.12.1${path.extname(layout.binExe)}`]);
  });

  it("keeps the newest three versions and never the partial leftovers", async () => {
    const layout = managedLayout(path.join(scratch, "保留", "omp"));
    for (const version of ["18.12.1", "18.12.2", "18.12.3", "18.12.4"]) {
      published.version = version;
      await installBuild(layout, { ...fetchOptions(), build: await fetchBuild(fetchOptions()) });
    }
    await writeFile(path.join(layout.versionsDir, "18.12.9.exe.partial"), "junk");
    published.version = "18.12.5";
    await installBuild(layout, { ...fetchOptions(), build: await fetchBuild(fetchOptions()) });
    const ext = path.extname(layout.binExe);
    expect((await readdir(layout.versionsDir)).sort()).toEqual([`18.12.3${ext}`, `18.12.4${ext}`, `18.12.5${ext}`]);
  });

  // 无扩展名的布局（mac / Linux 的 bin/omp）：用手搭的 layout 在任何平台上都能真跑 pruneVersions 的筛选逻辑。
  it("without a file extension, prunes only old versions and never treats .partial/.patch leftovers as versions", async () => {
    const root = path.join(scratch, "无扩展名", "omp");
    const layout: ManagedLayout = {
      root,
      versionsDir: path.join(root, "versions"),
      binDir: path.join(root, "bin"),
      binExe: path.join(root, "bin", "omp"),
      managerJson: path.join(root, "manager.json"),
    };
    await mkdir(layout.versionsDir, { recursive: true });
    for (const name of ["18.12.1", "18.12.2", "18.12.3", "18.12.4", "18.12.5", "18.12.9.partial", "18.12.9.patch"])
      await writeFile(path.join(layout.versionsDir, name), "x");
    await pruneVersions(layout, "18.12.5");
    expect((await readdir(layout.versionsDir)).sort()).toEqual(["18.12.3", "18.12.4", "18.12.5"]);
  });

  it("names the swap temp files after the binary's own file name", async () => {
    const root = path.join(scratch, "临时名", "omp");
    const layout: ManagedLayout = {
      root,
      versionsDir: path.join(root, "versions"),
      binDir: path.join(root, "bin"),
      binExe: path.join(root, "bin", "omp"),
      managerJson: path.join(root, "manager.json"),
    };
    await mkdir(layout.binDir, { recursive: true });
    await writeFile(layout.binExe, "old-version-bytes");
    published.version = "18.12.1";
    await installBuild(layout, { ...fetchOptions(), build: await fetchBuild(fetchOptions()) });
    expect((await readdir(layout.binDir)).some((name) => name.startsWith(".omp.old-"))).toBe(true);
    await sweepOldBinaries(layout);
    expect((await readdir(layout.binDir)).sort()).toEqual(["omp"]);
  });

  // Windows 没有执行位（stat 的 mode 恒为 0666），这条只能在 mac / Linux 上验证真正的 chmod。
  it.skipIf(process.platform === "win32")("leaves both bin/omp and versions/<v> executable on POSIX", async () => {
    const layout = managedLayout(path.join(scratch, "可执行", "omp"));
    published.version = "18.12.1";
    await installBuild(layout, { ...fetchOptions(), build: await fetchBuild(fetchOptions()) });
    expect((await stat(layout.binExe)).mode & 0o111).toBe(0o111);
    expect((await stat(path.join(layout.versionsDir, "18.12.1"))).mode & 0o111).toBe(0o111);
  });
});

describe("installBuild with a patch", () => {
  // 旧版 100 KB；新版 = 旧版前半段（改了几个字节）+ 3000 字节新文字 + 旧版后半段。
  const oldBytes = randomBytes(100_000);
  const inserted = Buffer.from("omp 18.12.2 新增的代码段。".repeat(120)).subarray(0, 3000);
  const head = Buffer.from(oldBytes.subarray(0, 50_000));
  head[100] = (head[100] ?? 0) ^ 0x55;
  head[40_000] = (head[40_000] ?? 0) ^ 0x0f;
  const newBytes = Buffer.concat([head, inserted, oldBytes.subarray(50_000)]);
  const covers = [
    { oldPos: 0, newPos: 0, length: 50_000 },
    { oldPos: 50_000, newPos: 53_000, length: 50_000 },
  ];

  async function installedOld(name: string, bytes: Buffer = oldBytes) {
    const layout = managedLayout(path.join(scratch, name, "omp"));
    await mkdir(layout.binDir, { recursive: true });
    await writeFile(layout.binExe, bytes);
    return layout;
  }
  async function update(layout: ManagedLayout) {
    published.version = "18.12.2";
    published.bytes = newBytes;
    published.fullDownloads = 0;
    await installBuild(layout, {
      ...fetchOptions(),
      build: await fetchBuild({ ...fetchOptions(), fromVersion: "18.12.1" }),
      fromExe: layout.binExe,
    });
  }

  it("downloads only the patch, and the patched exe is byte-for-byte the build; no patch file is left behind", async () => {
    published.patch = { from: oldBytes, bytes: encodeSingleStreamPatch(oldBytes, newBytes, covers, "zstd") };
    const layout = await installedOld("补丁 成功");
    await update(layout);
    expect(published.fullDownloads).toBe(0);
    expect(await readFile(layout.binExe)).toEqual(newBytes);
    expect(await readdir(layout.versionsDir)).toEqual([`18.12.2${path.extname(layout.binExe)}`]);
  });

  it("falls back to the full download when the installed exe is not the one the patch was made from", async () => {
    published.patch = { from: oldBytes, bytes: encodeSingleStreamPatch(oldBytes, newBytes, covers, "zstd") };
    const layout = await installedOld("补丁 起点不对", randomBytes(100_000));
    await update(layout);
    expect(published.fullDownloads).toBe(1);
    expect(await readFile(layout.binExe)).toEqual(newBytes);
  });

  it("falls back to the full download when the patched result does not match the build's sha256", async () => {
    const wrong = Buffer.from(newBytes);
    wrong[60_000] = (wrong[60_000] ?? 0) ^ 0xff;
    published.patch = { from: oldBytes, bytes: encodeSingleStreamPatch(oldBytes, wrong, covers, "") };
    const layout = await installedOld("补丁 结果不对");
    await update(layout);
    expect(published.fullDownloads).toBe(1);
    expect(await readFile(layout.binExe)).toEqual(newBytes);
    expect(
      (await readdir(layout.versionsDir)).filter((name) => name.endsWith(".patch") || name.endsWith(".partial")),
    ).toEqual([]);
  });
});

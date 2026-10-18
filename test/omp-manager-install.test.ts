import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BuildServiceError, buildTarget, downloadVerified, fetchBuild, VerifyError } from "../src/main/omp-manager/build-service.ts";
import { installBuild, managedLayout } from "../src/main/omp-manager/installer.ts";

let server: http.Server;
let baseUrl: string;
let scratch: string;
/** 假构建服务当前发布的内容。 */
const published = { version: "18.12.1", bytes: randomBytes(300_000), corrupt: false, missing: false };

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
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          build: { version: published.version },
          file: { name: "omp-windows-x64.exe", size: published.bytes.length, sha256: sha256(published.bytes).toUpperCase() },
          download: "/d/omp/omp.exe",
        }),
      );
      return;
    }
    // 下载：corrupt 时改一个字节，长度不变，只有 sha256 能发现。
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

const fetchOptions = () => ({ fetch: (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal | undefined }) => fetch(url, init as RequestInit), baseUrl });

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
    await expect(fetchBuild(fetchOptions())).rejects.toMatchObject({ name: "BuildServiceError", kind: "no_build" } satisfies Partial<BuildServiceError>);
    published.missing = false;
  });
});

describe("downloadVerified", () => {
  it("throws VerifyError and leaves no file when the bytes are corrupted but the size is right", async () => {
    published.corrupt = true;
    const dest = path.join(scratch, "坏的 omp.exe");
    const build = await fetchBuild(fetchOptions());
    await expect(downloadVerified({ ...fetchOptions(), build, dest })).rejects.toBeInstanceOf(VerifyError);
    published.corrupt = false;
    expect(await stat(dest).then(() => true, () => false)).toBe(false);
    expect(await stat(`${dest}.partial`).then(() => true, () => false)).toBe(false);
  });

  it("rejects a size mismatch even when the hash was computed over what arrived", async () => {
    const build = await fetchBuild(fetchOptions());
    const dest = path.join(scratch, "短的.exe");
    await expect(downloadVerified({ ...fetchOptions(), build: { ...build, file: { ...build.file, size: build.file.size + 1 } }, dest })).rejects.toThrow(/size mismatch/);
  });

  it("reports progress up to the full size", async () => {
    const build = await fetchBuild(fetchOptions());
    let last = 0;
    await downloadVerified({ ...fetchOptions(), build, dest: path.join(scratch, "进度.exe"), onProgress: (received) => (last = received) });
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
    expect(JSON.parse(await readFile(layout.managerJson, "utf8"))).toEqual({ manager: "omp-studio", name: "omp-studio" });
    const binNames = await readdir(layout.binDir);
    // 旧 exe 改了名留在 bin 里（可能还有进程在用），不是被覆盖。
    expect(binNames.some((name) => name.startsWith(".omp.exe.old-"))).toBe(true);
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
});

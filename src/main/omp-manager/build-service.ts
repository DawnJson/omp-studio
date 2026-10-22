// 官方构建服务（build.stencil.so）：查版本、下载并按 size + sha256 校验。接口见 docs/architecture/omp-install.md "自己管理时的下载"。
// 这里只收 `fetch` 实现作参数：应用里传 electron 的 net.fetch（走系统代理），测试里传指向本地假服务器的 fetch。
// 带 `?from_version=` 时应答多一个 `patch`（HDiffPatch 单流补丁，应用在 hpatch.ts），补丁的下载同样按 size + sha256 校验。
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export const DEFAULT_BUILD_URL = "https://build.stencil.so";

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal | undefined },
) => Promise<Response>;

interface BuildFile {
  name: string;
  size: number;
  sha256: string;
}

/** 一个可下载、可校验的文件：size 和 sha256 都对上才算下载成功。 */
interface Download {
  /** 带签名的直链，10 分钟有效。不写日志，不进错误信息。 */
  url: string;
  size: number;
  sha256: string;
}

/** 从 fromSha256 那个 exe 到这次 build 的补丁。 */
export interface BuildPatch extends Download {
  fromSha256: string;
}

export interface BuildInfo {
  version: string;
  file: BuildFile;
  /** 带签名的直链，10 分钟有效。不写日志，不进错误信息。 */
  downloadUrl: string;
  /** 只有请求时带了 fromVersion、且服务已经生成好补丁时才有。 */
  patch: BuildPatch | null;
}

export class BuildServiceError extends Error {
  override name = "BuildServiceError";
  /** `no_build`：这个 target 没有发布；`http`：服务返回了错误状态；`format`：应答不是约定的形状。 */
  readonly kind: "no_build" | "http" | "format";

  constructor(kind: BuildServiceError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/** 下载完但 size 或 sha256 对不上：文件已丢弃。 */
export class VerifyError extends Error {
  override name = "VerifyError";
}

/** 构建服务的 target 名（`omp-install.md`；取值照 omp 的 `scripts/install.ps1`：`windows-x86_64` / `windows-arm64`）。 */
export function buildTarget(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const os = platform === "win32" ? "windows" : platform === "darwin" ? "macos" : "linux";
  return `${os}-${arch === "arm64" ? "arm64" : "x86_64"}`;
}

function field(object: unknown, name: string): unknown {
  return typeof object === "object" && object !== null ? (object as Record<string, unknown>)[name] : undefined;
}

export interface FetchBuildOptions {
  fetch: FetchFn;
  baseUrl?: string | undefined;
  target?: string | undefined;
  /** 指定版本；不给就取 stable 的最新版。 */
  version?: string | undefined;
  /** 已装的版本：服务据此附上从它到最新版的补丁。 */
  fromVersion?: string | undefined;
  signal?: AbortSignal | undefined;
}

export async function fetchBuild(options: FetchBuildOptions): Promise<BuildInfo> {
  const base = (options.baseUrl ?? DEFAULT_BUILD_URL).replace(/\/+$/, "");
  const target = options.target ?? buildTarget();
  const url = options.version
    ? `${base}/api/products/omp/versions/${encodeURIComponent(options.version)}/${target}`
    : `${base}/api/products/omp/latest/${target}?channel=stable${options.fromVersion ? `&from_version=${encodeURIComponent(options.fromVersion)}` : ""}`;
  const response = await options.fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "omp-studio" },
    signal: options.signal,
  });
  if (response.status === 404) throw new BuildServiceError("no_build", `no omp build is published for ${target}`);
  if (!response.ok) throw new BuildServiceError("http", `build service answered ${response.status}`);
  const json: unknown = await response.json();
  const version = field(field(json, "build"), "version");
  const file = field(json, "file");
  const name = field(file, "name");
  const size = field(file, "size");
  const sha256 = field(file, "sha256");
  const download = field(json, "download");
  if (
    typeof version !== "string" ||
    typeof name !== "string" ||
    typeof size !== "number" ||
    typeof sha256 !== "string" ||
    typeof download !== "string"
  ) {
    throw new BuildServiceError("format", "the build service answer is missing version, file or download");
  }
  return {
    version,
    file: { name, size, sha256: sha256.toLowerCase() },
    downloadUrl: new URL(download, base).toString(),
    patch: parsePatch(field(json, "patch"), base),
  };
}

/** 只认 `format: "file"`（整文件补丁，2026-10-18 实测）；别的格式、字段不全、补丁还没生成好（`patch_pending`）都当没有补丁。 */
function parsePatch(patch: unknown, base: string): BuildPatch | null {
  const url = field(patch, "url");
  const size = field(patch, "size");
  const sha256 = field(patch, "sha256");
  const fromSha256 = field(patch, "from_sha256");
  if (
    field(patch, "format") !== "file" ||
    typeof url !== "string" ||
    typeof size !== "number" ||
    typeof sha256 !== "string" ||
    typeof fromSha256 !== "string"
  )
    return null;
  return {
    url: new URL(url, base).toString(),
    size,
    sha256: sha256.toLowerCase(),
    fromSha256: fromSha256.toLowerCase(),
  };
}

export interface DownloadOptions {
  fetch: FetchFn;
  source: Download;
  /** 最终文件；下载先写到 `<dest>.partial`，校验通过才改名。 */
  dest: string;
  onProgress?: ((receivedBytes: number, totalBytes: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}

/** 流式下载，边下边算 sha256。size 和 sha256 都对上才把 partial 改名为 dest，否则删掉 partial 并抛 VerifyError。 */
export async function downloadVerified(options: DownloadOptions): Promise<void> {
  const { source, dest } = options;
  const partial = `${dest}.partial`;
  const response = await options.fetch(source.url, { signal: options.signal });
  if (!response.ok || !response.body) throw new BuildServiceError("http", `download answered ${response.status}`);
  const hash = createHash("sha256");
  let received = 0;
  const tally = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      options.onProgress?.(received, source.size);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
      tally,
      createWriteStream(partial),
      ...(options.signal ? [{ signal: options.signal }] : []),
    );
    const digest = hash.digest("hex");
    if (received !== source.size)
      throw new VerifyError(`size mismatch: expected ${source.size} bytes, got ${received}`);
    if (digest !== source.sha256) throw new VerifyError("sha256 mismatch");
    await rename(partial, dest);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

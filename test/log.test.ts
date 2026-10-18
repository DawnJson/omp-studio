// 主进程日志：防的是日志里漏出用户名、家目录、key（AGENTS.md 隐私），以及按天换文件、过期删除出错。
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRedactor, Logger, RETAIN_DAYS } from "../src/main/log/log.ts";

describe("createRedactor", () => {
  const redact = createRedactor({ home: "C:\\Users\\Zhang San", user: "Zhang San" });

  it("replaces the home directory however it is spelled: case, slashes, JSON-escaped", () => {
    expect(redact("open C:\\Users\\Zhang San\\proj\\a.ts")).toBe("open ~\\proj\\a.ts");
    expect(redact("c:\\users\\zhang san\\x")).toBe("~\\x");
    expect(redact("cwd C:/Users/Zhang San/proj")).toBe("cwd ~/proj");
    expect(redact('{"cwd":"C:\\\\Users\\\\Zhang San\\\\proj"}')).toBe('{"cwd":"~\\\\proj"}');
  });

  it("replaces the user name outside the home directory, but not inside longer words", () => {
    expect(redact("D:\\work\\Zhang San\\x and zhang sanity")).toBe("D:\\work\\<user>\\x and zhang sanity");
  });

  it("masks keys, tokens and signed URL parameters", () => {
    expect(redact("key sk-ant-api03-abcdefghijklmnop end")).toBe("key sk-<redacted> end");
    expect(redact("Authorization: Bearer eyJhbGciOi.payload.sig")).toBe("Authorization: Bearer <redacted>");
    expect(redact('{"apiKey":"AIzaSyD-123","refresh_token": "r1"}')).toBe('{"apiKey":"<redacted>","refresh_token": "<redacted>"}');
    expect(redact("GET https://x.r2.cloudflarestorage.com/b/omp.exe?X-Amz-Signature=abc&X-Amz-Date=1 failed")).toBe("GET https://x.r2.cloudflarestorage.com/b/omp.exe?<redacted> failed");
  });

  it("leaves a short user name alone so ordinary words survive", () => {
    expect(createRedactor({ home: "/home/al", user: "al" })("all calls at /home/al/x")).toBe("all calls at ~/x");
  });
});

describe("Logger", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("writes one file per local day, redacted, and deletes files older than the retention window", async () => {
    dir = path.join(await mkdtemp(path.join(os.tmpdir(), "omp-studio 日志 ")), "logs");
    let now = new Date(2026, 9, 18, 23, 59);
    const logger = new Logger({ dir, now: () => now, redact: createRedactor({ home: "C:\\Users\\Zhang San", user: "Zhang San" }) });
    logger.write("info", "first", []);
    const stale = path.join(dir, "main-2026-09-01.log");
    const kept = path.join(dir, `main-2026-10-${String(19 - RETAIN_DAYS + 1).padStart(2, "0")}.log`);
    await writeFile(stale, "old");
    await writeFile(kept, "recent");
    await writeFile(path.join(dir, "notes.txt"), "not a log");

    now = new Date(2026, 9, 19, 0, 1);
    logger.write("error", "failed at %s", ["C:\\Users\\Zhang San\\proj"]);
    logger.write("warn", "boom", [new Error("bad sk-abcdefghijkl")]);

    expect((await readdir(dir)).sort()).toEqual([path.basename(kept), "main-2026-10-18.log", "main-2026-10-19.log", "notes.txt"].sort());
    const today = await readFile(path.join(dir, "main-2026-10-19.log"), "utf8");
    expect(today).toContain("ERROR failed at ~\\proj\n");
    expect(today).toContain("Error: bad sk-<redacted>");
    expect(today).not.toContain("Zhang San");
    expect(logger.files().map((file) => path.basename(file))).toEqual(["main-2026-10-19.log", "main-2026-10-18.log", path.basename(kept)]);
  });
});

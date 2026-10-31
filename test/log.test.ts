// 主进程日志：防的是日志里漏出用户名、家目录、key（docs/architecture/security.md「日志和脱敏」），以及按天换文件、过期删除出错。
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
    expect(redact('{"apiKey":"AIzaSyD-123","refresh_token": "r1"}')).toBe(
      '{"apiKey":"<redacted>","refresh_token": "<redacted>"}',
    );
    expect(redact("GET https://x.r2.cloudflarestorage.com/b/omp.exe?X-Amz-Signature=abc&X-Amz-Date=1 failed")).toBe(
      "GET https://x.r2.cloudflarestorage.com/b/omp.exe?<redacted> failed",
    );
  });

  it("leaves a short user name alone so ordinary words survive", () => {
    expect(createRedactor({ home: "/home/al", user: "al" })("all calls at /home/al/x")).toBe("all calls at ~/x");
  });

  it("replaces percent-encoded home paths from ESM stack frames", () => {
    expect(redact("at file:///C:/Users/Zhang%20San/AppData/Local/Programs/omp-studio/main.js:1:2")).toBe(
      "at file:///~/AppData/Local/Programs/omp-studio/main.js:1:2",
    );
    const cjk = createRedactor({ home: "C:\\Users\\张三", user: "张三" });
    expect(cjk("at file:///C:/Users/%E5%BC%A0%E4%B8%89/x.js and c:/users/%e5%bc%a0%e4%b8%89/y.js")).toBe(
      "at file:///~/x.js and ~/y.js",
    );
  });

  it("replaces a two-character CJK user name anywhere, raw or percent-encoded", () => {
    const cjk = createRedactor({ home: "C:\\Users\\张三", user: "张三" });
    expect(cjk("owner DESKTOP-1\\张三, url /%E5%BC%A0%E4%B8%89/")).toBe("owner DESKTOP-1\\<user>, url /<user>/");
  });
});

describe("Logger", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("writes one file per local day, redacted, and deletes files older than the retention window", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "omp-studio 日志 "));
    const dir = path.join(root, "logs");
    let now = new Date(2026, 9, 18, 23, 59);
    const logger = new Logger({
      dir,
      now: () => now,
      redact: createRedactor({ home: "C:\\Users\\Zhang San", user: "Zhang San" }),
    });
    logger.write("info", "first", []);
    await logger.flush();
    const stale = path.join(dir, "main-2026-09-01.log");
    const kept = path.join(dir, `main-2026-10-${String(19 - RETAIN_DAYS + 1).padStart(2, "0")}.log`);
    await writeFile(stale, "old");
    await writeFile(kept, "recent");
    await writeFile(path.join(dir, "notes.txt"), "not a log");

    now = new Date(2026, 9, 19, 0, 1);
    logger.write("error", "failed at %s", ["C:\\Users\\Zhang San\\proj"]);
    logger.write("warn", "boom", [new Error("bad sk-abcdefghijkl")]);
    await logger.flush();

    expect((await readdir(dir)).sort()).toEqual(
      [path.basename(kept), "main-2026-10-18.log", "main-2026-10-19.log", "notes.txt"].sort(),
    );
    const today = await readFile(path.join(dir, "main-2026-10-19.log"), "utf8");
    expect(today).toContain("ERROR failed at ~\\proj\n");
    expect(today).toContain("Error: bad sk-<redacted>");
    expect(today).not.toContain("Zhang San");
    expect(logger.files().map((file) => path.basename(file))).toEqual([
      "main-2026-10-19.log",
      "main-2026-10-18.log",
      path.basename(kept),
    ]);
  });

  it("keeps lines in order when they arrive while a write is in flight, and flushSync writes what is still queued", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "omp-studio 日志 "));
    const dir = path.join(root, "logs");
    const now = new Date(2026, 9, 18, 12, 0);
    const logger = new Logger({ dir, now: () => now, redact: (text) => text });
    for (let i = 0; i < 50; i++) logger.write("info", `line ${i}`, []);
    await Promise.resolve();
    for (let i = 50; i < 100; i++) logger.write("info", `line ${i}`, []);
    await logger.flush();
    logger.write("info", "last", []);
    logger.flushSync();
    const lines = (await readFile(path.join(dir, "main-2026-10-18.log"), "utf8")).trimEnd().split("\n");
    expect(lines.map((line) => line.slice(line.indexOf("INFO") + 6))).toEqual([
      ...Array.from({ length: 100 }, (_, i) => `line ${i}`),
      "last",
    ]);
    await logger.flush();
  });
});

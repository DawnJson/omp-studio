import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { localFeedDir, serveFeedDir, type LocalFeed } from "../src/main/update/local-feed.ts";

describe("localFeedDir", () => {
  test("file:// 地址和绝对路径是本机目录，http(s) 和相对路径不是", () => {
    const dir = path.join(os.tmpdir(), "omp studio 更新");
    expect(localFeedDir(pathToFileURL(dir).href)).toBe(dir);
    expect(localFeedDir(dir)).toBe(dir);
    expect(localFeedDir("http://127.0.0.1:8123/")).toBeNull();
    expect(localFeedDir("https://example.com/feed/")).toBeNull();
    expect(localFeedDir("feed")).toBeNull();
  });
});

describe("serveFeedDir", () => {
  let root = "";
  let feed: LocalFeed;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "omp-feed-"));
    const dir = path.join(root, "更新 目录");
    await mkdir(path.join(dir, "sub"), { recursive: true });
    await writeFile(path.join(dir, "latest.yml"), "version: 0.1.0\n");
    await writeFile(path.join(dir, "omp-studio-0.1.0-setup.exe"), "exe");
    await writeFile(path.join(dir, "sub", "inner.txt"), "inner");
    await writeFile(path.join(root, "secret.txt"), "secret");
    feed = await serveFeedDir(dir);
  });
  afterEach(async () => {
    await feed.close();
    await rm(root, { recursive: true, force: true });
  });

  test("只监听回环地址；提供目录里的文件，忽略 electron-updater 加的查询参数", async () => {
    expect(feed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const yml = await fetch(`${feed.url}latest.yml?noCache=1abc`);
    expect(yml.status).toBe(200);
    expect(await yml.text()).toBe("version: 0.1.0\n");
    const exe = await fetch(`${feed.url}omp-studio-0.1.0-setup.exe`, { method: "HEAD" });
    expect(exe.status).toBe(200);
    expect(exe.headers.get("content-length")).toBe("3");
  });

  test("目录外、子目录、不存在的文件都是 404；非 GET/HEAD 是 405", async () => {
    for (const target of ["..%2Fsecret.txt", "%2e%2e%5Csecret.txt", "sub/inner.txt", "sub", "", "missing.yml"])
      expect((await fetch(`${feed.url}${target}`)).status, target).toBe(404);
    expect((await fetch(`${feed.url}latest.yml`, { method: "POST" })).status).toBe(405);
  });
});

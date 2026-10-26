// 账号型 provider 扩展的部署（src/main/client-accounts/deploy.ts）：写进 `<agent 目录>/extensions/studio-accounts/`。
// 真实 omp 是否真能从这个目录加载它见 test/client-accounts-real-omp.test.ts。
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_EXTENSION_FILES, deployAccountExtension } from "../src/main/client-accounts/deploy.ts";

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp studio 扩展-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("扩展文件表", () => {
  it("部署出去的每个相对 import 都能在表里找到（少一个文件 omp 就整个扩展加载失败），MIT 许可证随扩展部署", () => {
    const names = Object.keys(ACCOUNT_EXTENSION_FILES);
    expect(names).toContain("studio-accounts.mjs");
    for (const [name, content] of Object.entries(ACCOUNT_EXTENSION_FILES)) {
      if (!name.endsWith(".mjs")) continue;
      for (const match of content.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1] ?? ""));
        expect(names, `${name} -> ${match[1]}`).toContain(target);
      }
    }
    expect(names).toContain("vendor/LICENSE");
  });
});

describe("部署", () => {
  it("写到 <agent 目录>/extensions/studio-accounts/，带转到入口的 index.js；路径带空格和中文也照写", async () => {
    const agentDir = path.join(scratch, "用户 一", "agent");
    const dir = await deployAccountExtension(agentDir, {
      "studio-accounts.mjs": "export default 1;",
      "vendor/a.mjs": "a",
    });
    expect(dir).toBe(path.join(agentDir, "extensions", "studio-accounts"));
    expect(await readFile(path.join(dir, "studio-accounts.mjs"), "utf8")).toBe("export default 1;");
    expect(await readFile(path.join(dir, "vendor", "a.mjs"), "utf8")).toBe("a");
    expect(await readFile(path.join(dir, "index.js"), "utf8")).toContain('from "./studio-accounts.mjs"');
  });

  it("内容没变的文件不重写，插件自己写的缓存不动；变了的照写，新版本没有的文件删掉", async () => {
    const agentDir = path.join(scratch, "两次");
    const dir = await deployAccountExtension(agentDir, { "studio-accounts.mjs": "v1", "old.mjs": "old" });
    await writeFile(path.join(dir, "models-cache-v3.json"), "{}", "utf8");
    const before = (await stat(path.join(dir, "studio-accounts.mjs"))).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 30));

    await deployAccountExtension(agentDir, { "studio-accounts.mjs": "v1", "old.mjs": "old" });
    expect((await stat(path.join(dir, "studio-accounts.mjs"))).mtimeMs).toBe(before);

    await deployAccountExtension(agentDir, { "studio-accounts.mjs": "v2" });
    expect(await readFile(path.join(dir, "studio-accounts.mjs"), "utf8")).toBe("v2");
    await expect(stat(path.join(dir, "old.mjs"))).rejects.toThrow();
    expect(await readFile(path.join(dir, "models-cache-v3.json"), "utf8")).toBe("{}");
  });

  it("文件清单被改成指向目录外面时，不删目录外的文件", async () => {
    const agentDir = path.join(scratch, "清单");
    const outside = path.join(agentDir, "config.yml");
    await mkdir(agentDir, { recursive: true });
    await writeFile(outside, "keep", "utf8");
    const dir = await deployAccountExtension(agentDir, { "studio-accounts.mjs": "v1" });
    await writeFile(path.join(dir, ".studio-files.json"), JSON.stringify(["../../config.yml", outside]), "utf8");

    await deployAccountExtension(agentDir, { "studio-accounts.mjs": "v1" });
    expect(await readFile(outside, "utf8")).toBe("keep");
  });
});

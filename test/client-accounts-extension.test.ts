// 账号型 provider 扩展的部署（src/main/client-accounts/deploy.ts）和三个 omp 入口的 `-e` 参数。
// 真实 omp 是否真能加载这个扩展见 test/client-accounts-real-omp.test.ts。
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCOUNT_EXTENSION_ENTRY,
  ACCOUNT_EXTENSION_FILES,
  deployAccountExtension,
  extensionContentHash,
} from "../src/main/client-accounts/deploy.ts";
import { buildOmpArgs, buildTspArgs } from "../src/main/omp/launch-args.ts";

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp studio 扩展-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("扩展文件表", () => {
  it("入口、接线、vendor 和声明都在，内容非空", () => {
    expect(Object.keys(ACCOUNT_EXTENSION_FILES).sort()).toEqual([
      "NOTICE.md",
      "adapter.mjs",
      "models-cache.mjs",
      "shim.mjs",
      "studio-accounts.mjs",
      "vendor/qoder/LICENSE-CLIProxyAPI",
      "vendor/qoder/index.mjs",
      "vendor/workbuddy/index.mjs",
    ]);
    for (const [name, content] of Object.entries(ACCOUNT_EXTENSION_FILES)) {
      expect(content.length, name).toBeGreaterThan(100);
    }
    expect(ACCOUNT_EXTENSION_FILES[ACCOUNT_EXTENSION_ENTRY]).toContain("registerAccountProvider");
  });

  it("哈希只看内容：改一个字就变，键顺序不影响", () => {
    const base = extensionContentHash({ "a.mjs": "x", "b.mjs": "y" });
    expect(extensionContentHash({ "b.mjs": "y", "a.mjs": "x" })).toBe(base);
    expect(extensionContentHash({ "a.mjs": "x", "b.mjs": "z" })).not.toBe(base);
  });
});

describe("部署", () => {
  it("写到 userData 下带哈希的目录，路径带空格和中文也照写，返回入口绝对路径", async () => {
    const base = path.join(scratch, "一个 用户 数据");
    const entry = await deployAccountExtension(base);

    expect(path.isAbsolute(entry)).toBe(true);
    expect(path.basename(entry)).toBe(ACCOUNT_EXTENSION_ENTRY);
    expect(path.dirname(path.dirname(entry))).toBe(path.join(base, "omp-extensions"));
    expect(path.basename(path.dirname(entry))).toBe(`accounts-${extensionContentHash()}`);

    for (const [name, content] of Object.entries(ACCOUNT_EXTENSION_FILES)) {
      expect(await readFile(path.join(path.dirname(entry), name), "utf8"), name).toBe(content);
    }
  });

  it("第二次部署不再写文件，升级后旧目录被清掉，别的前缀不动", async () => {
    const base = path.join(scratch, "重复");
    const entry = await deployAccountExtension(base);
    const root = path.join(base, "omp-extensions");

    const stale = path.join(root, "accounts-0000000000000000");
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, "old.mjs"), "old", "utf8");
    const other = path.join(root, "something-else");
    await mkdir(other, { recursive: true });

    expect(await deployAccountExtension(base)).toBe(entry);
    const left = (await readdir(root)).sort();
    expect(left).toEqual([path.basename(path.dirname(entry)), "something-else"]);
    expect((await readdir(other)).length).toBe(0);
  });

  it("内容变了换目录，新目录里是新的内容", async () => {
    const base = path.join(scratch, "升级");
    const first = await deployAccountExtension(base, { "studio-accounts.mjs": "v1" });
    const second = await deployAccountExtension(base, { "studio-accounts.mjs": "v2" });

    expect(second).not.toBe(first);
    expect(await readFile(second, "utf8")).toBe("v2");
    expect((await readdir(path.join(base, "omp-extensions"))).length).toBe(1);
  });
});

describe("omp 启动参数", () => {
  it("服务进程和任务进程都带 -e <绝对路径>；没有扩展时不带", () => {
    const entry = "C:\\Users\\someone\\AppData\\Roaming\\omp-studio\\omp-extensions\\accounts-abc\\studio-accounts.mjs";
    expect(buildOmpArgs({ cwd: "C:/p", extension: entry })).toEqual(["--mode", "rpc-ui", "-e", entry]);
    expect(buildOmpArgs({ cwd: "C:/p", noSession: true, extension: entry })).toEqual([
      "--mode",
      "rpc-ui",
      "--no-session",
      "-e",
      entry,
    ]);
    expect(buildTspArgs({ cwd: "C:/p", extension: entry })).toEqual(["-e", entry]);
    expect(buildOmpArgs({ cwd: "C:/p" })).toEqual(["--mode", "rpc-ui"]);
    expect(buildTspArgs({ cwd: "C:/p", extension: null })).toEqual([]);
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpEditInput } from "../src/shared/mcp-edit.ts";
import { mcpFilePath, readMcpServer, saveMcpServer } from "../src/main/integrations/mcp-file.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  // 路径带空格和中文：和用户真实的家目录、项目目录一样。
  dir = await mkdtemp(path.join(os.tmpdir(), "omp mcp 测试-"));
  file = mcpFilePath("user", path.join(dir, "agent 目录"), null);
  await mkdir(path.dirname(file), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

// omp 18.12.6 的 `/mcp add` 写出的形状（实测）：$schema 在最前、2 空格缩进、LF、没有末尾换行；--token 写成 headers.Authorization。
const ompFile = {
  $schema: "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json",
  mcpServers: {
    remote1: {
      type: "http",
      url: "http://127.0.0.1:9/mcp",
      headers: { "X-Trace": "on", Authorization: "Bearer old-token", "X-Last": "1" },
      timeout: 5000,
      oauth: { clientId: "abc" },
      enabled: false,
    },
    local1: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@scope/server"],
      env: { A: "1", B: "2" },
      instructions: false,
    },
    other: { type: "http", url: "https://other.example/mcp" },
  },
  disabledServers: ["zzz"],
};

const stdio = (over: Partial<McpEditInput> = {}): McpEditInput => ({
  name: "local1",
  scope: "user",
  transport: "stdio",
  command: "node",
  args: ["server.js", "--flag"],
  url: "",
  token: { kind: "keep" },
  ...over,
});

const remote = (over: Partial<McpEditInput> = {}): McpEditInput => ({
  name: "remote1",
  scope: "user",
  transport: "http",
  command: "",
  args: [],
  url: "https://new.example/mcp",
  token: { kind: "keep" },
  ...over,
});

const write = (text: string) => writeFile(file, text, "utf8");
const read = () => readFile(file, "utf8");
const json = async () => JSON.parse((await read()).replace(/^\uFEFF/, "")) as typeof ompFile;

describe("mcpFilePath", () => {
  it("用户级在 agent 目录，项目级在项目的 .omp/", () => {
    expect(mcpFilePath("user", path.join("a b", "agent"), null)).toBe(path.join("a b", "agent", "mcp.json"));
    expect(mcpFilePath("project", "x", path.join("项目 一"))).toBe(path.join("项目 一", ".omp", "mcp.json"));
    expect(() => mcpFilePath("project", "x", null)).toThrow();
  });
});

describe("readMcpServer", () => {
  it("读出表单初值；token 只给有没有，值不出现", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    const remoteInfo = await readMcpServer(file, "remote1", "user");
    expect(remoteInfo).toEqual({
      ok: true,
      value: {
        name: "remote1",
        scope: "user",
        transport: "http",
        command: "",
        args: [],
        url: "http://127.0.0.1:9/mcp",
        token: "set",
      },
    });
    expect(JSON.stringify(remoteInfo)).not.toContain("old-token");
    expect(await readMcpServer(file, "local1", "user")).toEqual({
      ok: true,
      value: {
        name: "local1",
        scope: "user",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@scope/server"],
        url: "",
        token: "none",
      },
    });
    expect(await readMcpServer(file, "other", "user")).toMatchObject({ ok: true, value: { token: "none" } });
  });

  it("Authorization 键大小写不敏感；没写 type 的有 url 按 http", async () => {
    await write(JSON.stringify({ mcpServers: { a: { url: "https://a", headers: { authorization: "Token x" } } } }));
    expect(await readMcpServer(file, "a", "user")).toMatchObject({
      ok: true,
      value: { transport: "http", token: "set" },
    });
  });

  it("文件或服务器不存在、JSON 坏了、形状管不了", async () => {
    expect(await readMcpServer(file, "x", "user")).toEqual({ ok: false, code: "not-found" });
    await write(JSON.stringify(ompFile));
    expect(await readMcpServer(file, "nope", "user")).toEqual({ ok: false, code: "not-found" });
    await write("{ not json");
    expect(await readMcpServer(file, "x", "user")).toEqual({ ok: false, code: "bad-json" });
    await write(
      JSON.stringify({ mcpServers: { m: { command: "x", args: ["a\nb"] }, n: { type: "websocket", url: "ws://x" } } }),
    );
    expect(await readMcpServer(file, "m", "user")).toEqual({ ok: false, code: "unsupported" });
    expect(await readMcpServer(file, "n", "user")).toEqual({ ok: false, code: "unsupported" });
  });
});

describe("saveMcpServer：只改目标项", () => {
  it("stdio：改命令和参数，env、instructions、别的服务器和顶层键、键顺序原样", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    expect(await saveMcpServer(file, stdio())).toEqual({ ok: true, value: null });
    const after = await json();
    expect(after.mcpServers.local1).toEqual({
      type: "stdio",
      command: "node",
      args: ["server.js", "--flag"],
      env: { A: "1", B: "2" },
      instructions: false,
    });
    expect(Object.keys(after.mcpServers.local1)).toEqual(["type", "command", "args", "env", "instructions"]);
    expect(Object.keys(after.mcpServers)).toEqual(["remote1", "local1", "other"]);
    expect(Object.keys(after)).toEqual(["$schema", "mcpServers", "disabledServers"]);
    expect(after.mcpServers.remote1).toEqual(ompFile.mcpServers.remote1);
    expect(after.mcpServers.other).toEqual(ompFile.mcpServers.other);
    expect(after.disabledServers).toEqual(["zzz"]);
  });

  it("远程：改 URL，headers 里别的键、timeout、oauth、enabled 原样；token 保持不变时值不动", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    expect(await saveMcpServer(file, remote())).toEqual({ ok: true, value: null });
    const entry = (await json()).mcpServers.remote1;
    expect(entry).toEqual({ ...ompFile.mcpServers.remote1, url: "https://new.example/mcp" });
    expect(Object.keys(entry)).toEqual(["type", "url", "headers", "timeout", "oauth", "enabled"]);
    expect(Object.keys(entry.headers)).toEqual(["X-Trace", "Authorization", "X-Last"]);
  });

  it("token：改成新值写成 Bearer，位置不变；去掉只删 Authorization", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    await saveMcpServer(file, remote({ token: { kind: "set", value: "new-token" } }));
    let headers = (await json()).mcpServers.remote1.headers;
    expect(headers).toEqual({ "X-Trace": "on", Authorization: "Bearer new-token", "X-Last": "1" });
    expect(Object.keys(headers)).toEqual(["X-Trace", "Authorization", "X-Last"]);
    await saveMcpServer(file, remote({ token: { kind: "none" } }));
    headers = (await json()).mcpServers.remote1.headers;
    expect(headers).toEqual({ "X-Trace": "on", "X-Last": "1" });
  });

  it("token：原来没有时新设，沿用已有 headers；去掉最后一个 header 时 headers 一起去掉", async () => {
    await write(
      JSON.stringify({ mcpServers: { r: { type: "http", url: "https://a", headers: { "X-A": "1" } } } }, null, 2),
    );
    await saveMcpServer(file, remote({ name: "r", token: { kind: "set", value: "t" } }));
    expect(((await json()).mcpServers as Record<string, unknown>)["r"]).toEqual({
      type: "http",
      url: "https://new.example/mcp",
      headers: { "X-A": "1", Authorization: "Bearer t" },
    });
    await write(
      JSON.stringify(
        { mcpServers: { r: { type: "http", url: "https://a", headers: { Authorization: "Bearer x" } } } },
        null,
        2,
      ),
    );
    await saveMcpServer(file, remote({ name: "r", token: { kind: "none" } }));
    expect(((await json()).mcpServers as Record<string, unknown>)["r"]).toEqual({
      type: "http",
      url: "https://new.example/mcp",
    });
  });

  it("http ↔ sse：改 type；没写 type 的选 http 不凭空加", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    await saveMcpServer(file, remote({ transport: "sse" }));
    expect((await json()).mcpServers.remote1.type).toBe("sse");
    await write(JSON.stringify({ mcpServers: { r: { url: "https://a" } } }, null, 2));
    await saveMcpServer(file, remote({ name: "r" }));
    expect(((await json()).mcpServers as Record<string, unknown>)["r"]).toEqual({ url: "https://new.example/mcp" });
  });

  it("stdio 和远程不互换", async () => {
    const original = JSON.stringify(ompFile, null, 2);
    await write(original);
    expect(await saveMcpServer(file, remote({ name: "local1" }))).toEqual({ ok: false, code: "kind-mismatch" });
    expect(await saveMcpServer(file, stdio({ name: "remote1" }))).toEqual({ ok: false, code: "kind-mismatch" });
    expect(await read()).toBe(original);
  });
});

describe("saveMcpServer：文件格式原样", () => {
  it.each([
    ["2 空格", 2],
    ["4 空格", 4],
    ["制表符", "\t"],
  ] as const)("%s缩进", async (_label, indent) => {
    await write(JSON.stringify(ompFile, null, indent));
    await saveMcpServer(file, stdio());
    expect(await read()).toBe(
      JSON.stringify(
        {
          ...ompFile,
          mcpServers: {
            ...ompFile.mcpServers,
            local1: { ...ompFile.mcpServers.local1, command: "node", args: ["server.js", "--flag"] },
          },
        },
        null,
        indent,
      ),
    );
  });

  it("CRLF、BOM、末尾换行一起恢复", async () => {
    const original = `\uFEFF${JSON.stringify(ompFile, null, 4).replace(/\n/g, "\r\n")}\r\n`;
    await write(original);
    await saveMcpServer(file, stdio());
    const after = await read();
    expect(after.startsWith("\uFEFF")).toBe(true);
    expect(after.endsWith("}\r\n")).toBe(true);
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
    const edited = {
      ...ompFile,
      mcpServers: {
        ...ompFile.mcpServers,
        local1: { ...ompFile.mcpServers.local1, command: "node", args: ["server.js", "--flag"] },
      },
    };
    expect(after).toBe(`\uFEFF${JSON.stringify(edited, null, 4).replace(/\n/g, "\r\n")}\r\n`);
  });

  it("LF 且没有末尾换行（omp 自己写出的样子）保持没有", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    await saveMcpServer(file, stdio());
    const after = await read();
    expect(after.endsWith("}")).toBe(true);
    expect(after).not.toContain("\r");
    expect(after.startsWith('{\n  "$schema"')).toBe(true);
  });

  it("没有任何改动时不写、不留 .bak", async () => {
    const original = JSON.stringify(ompFile, null, 2);
    await write(original);
    await saveMcpServer(file, stdio({ command: "npx", args: ["-y", "@scope/server"] }));
    expect(await read()).toBe(original);
    await expect(readFile(`${file}.bak`, "utf8")).rejects.toThrow();
  });

  it("写前留 .bak，内容是改之前的原文（含 BOM 和 CRLF）", async () => {
    const original = `\uFEFF${JSON.stringify(ompFile, null, 2).replace(/\n/g, "\r\n")}`;
    await write(original);
    await saveMcpServer(file, stdio());
    expect(await readFile(`${file}.bak`, "utf8")).toBe(original);
    expect(await read()).not.toBe(original);
  });
});

describe("saveMcpServer：不写的情况", () => {
  it("JSON 坏了：报错、原文不动、没有 .bak", async () => {
    const broken = '{ "mcpServers": { "local1": { "command": "npx", } } }';
    await write(broken);
    expect(await saveMcpServer(file, stdio())).toEqual({ ok: false, code: "bad-json" });
    expect(await read()).toBe(broken);
    await expect(readFile(`${file}.bak`, "utf8")).rejects.toThrow();
  });

  it("顶层不是对象、文件不存在、没有这一项：不写，也不新建文件", async () => {
    expect(await saveMcpServer(file, stdio())).toEqual({ ok: false, code: "not-found" });
    await expect(readFile(file, "utf8")).rejects.toThrow();
    await write("[1, 2]");
    expect(await saveMcpServer(file, stdio())).toEqual({ ok: false, code: "bad-json" });
    await write(JSON.stringify(ompFile));
    expect(await saveMcpServer(file, stdio({ name: "missing" }))).toEqual({ ok: false, code: "not-found" });
  });

  it("文件里有数字名字的键（解析会打乱顺序）：不写", async () => {
    const original = '{\n  "mcpServers": {\n    "zeta": { "command": "a" },\n    "7": { "command": "b" }\n  }\n}';
    await write(original);
    expect(await saveMcpServer(file, stdio({ name: "zeta" }))).toEqual({ ok: false, code: "key-order" });
    expect(await read()).toBe(original);
  });

  it("这一项管不了（参数含换行）：不写", async () => {
    const original = JSON.stringify({ mcpServers: { m: { command: "x", args: ["a\nb"] } } });
    await write(original);
    expect(await saveMcpServer(file, stdio({ name: "m" }))).toEqual({ ok: false, code: "unsupported" });
    expect(await read()).toBe(original);
  });
});

describe("saveMcpServer：并发", () => {
  it("同一个文件的两次写入串行，两处改动都在", async () => {
    await write(JSON.stringify(ompFile, null, 2));
    await Promise.all([saveMcpServer(file, stdio()), saveMcpServer(file, remote())]);
    const after = await json();
    expect(after.mcpServers.local1).toMatchObject({ command: "node" });
    expect(after.mcpServers.remote1).toMatchObject({ url: "https://new.example/mcp" });
  });
});

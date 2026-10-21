import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSessionHeader, readSessionHeader } from "../src/main/session-info/session-header.ts";
import { parseSessionPins, readSessionPins, sessionPinsPath } from "../src/main/session-info/session-pins.ts";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "omp-studio 置顶 "));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("session-pins.json（omp 18.12.5 的 /pin 写入：会话 id 的数组）", () => {
  it("字符串数组 → 集合；空数组 = 没有置顶；非字符串、空串被丢掉", () => {
    expect(parseSessionPins("[]")).toEqual(new Set());
    expect(parseSessionPins('["01a1","01a2",""]')).toEqual(new Set(["01a1", "01a2"]));
    expect(parseSessionPins('["01a1", 3, null, {"id":"x"}]')).toEqual(new Set(["01a1"]));
  });

  it("不是数组 / 不是 JSON：null（调用方按没有置顶处理并记日志）", () => {
    expect(parseSessionPins('{"pins":["a"]}')).toBeNull();
    expect(parseSessionPins("not json")).toBeNull();
    expect(parseSessionPins("")).toBeNull();
  });

  it("读文件：不存在 = 空集合；格式不认识 = 空集合（不抛错，不能让历史列表打不开）；正常读出", async () => {
    const agentDir = path.join(dir, "agent");
    expect(await readSessionPins(agentDir)).toEqual(new Set());
    await mkdir(agentDir, { recursive: true });
    await writeFile(sessionPinsPath(agentDir), "{broken", "utf8");
    expect(await readSessionPins(agentDir)).toEqual(new Set());
    await writeFile(sessionPinsPath(agentDir), '["01a15f75-0e4d-7029-bf28-43fca07df31f"]', "utf8");
    expect(await readSessionPins(agentDir)).toEqual(new Set(["01a15f75-0e4d-7029-bf28-43fca07df31f"]));
  });
});

// omp 18.12.5 实测的会话文件开头：256 字节标题槽 + session 头（本机录制，路径已脱敏）。
const slot = `{"type":"title","v":1,"title":"","updatedAt":"2026-10-21T18:23:18.782Z","pad":"${" ".repeat(40)}"}`;
const header =
  '{"type":"session","version":3,"id":"01a15fb4-10fe-76f9-a8c3-5ff8fbc9f1be","timestamp":"2026-10-21T18:23:18.782Z","cwd":"C:\\\\work\\\\project"}';

describe("会话文件头", () => {
  it("标题槽之后的 session 行：id、版本、时间、cwd；没有的字段给 null / 空数组", () => {
    expect(parseSessionHeader(`${slot}\n${header}\n{"type":"model_change"}\n`)).toEqual({
      id: "01a15fb4-10fe-76f9-a8c3-5ff8fbc9f1be",
      version: 3,
      timestamp: "2026-10-21T18:23:18.782Z",
      cwd: "C:\\work\\project",
      title: null,
      parentSession: null,
      additionalDirectories: [],
    });
  });

  it("带标题、父会话、额外目录（session.md 的头字段）", () => {
    const full = JSON.stringify({
      type: "session",
      version: 3,
      id: "s2",
      timestamp: "2026-10-21T10:00:00.000Z",
      cwd: "/work/shared app",
      title: "整理 日志",
      parentSession: "/old/session.jsonl",
      additionalDirectories: ["/work/shared", 7, "/work/other"],
    });
    expect(parseSessionHeader(full)).toMatchObject({
      id: "s2",
      title: "整理 日志",
      parentSession: "/old/session.jsonl",
      additionalDirectories: ["/work/shared", "/work/other"],
    });
  });

  it("头缺 id 或 cwd、头之前有垃圾、第一行不是 session：null", () => {
    expect(parseSessionHeader('{"type":"session","cwd":"/x"}')).toBeNull();
    expect(parseSessionHeader('{"type":"session","id":"a"}')).toBeNull();
    expect(parseSessionHeader(`garbage\n${header}`)).toBeNull();
    expect(parseSessionHeader('{"type":"message"}')).toBeNull();
    expect(parseSessionHeader("")).toBeNull();
  });

  it("读文件：不存在返回 null；路径含空格和中文", async () => {
    const file = path.join(dir, "会话 一.jsonl");
    expect(await readSessionHeader(file)).toBeNull();
    await writeFile(file, `${slot}\n${header}\n`, "utf8");
    expect((await readSessionHeader(file))?.id).toBe("01a15fb4-10fe-76f9-a8c3-5ff8fbc9f1be");
  });
});

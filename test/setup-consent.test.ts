// worktree setup 脚本确认记录：按项目 + 内容哈希，持久化到文件；换了内容或换了项目都不算确认过。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SetupConsent } from "../src/main/git/setup-consent.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SetupConsent", () => {
  it("记住项目 + 哈希；换哈希、换项目都要重新确认；重新打开文件仍然有效", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "setup 确认 "));
    dirs.push(dir);
    const file = path.join(dir, "consent.json");
    const consent = new SetupConsent(file);
    const project = path.join(dir, "项目 一");
    expect(await consent.isApproved(project, "aaa")).toBe(false);
    await Promise.all([
      consent.approve(project, "aaa"),
      consent.approve(project, "bbb"),
      consent.approve(project, "aaa"),
    ]);
    const reopened = new SetupConsent(file);
    expect(await reopened.isApproved(project, "aaa")).toBe(true);
    expect(await reopened.isApproved(project, "bbb")).toBe(true);
    expect(await reopened.isApproved(project, "ccc")).toBe(false);
    expect(await reopened.isApproved(path.join(dir, "项目 二"), "aaa")).toBe(false);
  });
});

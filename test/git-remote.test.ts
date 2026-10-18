import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commit, createPullRequest, getGitTools, push } from "../src/main/git/remote.ts";
import { makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("remote");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const fresh = () => makeRepo(scratch, `仓库 ${++n}`);

/** 路径上找不到 gh 的环境（保留 Windows 系统变量，只把 PATH 指向空目录）。 */
function envWithoutGh(): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  return { ...env, PATH: path.join(scratch, "空目录") };
}

describe("提交", () => {
  it("没有已暂存的内容是 nothing_to_commit；stageAll 会先暂存全部（含未跟踪的）；中文多行提交信息原样保存", async () => {
    const dir = await fresh();
    expect(await commit(dir, "无", false)).toEqual({ kind: "nothing_to_commit" });

    await put(dir, "新 文件.txt", "n\n");
    await put(dir, "a.txt", "changed\n");
    sh(dir, "add", "a.txt");
    // 不 stageAll：只提交已暂存的 a.txt。
    const first = await commit(dir, "只提交暂存的", false);
    expect(first).toEqual({ kind: "committed", commit: sh(dir, "rev-parse", "HEAD") });
    expect(sh(dir, "show", "--name-only", "--format=", "HEAD")).toBe("a.txt");

    const second = await commit(dir, "全部提交\n\n第二段：含 “引号” 和 emoji 🚀", true);
    expect(second.kind).toBe("committed");
    expect(sh(dir, "log", "-1", "--format=%B")).toBe("全部提交\n\n第二段：含 “引号” 和 emoji 🚀\n");
    expect(sh(dir, "status", "--porcelain")).toBe("");
  });

  it("钩子拒绝时返回 failed 和 git 的原话，不抛错", async () => {
    const dir = await fresh();
    await writeFile(path.join(dir, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho hook-says-no >&2\nexit 1\n", {
      mode: 0o755,
    });
    await put(dir, "a.txt", "changed\n");
    const result = await commit(dir, "会被拒绝", true);
    expect(result).toMatchObject({ kind: "failed" });
    expect(result.kind === "failed" && result.message).toContain("hook-says-no");
  });

  it("空提交信息被拒绝", async () => {
    const dir = await fresh();
    await put(dir, "a.txt", "changed\n");
    await expect(commit(dir, "   ", true)).rejects.toThrow(/empty/);
  });
});

describe("推送", () => {
  it("没有 remote 是 no_remote；detached HEAD 是 detached_head", async () => {
    const dir = await fresh();
    expect(await push(dir)).toEqual({ kind: "no_remote" });
    sh(dir, "checkout", "--detach");
    expect(await push(dir)).toEqual({ kind: "detached_head" });
  });

  it("首次推送设置 upstream；之后的提交直接推；远端有别人的提交时 rejected（不强推）", async () => {
    const dir = await fresh();
    const remote = path.join(scratch, "远端 仓库.git");
    sh(scratch, "init", "--bare", "-b", "main", remote);
    sh(dir, "remote", "add", "origin", remote);

    expect(await push(dir)).toEqual({ kind: "pushed", remote: "origin", branch: "main" });
    expect(sh(dir, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/main");

    await put(dir, "a.txt", "second\n");
    await commit(dir, "第二次", true);
    expect(await push(dir)).toEqual({ kind: "pushed", remote: "origin", branch: "main" });
    expect(sh(remote, "rev-parse", "main")).toBe(sh(dir, "rev-parse", "HEAD"));

    // 另一个克隆先推一个提交，本仓库再提交就和远端分叉。
    const other = path.join(scratch, "另一个 克隆");
    sh(scratch, "clone", remote, other);
    sh(other, "config", "user.name", "别人");
    sh(other, "config", "user.email", "o@example.com");
    await put(other, "o.txt", "o\n");
    sh(other, "add", "-A");
    sh(other, "commit", "-m", "别人的提交");
    sh(other, "push");

    await put(dir, "a.txt", "third\n");
    await commit(dir, "第三次", true);
    const rejected = await push(dir);
    expect(rejected.kind).toBe("rejected");
    // 远端没有被改写：仍然是别人的提交。
    expect(sh(remote, "log", "-1", "--format=%s", "main")).toBe("别人的提交");
  });

  it("worktree 分支首次推送：用同名分支并设置 upstream", async () => {
    const dir = await fresh();
    const remote = path.join(scratch, "远端 二.git");
    sh(scratch, "init", "--bare", "-b", "main", remote);
    sh(dir, "remote", "add", "origin", remote);
    sh(dir, "checkout", "-b", "studio/abcd1234");
    await put(dir, "a.txt", "x\n");
    await commit(dir, "在分支上", true);
    expect(await push(dir)).toEqual({ kind: "pushed", remote: "origin", branch: "studio/abcd1234" });
    expect(sh(remote, "rev-parse", "--verify", "studio/abcd1234")).toBe(sh(dir, "rev-parse", "HEAD"));
  });
});

describe("gh", () => {
  it("PATH 上没有 gh：createPullRequest 返回 gh_unavailable，getGitTools 报告 gh 不可用", async () => {
    const dir = await fresh();
    await mkdir(path.join(scratch, "空目录"), { recursive: true });
    const env = envWithoutGh();
    expect(await createPullRequest(dir, { title: "标题", body: "正文\n第二行" }, "main", env)).toEqual({
      kind: "gh_unavailable",
    });
    expect((await getGitTools(env)).gh).toBe(false);
  });

  it("getGitTools 报告 git 版本号", async () => {
    expect((await getGitTools()).git).toMatch(/^\d+\.\d+\.\d+/);
  });
});

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commit, createPullRequest, lastCommit, push } from "../src/main/git/remote.ts";
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

describe("修改上一次提交（amend）", () => {
  it("暂存的改动并入上一次提交、信息换成新的；提交数不变、哈希变了", async () => {
    const dir = await fresh();
    await put(dir, "a.txt", "one\n");
    expect((await commit(dir, "第一版\n\n原来的说明", true)).kind).toBe("committed");
    const before = sh(dir, "rev-parse", "HEAD");
    const count = sh(dir, "rev-list", "--count", "HEAD");

    await put(dir, "补 充.txt", "补充\n");
    sh(dir, "add", "补 充.txt");
    const result = await commit(dir, "修改后的标题\n\n新的说明", false, true);
    expect(result).toEqual({ kind: "committed", commit: sh(dir, "rev-parse", "HEAD") });
    expect(sh(dir, "rev-parse", "HEAD")).not.toBe(before);
    expect(sh(dir, "rev-list", "--count", "HEAD")).toBe(count);
    expect(sh(dir, "log", "-1", "--format=%B")).toBe("修改后的标题\n\n新的说明\n");
    expect(sh(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["a.txt", "补 充.txt"]);
  });

  it("没有暂存内容也能只改信息；没有提交时是 failed；空信息照旧被拒绝", async () => {
    const dir = await fresh();
    const tree = sh(dir, "rev-parse", "HEAD^{tree}");
    expect(await commit(dir, "只改信息", false, true)).toMatchObject({ kind: "committed" });
    expect(sh(dir, "log", "-1", "--format=%s")).toBe("只改信息");
    expect(sh(dir, "rev-parse", "HEAD^{tree}")).toBe(tree);
    await expect(commit(dir, " ", false, true)).rejects.toThrow(/empty/);

    const empty = path.join(scratch, "空 仓库 amend");
    sh(scratch, "init", "-b", "main", empty);
    expect(await commit(empty, "x", false, true)).toMatchObject({ kind: "failed" });
  });

  it("lastCommit：完整信息；没有提交是 null；推送后 pushed 为 true，amend 之后又是 false", async () => {
    const dir = await fresh();
    await put(dir, "a.txt", "v\n");
    await commit(dir, "标题 行\n\n第一段\n\n第二段", true);
    expect(await lastCommit(dir)).toEqual({
      commit: sh(dir, "rev-parse", "HEAD"),
      message: "标题 行\n\n第一段\n\n第二段",
      pushed: false,
    });

    const remote = path.join(scratch, "远端 amend.git");
    sh(scratch, "init", "--bare", "-b", "main", remote);
    sh(dir, "remote", "add", "origin", remote);
    await push(dir);
    expect((await lastCommit(dir))?.pushed).toBe(true);

    await commit(dir, "改写后的标题", false, true);
    expect((await lastCommit(dir))?.pushed).toBe(false);

    const empty = path.join(scratch, "空 仓库 last");
    sh(scratch, "init", "-b", "main", empty);
    expect(await lastCommit(empty)).toBeNull();
  }, 30_000);
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
  }, 30_000);

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
  it("PATH 上没有 gh：createPullRequest 返回 gh_unavailable", async () => {
    const dir = await fresh();
    await mkdir(path.join(scratch, "空目录"), { recursive: true });
    const env = envWithoutGh();
    expect(await createPullRequest(dir, { title: "标题", body: "正文\n第二行" }, "main", env)).toEqual({
      kind: "gh_unavailable",
    });
  });
});

describe("推送：分支名以 + 开头", () => {
  it("不会变成强推：远端同名分支被别人推进后，push 被拒绝，远端不被覆盖", async () => {
    const dir = await fresh();
    const remote = path.join(scratch, "远端 加号.git");
    sh(scratch, "init", "--bare", "-b", "main", remote);
    sh(dir, "remote", "add", "origin", remote);
    sh(dir, "checkout", "-b", "+foo");
    await put(dir, "a.txt", "mine\n");
    await commit(dir, "我的", true);
    // 远端 refs/heads/+foo 已有一个无关提交。
    const other = path.join(scratch, "加号 克隆");
    sh(scratch, "clone", remote, other);
    sh(other, "config", "user.name", "别人");
    sh(other, "config", "user.email", "o@example.com");
    sh(other, "checkout", "-b", "+foo");
    await put(other, "o.txt", "o\n");
    sh(other, "add", "-A");
    sh(other, "commit", "-m", "别人的");
    sh(other, "push", "origin", "refs/heads/+foo:refs/heads/+foo");

    const result = await push(dir);
    expect(result.kind).toBe("rejected");
    expect(sh(remote, "log", "-1", "--format=%s", "refs/heads/+foo")).toBe("别人的");
  });
});

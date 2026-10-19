import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { statusAt } from "../src/main/git/status.ts";
import {
  cleanupOrphanWorktrees,
  createWorktree,
  findSetupScript,
  mergeWorktree,
  removeWorktree,
  worktreeInfo,
  resolveWorktreesDir,
} from "../src/main/git/worktree.ts";
import { findOmp, isolateOmp, makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

const omp = findOmp();
let worktreesDir = "";
let restoreEnv = () => {};
const opts = { ompPath: omp ?? "omp" };

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("worktree");
  ({ worktreesDir, restore: restoreEnv } = await isolateOmp(scratch));
});
afterAll(async () => {
  restoreEnv();
  await rm(scratch, { recursive: true, force: true });
});

const fresh = () => makeRepo(scratch, `仓库 ${++n}`);
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
// 真实 omp 在 PATH 上才测（worktree 由 omp worktree add 创建）；没有就整体 skip。
const d = describe.skipIf(omp === null);
const branches = (dir: string) => sh(dir, "branch", "--format=%(refname:short)").split(/\r?\n/).filter(Boolean);

d("创建 worktree", () => {
  it("走 omp worktree add：分支 studio/<slug> 从当前 HEAD 建出，目录按 omp 的规则放在 worktree 目录下，omp 自己的 list 能看到", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    expect(wt.baseBranch).toBe("main");
    expect(wt.branch).toMatch(/^studio\/[0-9a-f]{8}$/);
    expect(path.dirname(wt.path)).toBe(worktreesDir);
    expect(path.basename(wt.path)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{7}$/);
    expect(path.relative(dir, wt.path).startsWith("..")).toBe(true);
    expect(await readFile(path.join(wt.path, "a.txt"), "utf8")).toBe("alpha\nbeta\n");
    expect(sh(wt.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(wt.branch);
    expect(sh(dir, "rev-parse", wt.branch)).toBe(sh(dir, "rev-parse", "HEAD"));
    // 主仓库的 git status 看不到 worktree 目录。
    expect((await statusAt(dir)).files).toEqual([]);
    // omp 自己认得它（omp worktree list 只列自己的目录下的）。
    const listed = execFileSync(opts.ompPath, ["worktree", "list", "--json"], { cwd: dir, encoding: "utf8" });
    expect(JSON.parse(listed)).toEqual(expect.arrayContaining([expect.objectContaining({ branch: wt.branch })]));
  });

  it("目录解析和 omp 一致：OMP_WORKTREE_DIR 优先，其次 worktree.base 设置，最后 ~/.omp/wt", async () => {
    const dir = await fresh();
    expect(await resolveWorktreesDir(opts.ompPath, dir)).toBe(worktreesDir);
    const saved = process.env["OMP_WORKTREE_DIR"];
    delete process.env["OMP_WORKTREE_DIR"];
    try {
      expect(await resolveWorktreesDir(opts.ompPath, dir)).toBe(path.join(os.homedir(), ".omp", "wt"));
      const base = path.join(scratch, "配置 的 base");
      execFileSync(opts.ompPath, ["config", "set", "worktree.base", base], { cwd: dir });
      expect(path.resolve(await resolveWorktreesDir(opts.ompPath, dir))).toBe(path.resolve(base));
    } finally {
      if (saved !== undefined) process.env["OMP_WORKTREE_DIR"] = saved;
    }
  });

  it("不是 git 仓库、子目录项目、没有提交、detached HEAD 都拒绝，并说清原因", async () => {
    const plain = path.join(scratch, "普通 目录");
    await mkdir(plain);
    await expect(createWorktree(plain, opts)).rejects.toThrow(/git repository/);

    const dir = await fresh();
    await mkdir(path.join(dir, "子 目录"));
    await expect(createWorktree(path.join(dir, "子 目录"), opts)).rejects.toThrow(/repository root/);

    const empty = path.join(scratch, "空 仓库");
    sh(scratch, "init", "-b", "main", empty);
    await expect(createWorktree(empty, opts)).rejects.toThrow(/no commits/);

    sh(dir, "checkout", "--detach");
    await expect(createWorktree(dir, opts)).rejects.toThrow(/detached/);
  });

  const approve = { approveSetup: () => true };

  it("setup 脚本在新 worktree 里运行（路径含空格和中文），能拿到主仓库和 worktree 路径", async () => {
    const dir = await fresh();
    const win = process.platform === "win32";
    const name = win ? "setup.cmd" : "setup.sh";
    const script = win
      ? "@echo off\r\nchcp 65001 >nul\r\n> setup-ran.txt echo %OMP_STUDIO_PROJECT_DIR%^|%OMP_STUDIO_WORKTREE_DIR%\r\n"
      : 'echo "$OMP_STUDIO_PROJECT_DIR|$OMP_STUDIO_WORKTREE_DIR" > setup-ran.txt\n';
    await put(dir, `.omp-studio/${name}`, script);
    expect((await findSetupScript(dir))?.name).toBe(`.omp-studio/${name}`);

    const wt = await createWorktree(dir, { ...approve, ...opts });
    const out = (await readFile(path.join(wt.path, "setup-ran.txt"), "utf8")).trim();
    expect(out).toBe(`${dir}|${wt.path}`);
  });

  it.skipIf(process.platform !== "win32")("Windows 上 setup.ps1 优先于 setup.cmd", async () => {
    const dir = await fresh();
    await put(dir, ".omp-studio/setup.cmd", "@echo off\r\n> from.txt echo cmd\r\n");
    await put(dir, ".omp-studio/setup.ps1", "Set-Content -Path from.txt -Value ps1\r\n");
    const wt = await createWorktree(dir, { ...approve, ...opts });
    expect((await readFile(path.join(wt.path, "from.txt"), "utf8")).trim()).toBe("ps1");
  });

  it("setup 脚本失败：整个创建回滚（没有残留目录和分支），错误里带脚本输出", async () => {
    const dir = await fresh();
    const win = process.platform === "win32";
    await put(
      dir,
      `.omp-studio/${win ? "setup.cmd" : "setup.sh"}`,
      win ? "@echo off\r\necho install failed 1>&2\r\nexit /b 3\r\n" : "echo boom >&2\nexit 3\n",
    );
    await expect(createWorktree(dir, { ...approve, ...opts })).rejects.toThrow(/exit 3/);
    expect(branches(dir)).toEqual(["main"]);
    expect(sh(dir, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  it("没确认的 setup 脚本不运行：创建被拒绝，什么都不留；确认回调拿到脚本内容的哈希", async () => {
    const dir = await fresh();
    const win = process.platform === "win32";
    await put(
      dir,
      `.omp-studio/${win ? "setup.cmd" : "setup.sh"}`,
      win ? "@echo off\r\n> ran.txt echo x\r\n" : "echo x > ran.txt\n",
    );
    await expect(createWorktree(dir, opts)).rejects.toThrow(/setup script not approved/);
    let seen = "";
    await expect(
      createWorktree(dir, {
        ...opts,
        approveSetup: (script) => {
          seen = script.sha256;
          return false;
        },
      }),
    ).rejects.toThrow(/setup script not approved/);
    expect(seen).toBe((await findSetupScript(dir))?.sha256);
    expect(seen).toMatch(/^[0-9a-f]{64}$/);
    expect(branches(dir)).toEqual(["main"]);
    expect(sh(dir, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});

d("合并回基分支", () => {
  it("worktree 里提交后合并：基分支拿到改动；没有新提交时是 nothing_to_merge", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    expect(await mergeWorktree(dir, wt.path, wt.branch, wt.baseBranch)).toEqual({ kind: "nothing_to_merge" });

    await put(wt.path, "新 功能.txt", "feature\n");
    sh(wt.path, "add", "-A");
    sh(wt.path, "commit", "-m", "加功能");
    expect(await worktreeInfo(dir, wt.branch, wt.baseBranch)).toMatchObject({ commitsAhead: 1 });

    const result = await mergeWorktree(dir, wt.path, wt.branch, wt.baseBranch);
    expect(result).toEqual({ kind: "merged", commit: sh(dir, "rev-parse", "HEAD") });
    expect(await readFile(path.join(dir, "新 功能.txt"), "utf8")).toBe("feature\n");
  });

  it("worktree 有没提交的改动、主仓库有没提交的改动、主仓库不在基分支：都不合并，并说明原因", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    await put(wt.path, "w.txt", "w\n");
    expect(await mergeWorktree(dir, wt.path, wt.branch, wt.baseBranch)).toEqual({
      kind: "blocked",
      reason: "worktree_dirty",
    });
    sh(wt.path, "add", "-A");
    sh(wt.path, "commit", "-m", "w");

    await put(dir, "a.txt", "dirty\n");
    expect(await mergeWorktree(dir, wt.path, wt.branch, wt.baseBranch)).toEqual({
      kind: "blocked",
      reason: "base_dirty",
    });
    sh(dir, "checkout", "--", "a.txt");

    sh(dir, "checkout", "-b", "other");
    expect(await mergeWorktree(dir, wt.path, wt.branch, wt.baseBranch)).toEqual({
      kind: "blocked",
      reason: "base_not_checked_out",
      currentBranch: "other",
    });
  });

  it("冲突：报告冲突文件，并且 merge --abort，主仓库回到合并前（没有标记、没有 MERGE_HEAD）", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    await put(wt.path, "a.txt", "来自 worktree\nbeta\n");
    sh(wt.path, "commit", "-am", "wt 改动");
    await put(dir, "a.txt", "来自 main\nbeta\n");
    sh(dir, "commit", "-am", "main 改动");
    const mainHead = sh(dir, "rev-parse", "HEAD");

    const result = await mergeWorktree(dir, wt.path, wt.branch, wt.baseBranch);
    expect(result).toEqual({ kind: "conflict", files: ["a.txt"] });
    expect(sh(dir, "rev-parse", "HEAD")).toBe(mainHead);
    expect(await readFile(path.join(dir, "a.txt"), "utf8")).toBe("来自 main\nbeta\n");
    expect((await statusAt(dir)).files).toEqual([]);
    expect(await exists(path.join(dir, ".git", "MERGE_HEAD"))).toBe(false);
  });
});

d("丢弃和清理", () => {
  it("丢弃：目录和分支都没了，含未提交和未合并的内容；重复丢弃不报错", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    await put(wt.path, "未提交.txt", "x\n");
    await put(wt.path, "a.txt", "已提交\n");
    sh(wt.path, "commit", "-am", "未合并");
    await removeWorktree(dir, wt.path, wt.branch);
    expect(await exists(wt.path)).toBe(false);
    expect(branches(dir)).toEqual(["main"]);
    await removeWorktree(dir, wt.path, wt.branch);
  });

  it("清理无主 worktree：任务引用的不动；干净且已合入的删除；脏的、有未合并提交的保留并报告；不碰不是 studio/ 分支的 worktree", async () => {
    const dir = await fresh();
    const referenced = await createWorktree(dir, opts);
    const clean = await createWorktree(dir, opts);
    const dirty = await createWorktree(dir, opts);
    const unmerged = await createWorktree(dir, opts);
    await put(dirty.path, "脏.txt", "x\n");
    await put(unmerged.path, "u.txt", "u\n");
    sh(unmerged.path, "add", "-A");
    sh(unmerged.path, "commit", "-m", "未合并");
    // 别人（用户或别的工具）建的 worktree，分支不是 studio/：不是我们的，不动。
    const foreign = path.join(scratch, `别人的 worktree ${n}`);
    sh(dir, "worktree", "add", "-b", "feature/mine", foreign);

    const result = await cleanupOrphanWorktrees(dir, [referenced.path]);
    const name = (wt: { path: string }) => path.basename(wt.path);
    expect(result.removed).toEqual([name(clean)]);
    expect(result.kept).toEqual(
      expect.arrayContaining([
        { name: name(dirty), reason: "dirty" },
        { name: name(unmerged), reason: "unmerged" },
      ]),
    );
    expect(result.kept).toHaveLength(2);
    expect(await exists(referenced.path)).toBe(true);
    expect(await exists(clean.path)).toBe(false);
    expect(branches(dir)).not.toContain(clean.branch);
    expect(await exists(foreign)).toBe(true);
    expect(branches(dir)).toContain("feature/mine");
    // 建 4 个 worktree、几十次 git 调用：整套测试并行跑时 5 秒默认超时不够（2026-10-19 偶发超时）。
  }, 20_000);

  it("旧版位置（<仓库上级>/.omp-studio-worktrees）的 worktree 照常能合并、丢弃（按 git 登记认，不按目录）", async () => {
    const dir = await fresh();
    const legacy = path.join(path.dirname(dir), ".omp-studio-worktrees", path.basename(dir), "deadbeef");
    sh(dir, "worktree", "add", "-b", "studio/deadbeef", legacy);
    await put(legacy, "旧.txt", "old\n");
    sh(legacy, "add", "-A");
    sh(legacy, "commit", "-m", "旧位置");
    expect(await mergeWorktree(dir, legacy, "studio/deadbeef", "main")).toMatchObject({ kind: "merged" });
    await removeWorktree(dir, legacy, "studio/deadbeef");
    expect(await exists(legacy)).toBe(false);
    expect(branches(dir)).toEqual(["main"]);
  });

  it("拒绝移除没登记的目录、不在登记分支上的 worktree、非 studio/ 分支", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    const stray = path.join(scratch, "没登记 的目录");
    await mkdir(stray, { recursive: true });
    await expect(removeWorktree(dir, stray, "studio/x")).rejects.toThrow(/not a registered worktree/);
    await expect(removeWorktree(dir, wt.path, "studio/other")).rejects.toThrow(/not on the task's branch/);
    await expect(removeWorktree(dir, wt.path, "main")).rejects.toThrow(/not a studio branch/);
    expect(await exists(stray)).toBe(true);
    expect(await exists(wt.path)).toBe(true);
  });

  it("目录被手动删掉后，清理会让 git 忘掉这条登记（prune）", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir, opts);
    await rm(wt.path, { recursive: true, force: true });
    await cleanupOrphanWorktrees(dir, []);
    expect(sh(dir, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});

import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  worktreeParent,
} from "../src/main/git/worktree.ts";
import { makeRepo, makeScratch, put, sh } from "./git-helpers.ts";

let scratch: string;
let n = 0;
beforeAll(async () => {
  scratch = await makeScratch("worktree");
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const fresh = () => makeRepo(scratch, `仓库 ${++n}`);
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
const branches = (dir: string) => sh(dir, "branch", "--format=%(refname:short)").split(/\r?\n/).filter(Boolean);

describe("创建 worktree", () => {
  it("分支 studio/<slug> 从当前 HEAD 建出，目录在仓库之外的 .omp-studio-worktrees/<仓库名>/<slug>", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir);
    expect(wt.baseBranch).toBe("main");
    expect(wt.branch).toMatch(/^studio\/[0-9a-f]{8}$/);
    expect(path.dirname(wt.path)).toBe(worktreeParent(dir));
    expect(path.relative(dir, wt.path).startsWith("..")).toBe(true);
    expect(await readFile(path.join(wt.path, "a.txt"), "utf8")).toBe("alpha\nbeta\n");
    expect(sh(wt.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(wt.branch);
    expect(sh(dir, "rev-parse", wt.branch)).toBe(sh(dir, "rev-parse", "HEAD"));
    // 主仓库的 git status 看不到 worktree 目录。
    expect((await statusAt(dir)).files).toEqual([]);
  });

  it("不是 git 仓库、子目录项目、没有提交、detached HEAD 都拒绝，并说清原因", async () => {
    const plain = path.join(scratch, "普通 目录");
    await mkdir(plain);
    await expect(createWorktree(plain)).rejects.toThrow(/git repository/);

    const dir = await fresh();
    await mkdir(path.join(dir, "子 目录"));
    await expect(createWorktree(path.join(dir, "子 目录"))).rejects.toThrow(/repository root/);

    const empty = path.join(scratch, "空 仓库");
    sh(scratch, "init", "-b", "main", empty);
    await expect(createWorktree(empty)).rejects.toThrow(/no commits/);

    sh(dir, "checkout", "--detach");
    await expect(createWorktree(dir)).rejects.toThrow(/detached/);
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

    const wt = await createWorktree(dir, approve);
    const out = (await readFile(path.join(wt.path, "setup-ran.txt"), "utf8")).trim();
    expect(out).toBe(`${dir}|${wt.path}`);
  });

  it.skipIf(process.platform !== "win32")("Windows 上 setup.ps1 优先于 setup.cmd", async () => {
    const dir = await fresh();
    await put(dir, ".omp-studio/setup.cmd", "@echo off\r\n> from.txt echo cmd\r\n");
    await put(dir, ".omp-studio/setup.ps1", "Set-Content -Path from.txt -Value ps1\r\n");
    const wt = await createWorktree(dir, approve);
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
    await expect(createWorktree(dir, approve)).rejects.toThrow(/exit 3/);
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
    await expect(createWorktree(dir)).rejects.toThrow(/setup script not approved/);
    let seen = "";
    await expect(
      createWorktree(dir, {
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

describe("合并回基分支", () => {
  it("worktree 里提交后合并：基分支拿到改动；没有新提交时是 nothing_to_merge", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir);
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
    const wt = await createWorktree(dir);
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
    const wt = await createWorktree(dir);
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

describe("丢弃和清理", () => {
  it("丢弃：目录和分支都没了，含未提交和未合并的内容；重复丢弃不报错", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir);
    await put(wt.path, "未提交.txt", "x\n");
    await put(wt.path, "a.txt", "已提交\n");
    sh(wt.path, "commit", "-am", "未合并");
    await removeWorktree(dir, wt.path, wt.branch);
    expect(await exists(wt.path)).toBe(false);
    expect(branches(dir)).toEqual(["main"]);
    await removeWorktree(dir, wt.path, wt.branch);
  });

  it("清理无主 worktree：任务引用的不动；干净且已合入的删除；脏的、有未合并提交的、git 不认识的目录保留并报告", async () => {
    const dir = await fresh();
    const referenced = await createWorktree(dir);
    const clean = await createWorktree(dir);
    const dirty = await createWorktree(dir);
    const unmerged = await createWorktree(dir);
    await put(dirty.path, "脏.txt", "x\n");
    await put(unmerged.path, "u.txt", "u\n");
    sh(unmerged.path, "add", "-A");
    sh(unmerged.path, "commit", "-m", "未合并");
    const stray = path.join(worktreeParent(dir), "不认识 的目录");
    await mkdir(stray, { recursive: true });
    await writeFile(path.join(stray, "f.txt"), "f");

    const result = await cleanupOrphanWorktrees(dir, [referenced.path]);
    const name = (wt: { path: string }) => path.basename(wt.path);
    expect(result.removed).toEqual([name(clean)]);
    expect(result.kept).toEqual(
      expect.arrayContaining([
        { name: name(dirty), reason: "dirty" },
        { name: name(unmerged), reason: "unmerged" },
        { name: "不认识 的目录", reason: "unregistered" },
      ]),
    );
    expect(result.kept).toHaveLength(3);
    expect(await exists(referenced.path)).toBe(true);
    expect(await exists(clean.path)).toBe(false);
    expect(branches(dir)).not.toContain(clean.branch);
    expect(await exists(stray)).toBe(true);
  });

  it("目录被手动删掉后，清理会让 git 忘掉这条登记（prune）", async () => {
    const dir = await fresh();
    const wt = await createWorktree(dir);
    await rm(wt.path, { recursive: true, force: true });
    await cleanupOrphanWorktrees(dir, []);
    expect(sh(dir, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});

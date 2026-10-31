// skill 镜像：Claude Code 只读 .claude/skills，镜像没建或过期时它看不到 .agents/skills 里的 skill，或者看到旧版本。
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncSkills } from "../scripts/sync-agent-adapters.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "omp-studio-skills 中文-"));
  await mkdir(path.join(root, ".agents", "skills", "review"), { recursive: true });
  await writeFile(path.join(root, ".agents", "skills", "review", "SKILL.md"), "---\nname: review\n---\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe("syncSkills", () => {
  it("建出镜像后能从 .claude/skills 读到 SKILL.md，再同步一次什么也不改", async () => {
    expect(await syncSkills(root, true)).toEqual([".claude/skills/review: 缺少"]);
    expect(await syncSkills(root, false)).toHaveLength(1);
    expect(await readFile(path.join(root, ".claude", "skills", "review", "SKILL.md"), "utf8")).toContain(
      "name: review",
    );
    expect(await syncSkills(root, false)).toEqual([]);
    expect(await syncSkills(root, true)).toEqual([]);
  });

  it("镜像被删掉时检查报不一致，同步后恢复", async () => {
    await syncSkills(root, false);
    await rm(path.join(root, ".claude", "skills", "review"), { recursive: true, force: true, maxRetries: 3 });
    // 删的是链接本身，源文件还在
    expect(await readFile(path.join(root, ".agents", "skills", "review", "SKILL.md"), "utf8")).toContain(
      "name: review",
    );
    expect(await syncSkills(root, true)).toEqual([".claude/skills/review: 缺少"]);
    await syncSkills(root, false);
    expect(await syncSkills(root, true)).toEqual([]);
  });

  it("复制出来的镜像少了文件或内容过期时检查报不一致，同步换成和源一致", async () => {
    const target = path.join(root, ".claude", "skills", "review");
    await cp(path.join(root, ".agents", "skills", "review"), target, { recursive: true });
    expect(await syncSkills(root, true)).toEqual([]);
    await writeFile(path.join(root, ".agents", "skills", "review", "SKILL.md"), "---\nname: review\n---\n新内容\n");
    expect(await syncSkills(root, true)).toEqual([".claude/skills/review: 复制的内容和源不一致"]);
    await rm(path.join(target, "SKILL.md"));
    expect(await syncSkills(root, true)).toEqual([".claude/skills/review: 复制的内容和源不一致"]);
    await syncSkills(root, false);
    expect(await readFile(path.join(target, "SKILL.md"), "utf8")).toContain("新内容");
  });

  it("源里删掉的 skill：留下的链接算不一致并被删掉，不碰 .claude/skills 里别的普通目录", async () => {
    await mkdir(path.join(root, ".claude", "skills", "personal"), { recursive: true });
    await syncSkills(root, false);
    await rm(path.join(root, ".agents", "skills", "review"), { recursive: true, force: true, maxRetries: 3 });
    expect(await syncSkills(root, true)).toEqual([".claude/skills/review: .agents/skills 里已没有这个 skill"]);
    await syncSkills(root, false);
    expect(await syncSkills(root, true)).toEqual([]);
    expect((await readdir(path.join(root, ".claude", "skills"))).filter((name) => !name.startsWith("."))).toEqual([
      "personal",
    ]);
  });

  it("建链接失败时复制出来的镜像，源里删掉后同样算不一致并被删掉", async () => {
    await syncSkills(root, false);
    // 换成复制件，等同于建联接失败时走的复制
    const target = path.join(root, ".claude", "skills", "review");
    await rm(target, { recursive: true, force: true, maxRetries: 3 });
    await cp(path.join(root, ".agents", "skills", "review"), target, { recursive: true });
    await rm(path.join(root, ".agents", "skills", "review"), { recursive: true, force: true, maxRetries: 3 });
    expect(await syncSkills(root, true)).toEqual([".claude/skills/review: .agents/skills 里已没有这个 skill"]);
    await syncSkills(root, false);
    expect(await syncSkills(root, true)).toEqual([]);
    expect((await readdir(path.join(root, ".claude", "skills"))).filter((name) => !name.startsWith("."))).toEqual([]);
  });
});

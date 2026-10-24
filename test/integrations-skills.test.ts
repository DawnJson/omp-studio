// src/main/integrations/skills.ts：列表（含停用补行）、停用 / 启用、删除前校验、添加（frontmatter 校验、复制、同名拒绝）。
// 路径带空格和中文；用真实的临时目录，omp 命令换成假的 RunOmp。
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copySkillFolder,
  displayPath,
  listSkillEntries,
  readSkillFolder,
  removeSkill,
  setSkillEnabled,
  SkillPicker,
  skillsRoot,
} from "../src/main/integrations/skills.ts";
import type { RunOmp } from "../src/main/usage/usage-service.ts";

let base: string;
let home: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(os.tmpdir(), "omp skills 测试 "));
  home = path.join(base, "home dir");
  await mkdir(home, { recursive: true });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function writeSkill(dir: string, frontmatter: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n正文\n`, "utf8");
  return dir;
}

const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: "" });

function listing(skills: { name: string; baseDir: string; source: string; description?: string }[]): string {
  return JSON.stringify({
    skills: skills.map((skill) => ({
      description: "说明",
      filePath: path.join(skill.baseDir, "SKILL.md"),
      hide: false,
      ...skill,
    })),
    warnings: [],
  });
}

describe("displayPath", () => {
  it("家目录写成 ~，分隔符统一成 /；家目录外的原样", () => {
    expect(displayPath(path.join(home, ".agents", "skills", "我的 skill"), home)).toBe("~/.agents/skills/我的 skill");
    expect(displayPath(home, home)).toBe("~");
    expect(displayPath(path.join(base, "elsewhere"), home)).toBe(path.join(base, "elsewhere"));
    // 前缀相同但不在家目录里
    expect(displayPath(`${home}-other`, home)).toBe(`${home}-other`);
  });
});

describe("listSkillEntries", () => {
  it("来源、能否删除、是否共用、停用补行；按名字排序", async () => {
    const shared = await writeSkill(path.join(home, ".agents", "skills", "共用 skill"), "name: 共用 skill");
    const own = await writeSkill(path.join(base, "agent dir", "skills", "own"), "name: own");
    const project = await writeSkill(path.join(base, "proj", ".omp", "skills", "proj-one"), "name: proj-one");
    const pluginDir = path.join(base, "plugins", "cache", "pdf", "skills", "pdf");
    await writeSkill(pluginDir, "name: pdf");
    const run: RunOmp = (args) => {
      expect(args).toEqual(["skill", "list", "--json"]);
      return ok(
        listing([
          { name: "共用 skill", baseDir: shared, source: "agents:user" },
          { name: "own", baseDir: own, source: "native:user", description: "" },
          { name: "proj-one", baseDir: project, source: "native:project" },
          { name: "pdf", baseDir: pluginDir, source: "claude-plugins:user" },
        ]),
      );
    };
    const config: RunOmp = (args) => {
      expect(args).toEqual(["config", "get", "--json", "disabledExtensions"]);
      return ok(
        JSON.stringify({
          key: "disabledExtensions",
          value: ["skill:zzz-off", "context-file:user:CLAUDE.md", "skill:own"],
        }),
      );
    };
    const entries = await listSkillEntries(run, config, home, path.join(base, "proj"));
    const names = ["own", "pdf", "proj-one", "zzz-off", "共用 skill"];
    expect(entries.map((entry) => entry.name)).toEqual(names.sort((a, b) => a.localeCompare(b)));
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    expect(byName["共用 skill"]).toMatchObject({
      scope: "user",
      plugin: false,
      disabled: false,
      toggleable: true,
      removable: true,
      shared: true,
      folder: "~/.agents/skills/共用 skill",
    });
    expect(byName["own"]).toMatchObject({ scope: "user", removable: true, shared: false, disabled: false });
    expect(byName["own"]?.description).toBeUndefined();
    expect(byName["proj-one"]).toMatchObject({ scope: "project", toggleable: false, removable: true });
    expect(byName["pdf"]).toMatchObject({ plugin: true, removable: false });
    // 在 omp 列表里的（own）不重复补行；列表里没有的补成"已停用"，只有名字。
    expect(entries.filter((entry) => entry.name === "own")).toHaveLength(1);
    expect(byName["zzz-off"]).toEqual({
      name: "zzz-off",
      scope: "user",
      plugin: false,
      disabled: true,
      toggleable: true,
      removable: false,
      shared: false,
    });
  });

  it("project 层只认文件夹在当前项目里的：祖先目录里的（omp 沿 cwd 往上找到的）不列；用户范围一个 project 层都不列", async () => {
    const inside = await writeSkill(path.join(base, "proj", ".agents", "skills", "in"), "name: in");
    const ancestor = await writeSkill(path.join(base, ".agents", "skills", "up"), "name: up");
    const run: RunOmp = () =>
      ok(
        listing([
          { name: "in", baseDir: inside, source: "agents:project" },
          { name: "up", baseDir: ancestor, source: "agents:project" },
        ]),
      );
    const config: RunOmp = () => ok(JSON.stringify({ value: [] }));
    const inProject = await listSkillEntries(run, config, home, path.join(base, "proj"));
    expect(inProject.map((entry) => entry.name)).toEqual(["in"]);
    expect(await listSkillEntries(run, config, home, null)).toEqual([]);
  });

  it("文件夹没有 SKILL.md 或不在 skills/ 下时不能删", async () => {
    const noFile = path.join(home, ".agents", "skills", "empty");
    await mkdir(noFile, { recursive: true });
    const odd = await writeSkill(path.join(base, "elsewhere", "odd"), "name: odd");
    const entries = await listSkillEntries(
      () =>
        ok(
          listing([
            { name: "empty", baseDir: noFile, source: "agents:user" },
            { name: "odd", baseDir: odd, source: "agents:user" },
          ]),
        ),
      () => ok(JSON.stringify({ value: [] })),
      home,
      null,
    );
    expect(entries.map((entry) => entry.removable)).toEqual([false, false]);
  });

  it("omp 以非 0 退出就抛错，带 stderr", async () => {
    const failing: RunOmp = () => Promise.resolve({ code: 1, stdout: "", stderr: "boom" });
    await expect(listSkillEntries(failing, failing, home, null)).rejects.toThrow(
      "omp skill list exited with code 1: boom",
    );
  });
});

describe("setSkillEnabled", () => {
  function fakeConfig(initial: string[]) {
    const calls: string[][] = [];
    let value = initial;
    const run: RunOmp = (args) => {
      calls.push(args);
      if (args[1] === "get") return ok(JSON.stringify({ key: "disabledExtensions", value }));
      value = JSON.parse(args[5] ?? "[]") as string[];
      return ok(JSON.stringify({ key: "disabledExtensions", value }));
    };
    return { run, calls, current: () => value };
  }

  it("停用：读出、只加 skill:<name>、别的条目原样写回", async () => {
    const config = fakeConfig(["extension-module:foo", "context-file:user:CLAUDE.md"]);
    await setSkillEnabled(config.run, "我的 skill", false);
    expect(config.calls[1]).toEqual([
      "config",
      "set",
      "--json",
      "disabledExtensions",
      "--",
      '["extension-module:foo","context-file:user:CLAUDE.md","skill:我的 skill"]',
    ]);
    expect(config.current()).toEqual(["extension-module:foo", "context-file:user:CLAUDE.md", "skill:我的 skill"]);
  });

  it("启用：只去掉这一条；本来就没有停用就不写", async () => {
    const config = fakeConfig(["skill:a", "extension-module:foo", "skill:b"]);
    await setSkillEnabled(config.run, "a", true);
    expect(config.current()).toEqual(["extension-module:foo", "skill:b"]);
    const before = config.calls.length;
    await setSkillEnabled(config.run, "nope", true);
    expect(config.calls).toHaveLength(before + 1); // 只读了一次，没有 set
  });

  it("名字为空或含控制字符时拒绝，不碰配置", async () => {
    const config = fakeConfig([]);
    await expect(setSkillEnabled(config.run, "  ", false)).rejects.toThrow("name is invalid");
    await expect(setSkillEnabled(config.run, "a\nb", false)).rejects.toThrow("name is invalid");
    expect(config.calls.every((call) => call[1] === "get")).toBe(true);
  });
});

describe("removeSkill", () => {
  async function remove(
    name: string,
    scope: "user" | "project",
    skills: Parameters<typeof listing>[0],
    project: string | null = null,
  ) {
    const trashed: string[] = [];
    await removeSkill(
      () => ok(listing(skills)),
      name,
      scope,
      project,
      (folder) => {
        trashed.push(folder);
        return Promise.resolve();
      },
    );
    return trashed;
  }

  it("按名字和层级找到 baseDir，整个文件夹交给回收站", async () => {
    const dir = await writeSkill(path.join(home, ".agents", "skills", "带 空格 的 skill"), "name: x");
    const other = await writeSkill(path.join(base, "proj", ".omp", "skills", "x"), "name: x");
    const trashed = await remove("x", "user", [
      { name: "x", baseDir: other, source: "native:project" },
      { name: "x", baseDir: dir, source: "agents:user" },
    ]);
    expect(trashed).toEqual([dir]);
  });

  it("插件带的、不在 skills/ 下的、没有 SKILL.md 的、列表里没有的都拒绝，回收站不会被调用", async () => {
    const plugin = await writeSkill(path.join(base, "plugins", "pdf", "skills", "pdf"), "name: pdf");
    const odd = await writeSkill(path.join(base, "elsewhere", "odd"), "name: odd");
    const empty = path.join(home, ".agents", "skills", "empty");
    await mkdir(empty, { recursive: true });
    const skills = [
      { name: "pdf", baseDir: plugin, source: "claude-plugins:user" },
      { name: "odd", baseDir: odd, source: "agents:user" },
      { name: "empty", baseDir: empty, source: "agents:user" },
    ];
    await expect(remove("pdf", "user", skills)).rejects.toThrow("plugins cannot be removed");
    await expect(remove("odd", "user", skills)).rejects.toThrow("not under a skills directory");
    await expect(remove("empty", "user", skills)).rejects.toThrow("has no SKILL.md");
    await expect(remove("missing", "user", skills)).rejects.toThrow('skill "missing" not found');
    // 层级不符：项目级的 skill 不能当用户级删
    await expect(remove("pdf", "project", skills)).rejects.toThrow("not found");
    // 祖先目录里被 omp 标成 project 的：不在当前项目里，不能删
    const up = await writeSkill(path.join(base, ".agents", "skills", "up"), "name: up");
    const stray = [{ name: "up", baseDir: up, source: "agents:project" }];
    await expect(remove("up", "project", stray, path.join(base, "proj"))).rejects.toThrow("not found");
  });
});

describe("readSkillFolder", () => {
  it("读 name 和 description；CRLF、BOM、带引号的 YAML 都行", async () => {
    const dir = path.join(base, "源 文件夹");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "SKILL.md"),
      '\uFEFF---\r\nname: "中文 skill"\r\ndescription: >\r\n  第一行\r\n  第二行\r\n---\r\n正文',
      "utf8",
    );
    expect(await readSkillFolder(dir)).toEqual({ name: "中文 skill", description: "第一行 第二行" });
  });

  it("没有 SKILL.md、没有 frontmatter、缺 name 或 description、名字不能当文件夹名都拒绝", async () => {
    const empty = path.join(base, "empty");
    await mkdir(empty);
    await expect(readSkillFolder(empty)).rejects.toThrow("no SKILL.md");

    const plain = path.join(base, "plain");
    await mkdir(plain);
    await writeFile(path.join(plain, "SKILL.md"), "# no frontmatter\n", "utf8");
    await expect(readSkillFolder(plain)).rejects.toThrow("frontmatter has no name");

    await expect(readSkillFolder(await writeSkill(path.join(base, "n"), "description: d"))).rejects.toThrow("no name");
    await expect(readSkillFolder(await writeSkill(path.join(base, "d"), "name: n"))).rejects.toThrow("no description");
    for (const [index, bad] of ["a/b", "a\\b", "..", "a:b", "trail.", "x?y"].entries()) {
      const dir = await writeSkill(path.join(base, `bad-${index}`), `name: '${bad}'\ndescription: d`);
      await expect(readSkillFolder(dir)).rejects.toThrow("not a valid folder name");
    }
  });
});

describe("skillsRoot", () => {
  const places = { home: path.join(os.tmpdir(), "h"), agentDir: path.join(os.tmpdir(), "a"), project: null };
  it("用户范围：~/.agents/skills 和 agent 目录的 skills；项目范围：项目的 .agents/skills 和 .omp/skills", () => {
    const project = path.join("C:", "项目 文件夹");
    expect(skillsRoot("shared", places)).toBe(path.join(places.home, ".agents", "skills"));
    expect(skillsRoot("omp", places)).toBe(path.join(places.agentDir, "skills"));
    expect(skillsRoot("shared", { ...places, project })).toBe(path.join(project, ".agents", "skills"));
    expect(skillsRoot("omp", { ...places, project })).toBe(path.join(project, ".omp", "skills"));
  });
});

describe("添加：copySkillFolder / SkillPicker", () => {
  it("整个文件夹（含子目录里的文件）复制过去，路径带空格和中文", async () => {
    const source = await writeSkill(path.join(base, "源 文件夹", "my skill"), "name: 复制 me\ndescription: d");
    await mkdir(path.join(source, "scripts", "子目录"), { recursive: true });
    await writeFile(path.join(source, "scripts", "子目录", "run.py"), "print('你好')\n", "utf8");
    const root = path.join(home, ".agents", "skills"); // 还不存在：会被创建
    const dest = await copySkillFolder(source, root, "复制 me");
    expect(dest).toBe(path.join(root, "复制 me"));
    expect(await readFile(path.join(dest, "scripts", "子目录", "run.py"), "utf8")).toBe("print('你好')\n");
    expect(await readFile(path.join(dest, "SKILL.md"), "utf8")).toContain("name: 复制 me");
  });

  it("目标已有同名文件夹就拒绝，原有内容不变", async () => {
    const source = await writeSkill(path.join(base, "src"), "name: dup\ndescription: d");
    const root = path.join(base, "root");
    const existing = await writeSkill(path.join(root, "dup"), "name: dup\ndescription: old");
    await expect(copySkillFolder(source, root, "dup")).rejects.toThrow("already exists");
    expect(await readFile(path.join(existing, "SKILL.md"), "utf8")).toContain("description: old");
  });

  it("目标在被添加的文件夹里面时拒绝", async () => {
    const source = await writeSkill(path.join(base, "self"), "name: self\ndescription: d");
    await expect(copySkillFolder(source, path.join(source, "skills"), "self")).rejects.toThrow("inside");
  });

  it("pick 返回文件夹名、skill 名和说明（不含路径），add 按 token 复制；token 不对或已用掉就拒绝", async () => {
    const source = await writeSkill(path.join(base, "挑选 的 文件夹"), "name: picked\ndescription: 说明 文字");
    const picker = new SkillPicker();
    const places = { home, agentDir: path.join(base, "agent"), project: null };
    const candidate = await picker.pick(source);
    expect(candidate).toMatchObject({ folderName: "挑选 的 文件夹", name: "picked", description: "说明 文字" });
    expect(JSON.stringify(candidate)).not.toContain(base);
    await expect(picker.add("wrong", "omp", places)).rejects.toThrow("no folder is selected");
    const added = await picker.add(candidate.token, "omp", places);
    expect(added).toEqual({ name: "picked", folder: path.join(places.agentDir, "skills", "picked") });
    expect(await readFile(path.join(places.agentDir, "skills", "picked", "SKILL.md"), "utf8")).toContain("picked");
    await expect(picker.add(candidate.token, "omp", places)).rejects.toThrow("no folder is selected");
  });

  it("项目范围装到项目的 .agents/skills 或 .omp/skills，并在显示路径里保留项目路径", async () => {
    const project = path.join(base, "我的 项目");
    await mkdir(project, { recursive: true });
    const source = await writeSkill(path.join(base, "s"), "name: proj-skill\ndescription: d");
    const picker = new SkillPicker();
    const places = { home, agentDir: path.join(base, "agent"), project };
    const first = await picker.pick(source);
    await picker.add(first.token, "shared", places);
    const second = await picker.pick(source);
    await picker.add(second.token, "omp", places);
    expect(await readFile(path.join(project, ".agents", "skills", "proj-skill", "SKILL.md"), "utf8")).toContain(
      "proj-skill",
    );
    expect(await readFile(path.join(project, ".omp", "skills", "proj-skill", "SKILL.md"), "utf8")).toContain(
      "proj-skill",
    );
  });

  it("选完之后 SKILL.md 被改坏（name 变了）时拒绝；重新选择会作废上一次的 token", async () => {
    const source = await writeSkill(path.join(base, "changing"), "name: before\ndescription: d");
    const picker = new SkillPicker();
    const places = { home, agentDir: path.join(base, "agent"), project: null };
    const first = await picker.pick(source);
    await writeSkill(source, "name: after\ndescription: d");
    await expect(picker.add(first.token, "omp", places)).rejects.toThrow("changed after it was selected");
    const second = await picker.pick(source);
    await expect(picker.add(first.token, "omp", places)).rejects.toThrow("no folder is selected");
    await expect(picker.add(second.token, "omp", places)).resolves.toMatchObject({ name: "after" });
  });

  it("选的文件夹不合法时 pick 抛错，并清掉上一次的选择", async () => {
    const good = await writeSkill(path.join(base, "good"), "name: good\ndescription: d");
    const bad = path.join(base, "bad");
    await mkdir(bad);
    const picker = new SkillPicker();
    const places = { home, agentDir: path.join(base, "agent"), project: null };
    const candidate = await picker.pick(good);
    await expect(picker.pick(bad)).rejects.toThrow("no SKILL.md");
    await expect(picker.add(candidate.token, "omp", places)).rejects.toThrow("no folder is selected");
  });
});

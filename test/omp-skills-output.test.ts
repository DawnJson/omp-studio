// omp skill list --json / config get --json disabledExtensions 的解析（omp 18.12.6 实测形状）和 disabledExtensions 的加减。
import { describe, expect, it } from "vitest";
import {
  disabledSkillNames,
  isPluginProvider,
  parseDisabledExtensions,
  parseSkillList,
  parseSource,
  withSkillEnabled,
} from "../src/shared/omp-output/skills.ts";

const LIST = JSON.stringify({
  skills: [
    {
      name: "citation-management",
      description: " Comprehensive citation management ",
      filePath: "C:\\Users\\Some One\\.agents\\skills\\citation-management\\SKILL.md",
      baseDir: "C:\\Users\\Some One\\.agents\\skills\\citation-management",
      source: "agents:user",
      hide: false,
    },
    { name: "bare", filePath: "/x/SKILL.md", baseDir: "/x", source: "native:project", hide: true },
  ],
  warnings: [],
});

describe("parseSkillList", () => {
  it("取 name / description / 路径 / source，说明去首尾空白，缺说明给空串", () => {
    expect(parseSkillList(LIST)).toEqual([
      {
        name: "citation-management",
        description: "Comprehensive citation management",
        filePath: "C:\\Users\\Some One\\.agents\\skills\\citation-management\\SKILL.md",
        baseDir: "C:\\Users\\Some One\\.agents\\skills\\citation-management",
        source: "agents:user",
      },
      { name: "bare", description: "", filePath: "/x/SKILL.md", baseDir: "/x", source: "native:project" },
    ]);
  });

  it("JSON 前面有杂字也能解析；形状不对就抛错，不猜", () => {
    expect(parseSkillList(`warn\n${LIST}`)).toHaveLength(2);
    expect(() => parseSkillList("not json")).toThrow("did not print JSON");
    expect(() => parseSkillList("{}")).toThrow("no skills array");
    expect(() => parseSkillList('{"skills":[{"name":"x"}]}')).toThrow("unexpected skill entry");
  });
});

describe("parseSource / isPluginProvider", () => {
  it("`<provider>:<level>` 拆开；不是 project 的层级按用户级", () => {
    expect(parseSource("native:user")).toEqual({ provider: "native", level: "user" });
    expect(parseSource("agents:project")).toEqual({ provider: "agents", level: "project" });
    expect(parseSource("claude-plugins:user")).toEqual({ provider: "claude-plugins", level: "user" });
    expect(parseSource("odd")).toEqual({ provider: "odd", level: "user" });
  });

  it("插件 / registry / 自动学习的 provider 算插件，普通文件夹的不算", () => {
    for (const provider of ["omp-plugins", "agent-plugins", "claude-plugins", "skillshare", "omp-managed"])
      expect(isPluginProvider(provider)).toBe(true);
    for (const provider of ["native", "agents", "claude", "codex", "opencode", "github", "toString"])
      expect(isPluginProvider(provider)).toBe(false);
  });
});

describe("disabledExtensions", () => {
  it("读 `omp config get --json` 的 value；不是数组就抛错", () => {
    const out = JSON.stringify({ key: "disabledExtensions", value: ["skill:a", "context-file:user:CLAUDE.md"] });
    expect(parseDisabledExtensions(out)).toEqual(["skill:a", "context-file:user:CLAUDE.md"]);
    expect(() => parseDisabledExtensions('{"value":"x"}')).toThrow("not an array");
    expect(() => parseDisabledExtensions("nope")).toThrow("did not print JSON");
  });

  it("只列 `skill:` 条目的名字", () => {
    expect(disabledSkillNames(["skill:a", "extension-module:b", "context-file:user:x", "skill:team/pdf"])).toEqual([
      "a",
      "team/pdf",
    ]);
  });

  it("停用只在末尾加一条，启用只去掉这一条，别的条目顺序不变；重复停用不重复加", () => {
    const base = ["extension-module:foo", "skill:keep", "context-file:user:CLAUDE.md"];
    expect(withSkillEnabled(base, "new", false)).toEqual([...base, "skill:new"]);
    expect(withSkillEnabled(base, "keep", false)).toEqual(base);
    expect(withSkillEnabled(base, "keep", true)).toEqual(["extension-module:foo", "context-file:user:CLAUDE.md"]);
    expect(withSkillEnabled(base, "absent", true)).toEqual(base);
  });
});

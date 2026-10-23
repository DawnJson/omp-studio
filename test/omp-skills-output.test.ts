// get_available_commands → Skills 卡片的条目（omp 18.12.6 实测形状：skill 的 name 带 `skill:` 前缀，source = "skill"）。
import { describe, expect, it } from "vitest";
import { skillsFromCommands } from "../src/shared/omp-output/skills.ts";

describe("skillsFromCommands", () => {
  it("只取 source = skill，去掉前缀，按名字排序，带范围", () => {
    const skills = skillsFromCommands(
      [
        { name: "compact", source: "builtin", description: "Compact" },
        { name: "skill:zeta", source: "skill", description: " Last one " },
        { name: "skill:alpha", source: "skill", description: "First" },
        { name: "skill:plain", source: "skill" },
        { name: "review", source: "custom" },
      ],
      "user",
    );
    expect(skills).toEqual([
      { name: "alpha", description: "First", scope: "user" },
      { name: "plain", scope: "user" },
      { name: "zeta", description: "Last one", scope: "user" },
    ]);
  });

  it("重名 skill 的命名空间形式原样保留", () => {
    expect(skillsFromCommands([{ name: "skill:team/pdf", source: "skill" }], "project")).toEqual([
      { name: "team/pdf", scope: "project" },
    ]);
  });
});

// 设置 → 集成与插件 → Skills：omp 当前能用的 skill 来自 rpc-ui 的 `get_available_commands`（`source: "skill"`，名字带 `skill:` 前缀）。
// 实测（omp 18.12.6）：条目只有 name / description / input，没有文件路径和来源层级；范围由主进程比对用户和项目两份列表得出。
import type { AvailableSlashCommand } from "../omp-wire/rpc-wire.generated.ts";

export type SkillScope = "user" | "project";

export interface SkillEntry {
  /** 不带 `skill:` 前缀的名字；重名的 skill omp 给的是 `<命名空间>/<名字>`，原样保留。 */
  name: string;
  description?: string;
  scope: SkillScope;
}

const PREFIX = "skill:";

/** 命令列表里的 skill（按名字排序）；`scope` 由调用方给。 */
export function skillsFromCommands(commands: readonly AvailableSlashCommand[], scope: SkillScope): SkillEntry[] {
  return commands
    .filter((command) => command.source === "skill" && command.name.startsWith(PREFIX))
    .map((command): SkillEntry => {
      const description = command.description?.trim();
      return {
        name: command.name.slice(PREFIX.length),
        ...(description !== undefined && description !== "" && { description }),
        scope,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

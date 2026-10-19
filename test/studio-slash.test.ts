import { describe, expect, it } from "vitest";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import {
  findStudioSlash,
  withStudioSlash,
  type StudioSlashCommand,
} from "../src/renderer/src/features/composer/studio-slash.ts";

const exportCommand: StudioSlashCommand = {
  name: "export",
  aliases: ["save"],
  descKey: "menu.newTask",
  run: () => {},
};
const t = (key: string) => `t:${key}`;

describe("findStudioSlash", () => {
  it("命中名称或别名（不分大小写），参数去掉首尾空白", () => {
    expect(findStudioSlash("/export  a b ", [exportCommand])).toEqual({ command: exportCommand, args: "a b" });
    expect(findStudioSlash("  /SAVE", [exportCommand])?.args).toBe("");
  });

  it("前缀相同但名字不同、路径、普通文字都不算", () => {
    expect(findStudioSlash("/exporter", [exportCommand])).toBeNull();
    expect(findStudioSlash("/export/x", [exportCommand])).toBeNull();
    expect(findStudioSlash("export", [exportCommand])).toBeNull();
  });
});

describe("withStudioSlash", () => {
  const omp: AvailableSlashCommand[] = [
    { name: "export", source: "builtin", description: "omp 自己的" },
    { name: "keep", source: "builtin", aliases: ["save"] },
    { name: "compact", source: "builtin" },
  ];

  it("studio 的命令在前；omp 里同名（含别名撞名）的去掉，其余原样保留", () => {
    const merged = withStudioSlash(omp, [exportCommand], t);
    expect(merged.map((command) => command.name)).toEqual(["export", "compact"]);
    expect(merged[0]?.description).toBe("t:menu.newTask");
  });

  it("没有 studio 命令时是 omp 列表的副本", () => {
    const merged = withStudioSlash(omp, [], t);
    expect(merged).toEqual(omp);
    expect(merged).not.toBe(omp);
  });
});

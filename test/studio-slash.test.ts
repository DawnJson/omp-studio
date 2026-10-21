import { describe, expect, it } from "vitest";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import {
  findStudioSlash,
  handledCommands,
  passthroughCommands,
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
describe("handledCommands / passthroughCommands", () => {
  const rpcOnly: StudioSlashCommand = { name: "todo", descKey: "menu.newTask", run: () => {} };
  const both: StudioSlashCommand = {
    name: "usage",
    descKey: "menu.newTask",
    tsp: "studio",
    draft: () => {},
    run: () => {},
  };
  const ompOwned: StudioSlashCommand = { name: "tree", descKey: "menu.newTask", tsp: "omp", run: () => {} };
  const all = [rpcOnly, both, ompOwned];

  it("rpc 任务：全部由 studio 接管，没有交给 omp 的", () => {
    expect(handledCommands(all, "rpc")).toEqual(all);
    expect(passthroughCommands(all, "rpc")).toEqual([]);
  });

  it("TSP 任务：只有 tsp=studio 的接管；tsp=omp 的只在菜单里列出", () => {
    expect(handledCommands(all, "tsp")).toEqual([both]);
    expect(passthroughCommands(all, "tsp")).toEqual([ompOwned]);
  });

  it("草稿页：只有写了 draft 的", () => {
    expect(handledCommands(all, "draft")).toEqual([both]);
    expect(passthroughCommands(all, "draft")).toEqual([]);
  });

  it("TSP 下 tsp=omp 的命令发送时不被拦截（findStudioSlash 在 handled 列表里找不到）", () => {
    expect(findStudioSlash("/tree", handledCommands(all, "tsp"))).toBeNull();
    expect(findStudioSlash("/usage", handledCommands(all, "tsp"))?.command).toBe(both);
  });
});

describe("withStudioSlash", () => {
  const omp: AvailableSlashCommand[] = [
    { name: "export", source: "builtin", description: "omp 自己的" },
    { name: "keep", source: "builtin", aliases: ["save"] },
    { name: "compact", source: "builtin" },
  ];

  it("studio 的命令在前；omp 里同名（含别名撞名）的去掉，其余原样保留", () => {
    const merged = withStudioSlash(omp, [exportCommand], "rpc", t);
    expect(merged.map((command) => command.name)).toEqual(["export", "compact"]);
    expect(merged[0]?.description).toBe("t:menu.newTask");
  });

  it("没有 studio 命令时是 omp 列表的副本", () => {
    const merged = withStudioSlash(omp, [], "rpc", t);
    expect(merged).toEqual(omp);
    expect(merged).not.toBe(omp);
  });

  it("TSP：tsp=omp 的命令在 omp 列表没有时补在最后，有时不重复", () => {
    const tree: StudioSlashCommand = { name: "tree", descKey: "menu.newTask", tsp: "omp", run: () => {} };
    const keep: StudioSlashCommand = { name: "compact", descKey: "menu.newTask", tsp: "omp", run: () => {} };
    const merged = withStudioSlash(omp, [tree, keep], "tsp", t);
    expect(merged.map((command) => command.name)).toEqual(["export", "keep", "compact", "tree"]);
  });

  it("TSP：tsp=studio 的命令盖住 omp 的同名项，没写 tsp 的不出现", () => {
    const own: StudioSlashCommand = { name: "export", descKey: "menu.newTask", tsp: "studio", run: () => {} };
    const rpcOnly: StudioSlashCommand = { name: "compact", descKey: "menu.newTask", run: () => {} };
    const merged = withStudioSlash(omp, [own, rpcOnly], "tsp", t);
    expect(merged.map((command) => command.name)).toEqual(["export", "keep", "compact"]);
    expect(merged[0]?.description).toBe("t:menu.newTask");
    expect(merged[2]).toBe(omp[2]);
  });
});

// TSP `menu` 节点的行（TspMenuItem）和节点 `actions.menu` 的右键菜单项（TspMenuEntry，omp 19 起可以是对象）怎么解析。
import { describe, expect, it } from "vitest";
import { chosenAction, contextEntries, menuModel } from "../src/renderer/src/features/tsp/nodes/menu-model.ts";

describe("contextEntries（actions.menu 的右键菜单项）", () => {
  it("omp 19.2.1 旁路便签的菜单：对象行带 label / icon，`-` 是分隔线（btw-controller.ts #noteMenu）", () => {
    expect(
      contextEntries([
        { id: "btw-copy", label: "Copy answer", icon: "copy" },
        { id: "btw-history", label: "Open in BTW history", icon: "history" },
        "-",
        { id: "btw-fold", label: "Fold to one line" },
      ]),
    ).toEqual([
      { kind: "row", act: "btw-copy", label: "Copy answer", icon: "copy" },
      { kind: "row", act: "btw-history", label: "Open in BTW history", icon: "history" },
      { kind: "separator" },
      { kind: "row", act: "btw-fold", label: "Fold to one line" },
    ]);
  });

  it("动作名字符串、小节标题、detail / disabled（原因）/ danger 都留下", () => {
    expect(
      contextEntries([
        "open",
        { header: "More" },
        { id: "drop", detail: "cannot undo", disabled: "busy", danger: true },
        { id: "x", disabled: true },
      ]),
    ).toEqual([
      { kind: "row", act: "open" },
      { kind: "header", label: "More" },
      { kind: "row", act: "drop", detail: "cannot undo", disabled: "busy", danger: true },
      { kind: "row", act: "x", disabled: true },
    ]);
  });

  it("不认得的形状丢掉；分隔线不在开头、结尾，也不连着两条", () => {
    expect(contextEntries(["-", 3, null, { label: "no id" }, "a", "-", "-", "b", "-"])).toEqual([
      { kind: "row", act: "a" },
      { kind: "separator" },
      { kind: "row", act: "b" },
    ]);
    expect(contextEntries(undefined)).toEqual([]);
  });
});

describe("menuModel（menu 节点的 items）", () => {
  it("omp 19.2.1 计划审阅的执行模型下拉：单选行，没给 checked 的算 false", () => {
    expect(
      menuModel([
        { id: "tier:0", label: "Fast", detail: "small", radio: "tier", checked: true },
        { id: "tier:1", label: "Deep", radio: "tier" },
      ]),
    ).toEqual([
      { kind: "row", id: "tier:0", label: "Fast", detail: "small", radio: "tier", checked: true },
      { kind: "row", id: "tier:1", label: "Deep", radio: "tier", checked: false },
    ]);
  });

  it("字符串行按 id 起名，keys 收成数组，子菜单就地展开成小节", () => {
    expect(
      menuModel([
        "save-as",
        { id: "copy", keys: "ctrl+c", disabled: "nothing selected" },
        { id: "more", label: "More", items: ["a", "-", { header: "H" }] },
        "z",
      ]),
    ).toEqual([
      { kind: "row", id: "save-as", label: "Save as" },
      { kind: "row", id: "copy", label: "Copy", keys: ["ctrl+c"], disabled: "nothing selected" },
      { kind: "separator" },
      { kind: "header", label: "More" },
      { kind: "row", id: "a", label: "A" },
      { kind: "separator" },
      { kind: "header", label: "H" },
      { kind: "separator" },
      { kind: "row", id: "z", label: "Z" },
    ]);
  });
});

describe("chosenAction（选中一行发的 action）", () => {
  it("普通行只有 act；勾选行带翻过来的 checked；单选行总是 checked: true", () => {
    expect(chosenAction({ kind: "row", id: "a", label: "A" })).toEqual({ act: "a" });
    expect(chosenAction({ kind: "row", id: "w", label: "W", checked: true })).toEqual({ act: "w", checked: false });
    expect(chosenAction({ kind: "row", id: "t", label: "T", radio: "g", checked: true })).toEqual({
      act: "t",
      checked: true,
    });
  });
});

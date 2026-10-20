// 防的是：list 高亮标错字、picker 的目录补丁丢项 / 重复应用、事实列在窄窗口下挤掉标签、
// prefs 的步进 / 多选 / 排序算错、输入框背景层的分段和 decor 对不上。
import { describe, expect, it } from "vitest";
import {
  buildEntries,
  compactNumber,
  emptyCatalog,
  splitMonoLabel,
  updateCatalog,
  visibleColumns,
  visibleRange,
} from "../src/renderer/src/features/tsp/interactive/picker-model.ts";
import {
  isSegmented,
  moveOrdered,
  nextNumber,
  numberLabel,
  orderedOptions,
  toggleMulti,
  wordHits,
} from "../src/renderer/src/features/tsp/interactive/prefs-model.ts";
import {
  clampOffset,
  filterHits,
  plainText,
  splitRuns,
} from "../src/renderer/src/features/tsp/interactive/text-model.ts";

describe("filterHits（规范里的例子）", () => {
  it("连续出现优先，不分大小写", () => {
    expect(filterHits("Session Lifecycle", "LIFE")).toEqual([[8, 12]]);
  });
  it("没有连续出现时按子序列模糊匹配，相邻命中合并", () => {
    expect(filterHits("session-lifecycle", "sl")).toEqual([
      [0, 1],
      [8, 9],
    ]);
    expect(filterHits("abcdef", "abdf")).toEqual([
      [0, 2],
      [3, 4],
      [5, 6],
    ]);
  });
  it("没匹配或查询为空 → 不标", () => {
    expect(filterHits("abc", "xyz")).toEqual([]);
    expect(filterHits("abc", "   ")).toEqual([]);
  });
});

describe("plainText / clampOffset", () => {
  it("spans 拼成纯文本", () => {
    expect(plainText([{ t: "A " }, { t: "快", s: "muted" }])).toBe("A 快");
    expect(plainText(undefined)).toBe("");
  });
  it("偏移钳进范围，落在代理对中间时往前挪", () => {
    expect(clampOffset("abc", 99, 0)).toBe(3);
    expect(clampOffset("abc", -4, 0)).toBe(0);
    expect(clampOffset("a😀b", 2, 0)).toBe(1);
    expect(clampOffset("abc", undefined, 3)).toBe(3);
  });
});

describe("splitRuns", () => {
  it("按 decor 边界和光标切段，重叠的 token 按顺序合并，空范围忽略，越界钳住", () => {
    const runs = splitRuns(
      10,
      [
        { from: 2, to: 6, s: "accent" },
        { from: 4, to: 8, s: "strong" },
        { from: 9, to: 9, s: "x" },
        { from: 8, to: 99, s: "muted" },
      ],
      5,
    );
    expect(runs).toEqual([
      { from: 0, to: 2, tokens: "" },
      { from: 2, to: 4, tokens: "accent" },
      { from: 4, to: 5, tokens: "accent strong" },
      { from: 5, to: 6, tokens: "accent strong" },
      { from: 6, to: 8, tokens: "strong" },
      { from: 8, to: 10, tokens: "muted" },
    ]);
  });
  it("空文本也有一段（光标位置要能放）", () => {
    expect(splitRuns(0, [], 0)).toEqual([]);
  });
});

describe("picker 目录补丁", () => {
  const item = (id: string) => ({ id, label: id });
  it("items 整体替换；itemsAdd 增补 / 覆盖；itemsDel 删除；同一个补丁重复处理无副作用", () => {
    const catalog = emptyCatalog();
    const items = [item("a"), item("b")];
    updateCatalog(catalog, { items });
    expect([...catalog.items.keys()]).toEqual(["a", "b"]);
    const add = [{ id: "b", label: "B2" }, item("c")];
    const del = ["a"];
    updateCatalog(catalog, { items, itemsAdd: add, itemsDel: del });
    expect([...catalog.items.keys()].sort()).toEqual(["b", "c"]);
    expect(catalog.items.get("b")?.label).toBe("B2");
    // 同一批补丁再来一次（后续帧里 props 引用没变）：不复活被删的，也不重复增补
    updateCatalog(catalog, { items, itemsAdd: add, itemsDel: del });
    expect([...catalog.items.keys()].sort()).toEqual(["b", "c"]);
    // 新的 items 重置整个目录
    updateCatalog(catalog, { items: [item("z")] });
    expect([...catalog.items.keys()]).toEqual(["z"]);
  });
});

describe("buildEntries / visibleRange", () => {
  const catalog = new Map([
    ["a", { id: "a", label: "a" }],
    ["b", { id: "b", label: "b" }],
    ["c", { id: "c", label: "c" }],
  ]);
  it("按 order 展开分组头和行，未知 id 跳过，累计位置", () => {
    const { entries, total, rows } = buildEntries(
      catalog,
      [{ group: "g", label: "G", count: 2 }, "a", "nope", "c"],
      "rows",
    );
    expect(entries.map((e) => e.kind)).toEqual(["group", "row", "row"]);
    expect(entries.map((e) => e.top)).toEqual([0, 32, 68]);
    expect(total).toBe(104);
    expect(rows).toBe(2);
  });
  it("没有 order 时按目录顺序", () => {
    expect(buildEntries(catalog, undefined, "rows").rows).toBe(3);
  });
  it("窗口范围含 overscan，且不越界", () => {
    const big = new Map(Array.from({ length: 100 }, (_, i) => [`i${i}`, { id: `i${i}`, label: "x" }] as const));
    const { entries } = buildEntries(big, undefined, "rows");
    expect(visibleRange(entries, 0, 360, 6)).toEqual([0, 16]);
    const [from, to] = visibleRange(entries, 36 * 50, 360, 6);
    expect(from).toBe(44);
    expect(to).toBe(66);
    expect(visibleRange(entries, 36 * 99, 360, 6)[1]).toBe(100);
  });
});

describe("visibleColumns", () => {
  const cols = [
    { id: "int", format: "num" as const, priority: 1 },
    { id: "speed", format: "num" as const, priority: 2 },
    { id: "ctx", format: "num" as const, priority: 4 },
    { id: "price", format: "price" as const, priority: 3 },
  ];
  it("宽度够：全留", () => {
    expect(visibleColumns(cols, 800).map((c) => c.id)).toEqual(["int", "speed", "ctx", "price"]);
  });
  it("窄：先藏 priority 最低的，保持其余的原顺序", () => {
    // 总宽 52*3+76 = 232；标签要 260：宽 450 藏 int（priority 1）就够，400 还要再藏 speed，300 全藏
    expect(visibleColumns(cols, 450).map((c) => c.id)).toEqual(["speed", "ctx", "price"]);
    expect(visibleColumns(cols, 400).map((c) => c.id)).toEqual(["ctx", "price"]);
    expect(visibleColumns(cols, 300)).toEqual([]);
  });
  it("最多 8 列", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));
    expect(visibleColumns(many, 10_000)).toHaveLength(8);
  });
});

describe("picker 小工具", () => {
  it("紧凑数字", () => {
    expect(compactNumber(272000)).toBe("272k");
    expect(compactNumber(1_600_000)).toBe("1.6M");
    expect(compactNumber(34)).toBe("34");
    expect(compactNumber(0.75)).toBe("0.8");
  });
  it("mono 标签拆 dir / name", () => {
    expect(splitMonoLabel("anthropic/claude-opus")).toEqual({ dir: "anthropic/", name: "claude-opus" });
    expect(splitMonoLabel("plain")).toEqual({ dir: "", name: "plain" });
  });
});

describe("prefs 控件", () => {
  it("choice：2–4 个选项且标签合计 ≤28 字符 → 分段，否则弹出；style 优先", () => {
    const options = (...labels: string[]) => labels.map((label) => ({ value: label, label }));
    expect(isSegmented({ k: "choice", value: "a", options: options("Dev", "Staging", "Prod") })).toBe(true);
    expect(isSegmented({ k: "choice", value: "a", options: options("a") })).toBe(false);
    expect(isSegmented({ k: "choice", value: "a", options: options("x".repeat(15), "y".repeat(15)) })).toBe(false);
    expect(isSegmented({ k: "choice", value: "a", options: options("a", "b", "c", "d", "e") })).toBe(false);
    expect(
      isSegmented({ k: "choice", value: "a", style: "segmented", options: options("a", "b", "c", "d", "e") }),
    ).toBe(true);
    expect(isSegmented({ k: "choice", value: "a", style: "menu", options: options("a", "b") })).toBe(false);
  });
  it("number：± step 钳到范围，到头返回 null；有 labels 时走 labels 的键", () => {
    expect(nextNumber({ k: "number", value: 4, min: 1, max: 8 }, 1)).toBe(5);
    expect(nextNumber({ k: "number", value: 8, min: 1, max: 8 }, 1)).toBeNull();
    expect(nextNumber({ k: "number", value: 1, min: 1, max: 8 }, -1)).toBeNull();
    expect(nextNumber({ k: "number", value: 7, max: 8, step: 5 }, 1)).toBe(8);
    const labels = { "0": "Off", "10": "Low", "50": "High" };
    expect(nextNumber({ k: "number", value: 0, labels }, 1)).toBe(10);
    expect(nextNumber({ k: "number", value: 50, labels }, 1)).toBeNull();
    expect(nextNumber({ k: "number", value: 50, labels }, -1)).toBe(10);
    expect(numberLabel({ k: "number", value: 10, labels })).toBe("Low");
    expect(numberLabel({ k: "number", value: 3, unit: "s" })).toBe("3s");
  });
  it("multi：关掉移除，打开追加到末尾", () => {
    const control = { k: "multi" as const, values: ["a", "c"], options: [] };
    expect(toggleMulti(control, "a")).toEqual(["c"]);
    expect(toggleMulti(control, "b")).toEqual(["a", "c", "b"]);
  });
  it("排序：拖到目标前 / 后，并启用被拖的；启用的排在前面", () => {
    expect(moveOrdered(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"]);
    expect(moveOrdered(["a", "b", "c"], "a", "b", true)).toEqual(["b", "a", "c"]);
    expect(moveOrdered(["a"], "z", "a", false)).toEqual(["z", "a"]);
    expect(moveOrdered(["a"], "z", "missing", false)).toEqual(["a", "z"]);
    expect(orderedOptions([{ value: "a" }, { value: "b" }, { value: "c" }], ["c", "a"]).map((o) => o.value)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
  it("搜索词命中：每个词所有出现，不分大小写，重叠合并", () => {
    expect(wordHits("Dark Theme dark", "dark theme")).toEqual([
      [0, 4],
      [5, 10],
      [11, 15],
    ]);
    expect(wordHits("abcd", "ab bc")).toEqual([[0, 3]]);
    expect(wordHits("abc", "")).toEqual([]);
  });
});

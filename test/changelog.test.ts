// 发版时改写 CHANGELOG、更新目录取说明、启动时的"最近更新"统计：写错会让用户看到别的版本的说明，
// 发出一个没有说明的版本，或者升级后看到错的改动数。
import { describe, expect, it, vi } from "vitest";
import { promoteUnreleased } from "../scripts/changelog.ts";
import { summarizeWhatsNew } from "../src/main/whats-new.ts";
import { countEntries, releaseDate, releaseNotes } from "../src/shared/changelog.ts";

// whats-new.ts 引用了 electron 的 app（只在启动时读写记录用到）；vi.mock 会提升到导入之前。
vi.mock("electron", () => ({ app: {} }));

const text = `# 更新日志

说明文字。

## [未发布]

### 修复

- 修了 B。

## [0.1.0] - 2026-10-18

### 新增

- 第一个版本。
`;

describe("CHANGELOG", () => {
  it("发版把未发布一节记成新版本，上面留一个空的未发布，旧版本原样保留", () => {
    const next = promoteUnreleased(text, "0.1.1", "2026-10-20");
    expect(next).toContain(
      "## [未发布]\n\n## [0.1.1] - 2026-10-20\n\n### 修复\n\n- 修了 B。\n\n## [0.1.0] - 2026-10-18",
    );
    expect(releaseNotes(next, "0.1.1")).toBe("### 修复\n\n- 修了 B。");
    expect(releaseNotes(next, "0.1.0")).toBe("### 新增\n\n- 第一个版本。");
  });

  it("未发布下面没有条目、或者版本已经存在时拒绝发版", () => {
    const empty = promoteUnreleased(text, "0.1.1", "2026-10-20");
    expect(() => promoteUnreleased(empty, "0.1.2", "2026-10-21")).toThrow(/没有任何条目/);
    expect(() => promoteUnreleased(text, "0.1.0", "2026-10-21")).toThrow(/已经有 0.1.0/);
  });

  it("没有这个版本的一节时不编造说明", () => {
    expect(releaseNotes(text, "9.9.9")).toBeNull();
  });

  it("关于页的版本日期取自这一节的标题；标题没写日期或没有这一节时为 null，不拿别的版本的日期", () => {
    expect(releaseDate(text, "0.1.0")).toBe("2026-10-18");
    expect(releaseDate(`## [0.2.0]\n\n- a\n\n${text}`, "0.2.0")).toBeNull();
    expect(releaseDate(text, "9.9.9")).toBeNull();
  });

  it("统计只数新增/变更/修复下面的条目，其他小节只算进总数", () => {
    expect(countEntries("### 新增\n\n- a\n- b\n\n### 其他\n\n- c\n\n### 修复\n\n- d\n  续行不算")).toEqual({
      added: 2,
      changed: 0,
      fixed: 1,
      total: 4,
    });
  });
});

describe("最近更新", () => {
  const history = `## [未发布]

### 新增

- 还没发的。

## [0.3.0] - 2026-10-21

### 新增

- 三。

### 修复

- 三修。

## [0.2.0] - 2026-10-20

### 变更

- 二。

## [0.1.0] - 2026-10-18

### 新增

- 一。
`;

  it("跨版本升级时合计上次看过的版本之后、当前版本为止的各节，不含未发布", () => {
    expect(summarizeWhatsNew(history, "0.3.0", "0.1.0")).toEqual({
      version: "0.3.0",
      releases: 2,
      added: 1,
      changed: 1,
      fixed: 1,
      total: 3,
    });
  });

  it("第一次装（没有记录）只算当前版本这一节", () => {
    expect(summarizeWhatsNew(history, "0.2.0", null)).toMatchObject({ releases: 1, changed: 1, total: 1 });
  });

  it("当前版本在 CHANGELOG 里没有条目时不显示", () => {
    expect(summarizeWhatsNew(history, "0.3.1", "0.3.0")).toBeNull();
    expect(summarizeWhatsNew(history, "9.9.9", null)).toBeNull();
  });
});

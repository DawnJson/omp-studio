// 发版时改写 CHANGELOG、更新目录取说明：写错会让用户看到别的版本的说明，或者发出一个没有说明的版本。
import { describe, expect, it } from "vitest";
import { promoteUnreleased, releaseNotes } from "../scripts/changelog.ts";

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
    expect(next).toContain("## [未发布]\n\n## [0.1.1] - 2026-10-20\n\n### 修复\n\n- 修了 B。\n\n## [0.1.0] - 2026-10-18");
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
});

import { describe, expect, it } from "vitest";
import { createT } from "../src/shared/i18n/index.ts";

import { describeError, errorDetail } from "../src/shared/ui/errors.ts";

// 防的是：界面上出现 "Error invoking remote method 'studio:xxx': Error: …" 或与界面语言不一致的原话。
describe("errors", () => {
  const prefixed = new Error(
    "Error invoking remote method 'studio:openTaskFile': Error: executable files are not opened directly; reveal them in the folder instead",
  );

  it("去掉 Electron 的前缀，只留原话", () => {
    expect(errorDetail(prefixed)).toBe("executable files are not opened directly; reveal them in the folder instead");
    expect(errorDetail(new TypeError("boom"))).toBe("boom");
    expect(errorDetail("plain")).toBe("plain");
  });

  it("已知错误映射到当前语言的文案，不带英文原话", () => {
    expect(describeError(createT("zh-CN"), prefixed)).toBe("可执行文件不会被直接打开，请在文件夹中显示它。");
    expect(describeError(createT("en"), prefixed)).toMatch(/^Executable files/);
    expect(describeError(createT("zh-CN"), { kind: "too_many_tasks", message: "x" })).toBe(
      "同时运行的任务太多。先停掉或归档几个再试。",
    );
  });

  it("未知错误只给通用句，原文留给悬停提示", () => {
    const unknown = new Error("Error invoking remote method 'studio:x': Error: ENOENT: weird failure");
    expect(describeError(createT("zh-CN"), unknown)).toBe("操作没有完成。");
    expect(describeError(createT("en"), unknown)).not.toContain("ENOENT");
  });
});

// 防的是：运行过程的文案（run/ 下，两种语言共用英文）在中文界面按中文复数规则选成 "1 tool calls"；
// 以及其余界面的中文复数被英文规则带偏。
import { describe, expect, it } from "vitest";
import { createT } from "../src/shared/i18n/index.ts";

describe("t() 的复数", () => {
  const zh = createT("zh-CN");
  const en = createT("en");

  it("运行过程在中文界面也是英文，单复数照英文选", () => {
    for (const t of [zh, en]) {
      expect(t("process.toolCalls", { count: 1 })).toBe("1 tool call");
      expect(t("process.toolCalls", { count: 2 })).toBe("2 tool calls");
      expect(t("tool.bash.earlier", { count: 1 })).toBe("1 earlier line");
      expect(t("tool.output.more", { count: 0 })).toBe("0 more lines");
    }
  });

  it("其余界面照常按各自语言", () => {
    expect(zh("composer.queue.promote")).toBe("现在插话");
    expect(en("composer.queue.promote")).toBe("Steer now");
  });
});

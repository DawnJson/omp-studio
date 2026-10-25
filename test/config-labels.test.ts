import { describe, expect, it } from "vitest";
import { dictionaries } from "../src/shared/i18n/index.ts";
import { enumLabel, prefixTitle } from "../src/shared/ui/config-labels.ts";

describe("omp 枚举设置的可选值文案", () => {
  it("审批模式和输入框审批胶囊用同一套文案", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const approval = dictionaries[locale]["approval"] as Record<string, string>;
      expect(enumLabel(locale, "tools.approvalMode", "always-ask")).toBe(approval["alwaysAsk"]);
      expect(enumLabel(locale, "tools.approvalMode", "write")).toBe(approval["write"]);
      expect(enumLabel(locale, "tools.approvalMode", "yolo")).toBe(approval["yolo"]);
    }
  });

  it("思考强度档位和 thinking 命名空间同源，中文界面也写英文", () => {
    expect(enumLabel("zh-CN", "defaultThinkingLevel", "high")).toBe("High");
    expect(enumLabel("zh-CN", "task.maxEffort", "xhigh")).toBe("X-High");
    expect(enumLabel("zh-CN", "defaultThinkingLevel", "auto")).toBe("自动");
  });

  it("按键翻译，其次通用词，都没有就原样显示", () => {
    expect(enumLabel("zh-CN", "interruptMode", "wait")).toBe("等待");
    expect(enumLabel("zh-CN", "completion.notify", "off")).toBe("关闭");
    expect(enumLabel("en", "completion.notify", "on")).toBe("On");
    expect(enumLabel("zh-CN", "tools.format", "hermes")).toBe("hermes");
    expect(enumLabel("zh-CN", "tools.approvalMode", "something-new")).toBe("something-new");
  });
});

describe("omp 设置分组名", () => {
  it("已知分组有中文，未知的首字母大写", () => {
    for (const prefix of ["edit", "tools", "read", "todo", "auth"])
      expect(prefixTitle("zh-CN", prefix)).not.toBe(prefix);
    expect(prefixTitle("zh-CN", "tools")).toBe("工具");
    expect(prefixTitle("en", "edit")).toBe("Edit");
    expect(prefixTitle("zh-CN", "newgroup")).toBe("Newgroup");
  });
});

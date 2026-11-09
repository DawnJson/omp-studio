import { describe, expect, it } from "vitest";
import { outlineLabel } from "../src/shared/tsp/user-messages.ts";

describe("outlineLabel：对话大纲的标题", () => {
  it("取第一行非空文字，空白折成一个空格", () => {
    expect(outlineLabel("\n\n   修一下   登录页\n第二行")).toBe("修一下 登录页");
    expect(outlineLabel("")).toBe("");
    expect(outlineLabel("  \n\t\n")).toBe("");
  });

  it("跳过代码围栏行", () => {
    expect(outlineLabel("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(outlineLabel("~~~\nx\n~~~")).toBe("x");
  });

  it("去掉标题、引用、列表、任务框符号", () => {
    expect(outlineLabel("## 计划")).toBe("计划");
    expect(outlineLabel("> > 引用里的话")).toBe("引用里的话");
    expect(outlineLabel("- 第一项")).toBe("第一项");
    expect(outlineLabel("12. 第十二步")).toBe("第十二步");
    expect(outlineLabel("* [x] 做完了")).toBe("做完了");
  });

  it("去掉强调、删除线、行内代码；链接和图片留文字", () => {
    expect(outlineLabel("把 **粗体** 和 *斜体*、__下划__、~~删掉~~ 去掉")).toBe("把 粗体 和 斜体、下划、删掉 去掉");
    expect(outlineLabel("运行 `npm run check` 看看")).toBe("运行 npm run check 看看");
    expect(outlineLabel("看 [文档](https://example.com/a) 和 ![图](x.png)")).toBe("看 文档 和 图");
  });

  it("单词里的下划线、乘号不当强调", () => {
    expect(outlineLabel("rename snake_case_name to camel")).toBe("rename snake_case_name to camel");
    expect(outlineLabel("2 * 3 * 4")).toBe("2 * 3 * 4");
  });
});

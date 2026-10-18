// 防的是：输入法选词时按 Enter 把半截拼音发出去；运行中 Enter/Ctrl+Enter 的含义混了；有门时误批准。
import { describe, expect, it } from "vitest";
import { decideEnter, type KeyInfo, type SendContext } from "../src/renderer/src/features/composer/send-logic.ts";

const key = (overrides: Partial<KeyInfo> = {}): KeyInfo => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 13,
  ...overrides,
});
const ctx = (overrides: Partial<SendContext> = {}): SendContext => ({
  running: false,
  gate: false,
  hasContent: true,
  swapped: false,
  ...overrides,
});

describe("输入法组合态", () => {
  it("isComposing 时 Enter 不发送", () => {
    expect(decideEnter(key({ isComposing: true }), ctx())).toBe("default");
  });
  it("keyCode 229（Chromium 在组合结束那一下的 Enter）也不发送", () => {
    expect(decideEnter(key({ keyCode: 229 }), ctx())).toBe("default");
  });
  it("运行中、有门时同样不发送", () => {
    expect(decideEnter(key({ isComposing: true }), ctx({ running: true }))).toBe("default");
    expect(decideEnter(key({ isComposing: true }), ctx({ gate: true }))).toBe("default");
  });
});

describe("发送行为表", () => {
  it("空闲：Enter 和 Ctrl+Enter 都发送，Shift+Enter 换行，空草稿什么都不发", () => {
    expect(decideEnter(key(), ctx())).toBe("send");
    expect(decideEnter(key({ ctrlKey: true }), ctx())).toBe("send");
    expect(decideEnter(key({ shiftKey: true }), ctx())).toBe("default");
    expect(decideEnter(key(), ctx({ hasContent: false }))).toBe("default");
  });
  it("运行中：Enter 插话，Ctrl+Enter 稍后；设置对调后相反", () => {
    expect(decideEnter(key(), ctx({ running: true }))).toBe("steer");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ running: true }))).toBe("followUp");
    expect(decideEnter(key(), ctx({ running: true, swapped: true }))).toBe("followUp");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ running: true, swapped: true }))).toBe("steer");
  });
  it('有门：Enter 有草稿才"拒绝并发送"，空草稿不会隐式批准；Ctrl+Enter 草稿为空才是门的主操作', () => {
    expect(decideEnter(key(), ctx({ gate: true }))).toBe("denyAndSend");
    expect(decideEnter(key(), ctx({ gate: true, hasContent: false }))).toBe("default");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ gate: true, hasContent: false }))).toBe("gatePrimary");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ gate: true }))).toBe("default");
  });
  it("别的键不拦截", () => {
    expect(decideEnter(key({ key: "a" }), ctx())).toBe("default");
  });
});

import { matchSlash, slashQuery } from "../src/renderer/src/features/composer/slash-match.ts";
import { relativeToProject } from "../src/renderer/src/features/conversation/tool-info.ts";

describe("斜杠菜单匹配", () => {
  const commands = [
    { name: "compact", source: "builtin" as const },
    { name: "model", source: "builtin" as const, aliases: ["m"] },
    { name: "security", source: "extension" as never },
  ];
  it("只在草稿是 /命令名（还没有空格）时触发", () => {
    expect(slashQuery("/co")).toBe("co");
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/compact ")).toBeNull();
    expect(slashQuery("hi /co")).toBeNull();
    expect(slashQuery("/a/b")).toBeNull();
  });
  it("前缀匹配在前、包含匹配在后，别名也算", () => {
    expect(matchSlash(commands, "co").map((c) => c.name)).toEqual(["compact"]);
    expect(matchSlash(commands, "m").map((c) => c.name)).toEqual(["model", "compact"]);
    expect(matchSlash(commands, "zzz")).toEqual([]);
  });
});

describe("改动文件路径换成相对路径", () => {
  it("项目目录内的绝对路径（大小写、斜杠不敏感）变相对；目录外和越界的不可点", () => {
    expect(relativeToProject("E:\\Work\\项目 a\\src\\x.ts", "e:/work/项目 a")).toBe("src/x.ts");
    expect(relativeToProject("E:\\other\\x.ts", "E:\\work")).toBeNull();
    expect(relativeToProject("src/x.ts", null)).toBe("src/x.ts");
    expect(relativeToProject("../x.ts", null)).toBeNull();
    expect(relativeToProject("E:\\work\\x.ts", null)).toBeNull();
  });
});

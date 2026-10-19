// 防的是：输入法选词时按 Enter 把半截拼音发出去；运行中 Enter/Ctrl+Enter 的含义混了；有门时误批准。
import { describe, expect, it } from "vitest";
import {
  canRunShell,
  decideEnter,
  isShellDraft,
  type KeyInfo,
  type SendContext,
} from "../src/renderer/src/features/composer/send-logic.ts";

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
  shell: false,
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
    // 有草稿时门忽略 Ctrl+Enter，落到输入框自己的"稍后发送"（对调设置同样适用）。
    expect(decideEnter(key({ ctrlKey: true }), ctx({ gate: true }))).toBe("followUp");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ gate: true, running: true }))).toBe("followUp");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ gate: true, swapped: true }))).toBe("steer");
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

describe("!命令", () => {
  it("有门时 Enter 不拒绝门：直接走命令路径（回归：以前 !git diff 会把门拒绝掉）", () => {
    expect(decideEnter(key(), ctx({ gate: true, shell: true }))).toBe("shell");
    expect(decideEnter(key({ ctrlKey: true }), ctx({ gate: true, shell: true }))).toBe("shell");
    expect(decideEnter(key(), ctx({ gate: true, running: true, shell: true }))).toBe("shell");
  });
  it("空闲、运行中都走命令路径；输入法组合态和 Shift+Enter 仍不拦截", () => {
    expect(decideEnter(key(), ctx({ shell: true }))).toBe("shell");
    expect(decideEnter(key(), ctx({ running: true, shell: true }))).toBe("shell");
    expect(decideEnter(key({ isComposing: true }), ctx({ gate: true, shell: true }))).toBe("default");
    expect(decideEnter(key({ shiftKey: true }), ctx({ shell: true }))).toBe("default");
  });
  it("isShellDraft：以 ! 开头且无图片才是命令", () => {
    expect(isShellDraft({ text: "  !git diff", images: [] })).toBe(true);
    expect(isShellDraft({ text: "hi !x", images: [] })).toBe(false);
    expect(isShellDraft({ text: "!x", images: [{}] })).toBe(false);
  });
  it("canRunShell：任务在跑一轮或已有命令在跑都拒绝", () => {
    expect(canRunShell({ taskRunning: false, shellRunning: false })).toBe(true);
    expect(canRunShell({ taskRunning: true, shellRunning: false })).toBe(false);
    expect(canRunShell({ taskRunning: false, shellRunning: true })).toBe(false);
  });
});

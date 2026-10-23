import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupOf, isTerminalOnly } from "../src/shared/ui/config-groups.ts";

const keys = Object.keys(
  JSON.parse(readFileSync(new URL("../fixtures/omp-config/list.json", import.meta.url), "utf8")) as Record<
    string,
    unknown
  >,
);

describe("omp-studio 设置分组", () => {
  it("rpc-ui 下起作用的常用项一个都不能被藏起来", () => {
    // 这些项在 omp-settings.md 里实测或有文档依据（改了会影响 rpc-ui 会话的工具、模型、压缩、审批）。
    for (const key of [
      "modelRoles",
      "defaultThinkingLevel",
      "tools.approvalMode",
      "bash.enabled",
      "todo.enabled",
      "compaction.enabled",
      "steeringMode",
      "retry.fallbackChains",
      "task.maxConcurrency",
      "memory.backend",
      "mcp.startupTimeoutMs",
    ])
      expect(groupOf(key), key).not.toBeNull();
  });

  it("终端外观、状态栏、终端快捷键等没用的项被隐藏", () => {
    for (const key of [
      "theme.dark",
      "symbolPreset",
      "statusLine.preset",
      "statusLine.leftSegments",
      "tui.vimMode",
      "display.showTokenUsage",
      "terminal.showImages",
      "showHardwareCursor",
      "startup.quiet",
      "doubleEscapeAction",
    ])
      expect(isTerminalOnly(key), key).toBe(true);
  });

  it("前缀是终端专用、但实测在 rpc-ui 里起作用的 tui.reactions 要显示", () => {
    expect(groupOf("tui.reactions")).toBe("behavior");
    expect(groupOf("tui.mouse")).toBeNull();
  });

  it("TSP 下实测起作用的项放出来：思考块、通知、回顾；studio 要用的 terminal.programStatus 仍隐藏", () => {
    // 2026-10-23 omp 18.12.6 实测：hideThinkingBlock 让完成后的 omp.thinking 节点被删，expandThinkingBlocks 让它保持展开；
    // 通知和回顾是 omp 自己发的节点 / 决定 studio 通知的取值（docs/architecture/omp-settings.md）。
    expect(groupOf("hideThinkingBlock")).toBe("models");
    expect(groupOf("expandThinkingBlocks")).toBe("models");
    for (const key of ["ask.notify", "completion.notify", "error.notify", "recap.enabled", "recap.idleSeconds"])
      expect(groupOf(key), key).toBe("behavior");
    expect(isTerminalOnly("terminal.programStatus")).toBe(true);
    expect(isTerminalOnly("display.showTokenUsage")).toBe(true);
  });

  it("这个版本的 omp 的每一项都有去处，隐藏的只占少数，认不出的新键显示在“其他”", () => {
    const hidden = keys.filter(isTerminalOnly);
    expect(hidden.length).toBeGreaterThan(30);
    expect(hidden.length).toBeLessThan(keys.length / 3);
    expect(groupOf("someFutureSetting.enabled")).toBe("other");
    // 不靠前缀误伤：`tools` 开头的规则不能吞掉 `toolsX`。
    expect(groupOf("toolsX")).toBe("other");
  });
});

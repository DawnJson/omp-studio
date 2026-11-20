// 被 IRC 唤醒的子代理（issue #23）：按记录文件的条目判断在跑还是停着。条目形状照 omp 19.0.1 的子代理记录文件。
import { describe, expect, it } from "vitest";
import { scanRevival, type RevivalState } from "../src/shared/tsp/subagent-revival.ts";

const line = (entry: unknown) => `${JSON.stringify(entry)}\n`;
const assistant = (stopReason: string, tools: string[] = []) =>
  line({
    type: "message",
    message: {
      role: "assistant",
      stopReason,
      content: tools.map((name, i) => ({ type: "toolCall", id: `c${i}`, name, arguments: {} })),
    },
  });
const result = (toolName: string, isError = false) =>
  line({ type: "message", message: { role: "toolResult", toolName, isError, content: [] } });
const irc = line({ type: "custom_message", customType: "irc:incoming", content: "<irc>new task</irc>" });
const advisor = line({ type: "custom_message", customType: "advisor", content: "note" });
const custom = line({ type: "custom", customType: "tool_execution_start", data: {} });

const scan = (...parts: string[]): RevivalState => scanRevival("idle", parts.join(""));

describe("scanRevival", () => {
  it("唤醒的整个过程：结束 → irc → 工具调用 → 工具结果 → 又结束", () => {
    let state = scan(assistant("stop"));
    expect(state).toBe("idle");
    state = scanRevival(state, irc);
    expect(state).toBe("idle");
    state = scanRevival(state, custom + assistant("toolUse", ["bash"]) + custom);
    expect(state).toBe("running");
    state = scanRevival(state, result("bash"));
    expect(state).toBe("running");
    state = scanRevival(state, assistant("stop"));
    expect(state).toBe("idle");
  });

  it("以 yield 结束的一轮：yield 和别的工具并行、结果在后面也算停着；yield 被拒绝还在跑", () => {
    expect(scan(assistant("toolUse", ["yield"]), result("yield"))).toBe("idle");
    expect(scan(assistant("toolUse", ["hub", "yield"]), result("yield"), result("hub"))).toBe("idle");
    expect(scan(assistant("toolUse", ["yield"]), result("yield", true))).toBe("running");
  });

  it("一轮结束后追加的 advisor、custom 条目不算唤醒；只收到 IRC（plan mode 下 omp 不唤醒）也不算", () => {
    expect(scan(assistant("toolUse", ["yield"]), result("yield"), advisor, advisor, custom)).toBe("idle");
    expect(scan(assistant("stop"), advisor)).toBe("idle");
    expect(scan(assistant("stop"), irc, irc)).toBe("idle");
  });

  it("被中断的 assistant（aborted）后面跟着的工具结果不算在跑", () => {
    expect(scan(assistant("aborted", ["read"]), result("read"))).toBe("idle");
  });

  it("写到一半的行、坏行跳过", () => {
    expect(scan(assistant("stop"), irc, assistant("toolUse", ["bash"]), '{"type":"message","mess')).toBe("running");
    expect(scan(irc, "not json\n", assistant("stop"))).toBe("idle");
  });
});

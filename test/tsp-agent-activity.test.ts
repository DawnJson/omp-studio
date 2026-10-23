// 子代理面板的 Activity 页（src/shared/tsp/agent-activity.ts）：从子代理记录文件（`<名字>.jsonl`，经 parseSubagentMessages 读）
// 合并成按时间排的活动流（工具调用 / 回复 / 错误），以及 All / Errors / Responses / Tools 过滤。记录文件是按 omp 18.12.6 的行格式构造的。
import { describe, expect, it } from "vitest";
import { parseSubagentMessages } from "../src/main/tsp/subagent-file.ts";
import {
  ACTIVITY_MAX_ITEMS,
  activityFromMessages,
  filterActivity,
  mergeActivity,
} from "../src/shared/tsp/agent-activity.ts";

const line = (message: object) => JSON.stringify({ type: "message", message });
const assistant = (timestamp: number, content: object[], extra: object = {}) =>
  line({ role: "assistant", content, timestamp, stopReason: "toolUse", ...extra });
const call = (id: string, name: string, args: object, intent?: string) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
  ...(intent === undefined ? {} : { intent }),
});
const result = (timestamp: number, toolCallId: string, toolName: string, text: string, isError = false) =>
  line({ role: "toolResult", toolCallId, toolName, isError, timestamp, content: [{ type: "text", text }] });

// Alpha：读文件成功、跑命令失败、最后回复；Beta：一次模型错误。
const alphaText = [
  line({
    role: "user",
    content: [{ type: "text", text: "Complete assignment thoroughly:\n\ndo it" }],
    timestamp: 1000,
  }),
  assistant(2000, [call("c1", "read", { path: "src/a.ts" }, "Reading a.ts")]),
  result(2100, "c1", "read", "contents"),
  assistant(3000, [call("c2", "bash", { command: "npm test" })]),
  result(3500, "c2", "bash", "exit code 1\nfailing test", true),
  assistant(4000, [{ type: "text", text: "Tests fail:\n  see above" }], { stopReason: "stop" }),
].join("\n");
const betaText = [
  assistant(2500, [{ type: "text", text: "   " }, call("d1", "grep", { pattern: "TODO" })]),
  assistant(3200, [], { stopReason: "error", errorMessage: "429 Too Many Requests" }),
].join("\n");

const alpha = parseSubagentMessages(alphaText);
const beta = parseSubagentMessages(betaText);

describe("activityFromMessages", () => {
  const items = activityFromMessages("Alpha", alpha);

  it("工具调用取 intent（没有就取第一个有意义的参数），回复取第一段，用户消息不进活动流", () => {
    expect(items.map((item) => [item.kind, item.tool, item.text])).toEqual([
      ["tool", "read", "Reading a.ts"],
      ["tool", "bash", "npm test"],
      ["error", "bash", "exit code 1 failing test"],
      ["response", null, "Tests fail: see above"],
    ]);
  });

  it("toolResult 出错：把对应那次工具调用标成失败，并多一条 error", () => {
    expect(items.find((item) => item.tool === "read" && item.kind === "tool")?.failed).toBe(false);
    expect(items.find((item) => item.tool === "bash" && item.kind === "tool")?.failed).toBe(true);
    expect(items.find((item) => item.kind === "error")).toMatchObject({ agent: "Alpha", at: 3500, failed: true });
  });

  it("stopReason=error 的助手消息是一条 error（文字是 errorMessage）；空白回复不算", () => {
    expect(activityFromMessages("Beta", beta).map((item) => [item.kind, item.text])).toEqual([
      ["tool", "TODO"],
      ["error", "429 Too Many Requests"],
    ]);
  });

  it("id 稳定且唯一；没有时间的消息 at 为 0", () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      activityFromMessages(
        "X",
        parseSubagentMessages(line({ role: "assistant", content: [{ type: "text", text: "hi" }] })),
      )[0]?.at,
    ).toBe(0);
  });

  it("completedAt 比 timestamp 优先（工具调用在消息写完时才算发生）", () => {
    const [item] = activityFromMessages(
      "X",
      parseSubagentMessages(assistant(100, [call("c", "bash", { command: "ls" })], { completedAt: 900 })),
    );
    expect(item?.at).toBe(900);
  });
});

describe("mergeActivity", () => {
  const merged = mergeActivity([
    { name: "Alpha", messages: alpha },
    { name: "Beta", messages: beta },
    { name: "Gamma", messages: null },
  ]);

  it("所有子代理合成一条流，最新的在前；没有记录的子代理（messages 为 null）不出现", () => {
    expect(merged.map((item) => [item.at, item.agent, item.kind])).toEqual([
      [4000, "Alpha", "response"],
      [3500, "Alpha", "error"],
      [3200, "Beta", "error"],
      [3000, "Alpha", "tool"],
      [2500, "Beta", "tool"],
      [2000, "Alpha", "tool"],
    ]);
  });

  it("时间相同：后面的子代理 / 后写的在前；最多留 ACTIVITY_MAX_ITEMS 条最新的", () => {
    const same = mergeActivity([
      { name: "A", messages: parseSubagentMessages(assistant(5, [call("1", "bash", { command: "a" })])) },
      { name: "B", messages: parseSubagentMessages(assistant(5, [call("2", "bash", { command: "b" })])) },
    ]);
    expect(same.map((item) => item.agent)).toEqual(["B", "A"]);
    const many = Array.from({ length: ACTIVITY_MAX_ITEMS + 20 }, (_, index) =>
      assistant(index, [{ type: "text", text: `m${index}` }], { stopReason: "stop" }),
    ).join("\n");
    const capped = mergeActivity([{ name: "A", messages: parseSubagentMessages(many) }]);
    expect(capped).toHaveLength(ACTIVITY_MAX_ITEMS);
    expect(capped[0]?.text).toBe(`m${ACTIVITY_MAX_ITEMS + 19}`);
  });

  it("过滤：All / Errors / Responses / Tools（Tools 含失败的调用）", () => {
    expect(filterActivity(merged, "all")).toHaveLength(6);
    expect(filterActivity(merged, "errors").map((item) => item.agent)).toEqual(["Alpha", "Beta"]);
    expect(filterActivity(merged, "responses").map((item) => item.text)).toEqual(["Tests fail: see above"]);
    expect(filterActivity(merged, "tools").map((item) => [item.agent, item.tool, item.failed])).toEqual([
      ["Alpha", "bash", true],
      ["Beta", "grep", false],
      ["Alpha", "read", false],
    ]);
  });
});

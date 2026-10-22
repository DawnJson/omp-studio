// 子代理记录整理成轮（features/conversation/model.ts 的 buildTurns）：还在跑的子代理，最后一次没有结果的调用是"运行中"，
// 不是"完成"，叙述也不被当成结论；子代理结束了（被中断）才按完成处理、最后一句叙述当结论。
import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { buildTurns } from "../src/renderer/src/features/conversation/model.ts";

const call = (id: string, command: string) => ({ type: "toolCall", id, name: "bash", arguments: { command } });
const messages = [
  { role: "user", content: [{ type: "text", text: "Complete assignment thoroughly:\n\nrun two commands" }] },
  { role: "assistant", content: [{ type: "text", text: "Running them in order." }, call("a", "echo one")] },
  { role: "toolResult", toolCallId: "a", toolName: "bash", content: [{ type: "text", text: "one\n" }], isError: false },
  { role: "assistant", content: [call("b", "sleep 20")] },
] as unknown as AgentMessage[];

const statuses = (live: boolean) =>
  buildTurns(messages, live).flatMap((turn) =>
    turn.steps.flatMap((step) => (step.kind === "tool" ? [step.status] : [])),
  );

describe("子代理记录里的工具调用状态", () => {
  it("子代理还在跑：有结果的完成，最后一次没结果的是运行中", () => {
    expect(statuses(true)).toEqual(["done", "running"]);
  });

  it("子代理已结束：没结果的调用（被中断）按完成处理", () => {
    expect(statuses(false)).toEqual(["done", "done"]);
  });

  it("还在跑时叙述留在过程里，没有结论；结束后最后一句叙述当结论", () => {
    expect(buildTurns(messages, true).at(-1)?.answer).toBeNull();
    expect(buildTurns(messages, false).at(-1)?.answer).toBe("Running them in order.");
  });
});

// 审批门的内容预览：只取 write 的 content、edit 的 input（hashline 脚本），其余工具不编造。
import { describe, expect, it } from "vitest";
import { approvalPreview } from "../src/renderer/src/features/dialogs/gate-preview.ts";

const tool = (toolName: string, args: unknown, status: "running" | "done" | "error" = "running") => ({
  toolName,
  status,
  args,
});

describe("approvalPreview", () => {
  it("write 取 content，edit 取 input", () => {
    expect(approvalPreview({ a: tool("write", { path: "a.txt", content: "hello\n" }) }, "write")).toBe("hello");
    expect(approvalPreview({ a: tool("edit", { input: "[a.txt#1A2B]\nPUT >1:\n+x" }) }, "edit")).toBe(
      "[a.txt#1A2B]\nPUT >1:\n+x",
    );
  });

  it("多个同名调用取最近一个还在运行的；已结束的不算", () => {
    const tools = {
      a: tool("write", { content: "old" }),
      b: tool("write", { content: "new" }),
      c: tool("write", { content: "finished" }, "done"),
    };
    expect(approvalPreview(tools, "write")).toBe("new");
  });

  it("bash 等其它工具、没有参数、空内容都是 null", () => {
    expect(approvalPreview({ a: tool("bash", { command: "ls" }) }, "bash")).toBeNull();
    expect(approvalPreview({ a: tool("write", undefined) }, "write")).toBeNull();
    expect(approvalPreview({ a: tool("write", { content: "  \n" }) }, "write")).toBeNull();
    expect(approvalPreview({}, "edit")).toBeNull();
  });

  it("超长内容被截断并以省略号结尾", () => {
    const preview = approvalPreview({ a: tool("write", { content: "x".repeat(20_000) }) }, "write");
    expect(preview?.length).toBeLessThan(8_100);
    expect(preview?.endsWith("…")).toBe(true);
  });
});

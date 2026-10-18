// 防的是：审批卡片把 omp 给的选项文字显示错、或在文字对不上时丢选项（按键位置决定行为，标签只影响显示）。
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approvalOptionLabel, denyOption, splitTitle } from "../src/renderer/src/features/dialogs/approval-labels.ts";
import { createT } from "../src/shared/i18n/index.ts";

describe("审批选项的显示", () => {
  const zh = createT("zh-CN");
  const en = createT("en");

  it("精确匹配的 Approve / Deny / Approve <tool> for this session 本地化", () => {
    expect(approvalOptionLabel("Approve", zh)).toBe("允许");
    expect(approvalOptionLabel("Deny", zh)).toBe("拒绝");
    expect(approvalOptionLabel("Approve bash for this session", zh)).toBe("本任务内允许 bash");
    expect(approvalOptionLabel("Approve bash for this session", en)).toBe("Allow bash for this task");
  });

  it("对不上的文字原样显示，不丢、不报错", () => {
    expect(approvalOptionLabel("Approve once", zh)).toBe("Approve once");
    expect(approvalOptionLabel("approve", zh)).toBe("approve");
  });

  it("title 第一行是标题，其余是细节；拒绝选项是最后一项", () => {
    expect(splitTitle("Allow tool: bash\nCommand: echo hi\nPath: C:\\x")).toEqual({ headline: "Allow tool: bash", details: "Command: echo hi\nPath: C:\\x" });
    expect(splitTitle("Allow tool: read")).toEqual({ headline: "Allow tool: read", details: "" });
    expect(denyOption(["Approve", "Approve bash for this session", "Deny"])).toBe("Deny");
    expect(denyOption([])).toBeNull();
  });

  it("真实 always-ask 录制里的审批帧按这些规则解析（omp 18.12.1）", () => {
    const file = path.join(import.meta.dirname, "..", "fixtures", "rpc", "approval-select.ndjson");
    const frame = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): { kind: string; frame?: { method?: string; title?: string; options?: string[] } } => JSON.parse(line))
      .find((line) => line.kind === "out" && line.frame?.method === "select")?.frame;
    expect(frame?.title?.startsWith("Allow tool: ")).toBe(true);
    const options = frame?.options ?? [];
    expect(approvalOptionLabel(options[0] ?? "", zh)).toBe("允许");
    expect(approvalOptionLabel(options.at(-1) ?? "", zh)).toBe("拒绝");
    expect(options.some((option) => approvalOptionLabel(option, zh).startsWith("本任务内允许"))).toBe(true);
  });
});

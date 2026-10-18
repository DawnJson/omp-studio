import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DialogRequest } from "../src/shared/ipc.ts";
import type { ExtensionUiRequest, RpcServerFrame } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { DialogResponseError, isApprovalSelect, toDialogRequest, toUiResponse } from "../src/main/tasks/dialogs.ts";

function recordedUiRequests(name: string, method: string): ExtensionUiRequest[] {
  const file = path.join(import.meta.dirname, "..", "fixtures", "rpc", `${name}.ndjson`);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line): { kind: string; frame?: RpcServerFrame } => JSON.parse(line))
    .flatMap((entry) =>
      entry.kind === "out" && entry.frame?.type === "extension_ui_request" && entry.frame.method === method
        ? [entry.frame]
        : [],
    );
}

const [approvalFrame] = recordedUiRequests("approval-select", "select");
const [askFrame] = recordedUiRequests("ask-dialog", "ask");
const approval = toDialogRequest(approvalFrame!)!;
const ask = toDialogRequest(askFrame!)!;

describe("对话框：把 omp 的 extension_ui_request 转成 DialogRequest", () => {
  it("always-ask 下录到的工具审批（omp 18.12.1 实录）被识别为 approval", () => {
    expect(approval).toMatchObject({ kind: "select", approval: true });
    expect(approval.kind === "select" && approval.options.map((o) => o.label)).toEqual([
      "Approve",
      "Approve bash for this session",
      "Deny",
    ]);
  });

  it("普通 select（选项不是 Approve…Deny）不会被当成审批", () => {
    expect(isApprovalSelect("Pick one", ["a", "b"])).toBe(false);
    expect(isApprovalSelect("Allow tool: bash", ["Yes", "No"])).toBe(false);
  });

  it("notify / setWidget / cancel 不是对话框", () => {
    expect(toDialogRequest({ type: "extension_ui_request", id: "x", method: "notify", message: "hi" })).toBeNull();
    expect(
      toDialogRequest({ type: "extension_ui_request", id: "x", method: "setWidget", widgetKey: "autoresearch" }),
    ).toBeNull();
    expect(toDialogRequest({ type: "extension_ui_request", id: "x", method: "cancel", targetId: "y" })).toBeNull();
  });

  it("editor 的 promptStyle 缺省为 false，timeout 原样当 timeoutMs", () => {
    expect(toDialogRequest({ type: "extension_ui_request", id: "e", method: "editor", title: "t" })).toMatchObject({
      kind: "editor",
      promptStyle: false,
    });
    expect(
      toDialogRequest({
        type: "extension_ui_request",
        id: "c",
        method: "confirm",
        title: "t",
        message: "m",
        timeout: 30000,
      }),
    ).toMatchObject({ timeoutMs: 30000 });
  });
});

describe("对话框：应答校验（渲染进程的应答不可信）", () => {
  it("select：值必须是 options 里的原文，才翻译成 extension_ui_response", () => {
    expect(toUiResponse(approval, { kind: "value", value: "Deny" })).toEqual({
      type: "extension_ui_response",
      id: approval.id,
      value: "Deny",
    });
    expect(() => toUiResponse(approval, { kind: "value", value: "Approve everything" })).toThrow(DialogResponseError);
    expect(() => toUiResponse(approval, { kind: "confirm", confirmed: true })).toThrow(DialogResponseError);
  });

  it("任何对话框都可以取消，取消帧不带 value", () => {
    expect(toUiResponse(approval, { kind: "cancel" })).toEqual({
      type: "extension_ui_response",
      id: approval.id,
      cancelled: true,
    });
  });

  it("confirm 只接受布尔应答，input/editor 只接受文本", () => {
    const confirm: DialogRequest = { id: "c", kind: "confirm", title: "t", message: "m" };
    expect(toUiResponse(confirm, { kind: "confirm", confirmed: false })).toEqual({
      type: "extension_ui_response",
      id: "c",
      confirmed: false,
    });
    expect(() => toUiResponse(confirm, { kind: "value", value: "yes" })).toThrow(DialogResponseError);
    const input: DialogRequest = { id: "i", kind: "input", title: "t" };
    expect(toUiResponse(input, { kind: "value", value: "hi" })).toEqual({
      type: "extension_ui_response",
      id: "i",
      value: "hi",
    });
    expect(() => toUiResponse(input, { kind: "answers", answers: [] })).toThrow(DialogResponseError);
  });

  it("ask：答案和题目一一对应，单选不能同时选项和自由文本，选项必须在题目里", () => {
    expect(ask.kind).toBe("ask");
    expect(toUiResponse(ask, { kind: "answers", answers: [{ id: "lang", selectedOptions: ["Go"] }] })).toEqual({
      type: "extension_ui_response",
      id: ask.id,
      answers: [{ id: "lang", selectedOptions: ["Go"] }],
    });
    // 自由文本会被 trim，空白的自由文本等于没有。
    expect(
      toUiResponse(ask, { kind: "answers", answers: [{ id: "lang", selectedOptions: [], customInput: "  Zig " }] }),
    ).toMatchObject({ answers: [{ customInput: "Zig" }] });
    expect(
      toUiResponse(ask, { kind: "answers", answers: [{ id: "lang", selectedOptions: ["Go"], customInput: "   " }] }),
    ).toMatchObject({ answers: [{ selectedOptions: ["Go"] }] });
    expect(() => toUiResponse(ask, { kind: "answers", answers: [] })).toThrow(/expected 1 answers/);
    expect(() => toUiResponse(ask, { kind: "answers", answers: [{ id: "other", selectedOptions: ["Go"] }] })).toThrow(
      /expected "lang"/,
    );
    expect(() => toUiResponse(ask, { kind: "answers", answers: [{ id: "lang", selectedOptions: ["Cobol"] }] })).toThrow(
      /unknown option/,
    );
    expect(() =>
      toUiResponse(ask, { kind: "answers", answers: [{ id: "lang", selectedOptions: ["Go", "Rust"] }] }),
    ).toThrow(/single-select/);
    expect(() =>
      toUiResponse(ask, { kind: "answers", answers: [{ id: "lang", selectedOptions: ["Go"], customInput: "Zig" }] }),
    ).toThrow(/not both/);
  });

  it("ask 多选：可选多个、可为空、不能重复", () => {
    const multi: DialogRequest = {
      id: "m",
      kind: "ask",
      questions: [{ id: "f", question: "q", multi: true, options: [{ label: "A" }, { label: "B" }] }],
    };
    expect(toUiResponse(multi, { kind: "answers", answers: [{ id: "f", selectedOptions: ["A", "B"] }] })).toMatchObject(
      { answers: [{ selectedOptions: ["A", "B"] }] },
    );
    expect(toUiResponse(multi, { kind: "answers", answers: [{ id: "f", selectedOptions: [] }] })).toMatchObject({
      answers: [{ selectedOptions: [] }],
    });
    expect(() => toUiResponse(multi, { kind: "answers", answers: [{ id: "f", selectedOptions: ["A", "A"] }] })).toThrow(
      /repeats/,
    );
  });
});

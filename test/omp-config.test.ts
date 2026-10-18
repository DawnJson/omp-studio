import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OmpConfigError, OmpConfigService, type RunResult } from "../src/main/omp-config/config-service.ts";
import { applyValues, buildSchema, parseConfigText } from "../src/main/omp-config/schema.ts";

// 真实输出：omp 18.12.1，空的 agent 目录里 `omp config list --json` 和 `omp config list`（fixtures/omp-config/）。
const listJson: Record<string, unknown> = JSON.parse(readFileSync("fixtures/omp-config/list.json", "utf8"));
const listText = readFileSync("fixtures/omp-config/list.txt", "utf8");

describe("parseConfigText (real omp 18.12.1 output)", () => {
  const parsed = parseConfigText(listText);

  it("keeps omp's tab order and puts every key under the tab it is printed in", () => {
    expect(parsed.tabs).toEqual(["appearance", "context", "files", "interaction", "internal", "memory", "model", "providers", "shell", "tasks", "tools"]);
    expect(parsed.entries.get("theme.dark")?.tab).toBe("appearance");
    expect(parsed.entries.get("retry.maxRetries")?.tab).toBe("model");
  });

  it("reads enum options, including values with + and - in them, and leaves plain types without options", () => {
    expect(parsed.entries.get("tools.approvalMode")?.options).toEqual(["always-ask", "write", "yolo"]);
    expect(parsed.entries.get("title.icons")?.options).toEqual(["nf+emoji", "emoji", "boring"]);
    expect(parsed.entries.get("retry.fallbackOn")?.options).toEqual(["any", "usage-limit", "except-usage-limit"]);
    expect(parsed.entries.get("colorBlindMode")?.options).toBeNull();
    // 数组默认值里有括号和逗号，值部分不能被当成可选值。
    expect(parsed.entries.get("compaction.methodOrder")?.options).toBeNull();
    // "(not set)" 是值，括号组取最后一个（类型）。
    expect(parsed.entries.get("browser.cdpUrl")?.options).toBeNull();
  });

  it("still parses when omp colors its output (FORCE_COLOR in the environment)", () => {
    const colored = listText.replace(/^(\[\w+\])/gm, "\u001b[1m$1\u001b[0m");
    expect(parseConfigText(colored).tabs).toEqual(parsed.tabs);
  });

  it("covers every key the JSON lists (the text is what gives each its tab)", () => {
    const missing = Object.keys(listJson).filter((key) => !parsed.entries.has(key));
    expect(missing).toEqual([]);
  });
});

describe("buildSchema / applyValues", () => {
  const schema = buildSchema("18.12.1", listJson, listText);

  it("has all 555 settings with type, options and omp's own default", () => {
    expect(schema.entries).toHaveLength(555);
    const approval = schema.entries.find((entry) => entry.key === "tools.approvalMode");
    expect(approval).toMatchObject({ type: "enum", options: ["always-ask", "write", "yolo"], defaultValue: "yolo", hasDefault: true, tab: "interaction" });
    expect(schema.entries.find((entry) => entry.key === "compaction.methodOrder")).toMatchObject({ type: "array", defaultValue: ["remote", "snapcompact", "handoff", "shake", "soft"] });
  });

  it("never carries a credential's value: redacted keys only say whether they are set", () => {
    const current = {
      ...listJson,
      "images.urls.credentials": { redacted: true, type: "record", description: "" },
      "hindsight.apiToken": { redacted: true, type: "string", description: "Bearer token" },
    };
    const snapshot = applyValues(schema, current);
    const credentials = snapshot.items.find((item) => item.key === "images.urls.credentials");
    expect(credentials).toMatchObject({ redacted: true, hasValue: true, value: null, hasDefault: false });
    // 没设置的凭据（JSON 里没有 value 也没有 redacted）：按名字也识别为凭据，显示"未设置"。
    const unset = snapshot.items.find((item) => item.key === "auth.broker.token");
    expect(unset).toMatchObject({ redacted: true, hasValue: false, value: null });
    expect(JSON.stringify(snapshot)).not.toContain("Bearer token-secret");
  });

  it("marks a value that differs from the default, and an optional key with no value as unset", () => {
    const snapshot = applyValues(schema, { ...listJson, colorBlindMode: { ...(listJson["colorBlindMode"] as object), value: true } });
    const item = snapshot.items.find((candidate) => candidate.key === "colorBlindMode");
    expect(item).toMatchObject({ value: true, defaultValue: false });
    expect(snapshot.items.find((candidate) => candidate.key === "compaction.reserveTokens")).toMatchObject({ hasValue: false, hasDefault: false });
  });
});

/** 记录每次调用的假 omp：`handler` 决定输出。 */
function fakeService(handler: (args: string[]) => RunResult) {
  const calls: { args: string[]; isolated: { agentDir: string } | undefined }[] = [];
  const service = new OmpConfigService({
    run: (args, isolated) => {
      calls.push({ args, isolated });
      if (args[0] === "list") return Promise.resolve({ code: 0, stdout: args.includes("--json") ? JSON.stringify(listJson) : listText, stderr: "" });
      return Promise.resolve(handler(args));
    },
    version: () => Promise.resolve("18.12.1"),
  });
  return { service, calls };
}

describe("OmpConfigService writes", () => {
  it("passes omp's own error text through when set is rejected", async () => {
    const { service } = fakeService(() => ({ code: 1, stdout: "", stderr: "Error: Invalid value: nope. Valid values: unicode, nerd, ascii\n" }));
    const error = await service.set("symbolPreset", JSON.stringify("nope")).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OmpConfigError);
    expect((error as Error).message).toBe("Invalid value: nope. Valid values: unicode, nerd, ascii");
  });

  it("puts the value after `--` so a negative number is not taken for an option, and sends arrays as JSON", async () => {
    const { service, calls } = fakeService((args) => ({ code: 0, stdout: JSON.stringify({ key: args[2], value: -1 }), stderr: "" }));
    await service.set("compaction.thresholdPercent", "-1");
    await service.set("cycleOrder", JSON.stringify(["a", "b"]));
    const writes = calls.filter((call) => call.args[0] === "set").map((call) => call.args);
    expect(writes).toEqual([
      ["set", "--json", "compaction.thresholdPercent", "--", "-1"],
      ["set", "--json", "cycleOrder", "--", '["a","b"]'],
    ]);
  });

  it("reports overriddenBy and fallbackEnv from omp's answer, so the UI can say the value is shadowed", async () => {
    const { service } = fakeService(() => ({ code: 0, stdout: JSON.stringify({ key: "tools.approvalMode", value: "write", overriddenBy: "PI_APPROVAL_MODE" }), stderr: "" }));
    expect(await service.set("tools.approvalMode", '"write"')).toEqual({ key: "tools.approvalMode", value: "write", hasValue: true, redacted: false, overriddenBy: "PI_APPROVAL_MODE" });
  });

  it("refuses unknown keys (so a renderer string never becomes an option), wrong types, and credentials, without running omp", async () => {
    const { service, calls } = fakeService(() => ({ code: 0, stdout: "{}", stderr: "" }));
    await expect(service.set("--help", '"x"')).rejects.toThrow(/Unknown setting/);
    await expect(service.set("colorBlindMode", '"yes"')).rejects.toThrow(/boolean/);
    await expect(service.set("cycleOrder", '{"a":1}')).rejects.toThrow(/array/);
    await expect(service.set("hindsight.apiToken", '"tok"')).rejects.toThrow(/credential/);
    expect(calls.filter((call) => call.args[0] === "set")).toEqual([]);
  });

  it("reads the schema once per omp version, in an empty agent directory, and the values from the real one", async () => {
    const { service, calls } = fakeService(() => ({ code: 0, stdout: "{}", stderr: "" }));
    await service.snapshot();
    await service.snapshot();
    const lists = calls.filter((call) => call.args[0] === "list");
    // 第一次：空目录里两次（json + 文本）+ 真实目录一次；第二次只有真实目录一次。
    expect(lists).toHaveLength(4);
    expect(lists.filter((call) => call.isolated).length).toBe(2);
  });

  it("never returns a credential's value from a write answer", async () => {
    const { service } = fakeService(() => ({ code: 0, stdout: JSON.stringify({ key: "hindsight.apiToken" }), stderr: "" }));
    expect(await service.reset("hindsight.apiToken")).toMatchObject({ redacted: true, hasValue: false, value: null });
  });
});

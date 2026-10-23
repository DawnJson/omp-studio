import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notifyEnabled } from "../src/main/omp-config/notify-settings.ts";

/** omp 18.12.x 空 agent 目录里 `omp config list --json` 的真实输出。 */
const listed: unknown = JSON.parse(readFileSync(new URL("../fixtures/omp-config/list.json", import.meta.url), "utf8"));

const entry = (value: unknown) => ({ type: "enum", description: "", value });

describe("通知遵守 omp 的 *.notify 设置", () => {
  it("omp 的默认值：提问通知开、完成通知开、出错通知关", () => {
    expect(notifyEnabled(listed, "ask")).toBe(true);
    expect(notifyEnabled(listed, "completion")).toBe(true);
    expect(notifyEnabled(listed, "error")).toBe(false);
  });

  it("用户在设置页（或终端）改成 off / on 后，对应的通知跟着变，三类互不影响", () => {
    const changed = {
      "ask.notify": entry("off"),
      "completion.notify": entry("off"),
      "error.notify": entry("on"),
    };
    expect(notifyEnabled(changed, "ask")).toBe(false);
    expect(notifyEnabled(changed, "completion")).toBe(false);
    expect(notifyEnabled(changed, "error")).toBe(true);
    expect(notifyEnabled({ ...changed, "ask.notify": entry("on") }, "ask")).toBe(true);
  });

  it("读不到这个键、或值认不出时用 omp 的默认，不因为一项读坏而全关", () => {
    expect(notifyEnabled({}, "ask")).toBe(true);
    expect(notifyEnabled({}, "error")).toBe(false);
    expect(notifyEnabled(null, "completion")).toBe(true);
    expect(notifyEnabled({ "ask.notify": entry("sometimes") }, "ask")).toBe(true);
    expect(notifyEnabled({ "error.notify": { type: "enum" } }, "error")).toBe(false);
  });
});

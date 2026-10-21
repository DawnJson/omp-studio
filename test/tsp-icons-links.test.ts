import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveIconName } from "../src/renderer/src/features/tsp/icon-names.ts";
import { splitUrls } from "../src/shared/tsp/linkify.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "tsp");

/** 录制里出现过的全部图标名（`"icon":"…"`）。 */
function recordedIconNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith(".jsonl"))) {
    for (const m of readFileSync(join(FIXTURES, file), "utf8").matchAll(/"icon":"([^"]+)"/g)) names.add(m[1]!);
  }
  return names;
}

describe("resolveIconName（别名链）", () => {
  it("别名指向别名时跟到底", () => {
    for (const name of ["handoff", "extension", "voice", "mic"]) expect(resolveIconName(name), name).not.toBeNull();
  });
  it("ghost、omp 有画法", () => {
    expect(resolveIconName("ghost")).toBe("ghost");
    expect(resolveIconName("omp")).toBe("omp");
  });
  it("前缀去掉，未知名字不画", () => {
    expect(resolveIconName("status.ghost")).toBe("ghost");
    expect(resolveIconName("no-such-icon")).toBeNull();
    expect(resolveIconName(undefined)).toBeNull();
  });
  it("录制里的每个图标名都画得出来（provider:<id> 是供应商 logo，不在此表）", () => {
    const missing = [...recordedIconNames()].filter((n) => !n.startsWith("provider:") && resolveIconName(n) === null);
    expect(missing).toEqual([]);
  });
});

describe("splitUrls（纯文字里的网址）", () => {
  it("/trace 的地址", () => {
    const url = "http://127.0.0.1:3847/#/traces?s=abc-123";
    expect(splitUrls(`Trace: ${url}`)).toEqual([{ text: "Trace: " }, { text: url, url }]);
  });
  it("没有网址返回 null；非 http(s) 协议不认", () => {
    expect(splitUrls("nothing here")).toBeNull();
    expect(splitUrls("file:///etc/passwd javascript://x")).toBeNull();
  });
  it("结尾标点和不成对的右括号不算", () => {
    expect(splitUrls("see https://a.dev/x.")).toEqual([
      { text: "see " },
      { text: "https://a.dev/x", url: "https://a.dev/x" },
      { text: "." },
    ]);
    expect(splitUrls("(https://a.dev/x)")?.map((p) => p.url)).toEqual([undefined, "https://a.dev/x", undefined]);
    expect(splitUrls("https://a.dev/f_(1)")?.[0]?.url).toBe("https://a.dev/f_(1)");
  });
  it("多个网址", () => {
    expect(splitUrls("https://a.dev, https://b.dev")?.filter((p) => p.url).length).toBe(2);
  });
});

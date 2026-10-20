import { describe, expect, it } from "vitest";
import { buildTspArgs } from "../src/main/omp/launch-args.ts";
import { buildTspEnv, encodeTspEvent } from "../src/main/tsp/tsp-session.ts";
import { cleanOmpTitle } from "../src/main/tasks/tsp-runner.ts";

describe("TSP 任务的启动参数和环境", () => {
  it("交互式 omp：没有 --mode，模型、思考强度、--allow-home 和 rpc 路径一致，恢复会话用 --resume", () => {
    expect(buildTspArgs({ cwd: "C:/p" })).toEqual([]);
    expect(
      buildTspArgs({
        cwd: "C:/p",
        model: { provider: "deepseek", modelId: "deepseek-v4-flash" },
        thinkingLevel: "high",
        allowHome: true,
        resumeSessionFile: "C:\\Users\\某人\\.omp\\agent\\sessions\\a b\\x.jsonl",
      }),
    ).toEqual([
      "--resume=C:\\Users\\某人\\.omp\\agent\\sessions\\a b\\x.jsonl",
      "--model",
      "deepseek/deepseek-v4-flash",
      "--thinking",
      "high",
      "--allow-home",
    ]);
    // inherit = 不传，让 omp 按自己的配置。
    expect(buildTspArgs({ cwd: "C:/p", thinkingLevel: "inherit", resumeSessionFile: null })).toEqual([]);
  });

  it("环境：扮演 Tern（TERM_PROGRAM=tern、版本、truecolor），保留原有变量，丢掉值为 undefined 的", () => {
    const env = buildTspEnv({ PATH: "x", TERM_PROGRAM: "vscode", GONE: undefined, OPENAI_API_KEY: "k" }, "1.2.3");
    expect(env).toMatchObject({
      PATH: "x",
      OPENAI_API_KEY: "k",
      TERM_PROGRAM: "tern",
      TERM_PROGRAM_VERSION: "1.2.3",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    });
    expect("GONE" in env).toBe(false);
  });
});

describe("encodeTspEvent", () => {
  it("编成 APC；C1 控制字符（U+0080–U+009F）转义，免得被终端层当成序列终止符", () => {
    const wire = encodeTspEvent({ ev: "send", sf: "s:1", id: "j.line/input", text: "a\u009cb 你好" });
    expect(wire.startsWith("\x1b_tsp;e;")).toBe(true);
    expect(wire.endsWith("\x1b\\")).toBe(true);
    expect(wire).not.toContain("\u009c");
    const body = JSON.parse(wire.slice("\x1b_tsp;e;".length, -2)) as { text: string };
    expect(body.text).toBe("a\u009cb 你好");
  });
});

describe("cleanOmpTitle：omp 的终端标题是 `<图标字形> <标题>`", () => {
  it("去掉私有区图标，占位的 omp 不是标题", () => {
    expect(cleanOmpTitle("\u{f1821} HI: Greet with hi")).toBe("HI: Greet with hi");
    expect(cleanOmpTitle("omp")).toBe("");
    expect(cleanOmpTitle("\ue0a0 omp ")).toBe("");
    expect(cleanOmpTitle("修复 登录 bug")).toBe("修复 登录 bug");
  });
});

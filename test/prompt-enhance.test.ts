// 提示词优化（src/main/prompt-enhance/enhance.ts + src/shared/prompt-enhance.ts）：纯函数和对假 omp 的调用。
// 真实 omp 的冒烟在 test/prompt-enhance-real-omp.test.ts。
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OmpCommand } from "../src/main/git/commit-message.ts";
import {
  chooseModel,
  cleanOutput,
  cleanStreamingPreview,
  draftLanguage,
  enhanceArgs,
  enhancePrompt,
  systemPrompt,
  userMessage,
} from "../src/main/prompt-enhance/enhance.ts";
import type { ProjectId, TaskId } from "../src/shared/ipc.ts";
import { canEnhance, draftMarkers, missingMarkers, sameEnhanceTarget } from "../src/shared/prompt-enhance.ts";

describe("纯函数", () => {
  it("canEnhance：空白、只有附件、斜杠命令不能优化", () => {
    expect(canEnhance("")).toBe(false);
    expect(canEnhance("  \n ")).toBe(false);
    expect(canEnhance("[Image #1, 10x10] ")).toBe(false);
    expect(canEnhance("  /compact 保留结论")).toBe(false);
    expect(canEnhance("修一下登录")).toBe(true);
    expect(canEnhance("看看 [Image #1, 10x10]")).toBe(true);
  });

  it("sameEnhanceTarget：区分任务与草稿、不同 id", () => {
    const a = "a" as TaskId;
    const b = "b" as TaskId;
    const p = "a" as ProjectId;
    expect(sameEnhanceTarget({ kind: "task", taskId: a }, { kind: "task", taskId: a })).toBe(true);
    expect(sameEnhanceTarget({ kind: "task", taskId: a }, { kind: "task", taskId: b })).toBe(false);
    expect(sameEnhanceTarget({ kind: "draft", projectId: null }, { kind: "draft", projectId: null })).toBe(true);
    expect(sameEnhanceTarget({ kind: "task", taskId: a }, { kind: "draft", projectId: p })).toBe(false);
  });

  it("占位符：按次数比，少一个就算丢", () => {
    const draft = "看 [Image #1, 800x600] 和 [Paste #2, +40 lines]，再看 [File #3, a b.ts] [Image #1, 800x600]";
    expect(draftMarkers(draft)).toEqual([
      "[Image #1, 800x600]",
      "[Paste #2, +40 lines]",
      "[File #3, a b.ts]",
      "[Image #1, 800x600]",
    ]);
    expect(missingMarkers(draft, `改：${draft}`)).toEqual([]);
    expect(missingMarkers(draft, "看 [Image #1, 800x600] [Paste #2, +40 lines] [File #3, a b.ts]")).toEqual([
      "[Image #1, 800x600]",
    ]);
    expect(missingMarkers(draft, "看 [Image #1] [Paste #2, +40 lines]")).toHaveLength(3);
  });

  it("语言：汉字占字母类字符 ≥ 30% 算中文，占位符不算", () => {
    expect(draftLanguage("帮我看下登录那块为啥老是报错")).toBe("Chinese");
    expect(draftLanguage("看 src/main/index.ts 里的 createWindow")).toBe("Chinese");
    expect(draftLanguage("make the login button blue")).toBe("English");
    expect(draftLanguage("fix [Image #1, 800x600] 的 bug in parser.ts please")).toBe("English");
    expect(draftLanguage("12345")).toBe("English");
    expect(systemPrompt("English")).toContain("Write the rewritten message in English,");
    expect(systemPrompt("Chinese")).toContain("Write the rewritten message in Chinese");
  });

  it("多风格模板：内置 4 档各有侧重，自定义要求包在 style_preference 里，空自定义退回 polish", () => {
    expect(systemPrompt("Chinese", "polish")).toContain("Keep short drafts short.");
    expect(systemPrompt("Chinese", "spec")).toContain("Goal, Scope, Constraints, Verification");
    expect(systemPrompt("Chinese", "debug")).toContain("troubleshooting and bug-fix");
    expect(systemPrompt("Chinese", "concise")).toContain("high-density instruction");
    const custom = systemPrompt("Chinese", "custom", "输出为编号步骤");
    expect(custom).toContain("<style_preference>\n输出为编号步骤\n</style_preference>");
    expect(custom).toContain("Keep verbatim:");
    expect(systemPrompt("Chinese", "custom", "   ")).toBe(systemPrompt("Chinese", "polish"));
  });

  it("userMessage：有上下文时包在只读 context 块里，无上下文时原样", () => {
    expect(userMessage("修一下")).toBe("Draft to rewrite (do not answer it):\n<draft>\n修一下\n</draft>\n");
    const withCtx = userMessage("修一下", { history: "User: 看 A\nAssistant: 在 B", gitFiles: "M src/b.ts" });
    expect(withCtx).toContain("<context>");
    expect(withCtx).toContain("Recent conversation:\nUser: 看 A\nAssistant: 在 B");
    expect(withCtx).toContain("Modified files in workspace:\nM src/b.ts");
    expect(withCtx).toContain("<draft>\n修一下\n</draft>");
  });

  it("模型：配了 smol 或 default 用 @smol；都没配时用当前模型；也没有当前模型仍是 @smol", () => {
    const key = { provider: "deepseek", modelId: "deepseek-v4-flash" };
    expect(chooseModel({ smol: "a/b" }, key)).toBe("@smol");
    expect(chooseModel({ default: "a/b:high" }, key)).toBe("@smol");
    expect(chooseModel({ task: "a/b" }, key)).toBe("deepseek/deepseek-v4-flash");
    expect(chooseModel({}, { provider: "openrouter", modelId: "qwen/qwen3" })).toBe("openrouter/qwen/qwen3");
    expect(chooseModel({}, null)).toBe("@smol");
    // 读不到配置：不猜，交给 omp。
    expect(chooseModel(null, key)).toBe("@smol");
  });

  it("cleanOutput：去掉思考块、整段围栏、draft 标签、成对引号和 ANSI；中间的引号不动", () => {
    expect(cleanOutput("\x1b[32m  改好的提示词 \x1b[39m\r\n")).toBe("改好的提示词");
    expect(cleanOutput("<think>先想一下</think>\n改好的提示词")).toBe("改好的提示词");
    expect(cleanOutput("<THINK>step 1</THINK>\n```markdown\n第一行\n第二行\n```\n")).toBe("第一行\n第二行");
    expect(cleanOutput("<draft>\nhello\n</draft>")).toBe("hello");
    expect(cleanOutput('"make it blue"')).toBe("make it blue");
    expect(cleanOutput("“改成蓝色”")).toBe("改成蓝色");
    expect(cleanOutput('"a" and "b"')).toBe('"a" and "b"');
    expect(cleanOutput("开头 ```code``` 结尾")).toBe("开头 ```code``` 结尾");
  });

  it("cleanStreamingPreview：流式阶段隐藏未闭合思考块和开头围栏", () => {
    expect(cleanStreamingPreview("<think>正在分析草稿")).toBe("");
    expect(cleanStreamingPreview("<think>分析完</think>\n```markdown\n请修复")).toBe("请修复");
    expect(cleanStreamingPreview("<draft>\n请修复 src/a.ts")).toBe("请修复 src/a.ts");
  });

  it("参数：-p、不落会话、不带内置工具和 LSP（--tools= --no-lsp，不用 --no-tools）和上下文、不关扩展", () => {
    const args = enhanceArgs("@smol", "SYS");
    expect(args).toEqual([
      "-p",
      "--no-session",
      "--tools=",
      "--no-lsp",
      "--no-skills",
      "--no-rules",
      "--no-context-files",
      "--no-title",
      "--model",
      "@smol",
      "--system-prompt",
      "SYS",
    ]);
    // omp 19.2 起 --no-tools 连扩展一起不加载（扩展注册的模型解析不到），也不能和 --extension 同用。
    expect(args).not.toContain("--no-extensions");
    expect(args).not.toContain("--no-tools");
  });
});

let scratch: string;
let n = 0;
beforeAll(async () => {
  // macOS 的临时目录 /var 是 /private/var 的软链接，子进程的 cwd 报的是真实路径。
  scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), "omp-studio 优化-")));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const FAKE = path.resolve("test/fake-omp/fake-omp-print.ts");

interface Call {
  cwd: string;
  argv: string[];
  stdin: string;
  pid: number;
  autoQa?: string;
  mcpTimeout?: string;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function setup(mode: string) {
  const log = path.join(scratch, `calls ${++n}.log`);
  const omp: OmpCommand = {
    command: process.execPath,
    args: [FAKE],
    env: { ...process.env, FAKE_PRINT_MODE: mode, FAKE_PRINT_LOG: log },
  };
  const calls = async (): Promise<Call[]> =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call);
  return { omp, calls };
}

const run = (
  draft: string,
  mode: string,
  extra: {
    signal?: AbortSignal;
    timeoutMs?: number;
    style?: "polish" | "spec" | "debug" | "concise" | "custom";
    customInstruction?: string;
    context?: { history: string | null; gitFiles: string | null };
    onStream?: (preview: string) => void;
  } = {},
) => {
  const { omp, calls } = setup(mode);
  const result = enhancePrompt(draft, {
    cwd: scratch,
    omp,
    model: "@smol",
    signal: extra.signal ?? new AbortController().signal,
    ...(extra.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
    ...(extra.style !== undefined ? { style: extra.style } : {}),
    ...(extra.customInstruction !== undefined ? { customInstruction: extra.customInstruction } : {}),
    ...(extra.context !== undefined ? { context: extra.context } : {}),
    ...(extra.onStream !== undefined ? { onStream: extra.onStream } : {}),
  });
  return { result, calls };
};

describe("enhancePrompt（假 omp）", () => {
  it("草稿（中文、换行、占位符）只走 stdin，不在命令行里；cwd 是给的目录；结果去掉围栏后原样返回", async () => {
    const draft = "帮我看下登录那块\n为啥老是报错 [Image #1, 800x600]";
    const { result, calls } = run(draft, "fenced");
    expect(await result).toEqual({ kind: "enhanced", text: `${draft} (enhanced)` });
    const [call] = await calls();
    expect(call!.cwd).toBe(scratch);
    expect(call!.stdin).toBe(`Draft to rewrite (do not answer it):\n<draft>\n${draft}\n</draft>\n`);
    expect(call!.argv.slice(0, 10)).toEqual(enhanceArgs("@smol", "").slice(0, 10));
    // Auto-QA 关掉、MCP 超时压到 1ms：避免多出 report_issue 或无用 MCP 工具。
    expect(call!.autoQa).toBe("0");
    expect(call!.mcpTimeout).toBe("1");
    expect(call!.argv[11]).toContain("Write the rewritten message in Chinese");
    expect(call!.argv.join("\n")).not.toContain("登录");
  });

  it("流式输出：先吐思考块时不触发预览，正文分块推进且最终剥离思考块", async () => {
    const draft = "make the login button blue";
    const chunks: string[] = [];
    const { result, calls } = run(draft, "stream", {
      style: "spec",
      context: { history: "User: 看按钮", gitFiles: "M src/login.tsx" },
      onStream: (preview) => chunks.push(preview),
    });
    expect(await result).toEqual({ kind: "enhanced", text: `${draft} (enhanced)` });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) expect(chunk).not.toContain("<think>");
    expect(chunks.at(-1)).toBe(`${draft} (enhanced)`);
    const [call] = await calls();
    expect(call!.argv[11]).toContain("Goal, Scope, Constraints, Verification");
    expect(call!.stdin).toContain("Recent conversation:\nUser: 看按钮");
    expect(call!.stdin).toContain("Modified files in workspace:\nM src/login.tsx");
  });

  it("剥离推理模型的 <think> 块", async () => {
    expect(await run("fix bug", "think").result).toEqual({ kind: "enhanced", text: "fix bug (enhanced)" });
  });

  it("没有模型是 no_model；其余失败带 omp 的错误行；空输出是 failed；丢了占位符是 markers_lost", async () => {
    expect(await run("make it blue", "nomodel").result).toEqual({ kind: "no_model" });
    expect(await run("make it blue", "fail").result).toEqual({
      kind: "failed",
      message: "error: 429 rate limit exceeded",
    });
    expect(await run("make it blue", "empty").result).toEqual({ kind: "failed", message: "omp returned no text" });
    expect(await run("make [Paste #1, +30 lines] blue", "drop-chip").result).toEqual({ kind: "markers_lost" });
  });

  it("取消：结束 omp 进程，返回 cancelled", async () => {
    const controller = new AbortController();
    const { result, calls } = run("make it blue", "hang", { signal: controller.signal });
    // 等假 omp 读完 stdin、记下调用（真的起来了）再取消。
    await vi.waitFor(async () => expect(await calls()).toHaveLength(1), { timeout: 15_000 });
    controller.abort();
    expect(await result).toEqual({ kind: "cancelled" });
    // 假 omp 记下了自己的 pid：取消后进程真的结束了，不只是 promise 先返回。
    const pid = (await calls())[0]!.pid;
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 10_000 });
  });

  it("超时：结束进程，返回 failed", async () => {
    const { result, calls } = run("make it blue", "hang", { timeoutMs: 3_000 });
    expect(await result).toEqual({ kind: "failed", message: "omp timed out" });
    expect(await calls()).toHaveLength(1);
  }, 15_000);
});

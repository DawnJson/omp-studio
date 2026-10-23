// 斜杠命令（wave B）：TUI 才有的命令合并进命令表且不被当成未知命令、按参数接管的分派规则、`/queue` 文本。
import { describe, expect, it } from "vitest";
import type { ModelOption } from "../src/shared/ipc.ts";
import type { AvailableSlashCommand } from "../src/shared/omp-wire/rpc-wire.generated.ts";
import { mergeTuiCommands, OMP_TUI_ONLY_COMMANDS } from "../src/shared/omp-tui-commands.ts";
import { followUpText } from "../src/shared/tsp/queue-command.ts";
import { decideSlashSend } from "../src/renderer/src/features/composer/slash-guard.ts";
import {
  parseModelArg,
  resolveEffortCommand,
  resolveModelCommand,
  resolveTodoCommand,
} from "../src/renderer/src/features/composer/slash-args.ts";

const rpcList: AvailableSlashCommand[] = [
  { name: "compact", source: "builtin" },
  { name: "deploy", source: "custom" },
  { name: "queue", source: "extension" },
];

describe("命令表合并", () => {
  it("TUI 才有的命令加进来；omp 列表里已有的名字不重复；项目自定义命令保留", () => {
    const merged = mergeTuiCommands(rpcList);
    const names = merged.map((command) => command.name);
    expect(names).toContain("plan");
    expect(names).toContain("loop");
    expect(names).toContain("deploy");
    expect(names.filter((name) => name === "queue")).toHaveLength(1);
    expect(merged.find((command) => command.name === "queue")?.source).toBe("extension");
    expect(merged).toHaveLength(rpcList.length + OMP_TUI_ONLY_COMMANDS.length - 1);
  });
  it("omp 列表还没载入（空）时仍是空：守卫放行", () => {
    expect(mergeTuiCommands([])).toEqual([]);
  });
  it("/plan /vibe /loop /queue 不再被当成未知命令；两边都没有的才提示", () => {
    const merged = mergeTuiCommands(rpcList);
    for (const text of ["/plan fix it", "/vibe", "/loop 3 go", "/queue hi", "/Q", "/status"])
      expect(decideSlashSend(text, merged), text).toEqual({ kind: "send" });
    expect(decideSlashSend("/nope", merged)).toEqual({ kind: "warn", name: "nope" });
  });
});

const model = (provider: string, modelId: string, name: string): ModelOption =>
  ({ key: { provider, modelId }, name }) as ModelOption;
const models = [
  model("anthropic", "claude-sonnet-4", "Claude Sonnet 4"),
  model("anthropic", "claude-opus-4", "Claude Opus 4"),
  model("openrouter", "anthropic/claude-sonnet-4", "Claude Sonnet 4 (OR)"),
  model("openai", "gpt-5", "GPT-5"),
  model("openai", "gpt-5-mini", "GPT-5 mini"),
];

describe("/model 按参数", () => {
  it("不带参数 / @角色 打开选择器（角色范围）", () => {
    expect(resolveModelCommand("", models)).toEqual({ kind: "picker", request: { query: "", scope: "all" } });
    expect(resolveModelCommand("@task", models)).toEqual({
      kind: "picker",
      request: { query: "task", scope: "roles" },
    });
  });
  it("唯一匹配直接切换；多个先看 id 全等，否则打开选择器并填好搜索词；没有交给 omp", () => {
    expect(resolveModelCommand("opus", models)).toEqual({
      kind: "switch",
      key: { provider: "anthropic", modelId: "claude-opus-4" },
      level: null,
    });
    expect(resolveModelCommand("gpt-5", models)).toMatchObject({ kind: "switch", key: { modelId: "gpt-5" } });
    expect(resolveModelCommand("sonnet", models)).toEqual({
      kind: "picker",
      request: { query: "sonnet", scope: "all" },
    });
    expect(resolveModelCommand("nothing-like-it", models)).toEqual({ kind: "omp" });
  });
  it(":档位 后缀同时设思考强度；不是档位名的冒号留在词里", () => {
    expect(parseModelArg("opus:high")).toEqual({ term: "opus", level: "high" });
    expect(parseModelArg("llama3:8b")).toEqual({ term: "llama3:8b", level: null });
    expect(resolveModelCommand("opus:high", models)).toMatchObject({ kind: "switch", level: "high" });
  });
});

describe("/effort 与 /todo 按参数", () => {
  it("/effort：档位在可选档位里直接设置，不区分大小写；不是就交给 omp", () => {
    const levels = ["off", "low", "high"] as const;
    expect(resolveEffortCommand("", levels)).toEqual({ kind: "picker" });
    expect(resolveEffortCommand("HIGH", levels)).toEqual({ kind: "set", level: "high" });
    expect(resolveEffortCommand("max", levels)).toEqual({ kind: "omp" });
  });
  it("/todo：子命令走 TaskCommand，不认识的原样交给 omp", () => {
    expect(resolveTodoCommand("")).toEqual({ kind: "board" });
    expect(resolveTodoCommand("done fix bug")).toEqual({
      kind: "command",
      command: { kind: "todo", op: "done", target: "fix bug" },
    });
    expect(resolveTodoCommand("drop")).toEqual({ kind: "command", command: { kind: "todo", op: "drop" } });
    expect(resolveTodoCommand("start")).toEqual({ kind: "omp" });
    expect(resolveTodoCommand("append [Phase 1] write tests")).toEqual({
      kind: "command",
      command: { kind: "todo", op: "append", phase: "Phase 1", task: "write tests" },
    });
    expect(resolveTodoCommand("append just a task")).toEqual({
      kind: "command",
      command: { kind: "todo", op: "append", task: "just a task" },
    });
    expect(resolveTodoCommand("export")).toEqual({ kind: "omp" });
  });
});

describe("/queue 文本", () => {
  it("普通文字（含多行）加 /queue；命令、shell、eval 原样", () => {
    expect(followUpText("then run tests")).toBe("/queue then run tests");
    expect(followUpText("a\nb")).toBe("/queue a\nb");
    expect(followUpText("/forget-approvals")).toBe("/forget-approvals");
    expect(followUpText("!ls")).toBe("!ls");
    expect(followUpText("$ print(1)")).toBe("$ print(1)");
  });
});

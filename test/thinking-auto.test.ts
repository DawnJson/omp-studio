// 思考强度 auto 和"转一圈看到的档位"：IPC 校验、输入框卡片的观察者、切强度的命令（用合成的 omp 文档，不起进程）。
import { describe, expect, it, vi } from "vitest";
import type { ModelOption, TaskId, TaskThinkingLevel } from "../src/shared/ipc.ts";
import { applyMessage, createDocument, type TspDocument } from "../src/shared/tsp/document.ts";
import { TspComposerObserver } from "../src/main/tasks/tsp-composer-observer.ts";
import { TspCommands, type TspCommandsHost } from "../src/main/tasks/tsp-commands.ts";
import type { TaskRecord } from "../src/main/tasks/task-registry.ts";
import type { SessionUsageAccumulator } from "../src/main/history/session-usage.ts";
import type { TspDocScans } from "../src/main/tasks/tsp-doc-scans.ts";
import type { TspSession } from "../src/main/tsp/tsp-session.ts";
import { parseThinkingLevel } from "../src/main/ipc/validate.ts";

// validate.ts 引用的主窗口模块要 electron；vi.mock 会提升到 import 之前。
vi.mock("../src/main/window/main-window.ts", () => ({ getMainWindow: () => null, isAppUrl: () => false }));

const flash: ModelOption = {
  key: { provider: "deepseek", modelId: "deepseek-v4-flash" },
  name: "DeepSeek V4 Flash",
  contextWindow: 1_000_000,
  reasoning: true,
  acceptsImages: false,
  maxTokens: null,
  thinkingEfforts: ["low", "high", "max"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  intelligence: null,
  catalogTps: null,
};

const add = (id: string, parent: string, k: string, p: Record<string, unknown> = {}) =>
  ["add", id, parent, null, { id, k, p }] as const;

/** 只有输入框卡片的 omp 文档：模型名 + 思考强度节点（`p.level` 是 omp 显示的档位原文）。 */
function composerDoc(level: string): TspDocument {
  const doc = createDocument();
  applyMessage(doc, { verb: "o", body: { id: "s:1", mode: "inline", title: "omp", role: "omp.session" } } as never);
  applyMessage(doc, {
    verb: "f",
    body: {
      sf: "s:1",
      s: 1,
      ops: [
        add("dock", "s:1", "col"),
        add("ed", "dock", "col", { role: "omp.editor" }),
        add("m", "ed", "row", { role: "omp.composer.model" }),
        add("m/name", "m", "text", { text: flash.name }),
        add("m/effort", "m", "dot", { role: "omp.composer.model.effort", level }),
      ],
    },
  } as never);
  return doc;
}

let frame = 1;
function showLevel(doc: TspDocument, level: string): void {
  frame += 1;
  applyMessage(doc, { verb: "f", body: { sf: "s:1", s: frame, ops: [["set", "m/effort", { level }]] } } as never);
}

describe("IPC：任务的思考强度", () => {
  it("接受 auto，不接受 inherit", () => {
    expect(parseThinkingLevel("auto")).toBe("auto");
    expect(parseThinkingLevel("high")).toBe("high");
    expect(() => parseThinkingLevel("inherit")).toThrow();
  });
});

describe("输入框卡片的观察者", () => {
  function observer(recordLevel: TaskThinkingLevel | null) {
    let record = { id: "t1", model: flash.key, thinkingLevel: recordLevel } as unknown as TaskRecord;
    const persisted: Partial<TaskRecord>[] = [];
    const watcher = new TspComposerObserver({
      taskId: "t1" as TaskId,
      record: () => record,
      persistRecord: async (patch) => {
        persisted.push(patch);
        record = { ...record, ...patch };
      },
      ownModel: () => flash,
      catalog: () => [flash],
      knownModels: () => [],
      disposed: () => false,
      scans: () => ({ todoPhases: [], toastTexts: [] }) as unknown as TspDocScans,
      readSessionFile: async () => null,
      publish: () => {},
    });
    return { watcher, persisted };
  }

  it("omp 显示 auto：任务的强度是 auto（不是 null），并记进任务记录（下次 --thinking auto）", async () => {
    const { watcher, persisted } = observer("high");
    watcher.syncComposer(composerDoc("auto"));
    expect(watcher.derived.thinkingLevel).toBe("auto");
    await Promise.resolve();
    expect(persisted).toContainEqual({ thinkingLevel: "auto" });
  });

  it("档位列表含 auto；输入框卡片还没读到时为 null", () => {
    const { watcher } = observer(null);
    expect(watcher.derived.thinkingLevels).toBeNull();
    watcher.syncComposer(composerDoc("low"));
    expect(watcher.derived.thinkingLevels).toEqual(["auto", "off", "low", "high", "max"]);
  });

  it("切强度时转一圈看到的档位取代目录里的", () => {
    const { watcher } = observer(null);
    watcher.syncComposer(composerDoc("low"));
    watcher.setObservedThinkingLevels(["low", "auto", "off"]);
    expect(watcher.derived.thinkingLevels).toEqual(["low", "auto", "off"]);
  });

  it("写记录的过程中会话文件认出了重名模型是哪一家：写完补记模型，不丢（v0.8.5 Windows CI 偶发）", async () => {
    const hf: ModelOption = { ...flash, key: { provider: "huggingface", modelId: "deepseek-ai/DeepSeek-V4-Flash" } };
    let record = { id: "t1", model: null, thinkingLevel: null } as unknown as TaskRecord;
    const persisted: Partial<TaskRecord>[] = [];
    const firstWrite = Promise.withResolvers<void>();
    const sessionRead = Promise.withResolvers<void>();
    const watcher = new TspComposerObserver({
      taskId: "t1" as TaskId,
      record: () => record,
      persistRecord: async (patch) => {
        // 第一次写（只有思考强度：目录里两家同名，还认不出是哪一家）卡住，直到会话文件读完。
        if (persisted.length === 0) await firstWrite.promise;
        persisted.push(patch);
        record = { ...record, ...patch };
      },
      ownModel: () => null,
      catalog: () => [flash, hf],
      knownModels: () => [],
      disposed: () => false,
      scans: () => ({ todoPhases: [], toastTexts: [] }) as unknown as TspDocScans,
      readSessionFile: async () => {
        sessionRead.resolve();
        const usage = { summary: () => ({ models: [] }), currentModel: () => hf.key };
        return { usage: usage as unknown as SessionUsageAccumulator };
      },
      publish: () => {},
    });
    watcher.syncComposer(composerDoc("low"));
    await sessionRead.promise;
    await vi.waitFor(() => expect(watcher.derived.model?.key).toEqual(hf.key));
    firstWrite.resolve();
    await vi.waitFor(() => expect(record.model).toEqual(hf.key));
    expect(persisted).toEqual([{ thinkingLevel: "low" }, { model: hf.key }]);
  });
});

describe("setThinkingLevel：按 omp 的循环点到目标档位", () => {
  /** omp 对这个模型的循环：low → auto → off → low…（点一下 thinking.cycle 换下一档）。 */
  function harness(cycle: readonly string[]) {
    const doc = composerDoc(cycle[0]!);
    let shown = 0;
    const observed: TaskThinkingLevel[][] = [];
    const session = {
      document: doc,
      sendEvent: () => {
        shown = (shown + 1) % cycle.length;
        showLevel(doc, cycle[shown]!);
      },
    } as unknown as TspSession;
    const host: TspCommandsHost = {
      start: async () => {},
      session: () => session,
      liveSession: () => session,
      awaitComposer: async () => ({ sf: "s:1", id: "ed" }),
      awaitDocument: async (check) => {
        const value = check(doc);
        if (value === null) throw new Error("timeout");
        return value;
      },
      exclusive: (job) => job(),
      composerInfo: () => ({
        modelName: null,
        effort: null,
        context: null,
        cost: null,
        subagentCost: null,
        fast: false,
      }),
      chosenKey: () => null,
      setChosenKey: () => {},
      syncComposer: () => {},
      setSlowEnabled: () => {},
      setObservedThinkingLevels: (levels) => observed.push(levels),
      goal: {} as TspCommandsHost["goal"],
    };
    return { commands: new TspCommands(host), observed, shown: () => cycle[shown] };
  }

  it("auto 在循环里：点到 auto 为止", async () => {
    const h = harness(["low", "auto", "off"]);
    await h.commands.setThinkingLevel("auto");
    expect(h.shown()).toBe("auto");
    expect(h.observed).toEqual([]);
  });

  it("high 不在循环里：转满一圈回到起点，报错带上看到的档位，并把它们交给宿主改正档位列表", async () => {
    const h = harness(["low", "auto", "off"]);
    await expect(h.commands.setThinkingLevel("high")).rejects.toThrow(
      "thinking level high is not available for this model (omp offers: low, auto, off)",
    );
    expect(h.shown()).toBe("low");
    expect(h.observed).toEqual([["low", "auto", "off"]]);
  });
});

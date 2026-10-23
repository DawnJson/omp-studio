// 真实 omp 冒烟（自定义模型）：用 models-file 写 models.yml → 真实 omp（临时 PI_CODING_AGENT_DIR）→ 本地假的 OpenAI 兼容服务。
// 验证：1) 新进程的 get_available_models 里有这些模型；2) 同一个进程里改文件不会重新加载（所以保存后要重启服务进程）；
// 3) 任务（伪终端里的交互式 omp）能把 prompt 发到假服务并拿到它的回复。三种 key 写法都跑：字面量、环境变量名、auth: none。
// 不调真实模型、不需要 key，但需要 PATH 上有 omp；默认跳过：`STUDIO_REAL_OMP=1 npx vitest run test/custom-models-real-omp.test.ts`。
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskState } from "../src/shared/ipc.ts";
import { findOmpOnPath } from "../src/main/omp/discover.ts";
import { buildOmpArgs, buildTspArgs } from "../src/main/omp/launch-args.ts";
import { OmpConnection } from "../src/main/omp/omp-connection.ts";
import { saveCustomProvider } from "../src/main/omp-config/models-file.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { requireSuccess, runOmpCommand } from "../src/main/usage/usage-service.ts";
import { TaskRegistry } from "../src/main/tasks/task-registry.ts";
import { startFakeOpenAi, type FakeOpenAi } from "./fake-openai/server.ts";

const enabled = process.env["STUDIO_REAL_OMP"] === "1";
let scratch: string;
let agentDir: string;
let keyed: FakeOpenAi;
let keyless: FakeOpenAi;
let pool: TaskPool | undefined;

const SECRET = "sk-fake-secret";

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp 自定义 模型-"));
  agentDir = path.join(scratch, "agent");
  keyed = await startFakeOpenAi({ apiKey: SECRET, models: ["fake-chat", "fake-mini"], reply: "FAKE-REPLY-KEYED" });
  keyless = await startFakeOpenAi({ models: ["local-one"], reply: "FAKE-REPLY-KEYLESS" });
});
afterAll(async () => {
  await pool?.shutdown();
  await keyed.close();
  await keyless.close();
  await rm(scratch, { recursive: true, force: true });
});

const ompEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  PI_CODING_AGENT_DIR: agentDir,
  FAKE_PROXY_KEY: SECRET,
});

async function listModelIds(omp: string, provider: string): Promise<string[]> {
  const connection = OmpConnection.spawn({
    command: omp,
    args: buildOmpArgs({ cwd: scratch, noSession: true }),
    cwd: scratch,
    env: ompEnv(),
  });
  try {
    await connection.ready;
    const { models } = await connection.request("get_available_models");
    return models.filter((model) => model.provider === provider).map((model) => model.id);
  } finally {
    await connection.close(3_000);
  }
}

describe.skipIf(!enabled)("自定义模型 × 真实 omp", () => {
  it("写入 models.yml 后新进程能列出模型；任务能发 prompt 并拿到假服务的回复", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    await mkdir(scratch, { recursive: true });

    expect(await listModelIds(omp, "fake-literal")).toEqual([]);
    for (const [id, base, key, models] of [
      ["fake-literal", keyed.baseUrl, { kind: "literal", value: SECRET }, [{ id: "fake-chat" }, { id: "fake-mini" }]],
      ["fake-env", keyed.baseUrl, { kind: "env", name: "FAKE_PROXY_KEY" }, [{ id: "fake-chat" }]],
      ["fake-none", keyless.baseUrl, { kind: "none" }, [{ id: "local-one" }]],
    ] as const) {
      const outcome = await saveCustomProvider(
        agentDir,
        { id, baseUrl: base, api: "openai-completions", key, models: [...models] },
        "add",
      );
      expect(outcome).toEqual({ ok: true });
    }

    expect(await listModelIds(omp, "fake-literal")).toEqual(["fake-chat", "fake-mini"]);
    expect(await listModelIds(omp, "fake-env")).toEqual(["fake-chat"]);
    expect(await listModelIds(omp, "fake-none")).toEqual(["local-one"]);

    // 同一个进程里改 models.yml 不会重新加载：保存后必须重启服务进程。
    const long = OmpConnection.spawn({
      command: omp,
      args: buildOmpArgs({ cwd: scratch, noSession: true }),
      cwd: scratch,
      env: ompEnv(),
    });
    try {
      await long.ready;
      await saveCustomProvider(
        agentDir,
        {
          id: "fake-late",
          baseUrl: keyless.baseUrl,
          api: "openai-completions",
          key: { kind: "none" },
          models: [{ id: "late" }],
        },
        "add",
      );
      const { models } = await long.request("get_available_models");
      expect(models.some((model) => model.provider === "fake-late")).toBe(false);
    } finally {
      await long.close(3_000);
    }
    expect(await listModelIds(omp, "fake-late")).toEqual(["late"]);

    const states: TaskState[] = [];
    const waiters: { predicate: (s: TaskState) => boolean; resolve: (s: TaskState) => void }[] = [];
    const registry = new TaskRegistry(path.join(scratch, "tasks.json"));
    let model = { provider: "fake-literal", modelId: "fake-chat" };
    pool = new TaskPool({
      registry,
      getSettings: async () => ({
        locale: "en",
        theme: "system",
        maxLiveProcesses: 6,
        reduceMotion: false,
        enterWhileRunning: "steer",
        soundOnDone: false,
        copyOnSelect: true,
        yoloConfirmed: false,
      }),
      tsp: {
        buildLaunch: async (record, project) => ({
          command: omp,
          args: buildTspArgs({ cwd: project.path, model, thinkingLevel: record.thinkingLevel }),
          cwd: project.path,
          env: ompEnv(),
        }),
        session: {
          appVersion: "0.0.0-test",
          appearance: () => ({ dark: true, reduceMotion: false }),
        },
      },
      events: {
        state: (state) => {
          states.push(state);
          for (const waiter of waiters.slice()) {
            if (!waiter.predicate(state)) continue;
            waiters.splice(waiters.indexOf(waiter), 1);
            waiter.resolve(state);
          }
        },
        notice: () => {},
        taskRemoved: () => {},
      },
    });
    await pool.init();
    const until = (predicate: (s: TaskState) => boolean) => {
      const latest = states.at(-1);
      if (latest && predicate(latest)) return Promise.resolve(latest);
      const { promise, resolve } = Promise.withResolvers<TaskState>();
      waiters.push({ predicate, resolve });
      return promise;
    };

    const projectDir = path.join(scratch, "项目 目录");
    await mkdir(projectDir);
    const project = await pool.ensureProject(projectDir);

    for (const [provider, modelId, server, reply] of [
      ["fake-literal", "fake-chat", keyed, "FAKE-REPLY-KEYED"],
      ["fake-env", "fake-chat", keyed, "FAKE-REPLY-KEYED"],
      ["fake-none", "local-one", keyless, "FAKE-REPLY-KEYLESS"],
    ] as const) {
      model = { provider, modelId };
      states.length = 0;
      const prompt = `ping via ${provider}`;
      const before = server.prompts.length;
      const created = await pool.createTask({ projectId: project.id });
      await until((s) => s.id === created.id && (s.status === "idle" || s.status === "error"));
      expect(pool.listTasks().find((task) => task.id === created.id)?.error).toBeNull();
      await pool.sendPrompt(created.id, { text: prompt, whenBusy: "steer" });
      const done = await until((s) => s.id === created.id && s.lastTurn !== null && s.status === "idle");
      expect(done.lastTurn?.status).toBe("completed");
      expect(server.prompts.length).toBe(before + 1);
      expect(server.prompts.at(-1)).toContain(prompt);
      expect(JSON.stringify(pool.getTspSnapshot(created.id).document)).toContain(reply);
    }
  }, 240_000);

  it("自动发现：只写 discovery、不列模型，omp 照样从 /models 读到；omp models refresh 跑得通，之后 omp models 也列得出", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    await mkdir(scratch, { recursive: true });
    const outcome = await saveCustomProvider(
      agentDir,
      {
        id: "fake-disco",
        baseUrl: keyless.baseUrl,
        api: "openai-completions",
        key: { kind: "none" },
        models: [],
        discovery: true,
      },
      "add",
    );
    expect(outcome).toEqual({ ok: true });

    const run = runOmpCommand(omp, scratch, 90_000, { PI_CODING_AGENT_DIR: agentDir });
    requireSuccess("omp models refresh", await run(["models", "refresh"]));
    const listed = await run(["models", "fake-disco"]);
    requireSuccess("omp models", listed);
    expect(listed.stdout).toContain("local-one");
    expect(await listModelIds(omp, "fake-disco")).toEqual(["local-one"]);

    // Anthropic 接口类型默认写 discovery.type: proxy：同一个 OpenAI 风格的 /models 也能读到。
    const anthropic = await saveCustomProvider(
      agentDir,
      {
        id: "fake-disco-anthropic",
        baseUrl: keyless.baseUrl,
        api: "anthropic-messages",
        key: { kind: "none" },
        models: [],
        discovery: true,
      },
      "add",
    );
    expect(anthropic).toEqual({ ok: true });
    expect(await listModelIds(omp, "fake-disco-anthropic")).toEqual(["local-one"]);
  }, 120_000);
});

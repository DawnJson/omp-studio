// 真实 omp 冒烟（自定义模型）：用 models-file 写 models.yml → 真实 omp（临时 PI_CODING_AGENT_DIR）→ 本地假的 OpenAI 兼容服务。
// 验证：1) 新进程的 get_available_models 里有这些模型；2) 同一个进程里改文件不会重新加载（所以保存后要重启服务进程）；
// 3) 任务（伪终端里的交互式 omp）能把 prompt 发到假服务并拿到它的回复。三种 key 写法都跑：字面量、环境变量名、auth: none。
// 不调真实模型、不需要 key，但需要 PATH 上有 omp；默认跳过：`STUDIO_REAL_OMP=1 npx vitest run test/custom-models-real-omp.test.ts`。
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TaskState } from "../src/shared/ipc.ts";
import { findOmpOnPath } from "../src/main/omp/discover.ts";
import { buildOmpArgs, buildTspArgs } from "../src/main/omp/launch-args.ts";
import { OmpConnection } from "../src/main/omp/omp-connection.ts";
import { readModelsFile, saveCustomProvider } from "../src/main/omp-config/models-file.ts";
import { TaskPool } from "../src/main/tasks/task-pool.ts";
import { requireSuccess, type RunOmp } from "../src/main/usage/usage-service.ts";
import { runCommand } from "../src/main/git/exec.ts";
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

/** `omp <args>`，用临时 agent 目录。 */
function ompCli(omp: string): RunOmp {
  return async (args) => {
    const result = await runCommand(omp, args, { cwd: scratch, env: ompEnv(), timeoutMs: 90_000 });
    return { code: result.code, stdout: result.stdout.toString("utf8"), stderr: result.stderr };
  };
}

/** 能力参数全部交给 omp 的模型。 */
const auto = (id: string) => ({ id, reasoning: null, images: null, contextWindow: null, maxTokens: null });

describe.skipIf(!enabled)("自定义模型 × 真实 omp", () => {
  it("写入 models.yml 后新进程能列出模型；任务能发 prompt 并拿到假服务的回复", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    await mkdir(scratch, { recursive: true });

    expect(await listModelIds(omp, "fake-literal")).toEqual([]);
    for (const [id, base, key, models] of [
      ["fake-literal", keyed.baseUrl, { kind: "literal", value: SECRET }, [auto("fake-chat"), auto("fake-mini")]],
      ["fake-env", keyed.baseUrl, { kind: "env", name: "FAKE_PROXY_KEY" }, [auto("fake-chat")]],
      ["fake-none", keyless.baseUrl, { kind: "none" }, [auto("local-one")]],
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
          models: [auto("late")],
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
        idleClose: "1h",
        reduceMotion: false,
        enterWhileRunning: "steer",
        soundOnDone: false,
        copyOnSelect: true,
        fontSize: 15,
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

    const run = ompCli(omp);
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

  it("环境变量形式的 key：变量名大小写混合、值写进 agent 目录的 .env，omp 启动时读到它，带着它去 /models 拉到模型", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    await mkdir(scratch, { recursive: true });
    const outcome = await saveCustomProvider(
      agentDir,
      {
        id: "fake-disco-env",
        baseUrl: keyed.baseUrl,
        api: "openai-completions",
        key: { kind: "env", name: "Pro_FAKE_KEY", value: SECRET },
        models: [],
        discovery: true,
      },
      "add",
    );
    expect(outcome).toEqual({ ok: true });
    expect(await readFile(path.join(agentDir, ".env"), "utf8")).toContain(`Pro_FAKE_KEY=${SECRET}`);
    expect((await readModelsFile(agentDir)).providers.find((p) => p.id === "fake-disco-env")?.key).toEqual({
      kind: "env",
      name: "Pro_FAKE_KEY",
      source: "env-file",
    });
    // 假服务要求 `Bearer sk-fake-secret`：omp 没读 .env 时会把变量名本身当 key 发出去，拿到 401，列不出模型。
    expect((await listModelIds(omp, "fake-disco-env")).sort()).toEqual(["fake-chat", "fake-mini"]);
  }, 120_000);

  it("能力参数：写进 models.yml 的 reasoning / input / contextWindow / maxTokens 被 omp 采用；留空的由 omp 按 id 补", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    await mkdir(scratch, { recursive: true });
    const outcome = await saveCustomProvider(
      agentDir,
      {
        id: "fake-meta",
        baseUrl: keyless.baseUrl,
        api: "openai-completions",
        key: { kind: "none" },
        models: [
          { id: "house-model", reasoning: true, images: true, contextWindow: 272000, maxTokens: 32000 },
          auto("house-plain"),
          auto("gpt-5.5"),
        ],
      },
      "add",
    );
    expect(outcome).toEqual({ ok: true });
    const run = ompCli(omp);
    const listed = await run(["models", "fake-meta", "--json"]);
    requireSuccess("omp models --json", listed);
    const parsed = JSON.parse(listed.stdout) as {
      models: { id: string; reasoning: boolean; input: string[]; contextWindow: number; maxTokens: number }[];
    };
    const rows = parsed.models.map(({ id, reasoning, input, contextWindow, maxTokens }) => ({
      id,
      reasoning,
      input,
      contextWindow,
      maxTokens,
    }));
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: "house-model", reasoning: true, input: ["text", "image"], contextWindow: 272000, maxTokens: 32000 },
        // omp 目录里没有的 id：omp 的默认（18.12.6 实测）。
        { id: "house-plain", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 16384 },
        // 目录里有的 id：按目录补，界面"自动"后面显示的就是这个值。
        expect.objectContaining({ id: "gpt-5.5", reasoning: true, input: ["text", "image"] }),
      ]),
    );
  }, 120_000);
});

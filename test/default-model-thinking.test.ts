// 默认模型的思考档位（service/default-model.ts）：get_state 的 configuredThinkingLevel 是用户的选择（自动模式是 `auto`），
// thinkingLevel 在自动模式下是 omp 这轮挑的档位；旧 omp 没有 configuredThinkingLevel 时退到 thinkingLevel。
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readDefaultModel } from "../src/main/service/default-model.ts";
import { StartupCache } from "../src/main/service/startup-cache.ts";

const hoisted = vi.hoisted(() => ({ state: {} as Record<string, unknown>, cache: null as unknown }));

vi.mock("electron", () => ({ app: { getVersion: () => "0.0.0-test" } }));
vi.mock("../src/main/ipc/events.ts", () => ({ emitEvent: () => {} }));
vi.mock("../src/main/omp-manager/index.ts", () => ({ readyOmpVersion: async () => "19.2.1" }));
vi.mock("../src/main/service/startup-cache-instance.ts", () => ({ startupCache: () => hoisted.cache }));
vi.mock("../src/main/service/service-omp.ts", () => ({
  serviceHasNoModel: () => false,
  serviceOmp: {
    use: async (job: (connection: unknown) => Promise<unknown>) =>
      job({
        request: async () => ({
          model: { provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
          ...hoisted.state,
        }),
      }),
    close: async () => {},
  },
}));

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 默认思考-"));
  const agentDir = path.join(scratch, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "config.yml"), "modelRoles: {}\n");
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  hoisted.cache = new StartupCache({
    file: path.join(scratch, "startup-cache.json"),
    write: async () => {},
    warn: () => {},
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(scratch, { recursive: true, force: true });
});

describe("readDefaultModel 的思考档位", () => {
  it("自动模式：取 configuredThinkingLevel（auto），不取 omp 这轮挑的 thinkingLevel", async () => {
    hoisted.state = { thinkingLevel: "high", configuredThinkingLevel: "auto" };
    expect((await readDefaultModel(true))?.thinkingLevel).toBe("auto");
  });

  it("没有 configuredThinkingLevel：退到 thinkingLevel；都没有是 null", async () => {
    hoisted.state = { thinkingLevel: "medium" };
    expect((await readDefaultModel(true))?.thinkingLevel).toBe("medium");
    hoisted.state = {};
    expect((await readDefaultModel(true))?.thinkingLevel).toBeNull();
  });
});

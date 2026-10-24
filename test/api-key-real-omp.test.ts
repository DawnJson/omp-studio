// 设置页的 API key 经 `omp auth import` 存进 omp 的凭据库（src/main/login/api-key.ts）。
// 校验部分不起 omp；对真实 omp 的部分需要 PATH 上有 omp（临时 PI_CODING_AGENT_DIR），默认跳过：
// `STUDIO_REAL_OMP=1 npx vitest run test/api-key-real-omp.test.ts`。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "../src/main/git/exec.ts";
import { importApiKey } from "../src/main/login/api-key.ts";
import { findOmpOnPath } from "../src/main/omp/discover.ts";

const enabled = process.env["STUDIO_REAL_OMP"] === "1";
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp 密钥 key-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("API key 校验（不起 omp）", () => {
  it("不能填 key 的 provider、空 key、带换行的 key 都在起 omp 之前拒绝", async () => {
    const missing = path.join(scratch, "no-such-omp.exe");
    await expect(importApiKey(missing, scratch, "xai-oauth", "sk-x")).rejects.toThrow("does not take an API key");
    await expect(importApiKey(missing, scratch, "anthropic", "   ")).rejects.toThrow("empty");
    await expect(importApiKey(missing, scratch, "anthropic", "sk-a\nsk-b")).rejects.toThrow("control characters");
  });
});

describe.skipIf(!enabled)("API key × 真实 omp", () => {
  it("新 key 替换这个 provider 的旧 key，OAuth 凭据和别的 provider 不动；首尾空白不进凭据库", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const env = { ...process.env, PI_CODING_AGENT_DIR: path.join(scratch, "agent") };
    const oauth = { type: "oauth", access: "fake-access", refresh: "fake-refresh", expires: Date.now() + 3_600_000 };
    const seeded = await runCommand(omp, ["auth", "import", "-"], {
      cwd: scratch,
      env,
      input: JSON.stringify({ version: 1, credentials: [{ provider: "anthropic", credential: oauth }] }),
      timeoutMs: 30_000,
    });
    expect(seeded.code).toBe(0);

    await importApiKey(omp, scratch, "anthropic", "sk-first", env);
    await importApiKey(omp, scratch, "tavily", "tvly-one", env);
    await importApiKey(omp, scratch, "anthropic", "  sk-second  ", env);

    const exported = await runCommand(omp, ["auth", "export"], { cwd: scratch, env, timeoutMs: 30_000 });
    expect(exported.code).toBe(0);
    const { credentials } = JSON.parse(exported.stdout.toString("utf8")) as {
      credentials: { provider: string; credential: { type: string; key?: string } }[];
    };
    const stored = credentials.map(
      ({ provider, credential }) => `${provider}:${credential.type}:${credential.key ?? ""}`,
    );
    expect(stored.sort()).toEqual(["anthropic:api_key:sk-second", "anthropic:oauth:", "tavily:api_key:tvly-one"]);
  }, 60_000);
});

// 账号型 provider 的扩展 × 真实 omp：`omp -e <部署出来的入口>` 能不能真的注册出 qoder / qoder-cn，
// 并出现在 `get_login_providers` 里（登录流程和模型要走真实账号，这里不碰网络、不登录）。
// 默认跳过：`STUDIO_REAL_OMP=1 npx vitest run test/client-accounts-real-omp.test.ts`，需要 PATH 上有 omp。
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deployAccountExtension } from "../src/main/client-accounts/deploy.ts";
import { runCommand } from "../src/main/git/exec.ts";
import { findOmpOnPath } from "../src/main/omp/discover.ts";

const enabled = process.env["STUDIO_REAL_OMP"] === "1";
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp studio 账号扩展-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

interface Frame {
  type?: string;
  id?: string;
  data?: unknown;
  error?: string;
}

/** 起一个 rpc-ui 的 omp，发几帧就关：够验证扩展加载和 provider 注册，不碰模型。 */
async function askOmp(omp: string, entry: string, frames: object[]): Promise<Frame[]> {
  const child = spawn(omp, ["--mode", "rpc-ui", "--no-session", "-e", entry], {
    cwd: scratch,
    env: { ...process.env, PI_CODING_AGENT_DIR: path.join(scratch, "agent"), NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out: Frame[] = [];
  let buffer = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith("{")) continue;
      out.push(JSON.parse(line) as Frame);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  await new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (out.some((frame) => frame.type === "ready")) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 30_000) {
        clearInterval(timer);
        reject(new Error(`omp never became ready; stderr: ${stderr.slice(-500)}`));
      }
    }, 100);
  });

  for (const [index, frame] of frames.entries()) {
    child.stdin.write(`${JSON.stringify({ ...frame, id: `t${index + 1}` })}\n`);
    const id = `t${index + 1}`;
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (out.some((item) => item.type === "response" && item.id === id)) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() - started > 30_000) {
          clearInterval(timer);
          reject(new Error(`no response for ${id}; stderr: ${stderr.slice(-500)}`));
        }
      }, 50);
    });
  }

  child.stdin.end();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 5_000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  return out;
}

describe.skipIf(!enabled)("扩展 × 真实 omp", () => {
  it("加载部署出来的扩展后，登录列表里有 qoder / qoder-cn / workbuddy / workbuddy-ai，且未登录", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const entry = await deployAccountExtension(path.join(scratch, "userData"));

    const frames = await askOmp(omp, entry, [{ type: "get_login_providers" }]);
    const response = frames.find((frame) => frame.type === "response" && frame.id === "t1");
    expect(response?.error).toBeUndefined();
    const data = response?.data as { providers?: { id: string; name: string; authenticated: boolean }[] } | undefined;
    const providers = data?.providers ?? [];
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    expect(byId.get("qoder")).toMatchObject({ name: "Qoder", authenticated: false });
    expect(byId.get("qoder-cn")).toMatchObject({ name: "Qoder CN", authenticated: false });
    expect(byId.get("workbuddy")).toMatchObject({ name: "WorkBuddy", authenticated: false });
    expect(byId.get("workbuddy-ai")).toMatchObject({ name: "WorkBuddy AI", authenticated: false });
  }, 120_000);

  // 任务进程和它走同一条启动路径（buildTspArgs 加 `-e`）：扩展在真请求里也要能安静地待着，
  // 不能因为它起不来。会调真实模型，没有 STUDIO_TEST_MODEL 时跳过。
  it("带扩展起 omp 跑一轮 prompt，回答正常返回（扩展不影响别的 provider）", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const dotenv = parseEnv(await readFile(path.join(import.meta.dirname, "..", ".env"), "utf8"));
    const model = dotenv["STUDIO_TEST_MODEL"];
    if (!model) {
      console.log("no STUDIO_TEST_MODEL, skipped");
      return;
    }
    const entry = await deployAccountExtension(path.join(scratch, "userData"));

    const result = await runCommand(omp, ["--no-session", "-e", entry, "--model", model, "-p", "Reply with: OK"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, ...dotenv, PI_CODING_AGENT_DIR: path.join(scratch, "agent-prompt") },
      timeoutMs: 180_000,
    });
    expect(result.code).toBe(0);
    const answer = result.stdout.toString("utf8");
    expect(answer.trim().length).toBeGreaterThan(0);
    expect(answer).toMatch(/\bOK\b/i);
    expect(result.stderr).not.toContain("studio-accounts");
  }, 240_000);
});

// 内置 magpie 插件的扩展 × 真实 omp：部署到 `<agent 目录>/extensions/studio-accounts/` 后，不带任何参数的 omp
// 能不能自己加载它、注册出全部能登录的 provider，并出现在 `get_login_providers` 里（登录流程和模型要走真实账号，这里不碰网络、不登录）。
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
async function askOmp(omp: string, agentDir: string, frames: object[]): Promise<Frame[]> {
  const child = spawn(omp, ["--mode", "rpc-ui", "--no-session"], {
    cwd: scratch,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, NO_COLOR: "1", FORCE_COLOR: "0" },
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
  it("扩展目录里的扩展被 omp 自动加载：登录列表里有每个插件能登录的 provider；要打字登录的不出现，omp 已有的 id 换名注册", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const agentDir = path.join(scratch, "agent");
    await deployAccountExtension(agentDir);

    const frames = await askOmp(omp, agentDir, [{ type: "get_login_providers" }]);
    const response = frames.find((frame) => frame.type === "response" && frame.id === "t1");
    expect(response?.error).toBeUndefined();
    const data = response?.data as { providers?: { id: string; name: string; authenticated: boolean }[] } | undefined;
    const names = Object.fromEntries((data?.providers ?? []).map((provider) => [provider.id, provider.name]));
    expect(names).toMatchObject({
      qoder: "Qoder",
      "qoder-cn": "Qoder CN",
      qwenwork: "QwenWork",
      workbuddy: "WorkBuddy",
      "workbuddy-ai": "WorkBuddy AI",
      "trae-cn": "Trae CN",
      "trae-global": "Trae Global",
      kiro: "Kiro",
      zed: "Zed",
      "commandcode-plan": "Command Code Plan",
      "minimax-code-account": "MiniMax Code",
      "minimax-code-global": "MiniMax Code (Global)",
      "mimo-app": "Xiaomi MiMo",
      zcode: "ZCode",
      codearts: "CodeArts",
      opendesign: "Open Design",
      joycode: "JoyCode",
      raccoon: "商汤小浣熊",
      "nous-portal": "Nous Portal (OAuth)",
      autoclaw: "AutoClaw (Zhipu)",
      "opencode-zen-free": "OpenCode Zen Free",
    });
    // 只能输手机号 / 企业域名登录的不接。
    expect(names).not.toHaveProperty("autoclaw-cn");
    expect(names).not.toHaveProperty("qwenwork-enterprise");
  }, 120_000);

  // 任务进程也自动加载这个扩展：扩展在真请求里要能安静地待着，不能让别的 provider 起不来。
  // 会调真实模型，没有 STUDIO_TEST_MODEL 时跳过。
  it("带扩展起 omp 跑一轮 prompt，回答正常返回（扩展不影响别的 provider）", async () => {
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const dotenv = parseEnv(await readFile(path.join(import.meta.dirname, "..", ".env"), "utf8"));
    const model = dotenv["STUDIO_TEST_MODEL"];
    if (!model) {
      console.log("no STUDIO_TEST_MODEL, skipped");
      return;
    }
    const agentDir = path.join(scratch, "agent-prompt");
    await deployAccountExtension(agentDir);

    const result = await runCommand(omp, ["--no-session", "--model", model, "-p", "Reply with: OK"], {
      cwd: path.join(import.meta.dirname, ".."),
      env: { ...process.env, ...dotenv, PI_CODING_AGENT_DIR: agentDir },
      timeoutMs: 180_000,
    });
    expect(result.code).toBe(0);
    const answer = result.stdout.toString("utf8");
    expect(answer.trim().length).toBeGreaterThan(0);
    expect(answer).toMatch(/\bOK\b/i);
    expect(result.stderr).not.toContain("studio-accounts");
  }, 240_000);
});

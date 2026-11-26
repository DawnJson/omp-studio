// 提示词优化 × 真实 omp（PATH 上的）：临时 PI_CODING_AGENT_DIR / home，模型由 agent 目录里的一个扩展注册（同 studio-accounts：
// 扩展不加载就解析不到），modelRoles.default 指向它，走 `@smol`（smol 没配时 omp 退到 default）。扩展把每次请求带的工具名记进文件。
// 会调真实模型，默认跳过：`STUDIO_REAL_OMP=1 npx vitest run test/prompt-enhance-real-omp.test.ts`。
// 需要仓库根 .env：STUDIO_TEST_MODEL（取最后一段作模型 id）、DEEPSEEK_URL（OpenAI 兼容地址）、DEEPSEEK_API_KEY。
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOmpOnPath } from "../src/main/omp/discover.ts";
import { draftLanguage, enhancePrompt } from "../src/main/prompt-enhance/enhance.ts";

const enabled = process.env["STUDIO_REAL_OMP"] === "1";
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), "omp-studio 优化 real-"));
});
afterAll(async () => {
  await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** 扩展：注册 provider `studio-probe`（.env 的 DeepSeek 地址和 key），把每次请求的工具名追加进 `<agent 目录>/tools.log`。 */
function probeExtension(modelId: string): string {
  return `import { appendFileSync } from "node:fs";
import path from "node:path";
export default function (pi) {
  pi.registerProvider("studio-probe", {
    baseUrl: process.env.DEEPSEEK_URL,
    apiKey: "DEEPSEEK_API_KEY",
    api: "openai-completions",
    models: [{ id: ${JSON.stringify(modelId)}, name: "Probe", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 8192 }],
  });
  pi.on("before_provider_request", (event) => {
    const tools = event.payload && event.payload.tools;
    appendFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "tools.log"),
      JSON.stringify(Array.isArray(tools) ? tools.map((t) => (t.function ? t.function.name : t.name)) : []) + "\\n");
  });
}
`;
}

describe.skipIf(!enabled)("提示词优化 × 真实 omp", () => {
  it("扩展注册的模型能用；请求不带工具；中文、英文草稿各一条：有输出、语言不变、[Image #1, …] 还在、不落会话", async () => {
    const dotenv = parseEnv(
      await readFile(process.env["STUDIO_ENV_FILE"] ?? path.join(import.meta.dirname, "..", ".env"), "utf8"),
    );
    const modelId = dotenv["STUDIO_TEST_MODEL"]?.split("/").pop();
    if (!modelId) throw new Error(".env has no STUDIO_TEST_MODEL");
    if (!dotenv["DEEPSEEK_URL"] || !dotenv["DEEPSEEK_API_KEY"])
      throw new Error(".env has no DEEPSEEK_URL / DEEPSEEK_API_KEY");
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const agentDir = path.join(scratch, "agent");
    const project = path.join(scratch, "项目");
    await mkdir(path.join(agentDir, "extensions", "studio-probe"), { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(path.join(agentDir, "extensions", "studio-probe", "index.js"), probeExtension(modelId), "utf8");
    await writeFile(
      path.join(agentDir, "config.yml"),
      `startup:\n  setupWizard: false\nmodelRoles:\n  default: studio-probe/${modelId}\n`,
      "utf8",
    );
    const env = { ...process.env, ...dotenv, PI_CODING_AGENT_DIR: agentDir, HOME: scratch, USERPROFILE: scratch };
    const run = (draft: string) =>
      enhancePrompt(draft, {
        cwd: project,
        omp: { command: omp, args: [], env },
        model: "@smol",
        signal: new AbortController().signal,
      });

    const zh = "帮我看下登录那块为啥老是报错，截图在这 [Image #1, 800x600]";
    const en = "make the login button blue, see [Image #1, 800x600]";
    const [zhResult, enResult] = [await run(zh), await run(en)];
    for (const [draft, result] of [
      [zh, zhResult],
      [en, enResult],
    ] as const) {
      expect(result.kind, JSON.stringify(result)).toBe("enhanced");
      if (result.kind !== "enhanced") continue;
      expect(result.text.trim()).not.toBe("");
      expect(result.text).toContain("[Image #1, 800x600]");
      expect(draftLanguage(result.text)).toBe(draftLanguage(draft));
    }
    // 每次请求都没有工具（没有内置工具，也没有 Auto-QA 的 report_issue）。
    const requests = (await readFile(path.join(agentDir, "tools.log"), "utf8")).trim().split("\n");
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const line of requests) expect(JSON.parse(line)).toEqual([]);
    // --no-session：agent 目录里没有会话。
    expect(await readdir(agentDir)).not.toContain("sessions");
  }, 180_000);
});

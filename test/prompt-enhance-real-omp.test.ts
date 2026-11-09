// 提示词优化 × 真实 omp（PATH 上的）：临时 PI_CODING_AGENT_DIR，modelRoles.default = .env 的 STUDIO_TEST_MODEL，走 `@smol`（smol 没配时 omp 退到 default）。
// 会调真实模型，默认跳过：`STUDIO_REAL_OMP=1 npx vitest run test/prompt-enhance-real-omp.test.ts`。需要仓库根 .env（STUDIO_TEST_MODEL 和 key）。
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

describe.skipIf(!enabled)("提示词优化 × 真实 omp", () => {
  it("中文、英文草稿各一条：有输出、语言不变、[Image #1, …] 还在、不落会话", async () => {
    const dotenv = parseEnv(
      await readFile(process.env["STUDIO_ENV_FILE"] ?? path.join(import.meta.dirname, "..", ".env"), "utf8"),
    );
    const model = dotenv["STUDIO_TEST_MODEL"];
    if (!model) throw new Error(".env has no STUDIO_TEST_MODEL");
    const omp = await findOmpOnPath();
    if (!omp) throw new Error("omp is not on PATH");
    const agentDir = path.join(scratch, "agent");
    const project = path.join(scratch, "项目");
    await mkdir(agentDir, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
      path.join(agentDir, "config.yml"),
      `startup:\n  setupWizard: false\nmodelRoles:\n  default: ${model}\n`,
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
    // --no-session：agent 目录里没有会话。
    expect(await readdir(agentDir)).not.toContain("sessions");
  }, 180_000);
});

// 启动构建产物（先 npm run build）：Playwright 的 _electron.launch。userData 和 omp 的 agent 目录都指到临时目录，
// 和真实数据隔离：会话索引读的是 PI_CODING_AGENT_DIR，里面只有这里造的假会话，真实 ~/.omp 不会出现在界面或截图里。
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { findOmpOnPath } from "../../src/main/omp/discover.ts";
import { parseTestOmpOverride } from "../../src/main/omp/launch-args.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  /** 本次启动用的 omp agent 目录（调用方没传 PI_CODING_AGENT_DIR 时是自动造的临时目录）。 */
  agentDir: string;
  close(): Promise<void>;
}

const headerLine = (id: string, cwd: string) =>
  `${JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-10-18T00:00:00.000Z", cwd })}\n`;
const userLine = (text: string) =>
  `${JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: [{ type: "text", text }] } })}\n`;

/** 假会话：标题中英混排、其中一条很长（测省略），修改时间依次相差几小时。cwd 指向 projectDir（可以是任何字符串）。 */
export async function seedFakeSessions(agentDir: string, projectDir: string): Promise<void> {
  const bucket = path.join(agentDir, "sessions", "--fake-project--");
  await mkdir(bucket, { recursive: true });
  const prompts = [
    "整理日志格式并补上单元测试",
    "Fix the flaky login test on CI",
    "把设置页的语言切换改成立即生效，并且在窄窗口下也不要撑破布局，顺便检查一下中英文混排时的行高是否一致",
    "Add pagination to the task list",
    "排查内存泄漏",
    "Write release notes for 0.1",
  ];
  const now = Date.now();
  for (const [index, prompt] of prompts.entries()) {
    const file = path.join(bucket, `2026-10-18T0${index}-00-00-000Z_fake-${index}.jsonl`);
    await writeFile(file, headerLine(`fake-${index}`, projectDir) + userLine(prompt), "utf8");
    const modified = new Date(now - (index + 1) * 3 * 60 * 60 * 1000);
    await utimes(file, modified, modified);
  }
}

/** 主进程的接管询问记录（src/main/omp-manager/takeover-state.ts）。键是 exe 路径，Windows 上小写。 */
async function seedTakeoverDeclined(userDataDir: string, exePaths: string[]): Promise<void> {
  const takeover = Object.fromEntries(
    exePaths.map((exe) => [process.platform === "win32" ? exe.toLowerCase() : exe, "declined"]),
  );
  await writeFile(path.join(userDataDir, "omp-studio-state.json"), JSON.stringify({ takeover }), "utf8");
}

/**
 * askTakeover=false（默认）时预先替用户拒绝接管 PATH 上的 omp 和 STUDIO_TEST_OMP 的假 omp：
 * 不测接管的用例不该被接管弹窗挡住，也绝不能在测试里真的下载 omp、改用户 PATH。
 */
export async function launchApp(
  extraEnv: Record<string, string> = {},
  options: { askTakeover?: boolean } = {},
): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "omp-studio-e2e-"));
  if (options.askTakeover !== true) {
    const testOmp = extraEnv["STUDIO_TEST_OMP"] ?? process.env["STUDIO_TEST_OMP"];
    const onPath = await findOmpOnPath().catch(() => null);
    await seedTakeoverDeclined(userDataDir, [
      ...(testOmp ? [parseTestOmpOverride(testOmp).command] : []),
      ...(onPath ? [onPath] : []),
    ]);
  }
  const ownedAgentDir =
    extraEnv["PI_CODING_AGENT_DIR"] === undefined ? await mkdtemp(path.join(os.tmpdir(), "omp-studio-agent-")) : null;
  if (ownedAgentDir !== null) await seedFakeSessions(ownedAgentDir, path.join(os.tmpdir(), "omp studio 假项目"));
  const agentDir = ownedAgentDir ?? extraEnv["PI_CODING_AGENT_DIR"] ?? "";
  // 指向 Vite 开发服务器的变量会让应用去加载开发页面；e2e 只跑构建产物。
  const { ELECTRON_RENDERER_URL: _devUrl, ...baseEnv } = process.env;
  const app = await electron.launch({
    args: [root],
    cwd: root,
    env: { ...baseEnv, STUDIO_USER_DATA: userDataDir, PI_CODING_AGENT_DIR: agentDir, ...extraEnv },
  });
  const page = await app.firstWindow();
  return {
    app,
    page,
    userDataDir,
    agentDir,
    async close() {
      await app.close();
      await rm(userDataDir, { recursive: true, force: true });
      if (ownedAgentDir !== null) await rm(ownedAgentDir, { recursive: true, force: true });
    },
  };
}

export const screenshotsDir = path.join(root, "screenshots");

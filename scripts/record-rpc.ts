// 录制一次真实 omp 会话，写成假 omp 能回放的 fixture。格式见 docs/architecture/rpc-replay.md。
// 用法：node scripts/record-rpc.ts <名字> <prompt 文本> [--scenario <场景>]
// 场景：prompt（默认，yolo，一问一答）、approval（always-ask，批准一次）、ask（ask 对话框，每题取推荐项）、
//       turn-error（无效 key，prompt_result 为 error）、queue-steer（运行中投递 steer 和 follow-up）、
//       resume-history（先聊一轮，再开新进程 switch_session 并读历史，只录第二个进程）。
// 需要 .env（STUDIO_TEST_MODEL 和对应 provider 的 key），默认读仓库根目录的，可用 STUDIO_ENV_FILE 指定。
// omp 用临时的 PI_CODING_AGENT_DIR，不碰 ~/.omp。初始化序列用 src/main/omp/session-init.ts，和应用共用。
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { findOmpOnPath, inspectOmp } from "../src/main/omp/discover.ts";
import { OmpConnection } from "../src/main/omp/omp-connection.ts";
import { initializeSession, loadHistory } from "../src/main/omp/session-init.ts";
import type { AskUiRequest, RpcServerFrame, SelectUiRequest } from "../src/shared/omp-wire/rpc-wire.generated.ts";

const scenarios = ["prompt", "approval", "ask", "turn-error", "queue-steer", "resume-history"] as const;
type Scenario = (typeof scenarios)[number];

const { values, positionals } = parseArgs({ allowPositionals: true, options: { scenario: { type: "string", default: "prompt" } } });
const [name, prompt] = positionals;
const scenario = values.scenario as Scenario;
if (!name || !/^[a-z0-9-]+$/.test(name) || !prompt || !scenarios.includes(scenario)) {
  console.error(`usage: node scripts/record-rpc.ts <name: a-z0-9-> <prompt> [--scenario ${scenarios.join("|")}]`);
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..");
const dotenv = parseEnv(await readFile(process.env.STUDIO_ENV_FILE ?? path.join(root, ".env"), "utf8"));
const model = dotenv.STUDIO_TEST_MODEL;
if (!model) throw new Error(".env has no STUDIO_TEST_MODEL");

const ompPath = await findOmpOnPath();
if (!ompPath) throw new Error("omp is not on PATH");
const omp = await inspectOmp(ompPath);

// 临时目录名带空格和中文，顺带覆盖这类路径。默认放在系统临时目录；Windows 上它在用户目录里，
// 模型把工作目录写进工具参数时会带出用户名（见下面的泄漏检查），这时用 STUDIO_SCRATCH_DIR 指到用户目录以外、
// 不在 git 仓库里的目录（在仓库里 omp 会把仓库当成项目，读进它的 AGENTS.md）。
const scratch = await mkdtemp(path.join(process.env.STUDIO_SCRATCH_DIR ?? os.tmpdir(), "omp-studio 录制-"));
const agentDir = path.join(scratch, "agent");
const cwd = path.join(scratch, "工作 目录");
await mkdir(cwd, { recursive: true });

// 没有显式审批模式时 omp 默认 yolo；这里每次都显式传，录制不依赖本机 omp 配置。
const approvalMode = scenario === "approval" ? "always-ask" : "yolo";
// turn-error：key 无效，provider 返回 401，prompt 以 error 结局。
const env: NodeJS.ProcessEnv = { ...process.env, ...dotenv, PI_CODING_AGENT_DIR: agentDir };
if (scenario === "turn-error") for (const key of Object.keys(dotenv)) if (key.endsWith("_API_KEY")) env[key] = "sk-invalid-recording-key";

const entries: object[] = [{ kind: "meta", ompVersion: omp.version, model, recordedAt: new Date().toISOString(), prompt, scenario, approvalMode }];

function connect(tap: boolean): OmpConnection {
  return OmpConnection.spawn(
    { command: omp.path, args: ["--mode", "rpc-ui", "--model", model!, "--approval-mode", approvalMode], cwd, env },
    tap ? { tap: (direction, frame) => entries.push({ kind: direction, frame }) } : {},
  );
}

/** 对话框自动应答：审批取第一项（Approve），ask 每题取推荐项否则第一项。 */
function answerDialogs(connection: OmpConnection): void {
  connection.onFrame((frame: RpcServerFrame) => {
    if (frame.type !== "extension_ui_request") return;
    if (frame.method === "select") {
      const request = frame as SelectUiRequest;
      console.log("select:", JSON.stringify({ title: request.title, options: request.options, optionDetails: request.optionDetails }).slice(0, 600));
      connection.send({ type: "extension_ui_response", id: request.id, value: request.options[0] ?? "" });
    } else if (frame.method === "ask") {
      const request = frame as AskUiRequest;
      const answers = request.questions.map((question) => ({ id: question.id, selectedOptions: [question.options[question.recommended ?? 0]?.label ?? ""] }));
      connection.send({ type: "extension_ui_response", id: request.id, answers });
    }
  });
}

async function runQueueSteer(connection: OmpConnection): Promise<void> {
  // 第一条是会调几次工具的长任务；第一次工具开始执行后再投递 steer 和 follow-up，这时 omp 一定在流式中。
  const toolStarted = Promise.withResolvers<void>();
  connection.onFrame((frame) => {
    if (frame.type === "tool_execution_start") toolStarted.resolve();
  });
  const first = connection.prompt({ message: prompt! });
  await toolStarted.promise;
  const steer = connection.prompt({ message: "改成只做一次就停下，并用一句话说明。", streamingBehavior: "steer" });
  const followUp = connection.prompt({ message: "最后再用一个词总结。", streamingBehavior: "followUp" });
  console.log("outcomes:", JSON.stringify(await Promise.all([first, steer, followUp])).slice(0, 600));
}

const connection = connect(scenario !== "resume-history");
let exitDescription = "";
try {
  await connection.ready;
  answerDialogs(connection);
  const init = await initializeSession(connection);
  if (scenario === "queue-steer") await runQueueSteer(connection);
  else if (scenario === "resume-history") {
    // 第一个进程不录：聊一轮让会话落盘，拿到 sessionFile 后关掉。
    await connection.prompt({ message: prompt });
    const sessionFile = (await connection.request("get_state")).sessionFile;
    if (!sessionFile) throw new Error("get_state has no sessionFile after the first turn");
    await connection.close();
    const second = connect(true);
    try {
      await second.ready;
      await initializeSession(second, { resumeSessionFile: sessionFile });
      const history = await loadHistory(second);
      console.log("history messages:", history.length);
    } finally {
      await second.close();
    }
  } else {
    console.log("outcome:", JSON.stringify(await connection.prompt({ message: prompt })).slice(0, 300));
  }
  console.log("init:", JSON.stringify({ delta: init.messageUpdatesDelta, askDialog: init.askDialog, sessionFile: init.state.sessionFile ?? null }));
} finally {
  const exit = await connection.close();
  exitDescription = JSON.stringify({ code: exit.code, killed: exit.killed, error: exit.error?.message ?? null });
  await rm(scratch, { recursive: true, force: true });
}
console.log("exit:", exitDescription);

// 录制里出现的临时目录和用户目录换成固定占位：回放结果不依赖录制时的机器，也不带出用户名。
// 路径会以原样、`/` 分隔，以及嵌在 JSON 字符串（工具参数）里多次转义的形式出现，都要替换。
let text = entries.map((entry) => JSON.stringify(entry)).join("\n");
for (const [dir, placeholder] of [[scratch, "<scratch>"], [os.homedir(), "<home>"]] as const) {
  for (const form of [dir, dir.replaceAll("\\", "/")]) {
    let escaped = form;
    for (let depth = 0; depth < 3; depth++) {
      escaped = JSON.stringify(escaped).slice(1, -1);
      text = text.replaceAll(escaped, placeholder);
    }
  }
}
// 流式输出的工具参数是逐段增长的，路径会被拆在几帧的 `delta` 里，整段替换不到。
// 所以把所有 `delta` 按顺序拼起来再查一遍，和整份录制一起检查用户名和凭据，命中就不写文件。
text = text.replaceAll(os.userInfo().username, "<user>");
const deltas = entries
  .map((entry) => ("frame" in entry ? (entry.frame as { assistantMessageEvent?: { delta?: unknown } }).assistantMessageEvent?.delta : undefined))
  .filter((delta) => typeof delta === "string")
  .join("");
const secrets: [string, string][] = [["username", os.userInfo().username]];
for (const [key, value] of Object.entries(dotenv)) if (key !== "STUDIO_TEST_MODEL" && value) secrets.push([key, value]);
for (const [key, value] of Object.entries(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD/i.test(key) && value && value.length >= 8) secrets.push([key, value]);
for (const [label, value] of secrets) {
  if (text.includes(value) || deltas.includes(value)) {
    throw new Error(`recording contains the value of ${label}; not written. For the username, set STUDIO_SCRATCH_DIR outside the user profile.`);
  }
}
const target = path.join(root, "fixtures", "rpc", `${name}.ndjson`);
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, text + "\n");
console.log(`wrote ${target} (${entries.length} entries, omp ${omp.version}, scenario ${scenario})`);

// 录制一次真实 omp 会话，写成假 omp 能回放的 fixture。格式见 docs/architecture/rpc-replay.md。
// 用法：node scripts/record-rpc.ts <名字> <prompt 文本>
// 需要 .env（STUDIO_TEST_MODEL 和对应 provider 的 key），默认读仓库根目录的，在别的 worktree 里可用 STUDIO_ENV_FILE 指定。
// omp 用临时的 PI_CODING_AGENT_DIR，不碰 ~/.omp。
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { readFile } from "node:fs/promises";
import { findOmpOnPath, inspectOmp } from "../src/main/omp/discover.ts";
import { OmpConnection } from "../src/main/omp/omp-connection.ts";

const [name, prompt] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name) || !prompt) {
  console.error("usage: node scripts/record-rpc.ts <name: a-z0-9-> <prompt>");
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

const entries: object[] = [{ kind: "meta", ompVersion: omp.version, model, recordedAt: new Date().toISOString(), prompt }];
const connection = OmpConnection.spawn(
  {
    command: omp.path,
    args: ["--mode", "rpc-ui", "--model", model],
    cwd,
    env: { ...process.env, ...dotenv, PI_CODING_AGENT_DIR: agentDir },
  },
  { tap: (direction, frame) => entries.push({ kind: direction, frame }) },
);

try {
  await connection.ready;
  const outcome = await connection.prompt({ message: prompt });
  console.log("outcome:", JSON.stringify(outcome).slice(0, 300));
} finally {
  const exit = await connection.close();
  console.log("exit:", JSON.stringify({ code: exit.code, killed: exit.killed, error: exit.error?.message ?? null }));
  await rm(scratch, { recursive: true, force: true });
}

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
console.log(`wrote ${target} (${entries.length} entries, omp ${omp.version})`);

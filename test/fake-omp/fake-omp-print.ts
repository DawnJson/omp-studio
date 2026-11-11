// 假 `omp -p`（一次性打印模式）：单测和 e2e 里扮演提示词优化、桌面宠物（起名、说话）调用的真实 omp（真实行为见 docs/architecture/prompt-enhance.md）。
// 用法：node test/fake-omp/fake-omp-print.ts -p --no-session … --model @smol --system-prompt "<模板>"，草稿从 stdin 进。
// 环境变量：
//   FAKE_PRINT_MODE  ok（默认：草稿后面接 " (enhanced)"）| fenced（同 ok，但包在代码围栏里）| nomodel | fail | hang | empty
//                    | pet（宠物：照 `--mode json` 的格式回一条 assistant 的 message_end，usage 固定 1000 token / $0.002；
//                      stdin 是 "Hatch the pet." 时文字是 {"name":"Pixel",…}，否则是 "said: <stdin 第一行>"）
//   FAKE_PRINT_MODE_FILE 给了就每次从这个文件读模式（e2e 一次启动里换着模式测），优先于 FAKE_PRINT_MODE
//   FAKE_PRINT_LOG   给了就把 {cwd, argv, stdin, pid} 作为一行 JSON 追加进去：测试据此断言参数、草稿只走 stdin、进程被结束
//   FAKE_PRINT_DELAY 输出前等这么多毫秒（e2e 里让"优化中"停一会儿）
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const modeFile = process.env["FAKE_PRINT_MODE_FILE"];
const mode = modeFile ? readFileSync(modeFile, "utf8").trim() : (process.env["FAKE_PRINT_MODE"] ?? "ok");

let stdin = "";
for await (const chunk of process.stdin) stdin += String(chunk);

if (process.env["FAKE_PRINT_LOG"])
  appendFileSync(
    process.env["FAKE_PRINT_LOG"],
    `${JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2), stdin, pid: process.pid })}\n`,
  );

process.stderr.write("Working...\n");
const delay = Number(process.env["FAKE_PRINT_DELAY"] ?? 0);
if (delay > 0) await sleep(delay);

const draft = /<draft>\n([\s\S]*)\n<\/draft>/.exec(stdin)?.[1] ?? "";
const enhanced = `${draft} (enhanced)`;

if (mode === "hang") {
  await sleep(10 * 60_000); // 等着被取消
} else if (mode === "nomodel") {
  process.stderr.write(
    "error: No API key found for anthropic. Use /login or set an API key environment variable.\n    at A_ (B:/~BUN/root/chunks/cli.js:25:11)\n",
  );
  process.exit(1);
} else if (mode === "fail") {
  process.stderr.write("error: 429 rate limit exceeded\n");
  process.exit(1);
} else if (mode === "empty") {
  process.stdout.write("\n");
} else if (mode === "fenced") {
  process.stdout.write(`\`\`\`text\n${enhanced}\n\`\`\`\n`);
} else if (mode === "drop-chip") {
  process.stdout.write(`${draft.replace(/\[(?:Image|Paste|File) #\d+[^\]]*\]\s?/g, "")} (enhanced)\n`);
} else if (mode === "pet") {
  const text = stdin.startsWith("Hatch")
    ? JSON.stringify({ name: "Pixel", personality: "A tiny test pet." })
    : `said: ${stdin.split("\n")[0]}`;
  const usage = { totalTokens: 1000, cost: { total: 0.002 } };
  process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
  process.stdout.write(
    `${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], usage } })}\n`,
  );
} else {
  process.stdout.write(`${enhanced}\n`);
}

// 假 `omp commit`：单测和 e2e 里扮演真实 omp 的 `commit --dry-run --no-changelog`（真实输出格式见 docs/architecture/git.md）。
// 用法：node test/fake-omp/fake-omp-commit.ts commit --dry-run --no-changelog
// 环境变量：
//   FAKE_COMMIT_MODE  ok（默认）| split | nomodel | fail | hang
//   FAKE_COMMIT_LOG   给了就把 "<cwd>\t<参数>" 追加进去，测试据此断言 omp 是怎么被调用的（没暂存内容时不该被调用）
//   FAKE_COMMIT_DELAY 输出前等这么多毫秒（e2e 里让"生成中"的状态停一会儿）
//   PI_CODING_AGENT_DIR 给了就像真实 omp 一样在 sessions/<桶>/ 下留一个会话文件（studio 不删它）
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const mode = process.env["FAKE_COMMIT_MODE"] ?? "ok";
const GREY = "\x1b[38;2;42;48;56m";
const BLUE = "\x1b[38;2;0;180;255m";
const OFF = "\x1b[39m";

const agentDir = process.env["PI_CODING_AGENT_DIR"];
if (agentDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bucket = path.join(agentDir, "sessions", "--fake-commit--");
  mkdirSync(bucket, { recursive: true });
  writeFileSync(
    path.join(bucket, `${stamp}_fake-commit.jsonl`),
    [
      JSON.stringify({ type: "title", v: 1, title: "" }),
      JSON.stringify({ type: "session", version: 3, id: "fake-commit", cwd: process.cwd() }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "Propose conventional commit for staged changes.\n…" }],
        },
      }),
    ].join("\n") + "\n",
  );
}

// 最后才记调用：测试等到这一行就说明会话文件已经写好了。
if (process.env["FAKE_COMMIT_LOG"])
  appendFileSync(process.env["FAKE_COMMIT_LOG"], `${process.cwd()}\t${process.argv.slice(2).join(" ")}\n`);

const delay = Number(process.env["FAKE_COMMIT_DELAY"] ?? 0);
if (delay > 0) await sleep(delay);

const progress = "● Resolving model...\n  └─ Fake Model\n● Starting commit agent...\n";

if (mode === "hang") {
  process.stdout.write(progress);
  await sleep(10 * 60_000); // 等着被取消
} else if (mode === "nomodel") {
  process.stdout.write("● Resolving model...\n");
  process.stderr.write(
    "error: No model available for commit generation\n    at A_ (B:/~BUN/root/chunks/cli.js:25:11)\n",
  );
  process.exit(1);
} else if (mode === "fail") {
  process.stdout.write(
    `${progress}● Using fallback commit generation...\n\nGenerated commit message:\nchore: update a.txt\n`,
  );
  process.stderr.write("Agent error: the model timed out\n");
  process.exit(1);
} else if (mode === "split") {
  process.stdout.write(
    `${progress}\nSplit commit plan (dry run):\nCommit 1:\nfeat: 先做这个\n\n- 第一件事\nChanges: a.txt\nCommit 2:\nfix: 再做那个\nChanges: b c.txt (all)\n`,
  );
} else {
  process.stdout.write(
    `${progress}● Proposed commit:\n\n  ${GREY}\`\`\`${OFF}\n    feat: 假 omp 生成的标题\n  ${GREY}\`\`\`${OFF}\n\n  ${BLUE}- ${OFF}details\n● agent finished (4 messages, 3 tools)\n\nGenerated commit message:\nfeat: 假 omp 生成的标题\n\n- 第一条说明\n- 第二条说明\n`,
  );
}

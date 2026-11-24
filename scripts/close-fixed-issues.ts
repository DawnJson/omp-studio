// 发版上传完之后：上一个版本到这个版本之间的提交标题里写了 `#N`、而且还开着的 issue，回复一句"在哪个版本修好"并关掉。
// PR 编号（合并 PR 的提交）和已经关掉的 issue 跳过。用户装上这个版本才拿到修复，所以在发版后关，不在推到 main 时关。
// 用法：node scripts/close-fixed-issues.ts <版本> [--dry-run]（本机运行，要 gh 登录的是仓库所有者的账号）
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((arg) => !arg.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法：node scripts/close-fixed-issues.ts <版本，如 0.1.0> [--dry-run]");
  process.exit(1);
}
const tag = `v${version}`;
const run = (command: string, commandArgs: string[]) =>
  execFileSync(command, commandArgs, { cwd: root, encoding: "utf8" }).trim();

const previous = run("git", ["describe", "--tags", "--abbrev=0", `${tag}^`]);
const subjects = run("git", ["log", "--format=%s", `${previous}..${tag}`]);
const numbers = [...new Set([...subjects.matchAll(/#(\d+)\b/g)].map((match) => match[1] ?? ""))];
const comment = `${tag} 已修复。Fixed in ${tag}.`;

console.log(`${previous}..${tag} 的提交里提到：${numbers.length > 0 ? numbers.map((n) => `#${n}`).join("、") : "无"}`);
for (const number of numbers) {
  // `gh api` 的 issues 接口对 PR 也返回，带 pull_request 字段。
  const [state, isPull] = run("gh", [
    "api",
    `repos/{owner}/{repo}/issues/${number}`,
    "--jq",
    '[.state, (.pull_request != null | tostring)] | join(" ")',
  ]).split(" ");
  if (isPull === "true" || state !== "open") {
    console.log(`#${number}：${isPull === "true" ? "是 PR" : "已关闭"}，跳过`);
    continue;
  }
  if (dryRun) {
    console.log(`[dry-run] #${number}：会回复"${comment}"并关闭`);
    continue;
  }
  run("gh", ["issue", "close", number, "--comment", comment]);
  console.log(`#${number}：已回复并关闭`);
}

// 发版：改版本号 → 把 CHANGELOG 的"未发布"改成这个版本 → 类型检查和单测 → 提交并打 tag → 打安装包和更新目录。
// 用法：npm run release -- <版本，如 0.1.0> [--dry-run]
// 只在本地做，不推送；推送 tag、上传更新目录由仓库所有者决定（AGENTS.md：发版先问）。
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions } from "../src/main/omp-manager/version.ts";
import { promoteUnreleased } from "./changelog.ts";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((arg) => !arg.startsWith("--"));
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法：npm run release -- <版本，如 0.1.0> [--dry-run]");
  process.exit(1);
}
// 经 npm run 启动时 npm 会给出自己的 JS 入口；用 node 直接跑它，不经过 shell（Windows 上 npm 是 .cmd）。
const npmCli = process.env["npm_execpath"];
if (!npmCli) {
  console.error("请用 npm run release 运行（需要 npm_execpath）");
  process.exit(1);
}

const git = (...gitArgs: string[]) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trim();
const npm = (...npmArgs: string[]) =>
  execFileSync(process.execPath, [npmCli, ...npmArgs], { cwd: root, stdio: "inherit" });

if (git("status", "--porcelain") !== "") throw new Error("工作区有未提交的改动，先提交或暂存");
if (git("tag", "--list", `v${version}`) !== "") throw new Error(`tag v${version} 已经存在`);
const pkg: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string")
  throw new Error("package.json 里没有 version");
const current = pkg.version;
if (compareVersions(version, current) < 0) throw new Error(`新版本 ${version} 比当前的 ${current} 还小`);

const changelogPath = path.join(root, "CHANGELOG.md");
const date = new Date().toLocaleDateString("sv-SE"); // 本地日期，YYYY-MM-DD
const changelog = promoteUnreleased(await readFile(changelogPath, "utf8"), version, date);

if (dryRun) {
  console.log(
    `[dry-run] 版本 ${current} → ${version}，CHANGELOG 记为 ${date}；会提交 "chore(release): v${version}"、打 tag v${version}、npm run dist、npm run feed`,
  );
  process.exit(0);
}

// 先检查再改文件：检查失败时工作区还是干净的。
npm("run", "typecheck");
npm("test");
await writeFile(changelogPath, changelog, "utf8");
npm("version", version, "--no-git-tag-version", "--allow-same-version");
git("add", "package.json", "package-lock.json", "CHANGELOG.md");
git("commit", "-m", `chore(release): v${version}`);
git("tag", "-a", `v${version}`, "-m", `v${version}`);
npm("run", "dist");
npm("run", "feed");
console.log(
  `\n已提交并打 tag v${version}（未推送）。安装包在 release\\，更新目录在 ..\\omp-studio-updates\\（装着的旧版本会从这里自动更新）。`,
);

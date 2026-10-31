// 发版：改版本号 → 把 CHANGELOG 的"未发布"改成这个版本 → scripts/check.ts（lint、格式、类型检查、仓库扫描，含"未发布"里的客户端名）
// 和受改动影响的单测 → 提交并打 tag → 打安装包 → 删 release\ 里旧版本的安装包。
// 用法：npm run release -- <版本，如 0.1.0> [--dry-run]
// 只在本地做，不推送。
import { execFileSync } from "node:child_process";
import { access, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions } from "../src/shared/omp-version.ts";
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
    `[dry-run] 版本 ${current} → ${version}，CHANGELOG 记为 ${date}；会提交 "chore(release): v${version}"、打 tag v${version}、npm run dist、删 release\\ 里旧版本的安装包`,
  );
  process.exit(0);
}

// 先检查再改文件：检查失败时工作区还是干净的。
// check.ts 缺本地黑名单时只警告并跳过；发版时 CHANGELOG 会公开，客户端名那份必须在。
await access(path.join(root, ".githooks", "no-mention.local.txt")).catch((error: unknown) => {
  throw new Error("缺 .githooks/no-mention.local.txt，查不了 CHANGELOG 里的第三方客户端名", { cause: error });
});
execFileSync(process.execPath, [path.join(root, "scripts", "check.ts")], { cwd: root, stdio: "inherit" });
// 单测只跑上一个 tag 以来改过的文件影响到的（vitest --changed，按 import 关系算；录制、假 omp、依赖和配置一改就跑全量，
// 见 vitest.config.ts）。还没有 tag 时跑全量。
const lastTag = git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0] ?? "";
npm("test", "--", ...(lastTag === "" ? [] : ["--changed", lastTag, "--passWithNoTests"]));
await writeFile(changelogPath, changelog, "utf8");
npm("version", version, "--no-git-tag-version", "--allow-same-version");
git("add", "package.json", "package-lock.json", "CHANGELOG.md");
git("commit", "-m", `chore(release): v${version}`);
git("tag", "-a", `v${version}`, "-m", `v${version}`);
npm("run", "dist");
// 只留这一版的安装包；差量更新用的旧版本 .blockmap 在之前各版本的 GitHub Release 里。
const releaseDir = path.join(root, "release");
const installer = `omp-studio-${version}-setup.exe`;
const stale = (await readdir(releaseDir)).filter(
  (file) => /^omp-studio-.+-setup\.exe(\.blockmap)?$/.test(file) && !file.startsWith(installer),
);
await Promise.all(stale.map((file) => rm(path.join(releaseDir, file), { force: true })));
// 正斜杠：这条命令会被贴进 bash，反斜杠会被吃掉；node 两种都认。
const assets = ["latest.yml", installer, `${installer}.blockmap`].map((file) => `release/${file}`).join(" ");
console.log(
  `\n已提交并打 tag v${version}（未推送）。推送后上传到 GitHub Release（装着的旧版本从那里自动更新）：\n` +
    `node scripts/publish-release.ts ${version} ${assets}`,
);

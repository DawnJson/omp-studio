// 把安装包传到 GitHub Releases 的 v<版本>：没有这个 Release 就先建（说明取 CHANGELOG.md 里这个版本的一节），再上传文件（同名覆盖）。
// 用法：node scripts/publish-release.ts <版本> <文件...>
// Windows 安装包在本机推送 tag 后传；macOS 的 dmg / zip 由 .github/workflows/mac.yml 在推 tag 时传。两边谁先到谁建 Release。
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { releaseNotes } from "../src/shared/changelog.ts";

const root = path.resolve(import.meta.dirname, "..");
const [version, ...files] = process.argv.slice(2);
if (version === undefined || files.length === 0) {
  throw new Error("用法：node scripts/publish-release.ts <版本> <文件...>");
}
const tag = `v${version}`;
const gh = (...args: string[]) => execFileSync("gh", args, { cwd: root, encoding: "utf8" });

const notes = releaseNotes(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), version);
if (notes === null) throw new Error(`CHANGELOG.md 里没有 ${version} 一节`);

const exists = (): boolean => {
  try {
    gh("release", "view", tag, "--json", "tagName");
    return true;
  } catch {
    return false;
  }
};

if (!exists()) {
  try {
    execFileSync(
      "gh",
      ["release", "create", tag, "--verify-tag", "--title", `omp-studio ${version}`, "--notes-file", "-"],
      {
        cwd: root,
        input: notes,
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
  } catch (error) {
    // 另一边（本机或 CI）刚好同时建好了，接着上传；否则原样抛出。
    if (!exists()) throw error;
  }
}
gh("release", "upload", tag, ...files, "--clobber");
console.log(`已上传到 ${tag}：${files.map((file) => path.basename(file)).join("、")}`);

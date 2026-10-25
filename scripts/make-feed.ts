// 本地验证自动更新用：把 npm run dist 生成的 latest.yml、安装包和 .blockmap 拷进一个目录，
// 装着的旧版本用 STUDIO_UPDATE_URL=<目录> 从这里更新（docs/architecture/auto-update.md "本地验证"）。
// latest.yml 由 electron-builder 按 electron-builder.yml 的 publish 生成；正式发版不用这个脚本，三个文件传到 GitHub Release。
// 用法：node scripts/make-feed.ts <目录>（先 npm run dist）。
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const target = process.argv[2];
if (target === undefined) throw new Error("用法：node scripts/make-feed.ts <目录>");
const out = path.resolve(target);
const pkg: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string")
  throw new Error("package.json 里没有 version");
const installer = `omp-studio-${pkg.version}-setup.exe`;

await mkdir(out, { recursive: true });
for (const file of ["latest.yml", installer, `${installer}.blockmap`]) {
  await copyFile(path.join(root, "release", file), path.join(out, file));
}
console.log(`${out}: ${pkg.version}`);

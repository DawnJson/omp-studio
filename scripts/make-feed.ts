// 生成自动更新的静态目录：把当前版本的安装包、.blockmap 和 latest.yml 放进指定目录。
// 用法：node scripts/make-feed.ts <目录>（先 npm run dist）。
// latest.yml 是 electron-updater 的 generic 源格式；默认构建没有配置 publish，所以自己写。
// releaseNotes 取 CHANGELOG.md 里这个版本的一节（electron-updater 把它放进 UpdateInfo.releaseNotes）。
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { releaseNotes } from "./changelog.ts";

const root = path.resolve(import.meta.dirname, "..");
const out = path.resolve(process.argv[2] ?? path.join(root, "release", "feed"));
const pkg: unknown = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (typeof pkg !== "object" || pkg === null || !("version" in pkg) || typeof pkg.version !== "string")
  throw new Error("package.json 里没有 version");
const version = pkg.version;
const name = `omp-studio-${version}-setup.exe`;
const installer = path.join(root, "release", name);

const size = await stat(installer).then(
  (s) => s.size,
  () => {
    throw new Error(`找不到 ${installer}，先跑 npm run dist`);
  },
);
const sha512 = createHash("sha512")
  .update(await readFile(installer))
  .digest("base64");
const notes = releaseNotes(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), version);
if (notes === null) console.warn(`CHANGELOG.md 里没有 ${version} 一节，latest.yml 不带 releaseNotes`);
const notesYaml =
  notes === null
    ? ""
    : `releaseNotes: |\n${notes
        .split("\n")
        .map((line) => (line === "" ? "" : `  ${line}`))
        .join("\n")}\n`;

await mkdir(out, { recursive: true });
await copyFile(installer, path.join(out, name));
await copyFile(`${installer}.blockmap`, path.join(out, `${name}.blockmap`));
await writeFile(
  path.join(out, "latest.yml"),
  `version: ${version}
files:
  - url: ${name}
    sha512: ${sha512}
    size: ${size}
path: ${name}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
${notesYaml}`,
  "utf8",
);
console.log(`${out}: ${version}（${size} 字节）`);

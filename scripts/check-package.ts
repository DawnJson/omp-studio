// 打包后检查 app.asar 里装了什么：顶层只能是 out/、package.json、node_modules/，node-pty 只带本平台的预编译件。
// 0.4.16 的安装包把整个仓库目录（含 .env、日志、截图）打了进去（electron-builder.yml 里 files 的注释），这里挡住再犯。
// 用法：node scripts/check-package.ts <app.asar 路径> <平台-架构，如 win32-x64>
import { open } from "node:fs/promises";

const [asarPath, target] = process.argv.slice(2);
if (asarPath === undefined || target === undefined) {
  throw new Error("用法：node scripts/check-package.ts <app.asar 路径> <平台-架构>");
}

interface AsarEntry {
  files?: Record<string, AsarEntry>;
}

// asar 文件头：[4 字节 = 4][4 字节 头部大小]，头部是 Chromium Pickle：[4 字节 负载大小][4 字节 JSON 长度][JSON]。
const file = await open(asarPath, "r");
const sizes = Buffer.alloc(16);
await file.read(sizes, 0, 16, 0);
const json = Buffer.alloc(sizes.readUInt32LE(12));
await file.read(json, 0, json.length, 16);
await file.close();
const root = JSON.parse(json.toString("utf8")) as AsarEntry;

const allowed = new Set(["out", "package.json", "node_modules"]);
const extra = Object.keys(root.files ?? {}).filter((name) => !allowed.has(name));
if (extra.length > 0) throw new Error(`app.asar 里有不该打包的东西：${extra.join("、")}`);

const prebuilds = Object.keys(root.files?.["node_modules"]?.files?.["node-pty"]?.files?.["prebuilds"]?.files ?? {});
if (prebuilds.length !== 1 || prebuilds[0] !== target) {
  throw new Error(`node-pty 的预编译件应该只有 ${target}，实际是：${prebuilds.join("、") || "（没有）"}`);
}
console.log(`app.asar 检查通过：顶层 ${Object.keys(root.files ?? {}).join("、")}，node-pty 预编译件 ${target}`);

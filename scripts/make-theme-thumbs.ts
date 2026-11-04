// 主题画廊（设置 → 通用）预览用的插图缩略图：把 src/renderer/styles/themes/<名字>.svg 画成 480×300 的 WebP，
// 产物提交进仓库（src/renderer/styles/themes/thumbs/），旁边的 sources.json 记每张图对应的 SVG 的 sha256。
// 为什么不直接用 SVG：插图里有 feGaussianBlur，画廊里 16 张一起栅格化，GPU 进程每次打开设置都要卡 300–550ms，
// 换页的淡入动画正好被这段卡顿吞掉（2026-11-04 实测，docs/architecture/themes.md「主题画廊的缩略图」）。
// 用法：node scripts/make-theme-thumbs.ts（改了或新增主题插图之后重跑；npm run check 的 theme-thumbs 会提醒）。
// 用仓库里的 Electron（同一个 Chromium）在隐藏窗口的 canvas 上画，和应用里画出来的一致。
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import electronPath from "electron";

const root = path.resolve(import.meta.dirname, "..");
const themesDir = path.join(root, "src", "renderer", "styles", "themes");
const thumbsDir = path.join(themesDir, "thumbs");
const width = 480;
const height = 300;

const names = (await readdir(themesDir)).filter((file) => file.endsWith(".svg")).map((file) => file.slice(0, -4));
const svgs = await Promise.all(names.map((name) => readFile(path.join(themesDir, `${name}.svg`))));

// Electron 主进程脚本：读输入 JSON（SVG 的 base64），在隐藏窗口里逐张画到 canvas，结果（WebP 的 data URL）写进输出 JSON。
const main = `
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const [input, output] = process.argv.slice(-2);
app.whenReady().then(async () => {
  try {
    const job = JSON.parse(fs.readFileSync(input, "utf8"));
    const win = new BrowserWindow({ show: false, width: 200, height: 200 });
    await win.loadURL("about:blank");
    const results = [];
    for (const svg of job.svgs) {
      results.push(await win.webContents.executeJavaScript(\`(async () => {
        const img = new Image();
        img.src = "data:image/svg+xml;base64,\${svg}";
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = \${job.width};
        canvas.height = \${job.height};
        canvas.getContext("2d").drawImage(img, 0, 0, \${job.width}, \${job.height});
        return canvas.toDataURL("image/webp", 0.9);
      })()\`));
    }
    fs.writeFileSync(output, JSON.stringify(results));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
`;

const work = await mkdtemp(path.join(os.tmpdir(), "theme-thumbs-"));
try {
  const mainFile = path.join(work, "main.cjs");
  const input = path.join(work, "input.json");
  const output = path.join(work, "output.json");
  await writeFile(mainFile, main);
  await writeFile(input, JSON.stringify({ width, height, svgs: svgs.map((svg) => svg.toString("base64")) }));
  await promisify(execFile)(electronPath as unknown as string, [mainFile, input, output], { cwd: work });
  const urls = JSON.parse(await readFile(output, "utf8")) as string[];
  await rm(thumbsDir, { recursive: true, force: true });
  await mkdir(thumbsDir);
  const sources: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const url = urls[index] ?? "";
    if (!url.startsWith("data:image/webp;base64,")) throw new Error(`${name}.svg 没有画成 WebP`);
    await writeFile(path.join(thumbsDir, `${name}.webp`), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
    // 按 LF 算（check.ts 的 theme-thumbs 同样）：Windows 上检出成 CRLF 也对得上。
    sources[name] = createHash("sha256").update(svgs[index]!.toString("utf8").replaceAll("\r\n", "\n")).digest("hex");
  }
  await writeFile(path.join(thumbsDir, "sources.json"), `${JSON.stringify(sources, null, 2)}\n`);
  console.log(`已生成 ${names.length} 张 ${width}×${height} 缩略图：src/renderer/styles/themes/thumbs/`);
} finally {
  await rm(work, { recursive: true, force: true, maxRetries: 5 });
}

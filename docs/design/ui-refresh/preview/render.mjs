// 生成五个方向的静态 HTML → 用仓库自带的 Electron 截 1200×800 PNG → 拼对比图（现状 + 五个方向，3 × 2）。
// 用法（仓库根目录）：node docs/design/ui-refresh/preview/render.mjs [方向 id …]
// 对比图里的"现状"取 now-*.png，由 capture-current.ts 从构建产物截取（先 npm run build，再跑它）。
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const htmlDir = join(here, "html");
const shots = join(root, "screenshots", "design-refresh");
const electron = createRequire(join(root, "package.json"))("electron");
const renderMain = join(root, "docs/design/2.6/preview/render-main.cjs");

const files = ["a-ink", "b-phosphor", "c-fluent", "d-graphite", "e-glass", "f-fusion"];
const all = [];
for (const f of files)
  if (existsSync(join(here, f + ".mjs"))) all.push((await import(pathToFileURL(join(here, f + ".mjs")).href)).default);
const only = process.argv.slice(2);
const dirs = only.length ? all.filter((x) => only.includes(x.id)) : all;
const scenes = ["conversation", "empty"];
const themes = ["light", "dark"];

mkdirSync(htmlDir, { recursive: true });
mkdirSync(shots, { recursive: true });

const jobs = [];
for (const dir of dirs)
  for (const s of scenes)
    for (const t of themes) {
      const n = `${dir.id}-${s}-${t}`;
      const html = join(htmlDir, n + ".html");
      writeFileSync(html, dir.render(s, t));
      jobs.push({ html, png: join(shots, n + ".png"), width: 1200, height: 800 });
    }
for (const dir of dirs)
  for (const { name: s, height } of dir.extraScenes ?? [])
    for (const t of themes) {
      const n = `${dir.id}-${s}-${t}`;
      const html = join(htmlDir, n + ".html");
      writeFileSync(html, dir.render(s, t));
      jobs.push({ html, png: join(shots, n + ".png"), width: 1200, height });
    }

// 对比图：每个画面 × 主题一张。compare-*：现状 + A-E，3 + 3 排；fusion-*：现状 | F 两张大图并排。
const sheets = [];
const sheetCss = (w, h, img) =>
  `<style>html{overflow:hidden}body{margin:0;background:#7d8085;font:600 18px "Segoe UI","Microsoft YaHei UI";display:flex;flex-wrap:wrap;gap:16px;padding:16px;width:${w}px;height:${h}px;box-sizing:border-box;overflow:hidden}
figure{margin:0;width:${img}px}figcaption{color:#fff;margin-bottom:6px}img{width:${img}px;display:block;box-shadow:0 2px 10px #0005}</style>`;
if (!only.length)
  for (const s of scenes)
    for (const t of themes) {
      const cell = (label, id) =>
        `<figure><figcaption>${label}</figcaption><img src="${pathToFileURL(join(shots, `${id}-${s}-${t}.png`)).href}"></figure>`;
      const five = all.filter((dir) => dir.id !== "f");
      const html = join(htmlDir, `_sheet-${s}-${t}.html`);
      writeFileSync(
        html,
        `<!doctype html><meta charset="utf-8">${sheetCss(1840, 912, 592)}${cell("现状（实际截图）", "now")}${five.map((dir) => cell(dir.label, dir.id)).join("")}`,
      );
      sheets.push({ html, png: join(shots, `compare-${s}-${t}.png`), width: 1840, height: 912 });
      const fusion = all.find((dir) => dir.id === "f");
      if (fusion === undefined) continue;
      const fhtml = join(htmlDir, `_fusion-${s}-${t}.html`);
      writeFileSync(
        fhtml,
        `<!doctype html><meta charset="utf-8">${sheetCss(1848, 680, 900)}${cell("现状（实际截图）", "now")}${cell(fusion.label, "f")}`,
      );
      sheets.push({ html: fhtml, png: join(shots, `fusion-${s}-${t}.png`), width: 1848, height: 680 });
    }
// 整段对话（窗口拉高到 2000）：现状 | F
if (!only.length && all.some((dir) => dir.id === "f"))
  for (const t of themes) {
    const cell = (label, id) =>
      `<figure><figcaption>${label}</figcaption><img src="${pathToFileURL(join(shots, `${id}-conversation-full-${t}.png`)).href}"></figure>`;
    const html = join(htmlDir, `_fusion-full-${t}.html`);
    writeFileSync(html, `<!doctype html><meta charset="utf-8">${sheetCss(1848, 1580, 900)}${cell("现状（实际截图）", "now")}${cell("F 融合", "f")}`);
    sheets.push({ html, png: join(shots, `fusion-full-${t}.png`), width: 1848, height: 1580 });
  }

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function run(list, name) {
  const f = join(htmlDir, name);
  writeFileSync(f, JSON.stringify(list));
  const r = spawnSync(electron, [renderMain, f], { stdio: "inherit", env });
  rmSync(f, { force: true });
  if (r.status !== 0) throw new Error("electron 渲染失败：" + r.status);
}
run(jobs, "_jobs.json");
if (sheets.length) run(sheets, "_sheets.json");
console.log(`完成：${jobs.length} 张截图 + ${sheets.length} 张对比图 → ${shots}`);

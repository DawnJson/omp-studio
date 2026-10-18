// 生成 HTML → Electron 截 1200×800 PNG → 每个画面拼一张对比图。
// 用法（仓库根目录）：node docs/design/2.6/preview/render.mjs
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, outDir, dirs, locales, themes, screensFor, baseName } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const shots = join(root, "screenshots", "design-2.6");
const electron = createRequire(join(root, "package.json"))("electron");

build();
mkdirSync(shots, { recursive: true });

const jobs = [];
for (const d of dirs)
  for (const s of screensFor(d))
    for (const l of locales)
      for (const t of themes) {
        const n = baseName(d, s, l, t);
        jobs.push({ html: join(outDir, n + ".html"), png: join(shots, n + ".png"), width: 1200, height: 800 });
      }

// 对比图：同一画面（conversation / empty / settings）× 语言 × 主题，A | B | Mix 三列
const sheetHtml = [];
for (const s of ["conversation", "empty", "settings"])
  for (const l of locales)
    for (const t of themes) {
      const img = (d) => pathToFileURL(join(shots, baseName(d, s, l, t) + ".png")).href;
      const html = join(here, "html", `_sheet-${s}-${l}-${t}.html`);
      const cell = (label, d) => `<figure><figcaption>${label}</figcaption><img src="${img(d)}"></figure>`;
      writeFileSync(
        html,
        `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#888;font:600 16px "Segoe UI","Microsoft YaHei UI";display:flex;gap:12px;padding:12px;width:1800px;height:440px;box-sizing:border-box}
figure{margin:0;width:580px}figcaption{color:#fff;margin-bottom:6px}img{width:580px;display:block;outline:1px solid #0004}</style>
${cell("A 仪表 / Instrument", "a")}${cell("B 工作台 / Workbench", "b")}${cell("Mix", "mix")}`,
      );
      sheetHtml.push({ html, png: join(shots, `compare-${s}-${l}-${t}.png`), width: 1800, height: 440 });
    }

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // 变量存在（哪怕为空）electron 也会当 node 跑

function run(list, name) {
  const f = join(here, "html", name);
  writeFileSync(f, JSON.stringify(list));
  const r = spawnSync(electron, [join(here, "render-main.cjs"), f], { stdio: "inherit", env });
  rmSync(f, { force: true });
  if (r.status !== 0) throw new Error("electron 渲染失败：" + r.status);
}
run(jobs, "_jobs.json");
run(sheetHtml, "_sheets.json");
console.log(`完成：${jobs.length} 张截图 + ${sheetHtml.length} 张对比图 → ${shots}`);

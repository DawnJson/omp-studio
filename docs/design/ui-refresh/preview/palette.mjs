// 3.0 主色调的几个候选：在 3.0 定稿稿（f-fusion.mjs）上只换颜色，其余不动。只是预览，不进应用。
// 用法（仓库根目录）：node docs/design/ui-refresh/preview/palette.mjs
// 候选都取自标志 π 的渐变（粉 #f84fcc → 紫 #9362f4 → 蓝 #28bae8），灰阶跟着主色换色相（饱和度和明度照现在的矿物灰），
// "新增"的绿色和主色分开（现在的 --diff-add-fg 直接用了松石绿，换主色后要单独给绿）。
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import f from "./f-fusion.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const htmlDir = join(here, "html");
const shots = join(root, "screenshots", "design-refresh");
const electron = createRequire(join(root, "package.json"))("electron");
const renderMain = join(root, "docs/design/2.6/preview/render-main.cjs");

/** 每个候选：浅色 / 深色两套变量（f-fusion.mjs 里的变量名）。对比度见 direction-3.0.md §2。 */
const options = [
  {
    id: "teal",
    name: "松石绿（现在）",
    note: "π 里没有这个颜色",
    light: {},
    dark: {},
  },
  {
    id: "violet",
    name: "鸢尾紫（π 中段）",
    note: "和标志同一色系，最协调",
    light:
      neutrals("#EEEDF0 #F9F8FA #F2F1F4 #131118 #4E4B56 #625F6A", "19,17,24") +
      "--accent:#6B46D9;--accent-soft:rgba(107,70,217,.1);--bubble:#ECE8F8;--add:#1F7A3F",
    dark:
      neutrals("#0C0B0E #121115 #0F0E12 #E8E6EC #A6A3AF #827F8B", "232,230,236", "#18171C") +
      "--accent:#A48BFF;--accent-soft:rgba(164,139,255,.15);--bubble:#251F38;--add:#5FCB86",
  },
  {
    id: "blue",
    name: "天蓝（π 尾端）",
    note: "最稳妥，但 IDE 和别的 agent 桌面端常见",
    light:
      neutrals("#EDEEF0 #F8F9FA #F1F2F4 #111418 #4B5056 #5F646A", "17,20,24") +
      "--accent:#1F68D1;--accent-soft:rgba(31,104,209,.1);--bubble:#E4EDF9;--add:#1F7A3F",
    dark:
      neutrals("#0B0C0E #111315 #0E1012 #E6E9EC #A3A8AF #7F848B", "230,233,236", "#17191C") +
      "--accent:#5BA4F5;--accent-soft:rgba(91,164,245,.15);--bubble:#1A2638;--add:#5FCB86",
  },
  {
    id: "magenta",
    name: "品红（π 起头）",
    note: "最有辨识度，也最跳",
    light:
      neutrals("#F0EDEF #FAF8F9 #F4F1F3 #181116 #564B52 #6A5F66", "24,17,22") +
      "--accent:#B8318E;--accent-soft:rgba(184,49,142,.09);--bubble:#F7E6F1;--add:#1F7A3F",
    dark:
      neutrals("#0E0B0D #151114 #120E11 #ECE6EA #AFA3AB #8B7F87", "236,230,234", "#1C171A") +
      "--accent:#F06BC8;--accent-soft:rgba(240,107,200,.15);--bubble:#35192C;--add:#5FCB86",
  },
];

/** 灰阶：窗口 / 主区 / 凹陷 / 三级文字；线和悬停用文字色的透明度（同现在的做法）。 */
function neutrals(list, rgb, raised = "#FFFFFF") {
  const [win, app, sunken, tx, tx2, tx3] = list.split(" ");
  const dark = raised !== "#FFFFFF";
  const a = (x) => `rgba(${rgb},${x})`;
  return (
    `--win:${win};--app:${app};--raised:${raised};--sunken:${sunken};--tx:${tx};--tx2:${tx2};--tx3:${tx3};--primary:${tx};` +
    `--hover:${a(0.05)};--active:${a(0.085)};--bd-s:${a(dark ? 0.06 : 0.08)};--bd:${a(dark ? 0.11 : 0.14)};--bd2:${a(dark ? 0.2 : 0.26)};--ring-track:${a(dark ? 0.18 : 0.16)};`
  );
}

const themes = ["light", "dark"];
mkdirSync(htmlDir, { recursive: true });
mkdirSync(shots, { recursive: true });
const jobs = [];
for (const o of options)
  for (const theme of themes)
    for (const scene of ["conversation", "empty"]) {
      const vars = o[theme];
      const override = Object.keys(vars).length ? `<style>:root[data-theme=${theme}]{${vars}}</style>` : "";
      const html = f.render(scene, theme).replace("</head>", `${override}</head>`);
      const file = join(htmlDir, `_palette-${o.id}-${scene}-${theme}.html`);
      writeFileSync(file, html);
      jobs.push({ html: file, png: join(shots, `palette-${o.id}-${scene}-${theme}.png`), width: 1200, height: 800 });
    }

// 对比图：每个主题一张，四个候选各一列，上对话、下新任务页
const cellW = 600;
for (const theme of themes) {
  const col = (o) =>
    `<figure><figcaption><b>${o.name}</b><span>${o.note}</span></figcaption>${["conversation", "empty"]
      .map((s) => `<img src="${pathToFileURL(join(shots, `palette-${o.id}-${s}-${theme}.png`)).href}">`)
      .join("")}</figure>`;
  const html = `<!doctype html><meta charset="utf-8"><style>html{overflow:hidden}body{margin:0;background:#7d8085;font:600 18px "Segoe UI","Microsoft YaHei UI";display:flex;gap:16px;padding:16px;width:${cellW * 4 + 16 * 5}px;height:${400 * 2 + 70}px;box-sizing:border-box;overflow:hidden}
figure{margin:0;width:${cellW}px}figcaption{color:#fff;margin-bottom:6px;display:flex;gap:10px;align-items:baseline}figcaption span{font-weight:400;font-size:14px;opacity:.85}
img{width:${cellW}px;display:block;margin-bottom:8px;box-shadow:0 2px 10px #0005}</style><body>${options.map(col).join("")}</body>`;
  const file = join(htmlDir, `_palette-sheet-${theme}.html`);
  writeFileSync(file, html);
  jobs.push({ html: file, png: join(shots, `palette-${theme}.png`), width: cellW * 4 + 16 * 5, height: 400 * 2 + 70 });
}

const list = join(htmlDir, "_palette.json");
writeFileSync(list, JSON.stringify(jobs));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [renderMain, list], { stdio: "inherit", env });
rmSync(list, { force: true });
if (r.status !== 0) throw new Error("electron 渲染失败：" + r.status);
console.log("完成 -> " + join(shots, "palette-{light,dark}.png"));

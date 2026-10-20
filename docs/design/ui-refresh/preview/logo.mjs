// omp-studio 标志的几个方案，照"omp 相对 pi 怎么改"的做法再往前走一步。只是预览，不进应用。
// 用法（仓库根目录）：node docs/design/ui-refresh/preview/logo.mjs
//
// pi（pi.dev/logo-auto.svg）：3×4 方格上三块俄罗斯方块似的色块（珊瑚红 / 蓝 / 黄）拼成 π。
// omp（oh-my-pi assets/hero.png、终端启动画面）：
//   - 留下 π 的方块骨架：直角、粗细一致、左腿短右腿长（pi 的黄块本来就落得更低）；
//   - 块数从 3 减到 2（横 + 左腿一体，右腿单独），去掉方格的拼图感；
//   - 三个平涂色换成一条连续渐变（粉 → 紫 → 蓝），成为自己的颜色；
//   - 终端里用块字符画同一个 π，左腿最下一格是 ▒；旧版 icon.svg 还在右腿上插了一个插头（"插件 / 自带电池"）。
// omp-studio 照同样三步：骨架原样继承 omp 的 π；颜色接着 omp 渐变的末端（蓝）往下走到应用的松石绿；
// 再加一个只属于"桌面端"的记号。
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");
const htmlDir = join(here, "html");
const shots = join(root, "screenshots", "design-refresh");
const electron = createRequire(join(root, "package.json"))("electron");
const renderMain = join(root, "docs/design/2.6/preview/render-main.cjs");

/* ───────── π 的骨架：按 omp hero 的比例量出来（横 178×35，腿宽 37，左腿 25 起，右腿 98 起，左腿下伸 91，右腿 135），缩到 100 格 ───────── */
const G = { x: 10, y: 14, w: 80, bar: 16, lx: 21, rx: 54, leg: 17, lb: 70, rb: 88 };

/** 渐变：omp 最后两格的蓝（#4d9cec、#28bae8）接到应用的松石绿（tokens.css 深色 --accent #3fcbae、浅色 #0b7a66）。 */
const grad = (id, dir = "x1='0' y1='0' x2='1' y2='1'") =>
  `<linearGradient id="${id}" ${dir}><stop offset="0" stop-color="#4D9CEC"/><stop offset=".45" stop-color="#28BAE8"/><stop offset=".8" stop-color="#2DC4A8"/><stop offset="1" stop-color="#14A386"/></linearGradient>`;
/** omp 原色，对照用 */
const ompGrad = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F84FCC"/><stop offset=".5" stop-color="#A55FED"/><stop offset="1" stop-color="#28BAE8"/></linearGradient>`;

const piPath = (g = G) =>
  `M${g.x} ${g.y}h${g.w}v${g.bar}H${g.lx + g.leg}V${g.lb}H${g.lx}V${g.y + g.bar}H${g.x}Z M${g.rx} ${g.y + g.bar}h${g.leg}V${g.rb}H${g.rx}Z`;

let uid = 0;
const svg = (size, body, defs = "", vb = "0 0 100 100") =>
  `<svg width="${size}" height="${size}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${body}</svg>`;

/* ───────── 方案 ───────── */
const options = [
  {
    id: "relay",
    name: "1 接力",
    note: "骨架和 omp 一模一样，只换颜色：omp 的渐变停在蓝，这里从那个蓝接着走到应用的松石绿。和 omp 关系最近，差别也最小。",
    mark(size) {
      const id = "g" + uid++;
      return svg(size, `<path d="${piPath()}" fill="url(#${id})"/>`, grad(id));
    },
  },
  {
    id: "window",
    name: "2 窗口",
    note: "π 的横就是窗口的标题栏，左端挖出三个窗口圆点（omp 旧图标在横的两端也有两颗点）；左腿 = 侧栏，右腿 = 对话。说的是\u201c这是 omp 的桌面窗口\u201d。",
    mark(size) {
      const id = "g" + uid++;
      const m = "m" + uid++;
      const dots = [0, 1, 2].map((i) => `<circle cx="${G.x + 7 + i * 6.5}" cy="${G.y + G.bar / 2}" r="2.3" fill="#000"/>`).join("");
      return svg(
        size,
        `<path d="${piPath()}" fill="url(#${id})" mask="url(#${m})"/>`,
        grad(id) + `<mask id="${m}"><rect width="100" height="100" fill="#fff"/>${dots}</mask>`,
      );
    },
  },
  {
    id: "talk",
    name: "3 对话",
    note: "右腿下端收成对话气泡的尖角（和新界面里你的消息气泡同一个角），说的是\u201c把 omp 变成一段对话\u201d。其余照 omp。",
    mark(size) {
      const id = "g" + uid++;
      const r = 3;
      const { rx, leg, y, bar, rb } = G;
      // 右腿：上方直角接横，左下圆角，右下伸出一个向右下的尖角
      const right = `M${rx} ${y + bar}h${leg}V${rb + 6}L${rx + leg - 7} ${rb}H${rx + r}Q${rx} ${rb} ${rx} ${rb - r}Z`;
      const left = `M${G.x} ${y}h${G.w}v${bar}H${G.lx + leg}V${G.lb}H${G.lx}V${y + bar}H${G.x}Z`;
      return svg(size, `<path d="${left} ${right}" fill="url(#${id})"/>`, grad(id));
    },
  },
  {
    id: "pixel",
    name: "4 像素",
    note: "照 omp 终端启动画面的块字符 π（新任务页现在用的就是它），保留左腿最下一格的 ▒，颜色换成蓝到松石绿；右腿旁边加一格光标，说的是\u201c终端里的 omp 搬到了窗口里\u201d。",
    mark(size) {
      // 12 列 × 5 行，每格 1 宽 2 高（和 PixelLogo.tsx 一样），整体 12 × 10，居中放进 100 格
      const rows = [
        "############",
        "...##..##...",
        "...##..##...",
        "...%%..##...",
        ".......##.c.",
      ];
      const stops = ["#4D9CEC", "#3FA7EA", "#28BAE8", "#26C0CF", "#2DC4A8", "#14A386"];
      const u = 6.4,
        ox = (100 - 12 * u) / 2,
        oy = (100 - 10 * u) / 2;
      let out = "";
      rows.forEach((row, ry) =>
        [...row].forEach((c, x) => {
          const color = stops[Math.min(stops.length - 1, Math.floor((x / 11) * 3 + ry * 0.75))];
          const X = ox + x * u,
            Y = oy + ry * 2 * u;
          if (c === "#") out += `<rect x="${X}" y="${Y}" width="${u + 0.05}" height="${2 * u + 0.05}" fill="${color}"/>`;
          if (c === "%")
            for (const [dx, dy] of [[0, 0], [0.5, 0.5], [0, 1], [0.5, 1.5]])
              out += `<rect x="${X + dx * u}" y="${Y + dy * u}" width="${u / 2}" height="${u / 2}" fill="${color}"/>`;
          if (c === "c") out += `<rect x="${X}" y="${Y + 0.3 * u}" width="${u * 0.9}" height="${1.6 * u}" fill="#2DC4A8" opacity=".85"/>`;
        }),
      );
      return svg(size, out, "", "0 0 100 100").replace("<svg ", '<svg shape-rendering="crispEdges" ');
    },
  },
];

/* ───────── 一张对照：pi → omp → omp-studio 各方案 ───────── */
function lineage() {
  const pi = `<svg width="120" height="120" viewBox="0 0 800 800"><path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z"/><path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"/><path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z"/></svg>`;
  const id = "g" + uid++;
  const omp = svg(120, `<path d="${piPath()}" fill="url(#${id})"/>`, ompGrad(id));
  return `<div class="lin"><figure>${pi}<figcaption>pi</figcaption></figure><span class="arr">→</span><figure>${omp}<figcaption>omp</figcaption></figure><span class="arr">→</span>${options
    .map((o) => `<figure>${o.mark(120)}<figcaption>${o.name}</figcaption></figure>`)
    .join("")}</div>`;
}

/** 应用图标：深色圆角方块上放标志（Windows 任务栏 / 开始菜单），并按真实像素大小画 48 / 32 / 24 / 16 */
const tile = (o, size) =>
  `<span class="tile" style="width:${size}px;height:${size}px;border-radius:${size * 0.22}px">${o.mark(Math.round(size * 0.78))}</span>`;

const lockup = (o, theme) =>
  `<span class="lock">${o.mark(44)}<span class="wm" style="color:${theme === "dark" ? "#E6ECEA" : "#111816"}">omp<span>studio</span></span></span>`;

function row(o) {
  return `<section class="row"><div class="info"><h2>${o.name}</h2><p>${o.note}</p></div>
    <div class="cell light">${o.mark(150)}</div>
    <div class="cell dark">${o.mark(150)}</div>
    <div class="cell icons">${tile(o, 96)}<span class="sizes">${[48, 32, 24, 16].map((s) => tile(o, s)).join("")}</span></div>
    <div class="cell locks"><div class="lk light">${lockup(o, "light")}</div><div class="lk dark">${lockup(o, "dark")}</div></div>
  </section>`;
}

const css = `*{box-sizing:border-box;margin:0;padding:0}
body{width:1600px;background:#E9ECEB;font:14px/1.6 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;color:#111816;padding:28px 32px}
h1{font:600 22px "Segoe UI Variable Display","Microsoft YaHei UI";margin-bottom:4px}
.sub{color:#4B5652;margin-bottom:18px;max-width:1400px}
.lin{display:flex;align-items:center;gap:22px;background:#fff;border-radius:14px;padding:18px 24px;margin-bottom:20px}
.lin figure{display:flex;flex-direction:column;align-items:center;gap:6px}
.lin figcaption{font-size:13px;color:#4B5652}
.lin .arr{font-size:26px;color:#9AA3A0}
.row{display:grid;grid-template-columns:300px 190px 190px 330px 1fr;gap:14px;align-items:stretch;margin-bottom:14px}
.info h2{font:600 17px "Segoe UI Variable Display","Microsoft YaHei UI";margin:6px 0 6px}
.info p{color:#4B5652;font-size:13px;line-height:1.7}
.cell{border-radius:14px;display:flex;align-items:center;justify-content:center;padding:16px;min-height:190px}
.light{background:#F8FAF9;box-shadow:0 0 0 1px rgba(17,24,22,.08)}
.dark{background:#111514}
.icons{background:#fff;gap:22px;box-shadow:0 0 0 1px rgba(17,24,22,.08)}
.sizes{display:flex;align-items:flex-end;gap:12px}
.tile{display:grid;place-items:center;background:linear-gradient(160deg,#1C2321,#0B0E0D);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.tile svg{display:block}
.locks{flex-direction:column;gap:10px;padding:10px;background:transparent}
.lk{width:100%;flex:1;border-radius:12px;display:flex;align-items:center;justify-content:center}
.lock{display:flex;align-items:center;gap:14px}
.wm{font:650 34px/1 "Segoe UI Variable Display","Segoe UI",sans-serif;letter-spacing:-.02em}
.wm span{font-weight:350;opacity:.62;margin-left:8px}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>omp-studio 标志方案</h1>
<p class="sub">做法照 omp 对 pi：骨架继承上一代（直角、等粗、左腿短右腿长），颜色换成自己的（omp 的渐变停在蓝，这里从蓝接到应用的松石绿），再加一个说明身份的记号。每行：浅底 / 深底 / 应用图标（96 及实际像素 48·32·24·16）/ 标志 + 字。</p>
${lineage()}
${options.map(row).join("")}
</body></html>`;

mkdirSync(htmlDir, { recursive: true });
const file = join(htmlDir, "logo.html");
writeFileSync(file, html);
const jobs = join(htmlDir, "_logo.json");
writeFileSync(jobs, JSON.stringify([{ html: file, png: join(shots, "logo-options.png"), width: 1600, height: 1150 }]));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [renderMain, jobs], { stdio: "inherit", env });
rmSync(jobs, { force: true });
if (r.status !== 0) throw new Error("electron 渲染失败：" + r.status);
console.log("完成 → " + join(shots, "logo-options.png"));

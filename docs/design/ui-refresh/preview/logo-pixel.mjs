// omp-studio 标志：在应用现在的像素标志（src/renderer/src/ui/PixelLogo.tsx，新任务页那个）上抽象地带出"studio"。
// 形状、逐格颜色、▒、像素字 "omp studio"、版本号全部照 PixelLogo.tsx 原样；每个方案只做一处加减。只是预览，不进应用。
// 用法（仓库根目录）：node docs/design/ui-refresh/preview/logo-pixel.mjs
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

/* ───────── 和 PixelLogo.tsx 完全一致的数据 ───────── */
const PI = [
  ["#f84fcc", "#ef51d0", "#e652d3", "#dc54d7", "#d356db", "#ca58de", "#c159e2", "#b85be5", "#af5de9", "#a55fed", "#9c60f0", "#9362f4"].map((c) => [c, "#"]),
  [null, null, null, ["#c359e1", "#"], ["#ba5be5", "#"], null, null, ["#9e60ef", "#"], ["#9562f3", "#"]],
  [null, null, null, ["#aa5eeb", "#"], ["#a15fef", "#"], null, null, ["#7f72f2", "#"], ["#727ef0", "#"]],
  [null, null, null, ["#9065f4", "%"], ["#8270f2", "%"], null, null, ["#5a91ee", "#"], ["#4d9cec", "#"]],
  [null, null, null, null, null, null, null, ["#35afea", "#"], ["#28bae8", "#"]],
];
const GLYPHS = {
  o: ["", "", ".XX.", "X..X", "X..X", ".XX."],
  m: ["", "", "XX.X.", "X.X.X", "X.X.X", "X.X.X"],
  p: ["", "", "XXX.", "X..X", "X..X", "XXX.", "X...", "X..."],
  s: ["", "", ".XXX", "XX..", "..XX", "XXX."],
  t: ["", ".X.", "XXX", ".X.", ".X.", ".XX"],
  u: ["", "", "X..X", "X..X", "X..X", ".XXX"],
  d: ["...X", "...X", ".XXX", "X..X", "X..X", ".XXX"],
  i: ["X", "", "X", "X", "X", "X"],
};
const TEXT_X = 12 + 7;

/** π 的每一格：列、行（一格 1 宽 2 高）、颜色、"#" 实块或 "%" ▒；part 用来拆件 */
const CELLS = PI.flatMap((row, r) =>
  row.flatMap((cell, c) => (cell ? [{ c, r, color: cell[0], kind: cell[1], part: r === 0 ? (c <= 6 ? "barL" : "barR") : c <= 4 ? "left" : "right" }] : [])),
);

const cellRects = (cell, dx = 0, dy = 0, extra = "") => {
  const x = cell.c + dx,
    y = cell.r * 2 + dy;
  if (cell.kind === "#") return `<rect x="${x}" y="${y}" width="1" height="2" fill="${cell.color}"${extra}/>`;
  return [0, 0.5, 1, 1.5].map((d) => `<rect x="${x + (d % 1)}" y="${y + d}" width=".5" height=".5" fill="${cell.color}"${extra}/>`).join("");
};

function word(text, startX) {
  let x = startX,
    d = "";
  [...text].forEach((ch, i) => {
    const rows = GLYPHS[ch];
    rows.forEach((row, y) => [...row].forEach((k, col) => k === "X" && (d += `M${x + col} ${y}h1v1h-1z`)));
    x += Math.max(...rows.map((r) => r.length)) + (i < text.length - 1 ? 1 : 0);
  });
  return { d, end: x };
}
const OMP = word("omp", TEXT_X);
const STUDIO = word("studio", OMP.end + 3);
const FULL_W = STUDIO.end;

/* ───────── 方案：each 返回 { pi: π 部分的 svg 片段, deco: 额外装饰（相对整幅标志坐标）, box: π 单独做图标时的取景 } ───────── */
const T = { light: { tx: "#111816", tx2: "#4B5652", tx3: "#5F6A66", line: "rgba(17,24,22,.32)" }, dark: { tx: "#E6ECEA", tx2: "#A3AFAB", tx3: "#7F8B87", line: "rgba(230,236,234,.3)" } };

const concepts = [
  {
    name: "0 现在",
    idea: "应用现在新任务页的标志，原样照搬，作对照。",
    pi: () => CELLS.map((c) => cellRects(c)).join(""),
    box: [0, 0, 12, 10],
  },
  {
    name: "1 拾起一格",
    idea: "横最右那一格被拎起来，悬在右上方一格高的地方。像一块正在被摆上去的零件——studio 是做东西的地方，π 还在被拼。π 的轮廓几乎不变，16px 也看得出。",
    pi: () =>
      CELLS.map((c) => (c.r === 0 && c.c === 11 ? cellRects(c, 1, -3) : cellRects(c))).join(""),
    box: [0, -3, 13, 13],
  },
  {
    name: "2 层叠",
    idea: "π 身后错开一个像素多一层同色的淡影，像后面还叠着一个窗口。终端里的 π 只有一层，到了桌面上多了一层。",
    pi: () => CELLS.map((c) => cellRects(c, 1, 1, ' opacity=".32"')).join("") + CELLS.map((c) => cellRects(c)).join(""),
    box: [0, 0, 13, 11],
  },
  {
    name: "3 拆件",
    idea: "π 沿着接缝拆成三块，各留一像素缝：横的左半连左腿、横的右半、右腿。pi 的标志是三块拼的，omp 合成一块，studio 把它摊开在工作台上。逐格颜色不变，渐变仍是连着的。",
    pi: () =>
      CELLS.map((c) => (c.part === "barR" ? cellRects(c, 1, 0) : c.part === "right" ? cellRects(c, 1, 1) : cellRects(c))).join(""),
    box: [0, 0, 13, 11],
  },
  {
    name: "4 取景框",
    idea: "整个标志四角加 L 形角标，像取景器 / 画框：omp 被放进一个画面里。omp 官方 hero 图的四角就有这种角标。π 和字本身不动。",
    pi: () => CELLS.map((c) => cellRects(c)).join(""),
    frame: true,
    box: [0, 0, 12, 10],
  },
  {
    name: "5 舞台",
    idea: "标志站在一条地平线上，右腿在线下投出两格渐隐的 ▒ 倒影：studio 是演播室 / 舞台，omp 上台了。",
    pi: () =>
      CELLS.map((c) => cellRects(c)).join("") +
      CELLS.filter((c) => c.r === 4)
        .map((c) => `<rect x="${c.c}" y="11" width=".5" height=".5" fill="${c.color}" opacity=".55"/><rect x="${c.c + 0.5}" y="11.5" width=".5" height=".5" fill="${c.color}" opacity=".55"/><rect x="${c.c}" y="12.5" width=".5" height=".5" fill="${c.color}" opacity=".25"/>`)
        .join(""),
    floor: true,
    box: [0, 0, 12, 13],
  },
];

/* ───────── 画 ───────── */
function lockup(k, theme, unit = 6) {
  const t = T[theme];
  let x0 = -1,
    y0 = -1,
    x1 = FULL_W + 1,
    y1 = 11;
  if (k.box[1] < 0) y0 = k.box[1] - 1;
  if (k.floor) y1 = 14;
  let deco = "";
  if (k.frame) {
    x0 = -4;
    y0 = -4;
    x1 = FULL_W + 4;
    y1 = 14;
    const L = 3;
    for (const [cx, cy, sx, sy] of [[x0 + 1, y0 + 1, 1, 1], [x1 - 2, y0 + 1, -1, 1], [x0 + 1, y1 - 2, 1, -1], [x1 - 2, y1 - 2, -1, -1]]) {
      deco += `<rect x="${sx > 0 ? cx : cx - L + 1}" y="${cy}" width="${L}" height="1" fill="${t.tx3}"/>`;
      deco += `<rect x="${cx}" y="${sy > 0 ? cy : cy - L + 1}" width="1" height="${L}" fill="${t.tx3}"/>`;
    }
  }
  if (k.floor) deco += `<rect x="-1" y="10" width="${FULL_W + 2}" height=".5" fill="${t.line}"/>`;
  const w = x1 - x0,
    h = y1 - y0;
  return `<svg width="${w * unit}" height="${h * unit}" viewBox="${x0} ${y0} ${w} ${h}" shape-rendering="crispEdges">${deco}${k.pi()}<path d="${OMP.d}" fill="${t.tx}"/><path d="${STUDIO.d}" fill="${t.tx2}"/><text x="${TEXT_X}" y="9.6" font-size="1.9" fill="${t.tx3}" style="font-family:Consolas,monospace">v0.3.14</text></svg>`;
}

/** 只要 π（应用图标）：取 box，左右补齐成正方形 */
function mark(k, px, theme) {
  const [bx, by, bw, bh] = k.box;
  const s = Math.max(bw, bh) + 2;
  const x0 = bx - (s - bw) / 2,
    y0 = by - (s - bh) / 2;
  let deco = "";
  if (k.frame) {
    const c = T[theme].tx3;
    const a = x0 + 0.0,
      b = y0 + 0.0,
      e = x0 + s - 1,
      f = y0 + s - 1;
    for (const [x, y, w, h] of [[a, b, 2, 1], [a, b, 1, 2], [e - 1, b, 2, 1], [e, b, 1, 2], [a, f, 2, 1], [a, f - 1, 1, 2], [e - 1, f, 2, 1], [e, f - 1, 1, 2]])
      deco += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
  }
  if (k.floor) deco += `<rect x="${x0 + 0.5}" y="10" width="${s - 1}" height=".5" fill="${T[theme].line}"/>`;
  return `<svg width="${px}" height="${px}" viewBox="${x0} ${y0} ${s} ${s}" shape-rendering="crispEdges">${deco}${k.pi()}</svg>`;
}

const tile = (k, size) => `<span class="tile" style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.2)}px">${mark(k, Math.round(size * 0.82), "dark")}</span>`;

const row = (k) => `<section class="row"><div class="info"><h2>${k.name}</h2><p>${k.idea}</p></div>
  <div class="cell light">${lockup(k, "light", 5)}</div>
  <div class="cell dark">${lockup(k, "dark", 5)}</div>
  <div class="cell icons">${tile(k, 72)}${tile(k, 40)}${tile(k, 24)}${tile(k, 16)}</div></section>`;

const css = `*{box-sizing:border-box;margin:0;padding:0}
body{width:1600px;background:#E9ECEB;font:14px/1.6 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",sans-serif;color:#111816;padding:26px 32px}
svg{display:block}
h1{font:600 22px "Segoe UI Variable Display","Microsoft YaHei UI";margin-bottom:4px}
.sub{color:#4B5652;margin-bottom:16px;font-size:13px}
.row{display:grid;grid-template-columns:330px 1fr 1fr 250px;gap:12px;margin-bottom:12px}
.info h2{font:600 16px "Segoe UI Variable Display","Microsoft YaHei UI";margin:4px 0}
.info p{color:#4B5652;font-size:12.5px;line-height:1.7}
.cell{border-radius:12px;display:flex;align-items:center;justify-content:center;min-height:150px}
.light{background:#F8FAF9;box-shadow:0 0 0 1px rgba(17,24,22,.08)}
.dark{background:#111514}
.icons{background:#fff;gap:14px;align-items:flex-end;padding-bottom:30px;box-shadow:0 0 0 1px rgba(17,24,22,.08)}
.tile{display:grid;place-items:center;background:linear-gradient(160deg,#241a2c,#0f0a14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>omp-studio 标志：在现在的像素标志上带出"studio"</h1>
<p class="sub">底子 = 应用新任务页现在的像素标志（PixelLogo.tsx：omp 终端启动画面的块字符 π，逐格粉→紫→蓝，左腿底一格 ▒，像素字 omp studio + 版本号），形状和颜色都不改。每行：浅底 / 深底 / 只用 π 做应用图标（72·40·24·16，深底同 omp 官网图标）。</p>
${concepts.map(row).join("")}
</body></html>`;

mkdirSync(htmlDir, { recursive: true });
const file = join(htmlDir, "logo-pixel.html");
writeFileSync(file, html);
const jobs = join(htmlDir, "_logo-pixel.json");
writeFileSync(jobs, JSON.stringify([{ html: file, png: join(shots, "logo-studio.png"), width: 1600, height: 1110 }]));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const r = spawnSync(electron, [renderMain, jobs], { stdio: "inherit", env });
rmSync(jobs, { force: true });
if (r.status !== 0) throw new Error("electron 渲染失败：" + r.status);
console.log("完成 → " + join(shots, "logo-studio.png"));

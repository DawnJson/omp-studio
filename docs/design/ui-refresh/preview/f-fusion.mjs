// 方向 F「融合」第 3 版 = 3.0 改版的定稿稿，和 docs/design/direction-3.0.md 逐项一致（两边不一致时以文档为准）：
//   色板 = 现有 token（矿物灰 + 松石绿），新加 --bg-bubble / --radius-bubble / --radius-composer；
//   顶栏左上 = 像素标志（π + 层叠淡影 + 像素字 omp studio，和新任务页同一个）；
//   侧栏顶部 = 三行：新任务 Ctrl N / 搜索（还是那个过滤输入框，画成一行）/ 打开文件夹；
//   任务行 = 四种状态各有各的点：进行中（绿点 + 光晕）、等你确认（琥珀菱形）、已完成（空心圈）、失败（红点）；选中 = 浮起的白底；
//   你的消息 = 淡绿气泡；过程 = 现状（工具卡默认展开）；
//   改动卡片 = 文件图标 + 路径 + 保留 +31 −6 + git diff --stat 式的 +/− 条；
//   状态行右边 = "后台任务""子代理"两个按钮；输入框 = 大圆角、无分隔线、圆形发送（--primary），圆环不写百分比；
//   列宽 840（现状）。新任务页 = 现状。功能不变。
import { D, icon, ring, winctl, doc, FONT } from "./common.mjs";
import { DotSphere } from "../../../../src/renderer/src/features/composer/dot-sphere.ts";

const css = `
:root{--sans:${FONT.sans};--display:${FONT.display};--serif:${FONT.serifCjk};--mono:${FONT.mono};--stroke:1.7}
:root[data-theme=light]{--win:#EDF0EF;--app:#F8FAF9;--raised:#FFFFFF;--sunken:#F1F4F3;--hover:rgba(17,24,22,.05);--active:rgba(17,24,22,.085);--bd-s:rgba(17,24,22,.08);--bd:rgba(17,24,22,.14);--bd2:rgba(17,24,22,.26);
  --tx:#111816;--tx2:#4B5652;--tx3:#5F6A66;--accent:#0B7A66;--accent-soft:rgba(11,122,102,.1);--bubble:#E3EFEB;--primary:#111816;--on-primary:#fff;
  --wait:#B76E00;--wait-tx:#8E5A00;--wait-soft:rgba(183,110,0,.1);--err:#B42E2E;--add:#0B7A66;--del:#B42E2E;--ring-track:rgba(17,24,22,.16);
  --sh-comp:0 1px 2px rgba(17,24,22,.04),0 8px 28px rgba(17,24,22,.08)}
:root[data-theme=dark]{--win:#0B0E0D;--app:#111514;--raised:#171C1A;--sunken:#0E1211;--hover:rgba(230,236,234,.05);--active:rgba(230,236,234,.085);--bd-s:rgba(230,236,234,.06);--bd:rgba(230,236,234,.11);--bd2:rgba(230,236,234,.2);
  --tx:#E6ECEA;--tx2:#A3AFAB;--tx3:#7F8B87;--accent:#3FCBAE;--accent-soft:rgba(63,203,174,.14);--bubble:#1B2A26;--primary:#E6ECEA;--on-primary:#0B0E0D;
  --wait:#F0B545;--wait-tx:#F0B545;--wait-soft:rgba(240,181,69,.12);--err:#F27373;--add:#3FCBAE;--del:#F27373;--ring-track:rgba(230,236,234,.18);
  --sh-comp:0 0 0 1px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.4)}
body{font-size:13px}
.win{display:grid;grid-template-columns:264px 1fr;grid-template-rows:40px 1fr;width:1200px;height:800px;background:var(--win)}

/* 顶栏：侧栏那一格放 A 的字标，主区那一格放标题 + 分支 / 评审 / 终端 */
.brand{display:flex;align-items:center;padding-left:14px}
.brand .ib{margin-left:auto;margin-right:8px;display:flex;gap:2px;color:var(--tx2)}
.brand .ib span,.top .ib{width:28px;height:28px;border-radius:6px;display:grid;place-items:center;color:var(--tx2)}
.top{display:flex;align-items:center;gap:6px;padding-left:12px}
.top h1{font:600 13.5px/20px var(--sans);color:var(--tx)}
.top .sp{flex:1}
.br{display:flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:6px;border:1px solid var(--bd-s);font:12px var(--mono);color:var(--tx2);margin-right:4px}
.br em{font-style:normal;color:var(--accent)}
.top .vr{width:1px;height:16px;background:var(--bd);margin:0 6px}

/* 侧栏 */
.side{display:flex;flex-direction:column;padding:6px 10px 8px;min-height:0}
.act{display:flex;align-items:center;gap:10px;height:30px;padding:0 8px;border-radius:6px;color:var(--tx)}
.act .ico{color:var(--tx2)}
.act kbd{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.act.search{color:var(--tx3)}
.strip{display:flex;align-items:center;gap:8px;height:30px;margin-top:8px;padding:0 10px;border-radius:6px;background:var(--wait-soft);color:var(--wait-tx);font-size:12.5px}
.strip i{width:7px;height:7px;background:var(--wait);transform:rotate(45deg)}
.grp{display:flex;align-items:center;gap:6px;margin:16px 4px 4px;font-size:12px;color:var(--tx2);font-weight:500}
.grp .ico{color:var(--tx3)}
.grp .n{margin-left:auto;color:var(--tx3);display:flex}
.tk{display:flex;align-items:center;gap:10px;height:30px;padding:0 8px 0 10px;border-radius:7px;color:var(--tx2)}
.tk .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tk.unread .t{color:var(--tx)}
.tk .w{font:11px var(--mono);color:var(--tx3)}
.tk.on{background:var(--raised);color:var(--tx);box-shadow:0 0 0 1px var(--bd-s),0 1px 2px rgba(17,24,22,.05)}
.dot{width:8px;height:8px;border-radius:50%;flex:none;margin:0 3px}
.dot.run{background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.dot.wait{width:8px;height:8px;border-radius:1px;transform:rotate(45deg);background:var(--wait)}
.dot.done{border:1.5px solid var(--tx2)}
.dot.err{background:var(--err)}
.dot.none{visibility:hidden}
.hh{display:flex;align-items:center;margin:18px 4px 4px;font-size:12px;color:var(--tx2);font-weight:500}
.seg{margin-left:auto;display:flex;padding:2px;border-radius:6px;background:var(--hover);font-size:11px}
.seg span{padding:0 7px;line-height:18px;border-radius:4px;color:var(--tx2)}
.seg span.on{background:var(--raised);color:var(--tx);box-shadow:0 0 0 1px var(--bd-s)}
.foot{margin-top:auto;display:flex;align-items:center;gap:10px;height:34px;padding:0 8px;color:var(--tx)}
.foot .ico{color:var(--tx2)}
.foot .r{margin-left:auto;display:flex;gap:14px;color:var(--tx2)}

/* 主区 */
.panel{position:relative;margin:0 8px 8px 0;border-radius:12px;background:var(--app);border:1px solid var(--bd-s);overflow:hidden}
.scroll{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:166px;overflow:hidden}
.col{width:840px;margin:0 auto}
.bub{display:flex;justify-content:flex-end;margin-top:22px}
.bub div{max-width:85%;background:var(--bubble);color:var(--tx);padding:10px 14px;border-radius:14px 14px 4px 14px;font-size:15px;line-height:24px}
/* 过程：照抄现状（conversation.css 的 .process-row / .step-tool / .step-output），默认展开，每次工具调用单独一张卡，不合并 */
.ph{display:flex;align-items:center;gap:6px;margin:12px 0 0 -6px;height:28px;padding:0 6px;color:var(--tx3);font-size:12px}
.stool{margin-top:8px}
.ph + .stool,.bub + .stool{margin-top:12px}
.shead{display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;font-size:12px;color:var(--tx2);white-space:nowrap}
.shead .si{width:14px;display:grid;place-items:center;color:var(--tx3)}
.shead b{color:var(--tx);font-weight:600}
.shead .a{padding:0 4px;font-family:var(--mono);color:var(--tx3)}
.shead .a.lnk{color:var(--accent)}
.shead .m{margin-left:auto;display:flex;align-items:center;gap:6px;color:var(--tx3);font-variant-numeric:tabular-nums}
.sout{margin-top:4px;padding:8px 12px;border:1px solid var(--bd-s);border-radius:6px;background:var(--sunken);font:12px/18px var(--mono);color:var(--tx);white-space:pre-wrap}
.spin{width:10px;height:10px;border-radius:50%;border:2px solid var(--bd2);border-top-color:var(--accent)}
.prose{margin-top:12px;font-size:15px;line-height:26px;color:var(--tx)}
.prose code{background:var(--sunken);border:1px solid var(--bd-s);padding:0 5px;border-radius:5px;font-size:.86em}
.prose ul{list-style:none;margin-top:2px}
.prose li{position:relative;padding-left:18px}
.prose li::before{content:"";position:absolute;left:5px;top:11px;width:5px;height:5px;border-radius:50%;background:var(--tx3)}
/* 改动卡片：功能和现状（ChangeCard.tsx）一样——折叠箭头、打开评审、⋯ 菜单、点文件打开、目录淡名字实、超过 5 个折成"还有 N 个"；
 * 只换外观：D 的文件图标 + B 的行数和 +/− 条 */
.chg{margin-top:14px;border-radius:10px;background:var(--raised);border:1px solid var(--bd-s);overflow:hidden}
.chg .h{display:flex;align-items:center;gap:8px;height:40px;padding:0 8px 0 10px;font-size:13px;font-weight:600;color:var(--tx)}
.chg .h .cv{color:var(--tx3)}
.chg .h .go{margin-left:auto;display:flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:6px;border:1px solid var(--bd);font-weight:500;font-size:12.5px}
.chg .h .more{width:26px;height:26px;display:grid;place-items:center;color:var(--tx2)}
.chg .r{display:flex;align-items:center;gap:10px;height:32px;padding:0 14px;border-top:1px solid var(--bd-s);font:12.5px var(--mono);color:var(--tx)}
.chg .r .ico{color:var(--tx2)}
.chg .r .dir{color:var(--tx3)}
.chg .r .n{margin-left:auto;font-size:12px;white-space:nowrap}
.chg .r .bar{width:24ch;font-size:12px;white-space:nowrap;letter-spacing:-.3px}
.bar i{font-style:normal;color:var(--add)}
.bar s{text-decoration:none;color:var(--del)}
.add{color:var(--add);font-family:var(--mono);font-weight:500}
.del{color:var(--del);font-family:var(--mono);font-weight:500}

/* 输入框上方的状态行（现状）+ 右侧两个按钮；输入框（E 的形状，实心） */
.dock{position:absolute;left:0;right:0;bottom:0;padding:24px 0 14px;background:linear-gradient(transparent,var(--app) 26%)}
.rs{width:840px;margin:0 auto 8px;display:flex;align-items:center;gap:8px;height:26px;padding:0 6px;font-size:12px;color:var(--tx2)}
.rs svg.sphere{width:16px;height:16px;color:var(--accent)}
.rs b{font:600 12px var(--mono);color:var(--tx)}
.rs .vr{width:1px;height:12px;background:var(--bd)}
.rs .btns{margin-left:auto;display:flex;gap:6px}
.pill{display:flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:6px;border:1px solid var(--bd);background:var(--raised);color:var(--tx);font-size:12px}
.pill .ico{color:var(--tx2)}
.pill .c{display:flex;align-items:center;gap:4px;font:600 11.5px var(--mono)}
.pill .c i{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.pill .c.d{color:var(--tx3);font-weight:400}
.comp{width:840px;margin:0 auto;border-radius:22px;padding:6px 6px 6px 8px;background:var(--raised);border:1px solid var(--bd);box-shadow:var(--sh-comp)}
.comp .in{display:flex;align-items:center;height:42px;padding:0 10px;font-size:14.5px;color:var(--tx3)}
.comp .bar2{display:flex;align-items:center;gap:6px;height:36px}
.cbtn{width:30px;height:30px;border-radius:15px;display:grid;place-items:center;color:var(--tx2)}
.chip{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;background:var(--hover);font-size:12.5px;color:var(--tx)}
.chip .ico{color:var(--tx2)}
.chip .k{color:var(--accent)}
.meta{display:flex;align-items:center;gap:8px;margin-left:auto;padding-right:6px;font:11.5px var(--mono);color:var(--tx2)}
.chip.path{font:12px var(--mono);color:var(--tx2);background:none;padding:0 4px}
.send{width:32px;height:32px;border-radius:16px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary)}
.send.off{background:var(--hover);color:var(--tx3)}

/* 新任务页：现状 */
.hero{position:absolute;inset:0;display:grid;place-items:center;padding-bottom:70px}
`;

/* ───────── 两个图形：像素标志（照 PixelLogo.tsx：π + 层叠淡影 + 字和 π 上下居中）、点阵球（dot-sphere.ts 的一帧） ───────── */
const PI = [
  [
    "#f84fcc",
    "#ef51d0",
    "#e652d3",
    "#dc54d7",
    "#d356db",
    "#ca58de",
    "#c159e2",
    "#b85be5",
    "#af5de9",
    "#a55fed",
    "#9c60f0",
    "#9362f4",
  ].map((c) => [c, "#"]),
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
function word(text, startX) {
  let x = startX,
    d = "";
  [...text].forEach((ch, i) => {
    const rows = GLYPHS[ch];
    rows.forEach((row, y) => [...row].forEach((c, col) => c === "X" && (d += `M${x + col} ${y}h1v1h-1z`)));
    x += Math.max(...rows.map((r) => r.length)) + (i < text.length - 1 ? 1 : 0);
  });
  return { d, end: x };
}
/** unit = 每像素几 CSS 像素；顶栏 2、新任务页 6（带版本号）。 */
function pixelLogo(unit = 6, version = true) {
  const textY = 1;
  const omp = word("omp", 19),
    studio = word("studio", omp.end + 3);
  const pi = (dx, dy) => {
    let cells = "";
    PI.forEach((row, ry) =>
      row.forEach((cell, x) => {
        if (!cell) return;
        const [c, k] = cell;
        cells +=
          k === "#"
            ? `<rect x="${x + dx}" y="${ry * 2 + dy}" width="1" height="2" fill="${c}"/>`
            : [0, 0.5, 1, 1.5]
                .map(
                  (sy) => `<rect x="${x + dx + (sy % 1)}" y="${ry * 2 + dy + sy}" width=".5" height=".5" fill="${c}"/>`,
                )
                .join("");
      }),
    );
    return cells;
  };
  const ver = version
    ? `<text x="19" y="10.4" font-size="1.9" fill="var(--tx3)" style="font-family:var(--mono)">v0.3.14</text>`
    : "";
  return `<svg width="${studio.end * unit}" height="${11 * unit}" viewBox="0 0 ${studio.end} 11" shape-rendering="crispEdges"><g opacity=".32">${pi(1, 1)}</g>${pi(0, 0)}<g transform="translate(0 ${textY})"><path d="${omp.d}" fill="var(--tx)"/><path d="${studio.d}" fill="var(--tx2)"/></g>${ver}</svg>`;
}
const sphere = () =>
  `<svg class="sphere" viewBox="0 0 16 16">${new DotSphere(() => 0.37)
    .frame(900)
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${p.r.toFixed(2)}" opacity="${p.opacity.toFixed(2)}" fill="currentColor"/>`,
    )
    .join("")}</svg>`;

/* ───────── 侧栏 / 顶栏 ───────── */
// 四种状态各有各的点；blog 里两个旧任务是做完、已读的（空心圈，标题淡色）。
const dotOf = (st) => (st === "idle" ? "done" : st);
const unread = (t) => t.st === "wait" || t.st === "done";
function side(activeOn) {
  return `<aside class="side">
    <div class="act search">${icon("search", 15)}搜索任务和会话</div>
    <div class="act">${icon("compose", 15)}新任务<kbd>Ctrl N</kbd></div>
    <div class="act">${icon("folderPlus", 15)}打开文件夹</div>
    <div class="strip"><i></i>1 个任务在等你 · ${D.project}</div>
    ${D.projects
      .map(
        (p) =>
          `<div class="grp">${icon("chevD", 13)}${p.name}<span class="n">${icon("plus", 14)}</span></div>` +
          p.tasks
            .map(
              (t) =>
                `<div class="tk ${t.active && activeOn ? "on" : ""} ${unread(t) ? "unread" : ""}"><span class="dot ${dotOf(t.st)}"></span><span class="t">${t.t}</span><span class="w">${t.st === "wait" ? "" : t.when}</span></div>`,
            )
            .join(""),
      )
      .join("")}
    <div class="hh">历史会话<span class="seg"><span class="on">文件夹</span><span>时间</span></span></div>
    <div class="tk">${icon("chevR", 13)}<span class="t">${D.project}</span><span class="w">${D.history}</span></div>
    <div class="foot">${icon("gear", 15)}设置<span class="r">${icon("globe", 15)}${icon("contrast", 15)}</span></div>
  </aside>`;
}
const brand = `<div class="brand">${pixelLogo(2, false)}<span class="ib"><span>${icon("sidebar", 16)}</span><span>${icon("info", 16)}</span></span></div>`;
const top = (title, conv) =>
  `<header class="top"><h1>${title}</h1><span class="sp"></span>${
    conv
      ? `<span class="br">${icon("branch", 13)}${D.branch} <em>↑${D.ahead}</em></span><span class="ib">${icon("diff", 16)}</span>`
      : ""
  }<span class="ib">${icon("terminal", 16)}</span><span class="vr"></span>${winctl("var(--tx2)")}</header>`;

/* ───────── 对话 ───────── */
/** git diff --stat 式的条：最多 24 格，整张卡按改动最多的文件同比例缩小，不为 0 的一边至少 1 格。 */
const diffbar = (a, d, max) => {
  const k = Math.min(1, 24 / max);
  const n = (v) => (v === 0 ? 0 : Math.max(1, Math.round(v * k)));
  return `<span class="bar"><i>${"+".repeat(n(a))}</i><s>${"−".repeat(n(d))}</s></span>`;
};
// 一次工具调用 = 头部一行（图标、工具名、参数、耗时）+ 有输出时下面一块输出。数据和 capture-current.ts 里的现状截图相同。
const tool = (ic, name, arg, { link = false, out = null, meta = "4.0s" } = {}) =>
  `<div class="stool"><div class="shead"><span class="si">${icon(ic, 14)}</span><b>${name}</b><span class="a ${link ? "lnk" : ""}">${arg}</span><span class="m">${meta}</span></div>${
    out === null ? "" : `<div class="sout">${out}</div>`
  }</div>`;

const composer = (ph, running, project) => `<div class="comp"><div class="in">${ph}</div>
  <div class="bar2"><span class="cbtn">${icon("plus", 17)}</span><span class="chip">${D.model} · <span class="k">${D.think}</span>${icon("chevD", 12)}</span><span class="chip">${icon("shield", 13)}${D.approval}${icon("chevD", 12)}</span>${
    project ? `<span class="chip path">${icon("folder", 13)}${D.path}</span>` : ""
  }
  <span class="meta">${ring(running ? D.ctx : 0, 16, 2.4, "var(--ring-track)", "var(--accent)")}${running ? D.cost : "$0.00"}</span>
  <span class="send ${running ? "" : "off"}">${running ? icon("stop", 14) : icon("up", 16)}</span></div></div>`;

function conversation() {
  return `<section class="panel"><div class="scroll"><div class="col">
    <div class="bub"><div>${D.u1}</div></div>
    <div class="ph">${icon("chevD", 14)}已工作 ${D.proc.dur} · ${D.proc.tools} 次工具调用 · ${D.proc.agents} 个子代理</div>
    ${tool("search", "Grep", "src", { out: "ok" })}
    ${tool("file", "Read", "form.ts", { link: true, out: "ok" })}
    ${tool("file", "Read", "submit.ts", { link: true, out: "ok" })}
    ${tool("chevR", "Task", '<span style="font-family:var(--sans)">1 个代理</span>', { out: "ok" })}
    ${tool("file", "Read", "login.test.ts", { link: true, out: "ok" })}
    ${tool("pen", "Edit", "form.ts", { link: true })}
    ${tool("pen", "Edit", "submit.ts", { link: true })}
    ${tool("file", "Write", "login.test.ts", { link: true, out: "ok" })}
    ${tool("terminal", "Bash", "npm test", { out: "$ npm test\nok" })}
    ${tool("file", "Read", "form.ts", { link: true, out: "ok" })}
    ${tool("terminal", "Bash", "npm run lint", { out: "$ npm run lint\nok" })}
    ${tool("terminal", "Bash", "npm test", { out: "$ npm test\nok" })}
    <div class="prose">${D.lead}<ul>${D.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
    <div class="chg"><div class="h"><span class="cv">${icon("chevD", 14)}</span>${D.files.length} 个文件已更改<span class="add">+${D.add}</span><span class="del">−${D.del}</span><span class="go">打开评审</span><span class="more">${icon("more", 16)}</span></div>
      ${D.files
        .map((f) => {
          const i = f.p.lastIndexOf("/") + 1;
          const max = Math.max(...D.files.map((x) => x.a + x.d));
          return `<div class="r">${icon("file", 14)}<span><span class="dir">${f.p.slice(0, i)}</span>${f.p.slice(i)}</span><span class="n"><span class="add">+${f.a}</span> <span class="del">−${f.d}</span></span>${diffbar(f.a, f.d, max)}</div>`;
        })
        .join("")}</div>
    <div class="bub"><div>${D.u2}</div></div>
    ${tool("pen", "Edit", "messages.ts", { link: true, meta: '<span class="spin"></span>41.7s' })}
  </div></div>
  <div class="dock"><div class="rs">${sphere()}<b>42s</b><span class="vr"></span>${D.live.verb} ${D.live.target}
    <span class="btns"><span class="pill">${icon("terminal", 13)}后台任务<span class="c"><i></i>1</span></span><span class="pill">${icon("users", 13)}子代理<span class="c d">✓ 1</span></span></span></div>
    ${composer(D.ph, true, false)}</div></section>`;
}

function empty() {
  return `<section class="panel"><div class="hero">${pixelLogo(6)}</div><div class="dock">${composer(D.emptyPh, false, true)}</div></section>`;
}

export default {
  id: "f",
  label: "3.0 定稿稿",
  /** 只有 F 有：窗口拉高到 2000，看整段对话（过程全部展开）有多长，对照 now-conversation-full-*.png。 */
  extraScenes: [{ name: "conversation-full", height: 2000 }],
  render(scene, theme) {
    const conv = scene !== "empty";
    const tall = scene === "conversation-full" ? "html,body,.win{height:2000px}" : "";
    const body = `<div class="win">${brand}${top(conv ? D.title : "新任务", conv)}${side(conv)}${conv ? conversation() : empty()}</div>`;
    return doc(theme, css + tall, body);
  },
};

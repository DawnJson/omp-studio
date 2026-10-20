// 方向 E「玻璃」：iOS / macOS 26 的 Liquid Glass 语言搬到 Windows。
// 依据：WWDC25「Meet Liquid Glass」与 Apple「Adopting Liquid Glass」——玻璃只给导航层（侧栏、工具栏、输入框），
// 内容层保持实底；不叠玻璃；圆角同心；只给主操作上色；颜色取 iOS 系统色（systemBlue 等）和分组背景。
import { D, icon, ring, winctl, doc, FONT } from "./common.mjs";

const css = `
:root{--sans:${FONT.notoSans};--display:${FONT.notoDisplay};--mono:${FONT.mono};--stroke:1.9}
:root[data-theme=light]{--win:#E9EDF5;--wall:radial-gradient(60% 50% at 8% 12%,rgba(0,122,255,.38),transparent 70%),radial-gradient(50% 45% at 0% 88%,rgba(175,82,222,.32),transparent 70%),radial-gradient(40% 40% at 26% 55%,rgba(255,149,0,.22),transparent 70%),radial-gradient(60% 60% at 100% 100%,rgba(90,200,250,.25),transparent 70%);
  --glass:rgba(255,255,255,.52);--glass-bd:rgba(255,255,255,.75);--glass-hl:inset 0 1px 0 rgba(255,255,255,.9),inset 0 -1px 0 rgba(255,255,255,.35);--glass-sh:0 0 0 .5px rgba(0,0,0,.07),0 12px 40px rgba(20,30,60,.12);
  --bg:#FFFFFF;--grp:#F2F2F7;--fill:rgba(118,118,128,.12);--fill2:rgba(120,120,128,.16);--sep:rgba(60,60,67,.18);--tx:#000000;--tx2:rgba(60,60,67,.62);--tx3:rgba(60,60,67,.34);
  --blue:#007AFF;--blue-soft:rgba(0,122,255,.13);--green:#34C759;--orange:#FF9500;--red:#FF3B30;--indigo:#5856D6;--gray:#8E8E93;--ring-track:rgba(120,120,128,.2);--bubble-tx:#FFFFFF}
:root[data-theme=dark]{--win:#0A0C14;--wall:radial-gradient(60% 50% at 8% 12%,rgba(10,132,255,.45),transparent 70%),radial-gradient(50% 45% at 0% 88%,rgba(191,90,242,.38),transparent 70%),radial-gradient(40% 40% at 26% 55%,rgba(255,159,10,.2),transparent 70%),radial-gradient(60% 60% at 100% 100%,rgba(100,210,255,.18),transparent 70%);
  --glass:rgba(30,30,34,.5);--glass-bd:rgba(255,255,255,.14);--glass-hl:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -1px 0 rgba(255,255,255,.04);--glass-sh:0 0 0 .5px rgba(0,0,0,.5),0 12px 40px rgba(0,0,0,.45);
  --bg:#000000;--grp:#1C1C1E;--fill:rgba(118,118,128,.24);--fill2:rgba(118,118,128,.32);--sep:rgba(84,84,88,.6);--tx:#FFFFFF;--tx2:rgba(235,235,245,.62);--tx3:rgba(235,235,245,.32);
  --blue:#0A84FF;--blue-soft:rgba(10,132,255,.22);--green:#30D158;--orange:#FF9F0A;--red:#FF453A;--indigo:#5E5CE6;--gray:#8E8E93;--ring-track:rgba(118,118,128,.35);--bubble-tx:#FFFFFF}
body{font-size:15px;line-height:22px;letter-spacing:-.005em}
.win{position:relative;width:1200px;height:800px;background:var(--win);overflow:hidden}
.wall{position:absolute;inset:0;background:var(--wall);filter:blur(10px)}
.glass{background:var(--glass);backdrop-filter:blur(40px) saturate(1.8);border:1px solid var(--glass-bd);box-shadow:var(--glass-hl),var(--glass-sh)}

/* 侧栏：漂浮的玻璃面板，圆角与窗口同心 */
.side{position:absolute;left:8px;top:8px;bottom:8px;width:272px;border-radius:26px;padding:14px 10px 10px;display:flex;flex-direction:column}
.sh{display:flex;align-items:center;gap:10px;padding:2px 6px 0 8px;height:32px}
.appi{width:28px;height:28px;border-radius:8px;background:linear-gradient(160deg,#5AC8FA 0%,#007AFF 45%,#5856D6 100%);display:grid;place-items:center;color:#fff;font:700 16px/1 var(--display);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 2px 6px rgba(0,60,180,.3)}
.sh b{font:600 16px/1 var(--display);letter-spacing:-.01em}
.sh .ic{margin-left:auto;display:flex;gap:4px}
.sh .ic span{width:30px;height:30px;border-radius:15px;display:grid;place-items:center;color:var(--blue)}
.find{display:flex;align-items:center;gap:7px;height:36px;margin:12px 4px 4px;padding:0 10px;border-radius:18px;background:var(--fill);color:var(--tx2);font-size:15px}
.sec{display:flex;align-items:center;gap:6px;margin:16px 10px 4px;font:600 13px/18px var(--sans);color:var(--tx2)}
.sec .chev{margin-left:auto;color:var(--blue)}
.row{display:flex;align-items:center;gap:10px;height:38px;padding:0 10px;border-radius:12px;font-size:14.5px}
.row .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.row .w{font-size:12.5px;color:var(--tx2)}
.row.on{background:var(--blue-soft)}
.row.on .t{font-weight:600}
.row.on .w{color:var(--blue)}
.sg{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;flex:none}
.sg.wait{background:var(--orange);color:#fff}
.sg.err{background:var(--red);color:#fff}
.sg.done{color:var(--gray)}
.sg.wait svg,.sg.err svg{stroke-width:3.2}
.aiv{width:18px;height:18px;flex:none}
.tile{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:#fff;flex:none}
.sfoot{margin-top:auto;display:flex;flex-direction:column;gap:2px}
.sfoot .row{height:44px}
.sfoot .w{display:flex;align-items:center;gap:2px}

/* 内容层：实底面板，大圆角 */
.content{position:absolute;left:288px;top:8px;right:8px;bottom:8px;border-radius:26px;background:var(--bg);overflow:hidden;box-shadow:0 0 0 .5px rgba(0,0,0,.08)}
.tbar{position:absolute;top:10px;left:16px;right:150px;display:flex;align-items:center;gap:8px;z-index:3}
.cap{display:flex;align-items:center;height:40px;border-radius:20px;padding:0 4px}
.cap span{height:32px;min-width:32px;padding:0 10px;border-radius:16px;display:flex;align-items:center;justify-content:center;gap:6px;color:var(--tx);font-size:14px}
.cap .mono{font-size:12.5px}
.cap em{font-style:normal;color:var(--blue)}
.edge{position:absolute;left:0;right:0;top:0;height:64px;background:linear-gradient(var(--bg) 40%,transparent);z-index:2}
.winwrap{position:absolute;right:8px;top:8px;z-index:4;border-top-right-radius:26px;overflow:hidden}
.scroll{position:absolute;inset:0;overflow:hidden}
.col{width:720px;margin:0 auto;padding-top:58px}
.lt{font:700 30px/36px var(--display);letter-spacing:-.02em}
.lsub{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13.5px;color:var(--tx2)}
.lsub .pill{display:flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:12px;background:var(--blue-soft);color:var(--blue);font-weight:600;font-size:12.5px}
.bub{display:flex;justify-content:flex-end;margin-top:16px}
.bub div{max-width:520px;background:var(--blue);color:var(--bubble-tx);padding:9px 15px;border-radius:20px;font-size:15px;line-height:22px}
.cell{display:flex;align-items:center;gap:12px;margin-top:12px;padding:0 14px 0 12px;height:54px;border-radius:18px;background:var(--grp)}
.cell .tt{font-size:15px;font-weight:600;line-height:20px}
.cell .ds{font-size:13px;color:var(--tx2);line-height:18px}
.cell .chev{margin-left:auto;color:var(--tx3)}
.prose{margin-top:12px;font-size:15px;line-height:26px}
.prose code{background:var(--grp);padding:1px 6px;border-radius:6px;font-size:.86em}
.prose ul{list-style:none;margin-top:4px}
.prose li{position:relative;padding-left:20px}
.prose li::before{content:"";position:absolute;left:5px;top:10px;width:6px;height:6px;border-radius:50%;background:var(--tx3)}
.gh{margin:14px 0 6px 16px;font-size:13px;color:var(--tx2);display:flex;align-items:center;gap:8px}
.gh .go{margin-left:auto;margin-right:16px;color:var(--blue);display:flex;align-items:center;gap:2px;font-size:14px}
.gh .a{color:var(--green);font-family:var(--mono);font-size:12.5px}
.gh .d{color:var(--red);font-family:var(--mono);font-size:12.5px}
.list{border-radius:18px;background:var(--grp);overflow:hidden}
.li{display:flex;align-items:center;gap:12px;height:42px;padding:0 14px 0 12px;position:relative}
.li + .li::before{content:"";position:absolute;left:52px;right:0;top:0;height:.5px;background:var(--sep)}
.hero .li + .li::before{left:44px}
.li .p{font-size:14.5px}
.li .a{margin-left:auto;font:12.5px var(--mono);color:var(--green)}
.li .d{font:12.5px var(--mono);color:var(--red);width:26px;text-align:right}
.bub.second{margin-top:20px}
.live{display:flex;align-items:center;gap:10px;margin-top:12px;padding-left:4px;font-size:14.5px;color:var(--tx2)}
.live code{color:var(--tx);font-size:13px}
.live .t{margin-left:auto;font:13px var(--mono);color:var(--tx2)}

/* 输入框：底部漂浮的玻璃 */
.dock{position:absolute;left:0;right:0;bottom:0;padding:28px 0 14px;background:linear-gradient(transparent,var(--bg) 45%);z-index:3}
.comp{width:736px;margin:0 auto;border-radius:28px;padding:6px 6px 6px 8px}
.comp .in{display:flex;align-items:center;height:42px;padding:0 10px;font-size:15px;color:var(--tx3)}
.comp .bar{display:flex;align-items:center;gap:6px;height:40px}
.cbtn{width:34px;height:34px;border-radius:17px;display:grid;place-items:center;background:var(--fill);color:var(--tx)}
.chip{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;background:var(--fill);font-size:13.5px;color:var(--tx)}
.chip .ico{color:var(--tx2)}
.meta{display:flex;align-items:center;gap:6px;margin-left:auto;padding-right:6px;font-size:13px;color:var(--tx2)}
.send{width:36px;height:36px;border-radius:18px;display:grid;place-items:center;background:var(--blue);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 4px 12px rgba(0,122,255,.35)}
.send.off{background:var(--fill2);color:var(--tx3);box-shadow:none}

/* 空状态 */
.hero{width:720px;margin:0 auto;padding-top:84px;display:flex;flex-direction:column;align-items:center}
.bigi{width:92px;height:92px;border-radius:24px;background:linear-gradient(160deg,#5AC8FA 0%,#007AFF 45%,#5856D6 100%);display:grid;place-items:center;color:#fff;font:600 50px/1 var(--display);box-shadow:inset 0 2px 0 rgba(255,255,255,.55),inset 0 -6px 16px rgba(40,0,120,.25),0 18px 40px rgba(0,90,220,.32)}
.hero h1{font:700 30px/36px var(--display);margin-top:20px;letter-spacing:-.02em}
.hero .pp{margin-top:4px;font-size:13.5px;color:var(--tx2);display:flex;gap:10px;align-items:center}
.hero .gh{align-self:stretch}
.hero .list{align-self:stretch}
.li .m{margin-left:auto;font-size:13px;color:var(--tx2)}
`;

/** iOS 风格的活动指示器（8 根辐条，逐根变淡） */
const spinner = (s = 18, color = "currentColor") => {
  let g = "";
  for (let i = 0; i < 8; i++)
    g += `<rect x="11" y="2.5" width="2" height="6" rx="1" fill="${color}" opacity="${(1 - i * 0.11).toFixed(2)}" transform="rotate(${-i * 45} 12 12)"/>`;
  return `<svg class="aiv" width="${s}" height="${s}" viewBox="0 0 24 24">${g}</svg>`;
};
const BANG = '<path d="M12 6.5v7M12 17.5h.01"/>';
const sg = (s) =>
  s === "run"
    ? `<span class="sg" style="color:var(--blue)">${spinner(18)}</span>`
    : s === "wait"
      ? `<span class="sg wait"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="3.2">${BANG}</svg></span>`
      : s === "err"
        ? `<span class="sg err">${icon("x", 11)}</span>`
        : s === "done"
          ? `<span class="sg done">${icon("checkC", 20)}</span>`
          : '<span class="sg"></span>';
const tile = (n, bg, s = 16) => `<span class="tile" style="background:${bg}">${icon(n, s)}</span>`;

function side(activeOn) {
  return `<aside class="side glass">
    <div class="sh"><span class="appi">π</span><b>omp studio</b><span class="ic"><span>${icon("sidebar", 19)}</span><span>${icon("compose", 19)}</span></span></div>
    <div class="find">${icon("search", 16)}搜索</div>
    ${D.projects
      .map(
        (p) =>
          `<div class="sec">${p.name}<span class="chev">${icon("chevD", 14)}</span></div>` +
          p.tasks
            .map(
              (t) =>
                `<div class="row ${t.active && activeOn ? "on" : ""}">${sg(t.st)}<span class="t">${t.t}</span><span class="w">${t.when}</span></div>`,
            )
            .join(""),
      )
      .join("")}
    <div class="sfoot"><div class="row">${tile("history", "var(--indigo)")}<span class="t">历史会话</span><span class="w">${D.history}${icon("chevR", 14)}</span></div>
    <div class="row">${tile("gear", "var(--gray)")}<span class="t">设置</span><span class="w">${icon("chevR", 14)}</span></div></div>
  </aside>`;
}

const toolbar = (task) =>
  `<div class="tbar"><span class="sp"></span>${
    task
      ? `<div class="cap glass"><span class="mono">${icon("branch", 15)}${D.branch} <em>↑${D.ahead}</em></span></div><div class="cap glass"><span>${icon("diff", 18)}</span><span>${icon("terminal", 18)}</span><span>${icon("more", 18)}</span></div>`
      : ""
  }</div>`;

const composer = (ph, running) => `<div class="dock"><div class="comp glass"><div class="in">${ph}</div>
  <div class="bar"><span class="cbtn">${icon("plus", 18)}</span><span class="chip">${icon("cpu", 15)}${D.model} · ${D.think}${icon("chevUD", 12)}</span><span class="chip">${icon("shield", 15)}${D.approval}${icon("chevUD", 12)}</span>
  <span class="meta">${ring(running ? D.ctx : 0, 18, 2.4, "var(--ring-track)", "var(--blue)")}${running ? D.ctx : 0}% · ${running ? D.cost : "$0.00"}</span>
  <span class="send ${running ? "" : "off"}">${running ? icon("stop", 16) : icon("up", 18)}</span></div></div></div>`;

function conversation() {
  return `<section class="content">${toolbar(true)}<div class="edge"></div><div class="scroll"><div class="col">
    <div class="lt">${D.title}</div>
    <div class="lsub"><span class="pill">${spinner(13)}运行中</span>${D.project} · ${D.path}</div>
    <div class="bub"><div>${D.u1}</div></div>
    <div class="cell">${tile("hammer", "var(--orange)", 16)}<div><div class="tt">已工作 ${D.proc.dur}</div><div class="ds">${D.proc.tools} 次工具调用 · ${D.proc.agents} 个子代理</div></div><span class="chev">${icon("chevR", 18)}</span></div>
    <div class="prose">${D.lead}<ul>${D.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
    <div class="gh">${D.files.length} 个文件已更改<span class="a">+${D.add}</span><span class="d">−${D.del}</span><span class="go">打开评审${icon("chevR", 15)}</span></div>
    <div class="list">${D.files.map((f) => `<div class="li">${tile("file", "var(--blue)", 15)}<span class="p">${f.p}</span><span class="a">+${f.a}</span><span class="d">${f.d ? "−" + f.d : ""}</span></div>`).join("")}</div>
    <div class="bub second"><div>${D.u2}</div></div>
    <div class="live">${spinner(18)}${D.live.verb} <code>${D.live.target}</code><span class="t">${D.live.t}</span></div>
  </div></div>${composer(D.ph, true)}</section>`;
}

function empty() {
  return `<section class="content">${toolbar(false)}<div class="scroll"><div class="hero">
    <div class="bigi">π</div><h1>${D.project}</h1><div class="pp">${icon("folder", 14)}${D.path} · main</div>
    <div class="gh" style="margin-top:34px">最近</div>
    <div class="list">${D.recent.map((r) => `<div class="li">${sg(r.st)}<span class="p">${r.t}</span><span class="m">${r.meta}</span>${icon("chevR", 16)}</div>`).join("")}</div>
  </div></div>${composer(D.emptyPh, false)}</section>`;
}

export default {
  id: "e",
  label: "E 玻璃 · iOS / Liquid Glass",
  render(scene, theme) {
    const body = `<div class="win"><div class="wall"></div>${side(scene !== "empty")}${scene === "empty" ? empty() : conversation()}<div class="winwrap">${winctl()}</div></div>`;
    return doc(theme, css, body);
  },
};

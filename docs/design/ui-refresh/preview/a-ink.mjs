// 方向 A「墨线」：编辑排版。单一纸面、发丝线分区、你的问题当小节标题（衬线），过程和时间放页边。
import { D, icon, ring, winctl, doc, FONT } from "./common.mjs";

const css = `
:root{--sans:${FONT.sans};--serif:${FONT.serifCjk};--mono:${FONT.mono};--stroke:1.6}
:root[data-theme=light]{--win:#FAFAF7;--card:#FFFFFF;--tx:#15161A;--tx2:#50535B;--tx3:#74777F;--rule:rgba(21,22,26,.09);--rule2:rgba(21,22,26,.24);--sel:rgba(21,22,26,.055);--accent:#2A45C8;--accent-soft:rgba(42,69,200,.08);--wait:#B4600A;--err:#C0362C;--add:#1F7A3F;--del:#C0362C;--codebg:rgba(21,22,26,.055);--ring-track:rgba(21,22,26,.2);--btn:#15161A;--btn-tx:#fff}
:root[data-theme=dark]{--win:#131416;--card:#1A1B1E;--tx:#ECEAE4;--tx2:#A9A8A2;--tx3:#7F7E79;--rule:rgba(236,234,228,.09);--rule2:rgba(236,234,228,.22);--sel:rgba(236,234,228,.06);--accent:#93A6FF;--accent-soft:rgba(147,166,255,.1);--wait:#F0A94A;--err:#F0786C;--add:#6CCB8B;--del:#F0786C;--codebg:rgba(236,234,228,.07);--ring-track:rgba(236,234,228,.22);--btn:#ECEAE4;--btn-tx:#131416}

.win{display:grid;grid-template-columns:252px 1fr;grid-template-rows:40px 1fr;height:800px}
.top{grid-column:1/3;display:flex;align-items:center;border-bottom:1px solid var(--rule)}
.top .brand{width:252px;display:flex;align-items:center;gap:10px;padding-left:18px;height:40px;border-right:1px solid var(--rule)}
.wm{font-family:var(--serif);font-size:18px;letter-spacing:-.01em;font-style:italic;font-weight:600}
.wm b{font-style:normal;color:var(--accent);font-weight:600}
.wm span{font-family:var(--sans);font-style:normal;font-size:12px;color:var(--tx3);letter-spacing:.12em;text-transform:uppercase;margin-left:6px;font-weight:400}
.top .brand .ico{margin-left:auto;margin-right:12px;color:var(--tx3)}
.crumb{display:flex;align-items:baseline;gap:8px;padding-left:24px;font-size:13px;color:var(--tx3)}
.crumb b{font-family:var(--serif);font-size:15px;color:var(--tx);font-weight:600}
.tools{margin-left:auto;display:flex;align-items:center;gap:14px;padding-right:10px;color:var(--tx2);font-size:12px}
.tools .br{display:flex;align-items:center;gap:6px;font-family:var(--mono)}
.tools .br em{font-style:normal;color:var(--accent)}
.tools .vr{width:1px;height:16px;background:var(--rule2)}

.side{border-right:1px solid var(--rule);display:flex;flex-direction:column;padding:14px 12px 10px;min-height:0}
.act{display:flex;align-items:center;gap:10px;height:30px;padding:0 8px;color:var(--tx);font-size:13px}
.act .ico{color:var(--tx2)}
.act kbd{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.lbl{display:flex;align-items:center;margin:20px 8px 6px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3)}
.lbl .n{margin-left:auto;letter-spacing:0;font-family:var(--mono)}
.task{position:relative;display:flex;align-items:center;gap:10px;height:30px;padding:0 8px 0 10px;border-radius:4px;color:var(--tx2)}
.task .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.task .w{font-size:11px;color:var(--tx3);font-family:var(--mono)}
.task.on{background:var(--sel);color:var(--tx)}
.task.on::before{content:"";position:absolute;left:-12px;top:7px;bottom:7px;width:2px;background:var(--accent)}
.st{width:14px;height:14px;display:grid;place-items:center;flex:none}
.st-run{border:1.6px solid var(--accent-soft);border-top-color:var(--accent);border-radius:50%;width:12px;height:12px;margin:1px;border-color:rgba(127,127,127,.25);border-top-color:var(--accent)}
.st-wait i{width:8px;height:8px;background:var(--wait);transform:rotate(45deg)}
.st-done{color:var(--tx3)}
.st-err{color:var(--err)}
.hist{display:flex;align-items:center;gap:10px;height:30px;padding:0 8px;color:var(--tx2);margin-top:14px;border-top:1px solid var(--rule);padding-top:12px;height:42px}
.hist .n{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.foot{margin-top:auto;display:flex;align-items:center;gap:10px;height:34px;padding:0 8px;color:var(--tx2)}
.foot .r{margin-left:auto;display:flex;gap:14px;color:var(--tx3)}

.main{position:relative;min-width:0;overflow:hidden}
.col{width:780px;margin-left:72px}
.turn{display:grid;grid-template-columns:96px 1fr;column-gap:20px}
.mg{font:11px/20px var(--mono);color:var(--tx3);text-align:right;padding-top:7px}
.mg.live{color:var(--accent)}
.q{font-family:var(--serif);font-size:21px;line-height:33px;font-weight:600;color:var(--tx);text-wrap:balance;letter-spacing:.005em}
.proc{display:flex;align-items:center;gap:6px;margin-top:10px;color:var(--tx2);font-size:13px}
.proc .ico{color:var(--tx3)}
.proc .dots{flex:1;border-bottom:1px dotted var(--rule2);margin:0 4px 4px;height:1px;align-self:flex-end}
.prose{font-size:15px;line-height:27px;margin-top:14px;color:var(--tx)}
.prose code{background:var(--codebg);padding:1px 5px;border-radius:3px}
.prose ul{list-style:none;margin-top:6px}
.prose li{position:relative;padding-left:20px}
.prose li::before{content:"—";position:absolute;left:0;color:var(--tx3)}
.chg{margin-top:18px;border-top:1.5px solid var(--tx);border-bottom:1px solid var(--rule2)}
.chg .h{display:flex;align-items:center;gap:12px;height:38px;font-size:13px}
.chg .h .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3)}
.chg .h a{color:var(--accent);display:flex;align-items:center;gap:4px;text-decoration:none}
.chg .r{display:flex;align-items:center;height:30px;border-top:1px solid var(--rule);font:12.5px var(--mono);color:var(--tx2)}
.add{color:var(--add);font-family:var(--mono)}
.del{color:var(--del);font-family:var(--mono)}
.chg .r .add,.chg .r .del{width:44px;text-align:right}
.sep{height:1px;background:var(--rule);margin:30px 0 26px 116px}
.live-row{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:13.5px;color:var(--tx2)}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.caret{display:inline-block;width:7px;height:15px;background:var(--accent);margin-left:2px;vertical-align:-2px;opacity:.8}

.dock{position:absolute;left:0;right:0;bottom:0;padding:28px 0 18px;background:linear-gradient(transparent,var(--win) 30%)}
.dock .col{display:grid;grid-template-columns:96px 1fr;column-gap:20px}
.comp{background:var(--card);border:1px solid var(--rule2);border-radius:6px}
.comp .in{padding:13px 16px 12px;font-size:15px;color:var(--tx3);height:48px}
.comp .bar{display:flex;align-items:center;gap:14px;height:40px;padding:0 6px 0 14px;border-top:1px solid var(--rule);font-size:12.5px;color:var(--tx2)}
.comp .bar .c{display:flex;align-items:center;gap:5px}
.comp .bar .c .ico{color:var(--tx3)}
.comp .bar .m{display:flex;align-items:center;gap:6px;font-family:var(--mono);font-size:11.5px;color:var(--tx3)}
.comp .go{width:30px;height:30px;border-radius:4px;background:var(--btn);color:var(--btn-tx);display:grid;place-items:center}
.comp .go.off{background:var(--sel);color:var(--tx3)}
.hint{font:11px var(--mono);color:var(--tx3);text-align:right;padding-top:14px}

/* 空状态 */
.hero{padding-top:120px}
.hero h1{font-family:var(--serif);font-size:46px;line-height:54px;font-weight:600;letter-spacing:-.015em}
.hero .p{display:flex;gap:14px;margin-top:10px;font:12px var(--mono);color:var(--tx3)}
.hero .p span{display:flex;align-items:center;gap:6px}
.rec{margin-top:44px;border-top:1.5px solid var(--tx)}
.rec .k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3);height:34px;display:flex;align-items:center}
.rec .r{display:flex;align-items:center;gap:12px;height:44px;border-top:1px solid var(--rule);font-size:14.5px}
.rec .r .m{margin-left:auto;font-size:12px;color:var(--tx3)}
.rec .r .ico.go{color:var(--tx3)}
`;

const st = (s) =>
  s === "run"
    ? '<span class="st"><span class="st-run"></span></span>'
    : s === "wait"
      ? '<span class="st st-wait"><i></i></span>'
      : s === "done"
        ? `<span class="st st-done">${icon("check", 13)}</span>`
        : s === "err"
          ? `<span class="st st-err">${icon("x", 13)}</span>`
          : '<span class="st"></span>';

function side(activeOn) {
  const proj = D.projects
    .map(
      (p) =>
        `<div class="lbl">${p.name}<span class="n">${p.tasks.length}</span></div>` +
        p.tasks
          .map(
            (t) =>
              `<div class="task ${t.active && activeOn ? "on" : ""}">${st(t.st)}<span class="t">${t.t}</span><span class="w">${t.when}</span></div>`,
          )
          .join(""),
    )
    .join("");
  return `<aside class="side">
    <div class="act">${icon("compose", 15)}新任务<kbd>Ctrl N</kbd></div>
    <div class="act">${icon("search", 15)}搜索<kbd>Ctrl K</kbd></div>
    ${proj}
    <div class="hist">${icon("history", 15)}历史会话<span class="n">${D.history}</span></div>
    <div class="foot">${icon("gear", 15)}设置<span class="r">${icon("globe", 15)}${icon("contrast", 15)}</span></div>
  </aside>`;
}

function top(title) {
  return `<header class="top">
    <div class="brand"><span class="wm">o<b>m</b>p<span>studio</span></span>${icon("sidebar", 16)}</div>
    <div class="crumb"><span>${D.project}</span><span>/</span><b>${title}</b></div>
    <div class="tools">${
      title === "新任务"
        ? ""
        : `<span class="br">${icon("branch", 14)}${D.branch} <em>↑${D.ahead}</em></span><span class="vr"></span>${icon("diff", 16)}${icon("terminal", 16)}`
    }</div>${winctl()}
  </header>`;
}

const composer = (ph, running) => `<div class="dock"><div class="col"><div class="hint">${running ? "Esc 停止" : "Enter 发送"}</div>
  <div class="comp"><div class="in">${ph}</div>
  <div class="bar"><span class="c">${icon("plus", 15)}</span><span class="c">${D.model} · ${D.think}${icon("chevD", 13)}</span><span class="c">${icon("shield", 14)}${D.approval}${icon("chevD", 13)}</span>
  <span class="sp"></span><span class="m">${ring(running ? D.ctx : 0, 14)}${running ? D.ctx : 0}%</span><span class="m">${running ? D.cost : "$0.00"}</span>
  <span class="go ${running ? "" : "off"}">${running ? icon("stop", 14) : icon("up", 15)}</span></div></div></div></div>`;

function conversation() {
  return `<main class="main"><div class="col" style="padding-top:34px">
    <div class="turn"><div class="mg">14:02</div><div><div class="q">${D.u1}</div>
      <div class="proc">${icon("chevR", 14)}已工作 ${D.proc.dur}<span class="dots"></span>${D.proc.tools} 次工具调用 · ${D.proc.agents} 个子代理</div>
      <div class="prose">${D.lead}<ul>${D.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
      <div class="chg"><div class="h"><span class="k">改动</span><span>${D.files.length} 个文件</span><span class="add">+${D.add}</span><span class="del">−${D.del}</span><span class="sp"></span><a>评审${icon("arrowR", 14)}</a></div>
      ${D.files.map((f) => `<div class="r"><span>${f.p}</span><span class="sp"></span><span class="add">+${f.a}</span><span class="del">${f.d ? "−" + f.d : ""}</span></div>`).join("")}</div>
    </div></div>
    <div class="sep"></div>
    <div class="turn"><div class="mg">14:06</div><div><div class="q">${D.u2}</div>
      <div class="live-row"><span class="pulse"></span>${D.live.verb} <code>${D.live.target}</code><span class="sp"></span><span class="mono" style="font-size:12px;color:var(--accent)">${D.live.t}</span></div>
    </div></div>
  </div>${composer(D.ph, true)}</main>`;
}

function empty() {
  return `<main class="main"><div class="col"><div class="turn"><div></div><div class="hero">
    <h1>${D.project}</h1>
    <div class="p"><span>${icon("folder", 13)}${D.path}</span><span>${icon("branch", 13)}main</span></div>
    <div class="rec"><div class="k">最近</div>
      ${D.recent.map((r) => `<div class="r">${st(r.st)}<span>${r.t}</span><span class="m">${r.meta}</span>${icon("arrowR", 14, "go")}</div>`).join("")}
    </div></div></div></div>${composer(D.emptyPh, false)}</main>`;
}

export default {
  id: "a",
  label: "A 墨线 · 编辑排版",
  render(scene, theme) {
    const body =
      scene === "empty"
        ? `<div class="win">${top("新任务")}${side(false)}${empty()}</div>`
        : `<div class="win">${top(D.title)}${side(true)}${conversation()}</div>`;
    return doc(theme, css, body);
  },
};

// 方向 C「Fluent」：Windows 11 原生。Mica 底、NavigationView 侧栏、标题栏居中搜索、卡片和展开器、系统强调色。
// 颜色取自 WinUI 3 的主题资源（TextFillColor*、CardBackgroundFillColor*、AccentFillColorDefault 等）。
import { D, icon, ring, winctl, doc, FONT } from "./common.mjs";

const css = `
:root{--sans:${FONT.sans};--display:${FONT.display};--mono:${FONT.mono};--stroke:1.5}
:root[data-theme=light]{--win:#EDF1F7;--layer:#F7F8FA;--card:#FFFFFF;--card2:#FBFBFB;--stroke-c:rgba(0,0,0,.0578);--stroke-b:rgba(0,0,0,.1);--div:rgba(0,0,0,.08);--tx:#1B1B1B;--tx2:#5E5E5E;--tx3:#8A8A8A;--subtle:rgba(0,0,0,.0373);--subtle2:rgba(0,0,0,.0241);--accent:#005FB8;--accent-tx:#FFFFFF;--accent-soft:rgba(0,95,184,.09);--wait:#9D5D00;--wait-bg:#FFF4CE;--err:#C42B1C;--err-bg:#FDE7E9;--ok:#0F7B0F;--ok-bg:#DFF6DD;--ring-track:rgba(0,0,0,.1);--ctl:rgba(255,255,255,.7);--shadow:0 2px 4px rgba(0,0,0,.04)}
:root[data-theme=dark]{--win:#1C1F24;--layer:#25272B;--card:#2D2F33;--card2:#292B2F;--stroke-c:rgba(255,255,255,.07);--stroke-b:rgba(0,0,0,.25);--div:rgba(255,255,255,.08);--tx:#FFFFFF;--tx2:#C5C5C5;--tx3:#8E8E8E;--subtle:rgba(255,255,255,.06);--subtle2:rgba(255,255,255,.04);--accent:#60CDFF;--accent-tx:#000000;--accent-soft:rgba(96,205,255,.12);--wait:#FCE100;--wait-bg:#433519;--err:#FF99A4;--err-bg:#442726;--ok:#6CCB5F;--ok-bg:#393D1B;--ring-track:rgba(255,255,255,.14);--ctl:rgba(255,255,255,.06);--shadow:0 2px 4px rgba(0,0,0,.2)}
body{font-size:14px;line-height:20px}
:lang(zh) body{line-height:22px}
.win{display:grid;grid-template-columns:284px 1fr;grid-template-rows:48px 1fr;height:800px}
.tb{grid-column:1/3;display:flex;align-items:center;position:relative}
.app{display:flex;align-items:center;gap:12px;padding-left:16px;font-size:12px;color:var(--tx)}
.tile{width:18px;height:18px;border-radius:5px;background:linear-gradient(135deg,#3AA0FF,#005FB8 55%,#4B2FBF);display:grid;place-items:center;color:#fff;font:700 12px/1 var(--display)}
.srch{position:absolute;left:50%;transform:translateX(-50%);width:420px;height:32px;display:flex;align-items:center;gap:10px;padding:0 12px;border-radius:4px;background:var(--ctl);border:1px solid var(--stroke-c);border-bottom-color:var(--stroke-b);color:var(--tx3);font-size:13px}
.srch kbd{margin-left:auto;font:11px var(--sans);color:var(--tx3);padding:1px 6px;border:1px solid var(--div);border-radius:3px}
.tb .winctl{margin-left:auto}

.nav{display:flex;flex-direction:column;padding:2px 6px 8px;min-height:0}
.newbtn{display:flex;align-items:center;justify-content:center;gap:8px;height:34px;margin:2px 4px 10px;border-radius:4px;background:var(--accent);color:var(--accent-tx);font-weight:600;font-size:14px;box-shadow:inset 0 -1px 0 rgba(0,0,0,.15)}
.ni{position:relative;display:flex;align-items:center;gap:12px;height:36px;padding:0 10px 0 14px;border-radius:4px;color:var(--tx)}
.ni .ico{color:var(--tx)}
.ni .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.ni .w{font-size:12px;color:var(--tx3)}
.ni.grp{color:var(--tx);font-weight:600}
.ni.grp .chev{margin-left:auto;color:var(--tx2)}
.ni.sub{padding-left:40px}
.ni.on{background:var(--subtle)}
.ni.on::before{content:"";position:absolute;left:0;top:10px;width:3px;height:16px;border-radius:2px;background:var(--accent)}
.sic{width:16px;height:16px;display:grid;place-items:center;flex:none;border-radius:50%}
.sic.wait{background:var(--wait);color:var(--wait-bg)}
.sic.err{background:var(--err);color:var(--err-bg)}
.sic.done{color:var(--tx2)}
.sic.wait svg,.sic.err svg{stroke-width:3}
.navfoot{margin-top:auto;border-top:1px solid var(--div);padding-top:6px}

.content{background:var(--layer);border:1px solid var(--stroke-c);border-right:0;border-bottom:0;border-top-left-radius:8px;position:relative;overflow:hidden;min-width:0}
.hdr{display:flex;align-items:center;gap:16px;height:68px;padding:0 20px 0 36px}
.hdr h1{font:600 20px/28px var(--display)}
.hdr .sub{font-size:12px;color:var(--tx2);line-height:16px}
.cmd{margin-left:auto;display:flex;align-items:center;gap:2px}
.cb{display:flex;align-items:center;gap:8px;height:32px;padding:0 11px;border-radius:4px;color:var(--tx);font-size:13px}
.cb.dd{border:1px solid var(--stroke-c);border-bottom-color:var(--stroke-b);background:var(--ctl);font-family:var(--mono);font-size:12px}
.cb.dd em{font-style:normal;color:var(--accent)}
.cb .ico{color:var(--tx)}
.cvr{width:1px;height:20px;background:var(--div);margin:0 6px}

.col{width:780px;margin:0 auto;padding-top:4px}
.ub{display:flex;justify-content:flex-end}
.ub div{max-width:560px;background:var(--accent-soft);border:1px solid var(--stroke-c);border-radius:8px;padding:10px 14px;font-size:14px}
.exp{display:flex;align-items:center;gap:14px;margin-top:16px;height:56px;padding:0 8px 0 14px;background:var(--card);border:1px solid var(--stroke-c);border-radius:6px;box-shadow:var(--shadow)}
.exp .ic{width:32px;height:32px;border-radius:6px;display:grid;place-items:center;background:var(--subtle);color:var(--tx)}
.exp .tt{font-weight:600;font-size:14px;line-height:20px}
.exp .ds{font-size:12px;color:var(--tx2);line-height:16px}
.exp .chb{margin-left:auto;width:32px;height:32px;border-radius:4px;display:grid;place-items:center;color:var(--tx2)}
.prose{margin-top:16px;font-size:14px;line-height:24px}
.prose code{background:var(--subtle);border:1px solid var(--div);padding:0 4px;border-radius:3px}
.prose ul{padding-left:20px;margin-top:4px}
.prose li::marker{color:var(--tx3)}
.card{margin-top:14px;background:var(--card);border:1px solid var(--stroke-c);border-radius:6px;box-shadow:var(--shadow)}
.card .h{display:flex;align-items:center;gap:8px;height:50px;padding:0 9px 0 14px;font-weight:600}
.pill{font:600 12px/18px var(--mono);padding:0 6px;border-radius:10px}
.pill.a{background:var(--ok-bg);color:var(--ok)}
.pill.d{background:var(--err-bg);color:var(--err)}
.card .r{display:flex;align-items:center;gap:10px;height:34px;padding:0 14px;border-top:1px solid var(--div);font-size:13px}
.card .r .ico{color:var(--tx2)}
.card .r .p{font-family:var(--mono);font-size:12.5px}
.card .r .a{font:12px var(--mono);color:var(--ok);width:36px;text-align:right}
.card .r .d{font:12px var(--mono);color:var(--err);width:30px;text-align:right}
.card .ft{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--div);background:var(--card2);border-radius:0 0 6px 6px}
.btn{display:flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:4px;font-size:13px;border:1px solid var(--stroke-c);border-bottom-color:var(--stroke-b);background:var(--ctl)}
.btn.acc{background:var(--accent);color:var(--accent-tx);border-color:transparent;font-weight:600}
.ub.second{margin-top:22px}
.run{position:relative;display:flex;align-items:center;gap:12px;margin-top:16px;height:48px;padding:0 16px;background:var(--card);border:1px solid var(--stroke-c);border-radius:6px;overflow:hidden}
.run .t{margin-left:auto;font:12px var(--mono);color:var(--tx2)}
.run code{font-family:var(--mono);font-size:12.5px}
.run .pb{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--subtle)}
.run .pb i{position:absolute;left:22%;width:30%;top:0;bottom:0;border-radius:2px;background:var(--accent)}
.pr{width:16px;height:16px;border-radius:50%;border:2px solid transparent;border-top-color:var(--accent);border-right-color:var(--accent)}

.dock{position:absolute;left:0;right:0;bottom:0;padding:24px 0 18px;background:linear-gradient(transparent,var(--layer) 30%)}
.comp{width:780px;margin:0 auto;background:var(--card);border:1px solid var(--stroke-c);border-radius:8px;box-shadow:0 8px 16px rgba(0,0,0,.08);overflow:hidden;position:relative}
.comp::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--accent)}
.comp .in{padding:14px 16px 6px;color:var(--tx3);font-size:14px;height:46px}
.comp .bar{display:flex;align-items:center;gap:4px;padding:6px 8px 10px}
.ib{width:32px;height:32px;border-radius:4px;display:grid;place-items:center;color:var(--tx2)}
.dd2{display:flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:4px;color:var(--tx);font-size:13px}
.dd2 .ico{color:var(--tx2)}
.mt{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--tx2);padding:0 8px}
.go{width:36px;height:32px;border-radius:4px;display:grid;place-items:center;background:var(--accent);color:var(--accent-tx)}
.go.off{background:var(--subtle);color:var(--tx3)}

/* 空状态 */
.hero{width:780px;margin:0 auto;padding-top:64px}
.hero .big{display:flex;align-items:center;gap:16px}
.hero .bt{width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,#3AA0FF,#005FB8 55%,#4B2FBF);display:grid;place-items:center;color:#fff;font:600 30px/1 var(--display);box-shadow:0 4px 12px rgba(0,95,184,.3)}
.hero h1{font:600 28px/36px var(--display)}
.hero .pp{font-size:13px;color:var(--tx2);font-family:var(--mono)}
.hero h3{font:600 14px/20px var(--sans);margin:36px 0 10px}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.rc{background:var(--card);border:1px solid var(--stroke-c);border-radius:6px;padding:14px;box-shadow:var(--shadow);height:96px;display:flex;flex-direction:column}
.rc .t{display:flex;gap:10px;align-items:center;font-weight:600}
.rc .m{margin-top:auto;font-size:12px;color:var(--tx2)}
.tip{margin-top:16px;display:flex;align-items:center;gap:12px;height:48px;padding:0 14px;border-radius:6px;background:var(--accent-soft);border:1px solid var(--stroke-c);font-size:13px}
.tip .ico{color:var(--accent)}
`;

const sic = (s) =>
  s === "run"
    ? '<span class="sic"><span class="pr" style="width:14px;height:14px"></span></span>'
    : s === "wait"
      ? `<span class="sic wait">${icon("x", 10).replace(P_X, P_BANG)}</span>`
      : s === "err"
        ? `<span class="sic err">${icon("x", 10)}</span>`
        : s === "done"
          ? `<span class="sic done">${icon("check", 15)}</span>`
          : '<span class="sic"></span>';
const P_X = '<path d="M18 6 6 18M6 6l12 12"/>';
const P_BANG = '<path d="M12 5v9M12 19h.01"/>';

function nav(activeOn) {
  const groups = D.projects
    .map(
      (p, i) =>
        `<div class="ni grp">${icon("folder", 16)}<span>${p.name}</span><span class="chev">${icon(i === 0 ? "chevD" : "chevD", 14)}</span></div>` +
        p.tasks
          .map(
            (t) =>
              `<div class="ni sub ${t.active && activeOn ? "on" : ""}">${sic(t.st)}<span class="t">${t.t}</span><span class="w">${t.when}</span></div>`,
          )
          .join(""),
    )
    .join("");
  return `<nav class="nav"><div class="newbtn">${icon("plus", 16)}新任务</div>${groups}
    <div class="navfoot"><div class="ni">${icon("history", 16)}<span class="t">历史会话</span><span class="w">${D.history}</span></div><div class="ni">${icon("gear", 16)}<span class="t">设置</span></div></div></nav>`;
}

const tb = `<header class="tb"><div class="app"><span class="tile">π</span>omp studio</div><div class="srch">${icon("search", 15)}搜索任务、会话和命令<kbd>Ctrl+K</kbd></div>${winctl()}</header>`;

const composer = (ph, running) => `<div class="dock"><div class="comp"><div class="in">${ph}</div>
  <div class="bar"><span class="ib">${icon("paperclip", 16)}</span><span class="dd2">${icon("cpu", 15)}${D.model} · ${D.think}${icon("chevD", 13)}</span><span class="dd2">${icon("shield", 15)}${D.approval}${icon("chevD", 13)}</span>
  <span class="sp"></span><span class="mt">${ring(running ? D.ctx : 0, 16)}${running ? D.ctx : 0}%</span><span class="mt">${running ? D.cost : "$0.00"}</span>
  <span class="go ${running ? "" : "off"}">${running ? icon("stop", 15) : icon("up", 16)}</span></div></div></div>`;

function conversation() {
  return `<section class="content"><div class="hdr"><div><h1>${D.title}</h1><div class="sub">${D.project} · ${D.path}</div></div>
    <div class="cmd"><span class="cb dd">${icon("branch", 14)}${D.branch} <em>↑${D.ahead}</em>${icon("chevD", 12)}</span><span class="cvr"></span><span class="cb">${icon("diff", 16)}评审</span><span class="cb">${icon("terminal", 16)}终端</span><span class="cb">${icon("more", 16)}</span></div></div>
    <div class="col">
      <div class="ub"><div>${D.u1}</div></div>
      <div class="exp"><span class="ic">${icon("wrench", 16)}</span><div><div class="tt">已工作 ${D.proc.dur}</div><div class="ds">${D.proc.tools} 次工具调用 · ${D.proc.agents} 个子代理</div></div><span class="chb">${icon("chevD", 16)}</span></div>
      <div class="prose">${D.lead}<ul>${D.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
      <div class="card"><div class="h">${D.files.length} 个文件已更改<span class="pill a">+${D.add}</span><span class="pill d">−${D.del}</span><span class="sp"></span><span class="btn">提交…</span><span class="btn acc">${icon("diff", 14)}打开评审</span></div>
        ${D.files.map((f) => `<div class="r">${icon("file", 15)}<span class="p">${f.p}</span><span class="sp"></span><span class="a">+${f.a}</span><span class="d">${f.d ? "−" + f.d : ""}</span></div>`).join("")}
      </div>
      <div class="ub second"><div>${D.u2}</div></div>
      <div class="run"><span class="pr"></span>${D.live.verb} <code>${D.live.target}</code><span class="t">${D.live.t}</span><span class="pb"><i></i></span></div>
    </div>${composer(D.ph, true)}</section>`;
}

function empty() {
  return `<section class="content"><div class="hero">
    <div class="big"><span class="bt">π</span><div><h1>${D.project}</h1><div class="pp">${D.path} · main</div></div></div>
    <h3>最近的任务</h3>
    <div class="cards">${D.recent.map((r) => `<div class="rc"><div class="t">${sic(r.st)}${r.t}</div><div class="m">${r.meta}</div></div>`).join("")}</div>
    <div class="tip">${icon("alertC", 18)}输入 @ 引用文件，/ 使用斜杠命令；拖入文件夹即可切换项目。</div>
  </div>${composer(D.emptyPh, false)}</section>`;
}

export default {
  id: "c",
  label: "C Fluent · Windows 11 原生",
  render(scene, theme) {
    const body = `<div class="win">${tb}${nav(scene !== "empty")}${scene === "empty" ? empty() : conversation()}</div>`;
    return doc(theme, css, body);
  },
};

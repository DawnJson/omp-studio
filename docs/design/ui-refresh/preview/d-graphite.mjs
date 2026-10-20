// 方向 D「石墨」：专业工具。纯中性灰（不带色偏）、分层面板、靛紫强调色；过程折叠成一条彩色时间条，数字全部可读。
import { D, icon, winctl, doc, FONT } from "./common.mjs";

const css = `
:root{--sans:${FONT.sans};--display:${FONT.display};--mono:${FONT.mono};--stroke:1.6}
:root[data-theme=dark]{--win:#0A0A0C;--panel:#121214;--raised:#19191C;--raised2:#202024;--hover:rgba(255,255,255,.045);--bd:rgba(255,255,255,.07);--bd2:rgba(255,255,255,.12);--tx:#EDEDEF;--tx2:#A1A1AA;--tx3:#6E6E78;--accent:#8B8DFF;--accent2:#C084FC;--accent-soft:rgba(139,141,255,.14);--accent-tx:#0A0A0C;--wait:#F5A524;--err:#F3555A;--ok:#3DD68C;--c2:#3DD68C;--c3:#F5A524;--glow:0 0 0 1px rgba(139,141,255,.25),0 8px 40px -8px rgba(139,141,255,.35);--hl:inset 0 1px 0 rgba(255,255,255,.04)}
:root[data-theme=light]{--win:#F1F1F3;--panel:#FFFFFF;--raised:#F7F7F8;--raised2:#EFEFF1;--hover:rgba(0,0,0,.04);--bd:rgba(0,0,0,.075);--bd2:rgba(0,0,0,.12);--tx:#18181B;--tx2:#52525B;--tx3:#8A8A93;--accent:#5B5BD6;--accent2:#9B5DE5;--accent-soft:rgba(91,91,214,.1);--accent-tx:#FFFFFF;--wait:#C27803;--err:#DC3545;--ok:#1A9E5A;--c2:#1A9E5A;--c3:#C27803;--glow:0 0 0 1px rgba(91,91,214,.2),0 8px 30px -10px rgba(91,91,214,.3);--hl:none}
body{font-size:13px}
.win{display:grid;grid-template-columns:248px 1fr;grid-template-rows:40px 1fr;height:800px}
.top{grid-column:1/3;display:flex;align-items:center}
.brand{width:248px;display:flex;align-items:center;gap:9px;padding-left:16px;font-weight:600;font-size:13.5px;letter-spacing:-.01em}
.mark{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#fff;font:700 13px/1 var(--display)}
.brand .ico{margin-left:auto;margin-right:12px;color:var(--tx3)}
.cmdk{display:flex;align-items:center;gap:8px;height:28px;width:300px;padding:0 10px;border-radius:8px;background:var(--hover);border:1px solid var(--bd);color:var(--tx3);font-size:12.5px;margin-left:8px}
.cmdk kbd{margin-left:auto;font:11px var(--mono);color:var(--tx2);background:var(--raised2);padding:0 5px;border-radius:4px}
.top .winctl{margin-left:auto}

.side{display:flex;flex-direction:column;padding:6px 10px 10px;min-height:0}
.new{display:flex;align-items:center;gap:8px;height:32px;padding:0 10px;border-radius:8px;background:var(--raised);border:1px solid var(--bd);box-shadow:var(--hl);font-weight:500}
.new kbd{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.grp{display:flex;align-items:center;gap:8px;margin:18px 6px 4px;font-size:12px;color:var(--tx2);font-weight:500}
.av{width:16px;height:16px;border-radius:4px;display:grid;place-items:center;font:700 10px/1 var(--display);color:#fff}
.grp .n{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.tk{display:flex;align-items:center;gap:10px;height:30px;padding:0 8px 0 10px;border-radius:7px;color:var(--tx2)}
.tk .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.tk .w{font:11px var(--mono);color:var(--tx3)}
.tk.on{background:var(--raised2);color:var(--tx);box-shadow:var(--hl)}
.dot{width:8px;height:8px;border-radius:50%;flex:none;margin:0 3px}
.dot.run{background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft),0 0 10px var(--accent)}
.dot.wait{background:var(--wait);box-shadow:0 0 0 3px rgba(245,165,36,.16)}
.dot.done{background:transparent;border:1.5px solid var(--tx3)}
.dot.err{background:var(--err)}
.dot.idle{background:var(--bd2)}
.side .lnk{display:flex;align-items:center;gap:10px;height:30px;padding:0 10px;border-radius:7px;color:var(--tx2)}
.side .lnk .n{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.sfoot{margin-top:auto}

.panel{background:var(--panel);border:1px solid var(--bd);border-radius:12px;margin:0 8px 8px 0;position:relative;overflow:hidden;min-width:0;box-shadow:var(--hl)}
.ph{display:flex;align-items:center;gap:10px;height:52px;padding:0 14px 0 20px;border-bottom:1px solid var(--bd)}
.ph h1{font:600 14.5px/20px var(--sans)}
.badge{display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:11px;background:var(--accent-soft);color:var(--accent);font:500 11.5px var(--mono)}
.badge .dot{margin:0;width:6px;height:6px}
.ph .chip{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:7px;border:1px solid var(--bd);font:12px var(--mono);color:var(--tx2);margin-left:auto}
.ph .chip em{font-style:normal;color:var(--accent)}
.ph .ib{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;color:var(--tx2)}

.col{width:760px;margin:0 auto;padding-top:22px}
.um{background:var(--raised);border:1px solid var(--bd);border-radius:10px;padding:11px 14px;font-size:14.5px;line-height:24px;box-shadow:var(--hl)}
.um .who{font:11px var(--mono);color:var(--tx3);margin-bottom:2px}
.proc{display:flex;align-items:center;gap:8px;margin-top:12px;height:34px;padding:0 10px;border-radius:8px;color:var(--tx2);font-size:12.5px;border:1px dashed var(--bd2)}
.proc .k{font-family:var(--mono);color:var(--tx)}
.proc .s{color:var(--tx3)}
.lanes{margin-left:auto;width:220px;height:16px;position:relative}
.lanes i{position:absolute;height:3px;border-radius:2px}
.prose{font-size:14.5px;line-height:25px;margin-top:14px}
.prose code{font-size:.86em;background:var(--raised2);border:1px solid var(--bd);padding:1px 5px;border-radius:5px}
.prose ul{list-style:none;margin-top:4px}
.prose li{position:relative;padding-left:18px}
.prose li::before{content:"";position:absolute;left:4px;top:11px;width:4px;height:4px;border-radius:50%;background:var(--accent)}
.dc{margin-top:14px;border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.dc .h{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px 0 14px;background:var(--raised);font-weight:500}
.sq{display:flex;gap:2px}
.sq i{width:8px;height:8px;border-radius:2px;background:var(--ok)}
.sq i.d{background:var(--err)}
.sq i.n{background:var(--bd2)}
.add{color:var(--ok);font-family:var(--mono);font-size:12px}
.del{color:var(--err);font-family:var(--mono);font-size:12px}
.dc .h kbd{margin-left:auto;display:flex;align-items:center;gap:6px;font:12px var(--sans);color:var(--accent)}
.dc .h kbd b{font:11px var(--mono);color:var(--tx3);background:var(--raised2);padding:0 5px;border-radius:4px;font-weight:400}
.dc .r{display:flex;align-items:center;gap:10px;height:32px;padding:0 14px;border-top:1px solid var(--bd);font:12.5px var(--mono);color:var(--tx2)}
.dc .r .a{width:34px;text-align:right}
.dc .r .d{width:26px;text-align:right}
.um.second{margin-top:26px}
.live{display:flex;align-items:center;gap:10px;margin-top:12px;height:34px;padding:0 10px;color:var(--tx2);font-size:13px}
.spin{width:14px;height:14px;border-radius:50%;background:conic-gradient(from 90deg,transparent,var(--accent));-webkit-mask:radial-gradient(circle,transparent 4.5px,#000 5px)}
.live code{font:12.5px var(--mono);color:var(--tx)}
.live .t{margin-left:auto;font:12px var(--mono);color:var(--accent)}

.dock{position:absolute;left:0;right:0;bottom:0;padding:26px 0 16px;background:linear-gradient(transparent,var(--panel) 32%)}
.comp{width:760px;margin:0 auto;border-radius:12px;background:var(--raised);border:1px solid var(--bd2);box-shadow:var(--glow)}
.comp.idle{box-shadow:none}
.comp .in{padding:13px 16px 4px;font-size:14.5px;color:var(--tx3);height:44px}
.comp .bar{display:flex;align-items:center;gap:6px;padding:8px 8px 8px 10px}
.ch{display:flex;align-items:center;gap:7px;height:28px;padding:0 9px;border-radius:7px;background:var(--hover);border:1px solid var(--bd);font-size:12.5px;color:var(--tx)}
.ch .ico{color:var(--tx3)}
.ch .pd{width:6px;height:6px;border-radius:50%;background:#4D6BFE}
.cx{display:flex;align-items:center;gap:8px;margin-left:auto;font:11.5px var(--mono);color:var(--tx2);padding-right:6px}
.cbar{width:56px;height:4px;border-radius:2px;background:var(--bd2);position:relative;overflow:hidden}
.cbar i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.go{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff}
.go.off{background:var(--hover);color:var(--tx3)}
.kh{display:flex;justify-content:center;gap:16px;margin-top:8px;font:11px var(--mono);color:var(--tx3)}
.kh b{color:var(--tx2);font-weight:400}

/* 空状态 */
.hero{width:760px;margin:0 auto;padding-top:70px}
.hero .av2{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;color:#fff;font:700 22px/1 var(--display);box-shadow:0 8px 24px -6px var(--accent)}
.hero h1{font:600 26px/34px var(--display);margin-top:18px;letter-spacing:-.015em}
.hero .pp{font:12px var(--mono);color:var(--tx3);margin-top:4px;display:flex;gap:14px}
.qa{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:28px}
.qa div{border:1px solid var(--bd);border-radius:10px;padding:12px 14px;background:var(--raised);display:flex;align-items:center;gap:10px;color:var(--tx2)}
.qa kbd{margin-left:auto;font:11px var(--mono);color:var(--tx3)}
.rl{margin-top:24px;border:1px solid var(--bd);border-radius:10px;overflow:hidden}
.rl .h{font-size:12px;color:var(--tx3);height:34px;display:flex;align-items:center;padding:0 14px;background:var(--raised)}
.rl .r{display:flex;align-items:center;gap:10px;height:40px;padding:0 14px;border-top:1px solid var(--bd)}
.rl .r .m{margin-left:auto;font-size:12px;color:var(--tx3)}
`;

const HUE = ["#8B8DFF", "#F472B6", "#34D399"];
function side(activeOn) {
  return `<aside class="side"><div class="new">${icon("plus", 15)}新任务<kbd>Ctrl N</kbd></div>
    ${D.projects
      .map(
        (p, i) =>
          `<div class="grp"><span class="av" style="background:${HUE[i]}">${p.name[0].toUpperCase()}</span>${p.name}<span class="n">${p.tasks.length}</span></div>` +
          p.tasks
            .map(
              (t) =>
                `<div class="tk ${t.active && activeOn ? "on" : ""}"><span class="dot ${t.st}"></span><span class="t">${t.t}</span><span class="w">${t.when}</span></div>`,
            )
            .join(""),
      )
      .join("")}
    <div class="lnk" style="margin-top:12px">${icon("history", 15)}历史会话<span class="n">${D.history}</span></div>
    <div class="sfoot"><div class="lnk">${icon("gear", 15)}设置<span class="n">${icon("contrast", 14)}</span></div></div></aside>`;
}

const top = `<header class="top"><div class="brand"><span class="mark">π</span>omp studio${icon("sidebar", 16)}</div><div class="cmdk">${icon("search", 14)}搜索或执行命令…<kbd>Ctrl K</kbd></div>${winctl("var(--tx2)")}</header>`;

const squares = (a, d) => {
  const t = a + d,
    g = Math.round((a / t) * 5),
    r = d ? Math.max(1, 5 - g) : 0;
  return `<span class="sq">${"<i></i>".repeat(g)}${'<i class="d"></i>'.repeat(r)}${'<i class="n"></i>'.repeat(5 - g - r)}</span>`;
};

const composer = (ph, running) => `<div class="dock"><div class="comp ${running ? "" : "idle"}"><div class="in">${ph}</div>
  <div class="bar"><span class="ch" style="padding:0 7px">${icon("plus", 15)}</span><span class="ch"><span class="pd"></span>${D.model}<span style="color:var(--tx3)">·</span>${D.think}${icon("chevD", 13)}</span><span class="ch">${icon("shield", 14)}${D.approval}${icon("chevD", 13)}</span>
  <span class="cx"><span class="cbar"><i style="width:${running ? D.ctx : 0}%"></i></span>${running ? D.ctx : 0}%<span style="color:var(--tx3)">·</span>${running ? D.tokens + " · " + D.cost : "$0.00"}</span>
  <span class="go ${running ? "" : "off"}">${running ? icon("stop", 15) : icon("up", 16)}</span></div></div>
  <div class="kh">${running ? "<span><b>Enter</b> 插话</span><span><b>Ctrl Enter</b> 稍后</span><span><b>Esc</b> 停止</span>" : "<span><b>@</b> 引用文件</span><span><b>/</b> 命令</span><span><b>Enter</b> 发送</span>"}</div></div>`;

function conversation() {
  const lanes = `<span class="lanes"><i style="left:0;width:100%;top:1px;background:var(--bd2)"></i><i style="left:0;width:38%;top:1px;background:var(--accent)"></i><i style="left:62%;width:38%;top:1px;background:var(--accent)"></i><i style="left:30%;width:40%;top:7px;background:var(--c2)"></i><i style="left:58%;width:20%;top:13px;background:var(--c3)"></i></span>`;
  return `<section class="panel"><div class="ph"><h1>${D.title}</h1><span class="badge"><span class="dot run"></span>运行中 ${D.live.t}</span>
      <span class="chip">${icon("branch", 13)}${D.branch} <em>↑${D.ahead}</em></span><span class="ib">${icon("diff", 16)}</span><span class="ib">${icon("terminal", 16)}</span><span class="ib">${icon("more", 16)}</span></div>
    <div class="col">
      <div class="um"><div class="who">你 · 14:02</div>${D.u1}</div>
      <div class="proc">${icon("chevR", 14)}<span class="k">${D.proc.short}</span><span class="s">·</span>${D.proc.tools} 次工具调用<span class="s">·</span>${D.proc.agents} 个子代理${lanes}</div>
      <div class="prose">${D.lead}<ul>${D.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
      <div class="dc"><div class="h">${D.files.length} 个文件<span class="add">+${D.add}</span><span class="del">−${D.del}</span>${squares(D.add, D.del)}<kbd>打开评审<b>Ctrl Shift D</b></kbd></div>
        ${D.files.map((f) => `<div class="r">${icon("file", 14)}${f.p}<span class="sp"></span><span class="add a">+${f.a}</span><span class="del d">${f.d ? "−" + f.d : ""}</span></div>`).join("")}</div>
      <div class="um second"><div class="who">你 · 14:06</div>${D.u2}</div>
      <div class="live"><span class="spin"></span>${D.live.verb} <code>${D.live.target}</code><span class="t">${D.live.t}</span></div>
    </div>${composer(D.ph, true)}</section>`;
}

function empty() {
  return `<section class="panel"><div class="hero"><div class="av2">O</div><h1>${D.project}</h1><div class="pp"><span>${D.path}</span><span>⎇ main</span></div>
    <div class="qa"><div>${icon("folderPlus", 16)}换个文件夹</div><div>${icon("search", 16)}命令面板<kbd>Ctrl K</kbd></div><div>${icon("terminal", 16)}打开终端<kbd>Ctrl \`</kbd></div></div>
    <div class="rl"><div class="h">最近</div>${D.recent.map((r) => `<div class="r"><span class="dot ${r.st}"></span>${r.t}<span class="m">${r.meta}</span></div>`).join("")}</div>
  </div>${composer(D.emptyPh, false)}</section>`;
}

export default {
  id: "d",
  label: "D 石墨 · 专业工具",
  render(scene, theme) {
    const body = `<div class="win">${top}${side(scene !== "empty")}${scene === "empty" ? empty() : conversation()}</div>`;
    return doc(theme, css, body);
  },
};

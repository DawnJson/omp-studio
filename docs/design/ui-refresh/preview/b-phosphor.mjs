// 方向 B「磷光」：终端原生。界面框架全用等宽字体，琥珀色磷光强调色，提示符、日志行、diffstat、状态行。
import { D, icon, winctl, doc, FONT } from "./common.mjs";

const css = `
:root{--sans:${FONT.sans};--mono:${FONT.mono};--stroke:1.7}
:root[data-theme=dark]{--win:#0D0C0A;--panel:#14130F;--panel2:#1A1813;--tx:#ECE5D3;--tx2:#ABA28E;--tx3:#71695A;--rule:#28251E;--rule2:#3A362B;--accent:#FFB23F;--accent-tx:#1A1203;--accent-dim:rgba(255,178,63,.13);--wait:#FF6AC1;--wait-dim:rgba(255,106,193,.14);--err:#FF5F57;--add:#9BE08F;--del:#FF7B72;--codebg:#1F1D17;--glow:0 0 12px rgba(255,178,63,.35)}
:root[data-theme=light]{--win:#F4F2EC;--panel:#ECE9E0;--panel2:#E4E0D5;--tx:#1E1B14;--tx2:#5A5446;--tx3:#867F6E;--rule:#DAD5C8;--rule2:#C6C0B0;--accent:#9A5800;--accent-tx:#FFF8EA;--accent-dim:rgba(154,88,0,.1);--wait:#B0247A;--wait-dim:rgba(176,36,122,.1);--err:#C4302B;--add:#2E7D32;--del:#C4302B;--codebg:#E7E3D8;--glow:none}
body{font-family:var(--mono);font-size:12.5px}
.win{display:grid;grid-template-columns:268px 1fr;grid-template-rows:40px 1fr;height:800px}
.top{grid-column:1/3;display:flex;align-items:center;background:var(--panel);border-bottom:1px solid var(--rule)}
.logo{width:268px;padding-left:16px;font-size:14px;font-weight:700;display:flex;align-items:center;gap:0;letter-spacing:.02em}
.logo .cur{display:inline-block;width:8px;height:16px;background:var(--accent);margin:0 6px 0 2px;box-shadow:var(--glow)}
.logo .s{color:var(--tx3);font-weight:400}
.path{display:flex;align-items:center;gap:14px;color:var(--tx2);padding-left:18px}
.path b{color:var(--tx);font-weight:600}
.path .br{display:flex;align-items:center;gap:5px;color:var(--tx3)}
.path .br em{font-style:normal;color:var(--accent)}
.tbtn{display:flex;gap:8px;margin-left:auto;margin-right:8px}
.tbtn span{display:flex;align-items:center;gap:6px;height:24px;padding:0 8px;border:1px solid var(--rule2);border-radius:3px;color:var(--tx2);font-size:11.5px}

.side{border-right:1px solid var(--rule);padding:12px 10px;display:flex;flex-direction:column;min-height:0}
.find{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;border:1px solid var(--rule2);border-radius:3px;color:var(--tx3)}
.find .p{color:var(--accent)}
.find kbd{margin-left:auto;font:inherit;font-size:11px}
.new{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px;margin-top:6px;color:var(--tx)}
.new kbd{margin-left:auto;font:inherit;font-size:11px;color:var(--tx3)}
.tree{margin-top:12px}
.ph{display:flex;align-items:center;gap:6px;height:28px;padding:0 6px;color:var(--tx2)}
.ph .n{margin-left:auto;color:var(--tx3)}
.tk{position:relative;display:flex;align-items:center;gap:10px;height:28px;padding:0 6px 0 22px;color:var(--tx2);border-radius:2px}
.tk .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-family:var(--sans);font-size:13px}
.tk .w{color:var(--tx3);font-size:11px;width:28px;text-align:right}
.tk.on{background:var(--accent-dim);color:var(--tx)}
.tk.on::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--accent);box-shadow:var(--glow)}
.g{width:12px;text-align:center;flex:none;font-size:12px}
.g.run{color:var(--accent);text-shadow:var(--glow)}
.g.wait{color:var(--wait)}
.g.done{color:var(--tx3)}
.g.err{color:var(--err)}
.hist{display:flex;align-items:center;gap:6px;height:28px;padding:0 6px;color:var(--tx2);margin-top:8px}
.hist .n{margin-left:auto;color:var(--tx3)}
.foot{margin-top:auto;display:flex;align-items:center;gap:8px;height:30px;padding:0 6px;color:var(--tx2);border-top:1px solid var(--rule);padding-top:8px;height:38px}
.foot .r{margin-left:auto;color:var(--tx3);font-size:11px}

.main{position:relative;overflow:hidden;min-width:0}
.col{width:800px;margin:0 auto;padding-top:26px}
.u{display:flex;gap:10px;font-family:var(--sans);font-size:15px;line-height:25px;color:var(--tx)}
.u .p{font-family:var(--mono);color:var(--accent);font-weight:700;text-shadow:var(--glow)}
.meta{color:var(--tx3);font-size:11px;margin:0 0 4px 20px}
.log{display:flex;align-items:center;gap:10px;margin:10px 0 0 4px;color:var(--tx2);font-size:12px}
.log .tr{color:var(--tx3)}
.log .spark{color:var(--accent);opacity:.75;letter-spacing:-1px}
.log .x{color:var(--tx3);margin-left:auto}
.prose{font-family:var(--sans);font-size:15px;line-height:26px;margin:12px 0 0 20px;color:var(--tx)}
.prose code{background:var(--codebg);padding:1px 5px;border-radius:2px;color:var(--tx)}
.prose ul{list-style:none;margin-top:4px}
.prose li{position:relative;padding-left:18px}
.prose li::before{content:"›";position:absolute;left:2px;color:var(--accent);font-family:var(--mono)}
.diff{margin:16px 0 0 20px;border:1px solid var(--rule2);border-radius:3px;background:var(--panel)}
.diff .h{display:flex;align-items:center;gap:12px;height:32px;padding:0 12px;border-bottom:1px solid var(--rule);color:var(--tx3)}
.diff .h b{color:var(--tx);font-weight:600}
.diff .r{display:flex;align-items:center;gap:12px;height:26px;padding:0 12px;color:var(--tx2)}
.diff .r .m{color:var(--accent)}
.diff .r .f{width:230px}
.diff .r .c{width:24px;text-align:right;color:var(--tx3)}
.bar i{font-style:normal;color:var(--add)}
.bar s{text-decoration:none;color:var(--del)}
.diff .ft{display:flex;align-items:center;height:30px;padding:0 12px;border-top:1px solid var(--rule);color:var(--tx3);font-size:11.5px}
.diff .ft a{color:var(--accent);margin-left:auto}
.add{color:var(--add)}.del{color:var(--del)}
.gap{height:26px}
.live{display:flex;align-items:center;gap:10px;margin:10px 0 0 4px;color:var(--tx2);font-size:12.5px}
.live .sp1{color:var(--accent);text-shadow:var(--glow)}
.live .t{margin-left:auto;color:var(--accent)}
.blk{display:inline-block;width:8px;height:15px;background:var(--accent);vertical-align:-3px;box-shadow:var(--glow)}

.dock{position:absolute;left:0;right:0;bottom:0;padding:24px 0 16px;background:linear-gradient(transparent,var(--win) 28%)}
.comp{width:800px;margin:0 auto;border:1px solid var(--rule2);border-radius:4px;background:var(--panel)}
.comp .in{display:flex;align-items:center;gap:10px;height:50px;padding:0 14px;font-family:var(--sans);font-size:15px;color:var(--tx3)}
.comp .in .p{font-family:var(--mono);color:var(--accent);font-weight:700}
.sl{display:flex;align-items:stretch;height:28px;border-top:1px solid var(--rule);font-size:11.5px;color:var(--tx2)}
.sl > span{display:flex;align-items:center;gap:6px;padding:0 12px;border-right:1px solid var(--rule)}
.sl .mode{background:var(--accent);color:var(--accent-tx);font-weight:700;border:0}
.sl .meter{letter-spacing:-1px;color:var(--accent)}
.sl .meter u{text-decoration:none;color:var(--rule2)}
.sl .r{margin-left:auto;border-right:0;border-left:1px solid var(--rule)}
.sl kbd{font:inherit;padding:0 5px;border:1px solid var(--rule2);border-radius:2px;color:var(--tx)}

/* 空状态 */
.hero{padding-top:110px;width:800px;margin:0 auto}
.art{font-size:15px;line-height:15px;color:var(--accent);white-space:pre;text-shadow:var(--glow);letter-spacing:0}
.hero .p{display:flex;gap:18px;margin-top:22px;color:var(--tx2)}
.hero .p b{color:var(--tx)}
.ls{margin-top:34px}
.ls .c{color:var(--tx3);margin-bottom:8px}
.ls .c b{color:var(--accent);font-weight:400}
.ls .r{display:flex;align-items:center;gap:14px;height:32px;padding:0 10px;border-left:1px solid var(--rule2)}
.ls .r .t{font-family:var(--sans);font-size:14px;color:var(--tx);width:360px}
.ls .r .s{width:100px}
.ls .r .w{color:var(--tx3)}
.tips{margin-top:28px;color:var(--tx3);font-size:11.5px}
.tips kbd{font:inherit;color:var(--tx2);padding:0 4px;border:1px solid var(--rule2);border-radius:2px}
`;

const G = { run: "⠹", wait: "◆", done: "✓", err: "✗", idle: "·" };
const glyph = (s) => `<span class="g ${s}">${G[s]}</span>`;
const short = (w) => ({ 刚刚: "now", "5 分钟": "5m", "40 分钟": "40m", "2 小时": "2h", 昨天: "1d", "3 天": "3d" })[w] ?? w;

function side(activeOn) {
  return `<aside class="side">
    <div class="find"><span class="p">/</span>搜索任务与会话<kbd>^K</kbd></div>
    <div class="new">${icon("plus", 14)}新任务<kbd>^N</kbd></div>
    <div class="tree">${D.projects
      .map(
        (p) =>
          `<div class="ph">${icon("chevD", 13)}${p.name}/<span class="n">${p.tasks.length}</span></div>` +
          p.tasks
            .map(
              (t) =>
                `<div class="tk ${t.active && activeOn ? "on" : ""}">${glyph(t.st)}<span class="t">${t.t}</span><span class="w">${short(t.when)}</span></div>`,
            )
            .join(""),
      )
      .join("")}
    <div class="hist">${icon("chevR", 13)}history/<span class="n">${D.history}</span></div></div>
    <div class="foot">${icon("gear", 14)}设置<span class="r">^,</span></div>
  </aside>`;
}

function top(title) {
  return `<header class="top"><div class="logo">omp<span class="cur"></span><span class="s">studio</span></div>
    <div class="path"><span>~/work/${D.project}</span><b>${title}</b>${
      title === "新任务" ? "" : `<span class="br">${icon("branch", 13)}${D.branch} <em>↑${D.ahead}</em></span>`
    }</div>
    <div class="tbtn">${title === "新任务" ? "" : `<span>${icon("diff", 13)}diff</span><span>${icon("terminal", 13)}term</span>`}</div>${winctl("var(--tx2)")}</header>`;
}

const bar = (a, d) => `<span class="bar"><i>${"+".repeat(Math.round(a / 2))}</i><s>${"-".repeat(d)}</s></span>`;
const meter = (pct) => {
  const n = Math.round(pct / 10);
  return `<span class="meter">${"▰".repeat(n)}<u>${"▱".repeat(10 - n)}</u></span>`;
};

const composer = (ph, running) => `<div class="dock"><div class="comp">
  <div class="in"><span class="p">❯</span>${ph}</div>
  <div class="sl"><span class="mode">${running ? "RUN" : "NEW"}</span><span>${icon("cpu", 12)}${D.model}:${D.think}</span><span>${icon("shield", 12)}${D.approval}</span>
  <span>ctx ${meter(running ? D.ctx : 0)} ${running ? D.ctx : 0}%</span><span>${running ? D.tokens + " tok · " + D.cost : "0 tok · $0.00"}</span>
  <span class="r">${running ? "<kbd>esc</kbd> 停止" : "<kbd>enter</kbd> 发送"}</span></div></div></div>`;

function conversation() {
  return `<main class="main"><div class="col">
    <div class="meta">14:02</div>
    <div class="u"><span class="p">❯</span><span>${D.u1}</span></div>
    <div class="log"><span class="tr">└─</span>已工作 2m14s · ${D.proc.tools} 次工具调用 · ${D.proc.agents} 个子代理<span class="spark">▂▅▃▇▂▄▆▃▁▅▂▃</span><span class="x">[+] 展开</span></div>
    <div class="prose">${D.lead}<ul>${D.bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
    <div class="diff"><div class="h"><span>$ git diff --stat</span><span class="sp"></span><b>${D.files.length} files</b><span class="add">+${D.add}</span><span class="del">−${D.del}</span></div>
      ${D.files.map((f) => `<div class="r"><span class="m">M</span><span class="f">${f.p}</span><span class="c">${f.a + f.d}</span>${bar(f.a, f.d)}</div>`).join("")}
      <div class="ft">${D.proc.agents} 个子代理改了其中 1 个文件<a>→ 评审  ^⇧D</a></div></div>
    <div class="gap"></div>
    <div class="meta">14:06</div>
    <div class="u"><span class="p">❯</span><span>${D.u2}</span></div>
    <div class="live"><span class="sp1">⠹</span>${D.live.verb} ${D.live.target}<span class="blk"></span><span class="t">${D.live.t}</span></div>
  </div>${composer(D.ph, true)}</main>`;
}

const ART = [
  "▄▀▀▀▄ ▄▀▀▄▀▀▄ █▀▀▀▄",
  "█   █ █  █  █ █▄▄▄▀",
  " ▀▀▀  ▀  ▀  ▀ █    ",
].join("\n");

function empty() {
  return `<main class="main"><div class="hero">
    <div class="art">${ART}</div>
    <div class="p"><b>${D.project}</b><span>~/work/${D.project}</span><span>⎇ main</span></div>
    <div class="ls"><div class="c"><b>$</b> ls --recent</div>
      ${D.recent.map((r) => `<div class="r">${glyph(r.st)}<span class="t">${r.t}</span><span class="s ${r.st === "wait" ? "" : ""}" style="color:var(--${r.st === "run" ? "accent" : r.st === "wait" ? "wait" : "tx3"})">${r.meta.split(" · ")[0]}</span><span class="w">${short(r.meta.split(" · ")[1].replace("前", ""))}</span></div>`).join("")}
    </div>
    <div class="tips">提示：<kbd>@</kbd> 引用文件 · <kbd>/</kbd> 斜杠命令 · <kbd>^K</kbd> 命令面板 · <kbd>^\`</kbd> 终端</div>
  </div>${composer(D.emptyPh, false)}</main>`;
}

export default {
  id: "b",
  label: "B 磷光 · 终端原生",
  render(scene, theme) {
    const body =
      scene === "empty"
        ? `<div class="win">${top("新任务")}${side(false)}${empty()}</div>`
        : `<div class="win">${top(D.title)}${side(true)}${conversation()}</div>`;
    return doc(theme, css, body);
  },
};

// 生成预览用的静态 HTML（direction × screen × locale × theme）到 ./html/。
// 用法：node build.mjs   （render.mjs 会先调用它）
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const outDir = join(here, "html");

/* ───────── 文案 ───────── */
const T = {
  zh: {
    search: "搜索任务和会话",
    newTask: "新任务",
    addProject: "添加项目",
    settings: "设置",
    t1: "修复登录页的表单校验",
    t2: "升级 Electron 到 44",
    t3: "整理 CHANGELOG",
    t4: "给文章加目录",
    t5: "修复 RSS 链接",
    t6: "限流中间件",
    running: "运行中 · 1分12秒",
    idle: "空闲",
    u1: "登录页提交时没有校验邮箱格式，修一下并补测试。",
    proc: "▸ 读了 6 个文件 · 改了 2 个 · 跑了 1 次测试",
    procB: "▸ 6 步",
    dur: "38s",
    concl: "结论",
    c1: "邮箱现在用 validateEmail 校验，错误提示显示在输入框下方。",
    c2: "新增 4 个测试，全部通过。",
    changed: "改动 2 个文件",
    u2: "顺便把按钮禁用态也加上",
    editing: "正在改 src/login/Button.tsx …",
    ph: "回复，或者 / 调出命令…",
    model: "DeepSeek V4 Flash · 高",
    mode: "执行",
    approval: "跟随 omp",
    ctx: "上下文 34% · 68k/200k",
    sess: "本会话 112k tok · $0.21",
    emptyPh: "描述你要做的事，或者 / 调出命令…",
    recent: "最近的任务",
    r1m: "运行中",
    r2m: "等你确认 · 昨天",
    r3m: "已完成 · 3 天前",
    r4: "把 CI 的 lint 步骤并行",
    r4m: "",
    emptyNew: "新任务",
    // 检查栏
    insp: "检查栏",
    chg: "改动",
    review: "打开评审",
    ictx: "上下文",
    isess: "本会话",
    sub: "子代理",
    noChg: "还没有改动",
    subHint: "explore · task",
    // 设置
    sTitle: "设置",
    nav: ["通用", "模型与账号", "审批与安全", "后台运行", "关于"],
    g1: "通用",
    g2: "模型",
    g3: "omp",
    lang: "语言",
    langV: ["简体中文", "English"],
    theme: "主题",
    themeV: ["浅色", "深色", "跟随系统"],
    motion: "减少动效",
    dm: "默认模型",
    manage: "管理模型…",
    think: "思考强度",
    thinkV: ["关", "低", "中", "高"],
    appr: "审批模式",
    opath: "omp 路径",
    detect: "检测",
    bg: "后台运行",
    ocfg: "omp 设置",
    openCfg: "打开 omp 设置",
    sLang: 0,
  },
  en: {
    search: "Search tasks…",
    newTask: "New task",
    addProject: "Add project",
    settings: "Settings",
    t1: "Fix login form validation",
    t2: "Upgrade Electron to 44",
    t3: "Tidy up CHANGELOG",
    t4: "Add TOC to posts",
    t5: "Fix RSS links",
    t6: "Rate-limit middleware",
    running: "Running · 1m 12s",
    idle: "Idle",
    u1: "The login form doesn't validate the email format on submit. Fix it and add tests.",
    proc: "▸ Read 6 files · edited 2 · ran 1 test run",
    procB: "▸ 6 steps",
    dur: "38s",
    concl: "Conclusion",
    c1: "Email is now checked with validateEmail, and the error shows under the field.",
    c2: "Added 4 tests; all pass.",
    changed: "2 files changed",
    u2: "Also add the disabled state to the button",
    editing: "Editing src/login/Button.tsx …",
    ph: "Reply, or type / for commands…",
    model: "DeepSeek V4 Flash · High",
    mode: "Execute",
    approval: "Follow omp",
    ctx: "Context 34% · 68k/200k",
    sess: "Session 112k tok · $0.21",
    emptyPh: "Describe what to do, or type / for commands…",
    recent: "Recent tasks",
    r1m: "Running",
    r2m: "Needs you · yesterday",
    r3m: "Done · 3 days ago",
    r4: "",
    r4m: "",
    emptyNew: "New task",
    insp: "Inspector",
    chg: "Changes",
    review: "Open review",
    ictx: "Context",
    isess: "Session",
    sub: "Subagents",
    noChg: "No changes yet",
    subHint: "explore · task",
    sTitle: "Settings",
    nav: ["General", "Models & account", "Approval & safety", "Background", "About"],
    g1: "General",
    g2: "Model",
    g3: "omp",
    lang: "Language",
    langV: ["简体中文", "English"],
    theme: "Theme",
    themeV: ["Light", "Dark", "System"],
    motion: "Reduce motion",
    dm: "Default model",
    manage: "Manage models…",
    think: "Thinking",
    thinkV: ["Off", "Low", "Med", "High"],
    appr: "Approval mode",
    opath: "omp path",
    detect: "Detect",
    bg: "Run in background",
    ocfg: "omp settings",
    openCfg: "Open omp settings",
    sLang: 1,
  },
};
const INFO = {
  zh: {
    lang: "界面语言，与 omp 无关",
    theme: "浅色 / 深色 / 跟随系统",
    motion: "关闭界面里的动画",
    dm: "新任务默认使用的模型（由 omp 管理）",
    think: "模型的推理强度",
    appr: "工具调用的审批方式",
    opath: "omp 可执行文件的位置",
    bg: "关闭窗口后继续运行任务",
    ocfg: "omp 自己的设置项",
  },
  en: { lang: "", theme: "", motion: "", dm: "", think: "", appr: "", opath: "", bg: "", ocfg: "" },
};

/* ───────── 图标 ───────── */
const P = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folderPlus:
    '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M12 11v5M9.5 13.5h5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  chevD: '<path d="M7 10l5 5 5-5"/>',
  chevR: '<path d="M10 7l5 5-5 5"/>',
  chevL: '<path d="M14 7l-5 5 5 5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  panelR: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M15 5v14"/>',
  file: '<path d="M6 3.5h8l4 4V20.5H6z"/><path d="M14 3.5v4h4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  folder:
    '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  agents: '<path d="M4 8h10M8 12h12M6 16h8"/>',
  plan: '<path d="M5 6h14M5 12h14M5 18h9"/>',
};
// 带齿齿轮：8 齿，程序生成，不是"太阳"
function gearPath() {
  const n = 8,
    ro = 9.5,
    ri = 7.2,
    pts = [];
  for (let i = 0; i < n; i++) {
    const a = (Math.PI * 2 * i) / n;
    const w = (Math.PI * 2) / n;
    for (const [da, r] of [
      [-0.3, ri],
      [-0.17, ro],
      [0.17, ro],
      [0.3, ri],
    ]) {
      const ang = a + da * w * 1.6;
      pts.push(`${(12 + r * Math.sin(ang)).toFixed(2)} ${(12 - r * Math.cos(ang)).toFixed(2)}`);
    }
  }
  return `<path d="M${pts.join("L")}z"/><circle cx="12" cy="12" r="3"/>`;
}
const icon = (n, s = 16) =>
  `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24">${n === "gear" ? gearPath() : P[n]}</svg>`;
const logo = (s = 22) =>
  `<svg class="logo" width="${s}" height="${s}" viewBox="0 0 22 22" fill="none" stroke="var(--accent)" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8.5" stroke-width="2"/><path d="M7 8.8h8M9 8.8v6M13 8.8v5.2q0 1.2 1.2 1.2" stroke-width="1.5"/></svg>`;
const ring = (pct = 34, s = 14) => {
  const r = 5,
    c = 2 * Math.PI * r;
  return `<svg width="${s}" height="${s}" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="${r}" stroke="var(--bd)" stroke-width="2.4"/><circle cx="7" cy="7" r="${r}" stroke="var(--accent)" stroke-width="2.4" stroke-dasharray="${((c * pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 7 7)" stroke-linecap="round"/></svg>`;
};
const winctl = `<div class="winctl"><span><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" fill="none"><path d="M0 5h10"/></svg></span><span><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" fill="none"><rect x=".5" y=".5" width="9" height="9"/></svg></span><span><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" fill="none"><path d="M0 0l10 10M10 0L0 10"/></svg></span></div>`;

/* ───────── 公共片段 ───────── */
const stIcon = (st) =>
  st === "run"
    ? '<span class="st st-run"><i></i></span>'
    : st === "wait"
      ? '<span class="st st-wait"><i></i></span>'
      : `<span class="st">${icon("check", 13)}</span>`;
const task = (t, st, active) =>
  `<div class="task ${st === "done" ? "done" : ""} ${active ? "active" : ""}">${stIcon(st)}<span class="t">${t}</span></div>`;
function projects(L, activeTask = true) {
  return `
  <div class="proj"><div class="proj-h">${icon("chevD", 12)}<span>omp-studio</span><span class="n">3</span></div>
    ${task(L.t1, "run", activeTask)}${task(L.t2, "wait")}${task(L.t3, "done")}</div>
  <div class="proj"><div class="proj-h">${icon("chevD", 12)}<span>blog</span><span class="n">2</span></div>
    ${task(L.t4, "done")}${task(L.t5, "done")}</div>
  <div class="proj"><div class="proj-h">${icon("chevR", 12)}<span>api-gateway</span><span class="n">1</span></div></div>`;
}
const searchBox = (L) => `<div class="search">${icon("search", 14)}<span>${L.search}</span><kbd>Ctrl K</kbd></div>`;
const userMsg = (t) => `<div class="user-msg">${t}</div>`;
const card = (L) =>
  `<div class="card"><div class="row1"><span>${L.changed}</span><span class="sp"></span><span class="add">+48</span><span class="del">−6</span></div><div class="files"><span>src/login/form.ts</span><span>test/login.test.ts</span></div></div>`;
const composer = (L, ph) => `<div class="composer"><div class="c-input">${ph}</div><div class="c-tools">
  <span class="chip plain">${icon("plus", 14)}</span>
  <span class="chip">${L.model}<span class="car">${icon("chevD", 12)}</span></span>
  <span class="chip">${L.mode}<span class="car">${icon("chevD", 12)}</span></span>
  <span class="chip">${L.approval}<span class="car">${icon("chevD", 12)}</span></span>
  <span class="send">${icon("send", 15)}</span></div></div>`;
const meter = (L, empty = false) =>
  `<div class="meter">${ring(empty ? 0 : 34)}<span>${empty ? L.ctx.replace("34%", "0%").replace("68k", "0") : L.ctx}</span><span class="gap"></span><span>${empty ? L.sess.replace("112k", "0").replace("$0.21", "$0.00") : L.sess}</span></div>`;

function recent(L, locale) {
  const items = [
    [L.t1, "run", L.r1m],
    [L.t2, "wait", L.r2m],
    [L.t3, "done", L.r3m],
  ];
  return `<div class="recent-h">${L.recent}</div><div class="recent">${items.map(([t, st, m]) => `<div class="rcard"><div class="top">${stIcon(st)}<span class="ttl">${t}</span></div><div class="meta">${m}</div></div>`).join("")}</div>`;
}

/* ───────── 设置页内容（三个方向共用，样式由各自变量决定） ───────── */
function settings(L, locale) {
  const I = INFO[locale];
  const lbl = (k, t) => `<div class="lb">${t}${I[k] ? icon("info", 14) : icon("info", 14)}</div>`;
  const seg = (arr, on) =>
    `<div class="seg">${arr.map((x, i) => `<span class="${i === on ? "on" : ""}">${x}</span>`).join("")}</div>`;
  const tog = (on) => `<div class="tog ${on ? "on" : ""}"></div>`;
  const sel = (t) => `<div class="sel"><span>${t}</span><span class="car">${icon("chevD", 12)}</span></div>`;
  const row = (k, t, ct) => `<div class="srow">${lbl(k, t)}<div class="ct">${ct}</div></div>`;
  return `<div class="set">
    <div class="set-nav">${L.nav.map((n, i) => `<div class="${i === 0 ? "on" : ""}">${n}</div>`).join("")}</div>
    <div class="set-body"><h2>${L.sTitle}</h2>
      <div class="sec"><h3>${L.g1}</h3>
        ${row("lang", L.lang, seg(L.langV, L.sLang))}
        ${row("theme", L.theme, seg(L.themeV, 0).replace('on"', 'on"'))}
        ${row("motion", L.motion, tog(false))}
      </div>
      <div class="sec"><h3>${L.g2}</h3>
        ${row("dm", L.dm, sel("DeepSeek V4 Flash") + `<span class="btn sm">${L.manage}</span>`)}
        ${row("think", L.think, seg(L.thinkV, 3))}
        ${row("appr", L.appr, sel(L.approval))}
      </div>
      <div class="sec"><h3>${L.g3}</h3>
        ${row("opath", L.opath, `<div class="input">omp</div><span class="btn sm">${L.detect}</span><span class="ok">${icon("check", 13)} 18.12.3</span>`)}
        ${row("bg", L.bg, tog(true))}
        ${row("ocfg", L.ocfg, `<span class="btn sm">${L.openCfg}</span>`)}
      </div>
    </div></div>`;
}

/* ───────── 检查栏内容 ───────── */
function inspector(L, empty) {
  return `<div class="insp">
    <h4>${L.chg}</h4>
    ${empty ? `<div class="hint">${L.noChg}</div>` : `<div class="f"><span>src/login/form.ts</span><span class="add">+40</span></div><div class="f"><span>test/login.test.ts</span><span class="add">+8</span></div><span class="btn sm">${L.review}</span>`}
    <h4>${L.ictx}</h4><div class="bar"><i style="width:${empty ? 0 : 34}%"></i></div><div class="num">${empty ? "0 / 200k  0%" : "68k / 200k  34%"}</div>
    <h4>${L.isess}</h4><div class="num" style="margin-top:0;color:var(--tx)">${empty ? "0 tok  $0.00" : "112k tok  $0.21"}</div>
    <h4>${L.sub}</h4>${empty ? `<div class="hint">—</div>` : `<div class="lane" style="width:120px;opacity:.6"></div><div class="lane" style="width:150px;margin-left:40px;opacity:.35"></div><div class="hint mono" style="margin-top:6px;font-size:11px">${L.subHint}</div>`}
  </div>`;
}

/* ───────── 方向 A / Mix 外壳 ───────── */
function aShell(L, screen, { mix, open }) {
  const isSet = screen === "settings",
    isEmpty = screen === "empty";
  const crumb = isSet
    ? `<b>${L.sTitle}</b>`
    : isEmpty
      ? `<span>omp-studio</span><span class="sep">/</span><b>${L.emptyNew}</b>`
      : `<span>omp-studio</span><span class="sep">/</span><b>${L.t1}</b><span class="runstat"><i></i>${L.running}</span>`;
  const topbar = `<div class="topbar"><div class="left">${logo(22)}<span class="tb-btn">${icon("menu", 16)}</span></div>
    <div class="crumb" style="padding-left:12px">${crumb}</div>${winctl}</div>`;
  const sidebar = `<aside class="sidebar">${searchBox(L)}
    <div class="sb-actions"><span class="btn primary">${icon("plus", 14)}${L.newTask}</span><span class="btn">${L.addProject}</span></div>
    ${projects(L, !isSet && !isEmpty)}
    <div class="sb-foot ${isSet ? "on" : ""}">${icon("gear", 16)}<span>${L.settings}</span></div></aside>`;
  let main;
  if (isSet) main = settings(L, L === T.zh ? "zh" : "en");
  else if (isEmpty)
    main = `<div class="empty-wrap"><div class="col">
      <div class="empty-title">${logo(52)}<div><h1>omp-studio</h1><div class="empty-path">~/work/omp-studio</div></div></div>
      ${recent(L)}</div></div>
    <div class="dock"><div class="col">${composer(L, L.emptyPh)}${meter(L, true)}</div></div>`;
  else
    main = `<div class="thread"><div class="col"><div class="spine">
      <div class="turn"><span class="node n-user"><i></i></span>${userMsg(L.u1)}</div>
      <div class="turn proc-t"><span class="node n-proc"><i></i></span><div class="proc"><span>${L.proc}</span><span class="dur">${L.dur}</span></div></div>
      <div class="turn"><span class="node n-done"><i></i></span><div class="concl-h">${L.concl}</div><div class="prose">${L.c1}<br>${L.c2}</div>${card(L)}</div>
      <div class="turn"><span class="node n-user"><i></i></span>${userMsg(L.u2)}</div>
      <div class="turn"><span class="node n-run"><i></i></span><div class="runline">${L.editing}</div></div>
    </div></div></div>
    <div class="dock"><div class="col">${composer(L, L.ph)}${meter(L)}</div></div>`;
  let insp = "";
  if (mix && !isSet) {
    const empty = isEmpty;
    insp = open
      ? `<div class="inspector-open"><div class="ihead"><span>${L.insp}</span><span class="tb-btn">${icon("chevR", 16)}</span></div>${inspector(L, empty)}</div>`
      : `<div class="inspector-closed"><span class="tb-btn first">${icon("panelR", 17)}</span><hr><span class="tb-btn">${icon("file", 16)}${empty ? "" : '<span class="badge">2</span>'}</span><span class="tb-btn">${ring(empty ? 0 : 34, 16)}</span><span class="pct">${empty ? "0%" : "34%"}</span><span class="tb-btn">${icon("agents", 16)}</span></div>`;
  }
  return `<div class="win">${topbar}<div class="body">${sidebar}<section class="paper"><div class="pmain">${main}</div>${insp}</section></div></div>`;
}

/* ───────── 方向 B 外壳 ───────── */
function bShell(L, screen) {
  const isSet = screen === "settings",
    isEmpty = screen === "empty";
  const topbar = `<div class="topbar"><div class="left"><span class="logo-b">π</span><span class="tb-btn">${icon("menu", 16)}</span></div>${winctl}</div>`;
  const rail = `<nav class="rail"><span class="tb-btn on" title="">${icon("edit", 17)}</span><span class="tb-btn">${icon("search", 17)}</span><span class="tb-btn">${icon("folderPlus", 17)}</span>
    <span class="tb-btn bottom ${isSet ? "on" : ""}">${icon("gear", 17)}</span></nav>`;
  const sbl = `<aside class="sbl">${searchBox(L).replace("<kbd>Ctrl K</kbd>", "")}${projects(L, !isSet && !isEmpty)}</aside>`;
  const head = isSet
    ? ""
    : isEmpty
      ? `<div class="mhead"><div class="t">${L.emptyNew}</div><div class="s">omp-studio · main</div></div>`
      : `<div class="mhead"><div class="t">${L.t1}<span class="runstat" style="margin-left:0"><i></i>${L.running}</span></div><div class="s">omp-studio · main</div></div>`;
  let content;
  if (isSet) content = settings(L, L === T.zh ? "zh" : "en");
  else if (isEmpty)
    content = `<div class="empty-wrap"><div class="empty-title"><div><h1>omp-studio</h1><div class="empty-path">main · ~/work/omp-studio</div></div></div>${recent(L)}</div>
    <div class="dock">${composer(L, L.emptyPh)}</div>`;
  else
    content = `<div class="thread">
      <div class="it user">${userMsg(L.u1)}</div>
      <div class="it"><div class="proc"><span>${L.procB}</span><span class="dur" style="margin-left:0">· ${L.dur}</span></div></div>
      <div class="it"><div class="prose">${L.c1}<br>${L.c2}</div>${card(L)}</div>
      <div class="it user">${userMsg(L.u2)}</div>
      <div class="it"><div class="runline">● ${L.editing}</div></div></div>
    <div class="dock">${composer(L, L.ph)}</div>`;
  return `<div class="win">${topbar}<div class="body">${rail}${sbl}<section class="main">${head}${content}</section>${isSet ? "" : `<aside class="inspector">${inspector(L, isEmpty)}</aside>`}</div></div>`;
}

/* ───────── 输出 ───────── */
export const dirs = ["a", "b", "mix"];
export const locales = ["zh", "en"];
export const themes = ["light", "dark"];
export function screensFor(dir) {
  return dir === "mix"
    ? ["conversation", "conversation-inspector", "empty", "settings"]
    : ["conversation", "empty", "settings"];
}
export const baseName = (d, s, l, t) => `${d}-${s}-${l}-${t}`;

export function build() {
  mkdirSync(outDir, { recursive: true });
  for (const d of dirs)
    for (const s of screensFor(d))
      for (const l of locales)
        for (const t of themes) {
          const L = T[l];
          const scr = s === "conversation-inspector" ? "conversation" : s;
          const body =
            d === "b" ? bShell(L, scr) : aShell(L, scr, { mix: d === "mix", open: s === "conversation-inspector" });
          const css = d === "mix" ? ["common.css", "mix.css"] : ["common.css", d + ".css"];
          const html = `<!doctype html><html lang="${l === "zh" ? "zh-CN" : "en"}" data-theme="${t}"><head><meta charset="utf-8">
${css.map((c) => `<link rel="stylesheet" href="../${c}">`).join("\n")}
</head><body>${body}</body></html>`;
          writeFileSync(join(outDir, baseName(d, s, l, t) + ".html"), html);
        }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) build();

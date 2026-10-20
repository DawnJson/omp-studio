// 五个方向共用的数据、图标和窗口控件。只用于设计预览，不进应用。
// 图标路径取自 Lucide（ISC 许可）的线性图标，24×24 网格。

export const D = {
  projects: [
    {
      name: "omp-studio",
      tasks: [
        { t: "修复登录页的 bug", st: "run", when: "刚刚", active: true },
        { t: "重构数据层", st: "wait", when: "5 分钟" },
        { t: "整理日志格式", st: "done", when: "40 分钟" },
        { t: "升级依赖", st: "err", when: "2 小时" },
      ],
    },
    {
      name: "blog",
      tasks: [
        { t: "写发布说明", st: "idle", when: "昨天" },
        { t: "迁移到 Astro", st: "idle", when: "3 天" },
      ],
    },
  ],
  history: 12,
  title: "修复登录页的 bug",
  project: "omp-studio",
  path: "E:\\work\\omp-studio",
  branch: "task/login-fix",
  ahead: 2,
  u1: "登录页在 Safari 上点「登录」没反应，帮我查一下原因并修好，顺便补个测试。",
  proc: { dur: "2 分 14 秒", tools: 12, agents: 1, short: "2:14" },
  lead: "原因是表单提交用了 <code>requestSubmit()</code>，Safari 15.4 以下不支持，点击被静默吞掉了。",
  bullets: [
    "改为在 <code>submit</code> 事件里统一处理，旧版本走 <code>form.submit()</code> 回退",
    "新增 <code>login.test.ts</code>，覆盖按钮提交和回车提交两条路径",
    "<code>npm test</code> 41 项全部通过",
  ],
  files: [
    { p: "src/login/form.ts", a: 31, d: 6 },
    { p: "src/login/submit.ts", a: 9, d: 0 },
    { p: "test/login.test.ts", a: 8, d: 0 },
  ],
  add: 48,
  del: 6,
  u2: "把表单的错误提示也改成中文。",
  live: { verb: "正在编辑", target: "src/login/messages.ts", t: "0:42" },
  model: "DeepSeek V4 Flash",
  think: "高",
  approval: "写入自动",
  ctx: 34,
  tokens: "112k",
  cost: "$0.21",
  ph: "插话，Ctrl+Enter 稍后发送…",
  emptyPh: "让 omp 做点什么…",
  recent: [
    { t: "修复登录页的 bug", st: "run", meta: "运行中 · 刚刚" },
    { t: "重构数据层", st: "wait", meta: "等你确认 · 5 分钟前" },
    { t: "整理日志格式", st: "done", meta: "已完成 · 40 分钟前" },
  ],
};

const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
  terminal: '<path d="m5 8 4 4-4 4"/><path d="M12 16h7"/>',
  branch:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  diff: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6M12 7v6M9 17h6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  chevUD: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alertC: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5M12 16.2h.01"/>',
  xC: '<circle cx="12" cy="12" r="9.5"/><path d="m15 9-6 6M9 9l6 6"/>',
  checkC: '<circle cx="12" cy="12" r="9.5"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  up: '<path d="m5 12 7-7 7 7M12 19V5"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folderPlus:
    '<path d="M12 10v6M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  wrench:
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  compose:
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a1 1 0 0 1 3 3l-9 9a2 2 0 0 1-.85.5l-2.87.84a.5.5 0 0 1-.62-.62l.84-2.87a2 2 0 0 1 .5-.85z"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  globe:
    '<circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19"/>',
  contrast: '<circle cx="12" cy="12" r="9.5"/><path d="M12 2.5v19a9.5 9.5 0 0 0 0-19z" fill="currentColor"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 16v-4.5M12 8h.01"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  paperclip:
    '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  hammer:
    '<path d="m15 12-8.5 8.5c-.83.83-2.17.83-3 0 0 0 0 0 0 0a2.12 2.12 0 0 1 0-3L12 9"/><path d="M17.64 15 22 10.64"/><path d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.18 6.18 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"/>',
};

export const icon = (n, s = 16, cls = "") =>
  `<svg class="ico ${cls}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;

/** 上下文圆环：带数字，避免和加载转圈混淆 */
export function ring(pct, s = 16, w = 2.4, track = "var(--ring-track)", fg = "var(--accent)") {
  const r = (24 - w * 2) / 2,
    c = 2 * Math.PI * r;
  return `<svg class="ring" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="${r}" stroke="${track}" stroke-width="${w * 1.5}"/><circle cx="12" cy="12" r="${r}" stroke="${fg}" stroke-width="${w * 1.5}" stroke-dasharray="${((c * pct) / 100).toFixed(2)} ${c.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 12 12)"/></svg>`;
}

/** Windows 11 系统三键（titleBarOverlay 由系统绘制，这里只是示意） */
export const winctl = (color = "var(--tx)") =>
  `<div class="winctl" style="color:${color}"><span><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" fill="none"><path d="M0 5.5h10"/></svg></span><span><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" fill="none"><rect x=".5" y=".5" width="9" height="9" rx="1.5"/></svg></span><span><svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" fill="none"><path d="M.5 .5l9 9M9.5 .5l-9 9"/></svg></span></div>`;

export const winctlCss = `.winctl{display:flex;height:40px;flex:none}.winctl span{width:46px;height:40px;display:grid;place-items:center;opacity:.85}`;

/** 共用 reset；每个方向自己定义字体和颜色变量 */
export const baseCss = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:800px;overflow:hidden}
body{font-family:var(--sans);font-size:13px;line-height:20px;color:var(--tx);background:var(--win);-webkit-font-smoothing:auto}
svg{display:block;flex:none}
.ico{stroke-width:var(--stroke,1.75)}
code{font-family:var(--mono);font-size:.88em;font-variant-ligatures:none}
.mono{font-family:var(--mono);font-variant-ligatures:none}
.num{font-variant-numeric:tabular-nums}
.sp{flex:1}
${winctlCss}
`;

export const FONT = {
  sans: `"Segoe UI Variable Text","Segoe UI Variable","Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif`,
  display: `"Segoe UI Variable Display","Segoe UI Variable","Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif`,
  mono: `"Cascadia Code","Cascadia Mono",Consolas,"Microsoft YaHei UI",monospace`,
  // 以下两套需要随应用打包字体（本机装了才看得到）
  serifCjk: `Georgia,"Noto Serif SC","Source Han Serif SC","Songti SC",serif`,
  notoSans: `"Segoe UI Variable Text","Segoe UI Variable","Noto Sans SC","Microsoft YaHei UI",sans-serif`,
  notoDisplay: `"Segoe UI Variable Display","Segoe UI Variable","Noto Sans SC","Microsoft YaHei UI",sans-serif`,
};

export const doc = (theme, css, body) =>
  `<!doctype html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="utf-8"><style>${baseCss}${css}</style></head><body>${body}</body></html>`;

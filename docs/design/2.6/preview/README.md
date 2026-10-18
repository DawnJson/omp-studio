# 阶段 2.6 设计预览（高保真静态稿）

对应 `../../direction-2.6.md` 的方向 A「仪表」、方向 B「工作台」，以及混搭（A 的色板/脊线/顶栏 + B 的可收起检查栏）。色板、圆角取自该文档；字体栈取自 `src/renderer/styles/tokens.css`。只是预览，不改应用代码和 token。

## 重新生成

```pwsh
node docs/design/2.6/preview/render.mjs
```

脚本先由 `build.mjs` 生成 `html/*.html`（已 gitignore），再用仓库自带的 Electron（`render-main.cjs`）逐个加载并 `capturePage` 成 1200×800（缩放 1）PNG，输出到 `screenshots/design-2.6/`（gitignored），最后拼对比图。约 20 秒。

## 文件

| 文件 | 内容 |
|---|---|
| `common.css` | 三个方向共用的组件样式（只引用变量） |
| `a.css` / `b.css` | 各自的色板（浅/深）、圆角、布局 |
| `mix.css` | `@import a.css`，再加检查栏（收起窄栏 / 展开 236 宽） |
| `build.mjs` | 中英文案、图标、各方向外壳和画面的 HTML 生成 |
| `render.mjs` / `render-main.cjs` | 截图脚本 |

## 输出：`screenshots/design-2.6/<方向>-<画面>-<语言>-<主题>.png`

- 方向：`a`、`b`、`mix`
- 画面：`conversation`（主对话）、`empty`（空状态：项目名 + 最近 3 个任务，输入框贴底）、`settings`（两栏表格式设置页）；`mix` 另有 `conversation-inspector`（检查栏展开；`conversation` 里是收起状态）
- 语言：`zh`、`en`；主题：`light`、`dark`
- 对比图 `compare-<画面>-<语言>-<主题>.png`：A | B | Mix 三列并排（Mix 取检查栏收起的版本）

## 没画的

门（gate）、模型选择对话框、窄窗口（<1000）抽屉形态。

# omp-studio UI 规范（索引）

界面规范按节拆成 `docs/design/spec/` 下的文件；代码和文档里的 `spec §x.y` 指下表的节号。改哪块界面就读对应文件（组件先读 §4 通则），改完同步更新。

- 硬约束：过程信息的展开 / 折叠照 omp 的默认（例外：连续的工具调用合成一组，§4.11）；一个主导航；遥测克制；只用 token；中英双语；遵守 reduced-motion。
- 颜色、字号、间距等变量都在 `src/renderer/styles/tokens.css`（深浅两套、reduced-motion），文中的 `--xxx` 以它为准。
- 证据标记：**✔** = 在仓库里核实过（fixture、wire schema、omp 文档）；**[推测]** = 没有实测，实现时要用回放或真机验证；未标记的是设计决定。
- 设计方向的来由见 `docs/design/direction-*.md`。

| 节 | 文件 | 内容 |
|---|---|---|
| §1 | [`spec/1-decisions.md`](spec/1-decisions.md) | 裁决表 |
| §2 | [`spec/2-tokens.md`](spec/2-tokens.md) | Token |
| §3 | [`spec/3-layout.md`](spec/3-layout.md) | 布局 |
| §4 | [`spec/4.0-general.md`](spec/4.0-general.md) | 组件通则 |
| §4.1 | [`spec/4.1-status-dot.md`](spec/4.1-status-dot.md) | StatusDot |
| §4.2 | [`spec/4.2-task-row.md`](spec/4.2-task-row.md) | TaskRow |
| §4.3 | [`spec/4.3-folder-group.md`](spec/4.3-folder-group.md) | FolderGroup |
| §4.4 | [`spec/4.4-waiting-strip.md`](spec/4.4-waiting-strip.md) | WaitingStrip |
| §4.5 | [`spec/4.5-sidebar.md`](spec/4.5-sidebar.md) | Sidebar 外壳 |
| §4.6 | [`spec/4.6-topbar-title.md`](spec/4.6-topbar-title.md) | 顶栏任务标题与待办板 |
| §4.7 | [`spec/4.7-empty-state.md`](spec/4.7-empty-state.md) | EmptyState |
| §4.8 | [`spec/4.8-user-message.md`](spec/4.8-user-message.md) | UserMessage |
| §4.9 | [`spec/4.9-assistant-message-markdown.md`](spec/4.9-assistant-message-markdown.md) | AssistantMessage 与 Markdown |
| §4.10 | [`spec/4.10-code-block.md`](spec/4.10-code-block.md) | CodeBlock |
| §4.11 | [`spec/4.11-process-area.md`](spec/4.11-process-area.md) | 过程区 |
| §4.14 | [`spec/4.14-composer.md`](spec/4.14-composer.md) | Composer |
| §4.15 | [`spec/4.15-jump-to-latest.md`](spec/4.15-jump-to-latest.md) | JumpToLatest 药丸 |
| §4.16 | [`spec/4.16-drop-overlay.md`](spec/4.16-drop-overlay.md) | DropOverlay |
| §4.17 | [`spec/4.17-gates.md`](spec/4.17-gates.md) | 门 |
| §4.18 | [`spec/4.18-command-palette.md`](spec/4.18-command-palette.md) | CommandPalette |
| §4.19 | [`spec/4.19-settings-page.md`](spec/4.19-settings-page.md) | SettingsPage |
| §4.20 | [`spec/4.20-providers-login.md`](spec/4.20-providers-login.md) | Provider 与订阅 |
| §4.21 | [`spec/4.21-omp-outdated.md`](spec/4.21-omp-outdated.md) | omp 版本过旧 |
| §4.22 | [`spec/4.22-omp-setup-card.md`](spec/4.22-omp-setup-card.md) | OmpSetupCard |
| §4.23 | [`spec/4.23-controls.md`](spec/4.23-controls.md) | 通用控件 |
| §4.24 | [`spec/4.24-empty-and-errors.md`](spec/4.24-empty-and-errors.md) | 空状态与错误汇总 |
| §4.25 | [`spec/4.25-review-view.md`](spec/4.25-review-view.md) | ReviewView |
| §4.26 | [`spec/4.26-terminal-panel.md`](spec/4.26-terminal-panel.md) | TerminalPanel |
| §4.27 | [`spec/4.27-file-preview-pane.md`](spec/4.27-file-preview-pane.md) | FilePreviewPane |
| §4.28 | [`spec/4.28-agents-panel.md`](spec/4.28-agents-panel.md) | 子代理面板 |
| §4.29 | [`spec/4.29-browser-panel.md`](spec/4.29-browser-panel.md) | 浏览器面板 |
| §4.31 | [`spec/4.31-session-info.md`](spec/4.31-session-info.md) | 会话信息、请求记录与分享 |
| §5 | [`spec/5-interaction.md`](spec/5-interaction.md) | 交互 |
| §6 | [`spec/6-not-in-v1.md`](spec/6-not-in-v1.md) | 第一版不做 |
| §7 | [`spec/7-acceptance.md`](spec/7-acceptance.md) | “手感”验收清单 |
| §A | `src/shared/i18n/zh-CN/`、`en/` | 界面文字（key 表以代码为准，不另抄） |
| §B | [`spec/appendix-b-open-items.md`](spec/appendix-b-open-items.md) | 对主进程/协议的依赖、待核实与需要仓库所有者拍板的事 |

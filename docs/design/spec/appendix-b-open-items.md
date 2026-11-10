# 附录 B. 对主进程/协议的依赖、待核实与需要仓库所有者拍板的事

**需要仓库所有者拍板**

| # | 事项 | 本规范的选择 |
|---|---|---|
| 1 | 审批模式默认值 | **已定（2026-10-18）：完全跟随 omp 的配置**（`tools.approvalMode`），启动时从不传 `--approval-mode`；胶囊改的就是 omp 配置（§5.8）。studio 不自己存默认值 |
| 2 | 审批模式切换语义 | omp 在进程启动时读配置；胶囊改配置后，之后启动的任务生效，运行中的任务要重启（§5.8）。备选"重启进程并恢复会话"需先实测 `open_session` 无损恢复 |
| 3 | 测试结果显示 | 不显示；若要做，需先决定识别规则（omp 不给结构化的测试结果） |
| 4 | API key 类提供商登录 | **已定（2026-10-24）**：设置页输入，主进程经 `omp auth import` 存进 omp 自己的凭据库，和终端版共用（`docs/architecture/login.md`）；studio 不另存凭据 |
| 5 | 新增运行时依赖 / 技术选型 | **已定**：语法高亮 `shiki`、Markdown `markdown-it`、公式 `katex`；i18n 和覆盖式滚动条自己写（`src/shared/i18n/`、`ui/OverlayScrollbar.tsx`） |
| 6 | 字体是否打包 | **已定（0.3.29）**：打包 Geist / Geist Mono，中文仍用微软雅黑 UI；只改 `--font-*` |
| 7 | 阅读列宽 / 正文字号 | **已定（2026-10-30）**：列宽按主区比例并夹在上下限之间（见 `--content-w`）；正文字号可凭肉眼调，只改 `--fs-prose` |
| 8 | 任务完成不发系统通知 | 取“只有等你会叫你”的立场；若用户反馈需要，再加一个默认关闭的设置项 |
| 9 | 产品名/Logo | 暂定名 omp-studio，侧栏头不放 Logo/应用名 |

**需要实测 / 录制 fixture（[推测] 项）**

1. `titleBarOverlay` 在 Win11 上是否保留 Snap Layouts；无应用菜单时编辑快捷键是否正常；Electron 44 的 `linear()` 弹簧、`text-wrap: pretty` 支持。
2. 终端正在使用同一会话文件的探测方法；运行中 `set_model` 的生效时机（决定 `composer.nextRequest` 文案是否保留）。

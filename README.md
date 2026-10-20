# omp-studio

[oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp`）的桌面端，形态类似 Codex 桌面版和 Claude Code 桌面版：一个任务一段对话，结果和改动在前，过程默认折叠。目前只有 Windows 版，处于内测阶段（`0.x`）。

> omp-studio 是暂定名，和 omp 官方没有关系。

## 它做什么

- 每个任务启动一个 `omp --mode rpc-ui` 子进程，通过 stdio 收发 NDJSON。用的是官方原版 omp，不 fork，不打补丁。
- 侧栏按项目列出任务；需要你确认的任务（审批、提问）会置顶提示。
- 能读取终端里的 omp 会话历史，接着聊。和终端共用 `~/.omp`，登录、模型、设置两边一致。
- 设置页可以登录模型提供商、选默认模型、修改 omp 的全部设置。

## 安装

1. 下载 `omp-studio-<版本>-setup.exe`，双击安装（正式的发布渠道还没定，内测期间由仓库所有者直接分发）。装在用户目录，不需要管理员权限。安装包没有签名，第一次运行 Windows SmartScreen 会拦一下，点"更多信息 → 仍要运行"。
2. 第一次打开时 omp-studio 会找 omp：
   - PATH 上没有 omp：从官方构建服务（`build.stencil.so`）下载并校验一份，放到用户 PATH 最前面，之后每小时检查更新（有补丁时只下载差量）。
   - 已经有 omp（自己装的，或由 Tern 等管理的）：问一次要不要由 omp-studio 接管。不接管就直接用你原来的那份。
3. 之后 omp-studio 自己会在 设置 → 关于 里检查更新，下载后重启安装。内测期间更新源是仓库所有者本机的 `E:\work\code\omp-studio-updates`（`npm run release` 发版时写进去），别的机器上装的版本不检查更新，由仓库所有者直接分发新的安装包。

遇到问题：顶栏菜单（≡）→ 帮助与反馈，按模板提 issue，附上 设置 → 关于 → 问题排查 → "导出…" 生成的诊断信息。

## 开发

需要 Node.js 24 以上和 Windows（PowerShell）。

```powershell
npm ci
npm run dev          # 开发，热更新
npm run typecheck    # 类型检查（tsc 只做检查，Node 24 / Electron 直接跑 .ts）
npm run lint         # 静态检查（Oxlint）
npm run format       # 格式化（Prettier）
npm test             # 单元测试（Vitest）
npm run build        # 构建到 out/
npm run test:e2e     # 端到端测试（Playwright + Electron），先 build
npm run dist         # 打 NSIS 安装包到 release/
npm run icons        # 改了标志（src/shared/ui/pixel-pi.ts）后重新生成 resources/icon.ico 和 tray.png
```

- 真实调模型的测试和 RPC 录制要用 `.env`（模板 `.env.example`），里面放测试用的 provider key 和 `STUDIO_TEST_MODEL`。不会读你真实 `~/.omp` 里的凭据。
- 发版：`npm run release -- <版本>`（先加 `--dry-run` 看一遍），把 `CHANGELOG.md` 的"未发布"改成这个版本、改版本号、跑检查、提交、打 tag、打安装包。
- 架构文档在 `docs/architecture/`，设计规范在 `docs/design/spec.md`，计划和已定的决策在 `PLAN.md`，实测出来的 omp 行为在 `problem.md`。

## 许可

[MIT](LICENSE)

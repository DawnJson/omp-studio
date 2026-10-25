# omp-studio

[oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp`）的桌面端。每个任务在伪终端里运行一个官方原版的交互式 omp，界面按 omp 通过 TSP 协议发来的节点绘制，工具卡片、思考块、子代理的展开和折叠与 omp 一致。登录、模型、设置和会话与终端版 omp 共用 `~/.omp`。

目前处于内测阶段（`0.x`），支持 Windows x64 和 Apple 芯片的 macOS。

> omp-studio 是暂定名，由第三方独立开发。

![omp-studio 浅色主题：一个完成的任务，含待办板、两个子代理、pytest 输出和回答](docs/images/conversation-light.png)

## 功能

- 侧栏按项目列出任务，终端里开过的 omp 会话也在其中，点开即恢复，接着聊。
- 审批和提问由 omp 画在输入框上方。有任务在等你时，侧栏顶部出现提示条（`Ctrl+J` 跳过去）；窗口不在前台时任务栏闪烁，并按 omp 的通知设置发系统通知。关掉窗口后应用留在托盘，任务继续运行。
- 输入框上方是待办板、子代理和后台作业。子代理面板里可以查看每个子代理的输出，给它插话、结束或恢复它。`/btw` 在侧边面板里旁路提问，主对话不受影响。
- 评审（`Ctrl+Shift+D`）按文件或按行暂存、丢弃，提交信息可以由 omp 生成；分支菜单里提交、推送、创建 PR、合并。项目是 git 仓库时，新任务可以开在独立 worktree 里。
- 内置终端（``Ctrl+` ``）打开在任务的工作目录；文件面板（`Ctrl+Shift+E`）显示文件树和预览。
- 设置覆盖 Provider 登录和 API key、自定义 provider、模型角色、MCP、Skills、插件市场，以及 omp 的全部设置项。改动写进 omp 自己的配置，终端版随之生效。
- `Ctrl+K` 命令面板搜索任务、历史会话、命令和斜杠命令。
- 浅色、深色主题，中文、英文界面。对话过程区的文字与 omp 一样用英文。

macOS 上快捷键的 `Ctrl` 换成 `⌘`。

## 截图

<table>
  <tr>
    <td><img src="docs/images/conversation-dark.png" alt="深色主题下的同一个任务"></td>
    <td><img src="docs/images/command-palette.png" alt="Ctrl+K 命令面板"></td>
  </tr>
  <tr>
    <td align="center">深色主题</td>
    <td align="center">命令面板（<code>Ctrl+K</code>）</td>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/images/settings.png" alt="设置 → 通用：外观、通知、快捷键"></td>
  </tr>
  <tr>
    <td colspan="2" align="center">设置 → 通用</td>
  </tr>
</table>

## 安装

内测期间安装包由仓库所有者直接分发，正式发布渠道还没定。

### Windows

双击 `omp-studio-<版本>-setup.exe`，安装到当前用户目录，不需要管理员权限。安装包没有签名，第一次运行时 SmartScreen 会拦截，点"更多信息 → 仍要运行"。

### macOS（Apple 芯片）

mac 版由 GitHub Actions（`.github/workflows/mac.yml`）在手动触发或推送 `v*` tag 时打包，构建产物 `omp-studio-mac-arm64` 里有 dmg 和 zip，保留 14 天。包是 ad-hoc 签名，不经公证，更新靠手动下载新版；目前只在 CI 的 macOS 机器上跑过测试。

把 `omp-studio.app` 拖进"应用程序"后，Gatekeeper 会拦截。在终端执行：

```sh
xattr -cr /Applications/omp-studio.app
```

或者在 系统设置 → 隐私与安全性 里点"仍要打开"。

## 第一次启动

第一次启动时，omp-studio 先在 PATH 上找 omp：

- PATH 上没有 omp：准备页写明下载来源 `build.stencil.so` 和文件大小，点"下载并安装"后下载官方构建并校验 sha256。Windows 上装到 `%LOCALAPPDATA%\omp-studio\omp\`，并放到用户 PATH 最前面，之后新开的终端里敲 `omp` 用的是同一份；macOS 上装到 `~/Library/Application Support/omp-studio/omp/`，PATH 保持原样。
- PATH 上已有 omp（自己装的，或由 Tern 等工具管理的）：只问一次是否交给 omp-studio 管理。选"由 omp-studio 管理"，会另装一份官方版放到用户 PATH 最前面，原来那份保留在原处；选继续用原来的，更新仍由它原来的安装方式负责。Windows 上 omp-studio 只启动 `.exe`，PATH 上第一个 omp 是 `omp.cmd` 这类脚本时，需要交给 omp-studio 管理。

omp-studio 管理的 omp 每小时检查一次新版本，在后台下载并替换，有差量补丁时只下载补丁；正在运行的任务继续用旧版本，新任务用新版本。设置 → 关于 → omp 里可以手动检查更新。

## 更新 omp-studio

Windows 安装版启动 10 秒后检查一次更新，之后每小时一次，也可以在 设置 → 关于 点"检查更新"。下载完成后点"重启并安装"。

内测期间更新源是仓库所有者本机的 `E:\work\code\omp-studio-updates`，由 `npm run release` 写入。其他机器上的 设置 → 关于 显示"这个版本没有配置更新源"，新版本由仓库所有者直接分发。mac 版需要手动下载新版本。

## 反馈问题

1. 在 设置 → 关于 → 问题排查 里点"导出诊断信息…"。文件包含版本、系统、omp 状态和最近 3 天的日志，用户名、家目录和 key 已去掉。
2. `Ctrl+K` 打开命令面板，选"关于与反馈"，点"报告问题"，进入 GitHub Issues 的模板页。内测期间仓库是私有的，需要先被加为协作者。
3. 按模板填写，把诊断信息文件拖进"诊断信息"框。截图里有模型提供商的账户信息时先打码。

## 开发

需要 Node.js 24 以上。日常开发在 Windows（PowerShell）上进行；`npm run dist:mac` 必须在 macOS 上运行。

```powershell
npm ci
npm run dev          # 开发，热更新
npm run typecheck    # 类型检查（tsc 只做检查，Node 24 / Electron 直接跑 .ts）
npm run lint         # 静态检查（Oxlint）
npm run format       # 格式化（Prettier）；format:check 只检查
npm test             # 单元测试（Vitest）
npm run build        # 构建到 out/
npm run test:e2e     # 端到端测试（Playwright + Electron），先 build
npm run dist         # 打 Windows NSIS 安装包到 release/
npm run dist:mac     # 打 macOS arm64 的 dmg 和 zip 到 release/（只能在 macOS 上跑）
npm run icons        # 改了标志（src/shared/ui/pixel-pi.ts）后重新生成 resources/ 下的图标
```

- 调真实模型的冒烟测试 `test/task-real-omp.test.ts` 默认跳过。把 `.env.example` 复制成 `.env`，填测试用的 provider key 和 `STUDIO_TEST_MODEL`，PATH 上要有 omp，然后运行 `$env:STUDIO_REAL_OMP = "1"; npx vitest run test/task-real-omp.test.ts`。测试里 omp 的 agent 目录指向临时目录，真实 `~/.omp` 里的凭据不参与。
- 发版：`npm run release -- <版本>`（先加 `--dry-run` 看一遍）。脚本把 `CHANGELOG.md` 的"未发布"改成这个版本、改版本号、跑类型检查和受改动影响的单测、提交、打 tag、打 Windows 安装包并写入更新目录。
- 仓库规则在 `AGENTS.md`，踩过的坑在 `LESSONS.md`。架构文档在 `docs/architecture/`，实测的 omp 行为也记在对应功能的文档里；界面规范在 `docs/design/spec.md`；版本变化在 `CHANGELOG.md`。

## 许可

[MIT](LICENSE)

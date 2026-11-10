# Linux 版：打包与分发

只出 x64 AppImage（仓库所有者 2026-10-26 定），从 GitHub Release 自动更新。**本仓库没有 Linux 真机**："实测"没特别说明的都是 GitHub Actions `ubuntu-24.04`（Xvfb，没有桌面环境、窗口管理器和 D-Bus 会话）；"WSLg"是开发机的 WSL2 Ubuntu 24.04（见"WSL2 + WSLg 实测"）。GNOME / KDE 上的托盘、通知、Wayland 都没测。

## 打包

```
npm run dist:linux
```

必须在 Linux 上打：node-pty 1.1.0 的预编译件只有 win32 和 darwin，Linux 上 `npm ci` 时由 node-gyp 编出 `build/Release/pty.node`。CI 是 `.github/workflows/linux.yml`。

`electron-builder.yml` 的 `linux:` / `appImage:` / `toolsets:` 段：

- 目标只有 x64 AppImage；图标 `resources/icon.png`（`scripts/make-icons.ts` 生成）。
- node-pty 只打包 `build/Release/pty.node`；`scripts/check-package.ts` 的 `linux-x64` 分支检查。
- **静态运行时**（`toolsets.appimage`）：electron-builder 默认的旧运行时要系统的 libfuse2，Ubuntu 22.04 起默认不装。实测在 ubuntu-24.04（只有 libfuse3）上旧运行时的 AppImage 直接退出（`AppImages require FUSE to run`），静态运行时正常启动。它在 electron-builder 26 里标为 beta。两种运行时的 `AppRun` 相同，`latest-linux.yml` 照常生成。

## Chromium 沙箱

Ubuntu 23.10 起 AppArmor 默认不许非特权进程建 user namespace（`kernel.apparmor_restrict_unprivileged_userns = 1`），Chromium 沙箱要用它；AppImage 不能装 setuid 的 `chrome-sandbox`，所以：

- electron-builder 生成的 `AppRun` 先跑 `unshare -Ur true`，失败就加 `--no-sandbox`。实测 ubuntu-24.04 默认设置下带 `--no-sandbox`，应用正常。
- 用户想开沙箱，可以给 AppImage 加 AppArmor 配置（实测写 AppImage 完整路径有效；下面的通配路径写法没测），路径按自己的位置改：

  ```
  # /etc/apparmor.d/omp-studio-appimage
  abi <abi/4.0>,
  include <tunables/global>

  profile omp-studio-appimage /home/*/**/omp-studio-*.AppImage flags=(unconfined) {
    userns,
  }
  ```

  然后 `sudo apparmor_parser -r /etc/apparmor.d/omp-studio-appimage`。
- CI 的 e2e 和打包版冒烟前 `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`，只在那台机器上放开。

## 启动时窗口一直透明

窗口在 `ready-to-show` 先以不透明度 0 显示，渲染进程等 `first-contentful-paint` 再通知淡入（spec §2.6"窗口出现 / 消失"）。Linux 打包版里 Chromium 可能只记 `first-paint`、一直不记 FCP（ubuntu-24.04 CI 实测连起 3 次都这样；窗口变不透明后 FCP 才出现，推测 Chromium 在透明窗口里不算"有内容的绘制"）。未打包的 out/ 在同一台机器上有 FCP，所以 e2e 发现不了。

所以设置读到后最多等 `App.tsx` 的 `firstFrameFallbackMs`，FCP 没来也淡入。`scripts/smoke-packaged.ts` 在 `linux.yml` 和 `mac.yml` 里启动打包版，窗口没显示并淡入就失败。**`ready-to-show` 之前 `getOpacity()` 是默认的 1**：只看不透明度的检查第一次轮询就过，要先看 `isVisible()`。

## 进程

- 没有 Job Object，和 mac 共用 `sh` 看门狗（`platform/posix/watchdog.ts`）和按进程树 SIGKILL（`platform/posix/process-tree.ts`），见 `terminal.md`"POSIX（macOS / Linux）的进程结束和看门狗"。看门狗写 `kill -s 0`：Ubuntu 的 `/bin/sh` 是 dash，不认 `-0 --`。
- 实测（打包版）：`kill -9` 主进程 4 秒后，omp、看门狗、Electron 子进程都没了。
- WSLg 实测：omp 的 bash 工具让命令自己开进程组，只杀 omp 的进程组会留下被 init 收养的进程；所以看门狗先 SIGSTOP 组、按父子关系收齐组里各进程的后代再一起 SIGKILL，8 秒内什么都不剩。
- WSLg 实测：只给主进程发 SIGTERM 时，主进程 1 秒内退出，omp 没有残留（没区分是 `shutdown.ts` 还是看门狗收的尾）。

## 从桌面启动时的 PATH

桌面环境启动的应用拿不到 `~/.bashrc` 里加的 PATH（omp 安装脚本、bun 都写在那里）。主进程启动时用登录 shell `-ilc` 取一次 PATH 合并进来，和 mac 同一段代码（`platform/darwin/login-path.ts`，见 `terminal.md`"macOS / Linux 的 PATH"）。

实测：omp 在 `~/.local/bin`、PATH 只写在 `~/.bashrc`，`env -i PATH=/usr/bin:/bin` 启动打包版能找到 omp。注意有 `~/.bash_profile` 时登录 bash 不读 `~/.profile`，也就不读 `~/.bashrc`（GitHub runner 有这个文件；Ubuntu 桌面默认没有）。

找到用户自己装的 omp 后照常问是否接管（`omp-install.md`）；Linux 和 mac 接管不改 PATH，弹窗正文用 `omp.takeover.*StudioOnly`（spec §4.22）。

## 关窗口和退出

和 Windows 一样，× 只隐藏窗口，任务继续跑（仓库所有者定，2026-10-26）。

- GNOME 默认没有托盘（要装 AppIndicator 扩展），隐藏后可能找不到托盘图标，所以 Linux 加了 `Ctrl+Q` 退出（`window/hide-on-close.ts`，经 `app.quit()` 走 `shutdown.ts`）。第一次 × 时的系统通知写明 Ctrl+Q 退出、再次打开应用找回窗口（`notify.tray.stillRunning.*Linux`）。
- 实测：xdotool 发 Ctrl+Q（XTEST）主进程退出、无残留。Playwright 的 `page.keyboard` 和 `xdotool key --window`（XSendEvent）发的 Ctrl+Q 都不让应用退出，原因没查，不能用来测。
- WSLg 实测：`webContents.sendInputEvent` 发 Ctrl+Q，退出码 0，3 秒后 omp、看门狗、AppImage 挂载进程都没了。× 之后 `isVisible()` 为 false、主进程还在。
- 没测：真实桌面上的托盘图标、系统通知、再次打开应用带回窗口（`second-instance`）。WSLg 的 D-Bus 上没有 `StatusNotifierWatcher`，托盘图标不出现；`Notification.isSupported()` 为 true，但没核对通知是否真的弹出。

## 窗口

- 窗口图标见 `main-window.ts` 的 `windowIconPath`。
- 顶栏和 Windows 一样用 `titleBarOverlay`，Electron 在 Linux 上自己画三个窗口按钮。实测 Xvfb 和 WSLg 里都在顶栏右端正常显示，WSLg 不另加系统标题栏。

## WSL2 + WSLg 实测（2026-10-26）

Windows 11 开发机 `wsl --install` 装 Ubuntu 24.04（WSL 内核 6.18、WSLg 1.0.79），在 WSL 文件系统里 `npm ci`、`npm run dist:linux`。和 CI 不同：有显示服务和 D-Bus 会话；WSL 内核没有 `apparmor_restrict_unprivileged_userns`，**直接启动 AppImage 时 Chromium 沙箱开着**（Playwright 启动 Electron 时自己会加 `--no-sandbox`，看沙箱要不经 Playwright）。Electron 走 X11（XWayland），没测 Wayland 原生。

用 Playwright 驱动 AppImage 走了一遍（agent 目录指向临时目录）：

- 启动 4 秒内窗口淡入（这次有 FCP）。
- PATH 上没有 omp：准备页点"下载并安装"，自管 omp 装好、状态 `studio_managed`、不在 PATH 上；之后自管更新也走通了（没盯过程）。Linux / mac 不改 PATH，准备页正文用 `omp.missing.bodyStudioOnly`（spec §4.22）。
- 中文带空格的项目目录里发 prompt，正常回答、回到空闲。
- 内置终端打开 bash，cwd 是项目目录。

## 自动更新、自管 omp

- 自动更新见 `auto-update.md`"Linux"。
- 自管 omp 的下载和目录见 `omp-install.md`"Linux（x64）"。

## 没测

- 真实桌面环境（GNOME、KDE）、Wayland、托盘、系统通知、`.desktop` 集成（AppImage 不自动注册）。
- 真实桌面上打包版跑一轮 prompt（CI 只测到服务进程起来、窗口显示；WSLg 跑过但不是真实桌面）。
- 内置终端的 e2e（`terminal.e2e.ts` 的命令按 PowerShell / zsh 写）。
- 自动更新的下载、替换、重启整条路径。

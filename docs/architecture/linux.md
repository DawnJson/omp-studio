# Linux 版：打包与分发

只出 x64 AppImage（仓库所有者 2026-10-26 定），从 GitHub Release 自动更新。**本仓库没有 Linux 真机**：下面标"实测"的，没特别说明的都是在 GitHub Actions 的 `ubuntu-24.04` 机器上（Xvfb，没有桌面环境、窗口管理器和 D-Bus 会话）跑出来的；标"WSLg"的是在开发机的 WSL2 Ubuntu 24.04 上跑的（见下面"WSL2 + WSLg 实测"）。GNOME / KDE 桌面上的托盘、通知、Wayland 都没测。

## 打包

```
npm run dist:linux    # electron-vite build && electron-builder --linux AppImage --x64 --publish never && check-package
```

必须在 Linux 上打：node-pty 1.1.0 的预编译件只有 win32 和 darwin，Linux 上 `npm ci` 时 node-gyp 编出 `build/Release/pty.node`（runner 自带 python3、make、g++）。CI 由 `.github/workflows/linux.yml` 在推到 `main`、推 tag 时跑。

`electron-builder.yml` 的 `linux:` / `appImage:` / `toolsets:` 段：

- 目标只有 `AppImage`、x64，产物名 `omp-studio-<版本>-x86_64.AppImage`；图标 `resources/icon.png`（512×512，`scripts/make-icons.ts` 生成），`extraResources` 带 `tray.png` 和窗口图标 `icon.png`。
- node-pty 只打包 `build/Release/pty.node`，编译中间文件和别的平台的预编译件都排除；`scripts/check-package.ts` 的 `linux-x64` 分支检查 `prebuilds/` 是空的、`build/` 下只有 `Release/pty.node`。
- **静态运行时**（`toolsets.appimage: "1.0.3"`，2026-10-26）：electron-builder 默认的旧运行时要系统的 libfuse2，Ubuntu 22.04 起默认不装。实测：在 ubuntu-24.04（只有 libfuse3）上旧运行时的 AppImage 直接退出，`dlopen(): error loading libfuse.so.2` / `AppImages require FUSE to run`；同一份应用用 1.0.3 打的 AppImage 正常启动、显示界面。1.0.3 在 electron-builder 26 的类型文档里标为 beta（"Runtime 20251108"）。两种运行时的 `AppRun` 脚本相同，`latest-linux.yml` 照常生成，blockmap 嵌在文件末尾。

## Chromium 沙箱

Ubuntu 23.10 起 AppArmor 默认不许非特权进程建 user namespace（`kernel.apparmor_restrict_unprivileged_userns = 1`），Chromium 的沙箱要用它。AppImage 不能装 setuid 的 `chrome-sandbox`，所以：

- electron-builder 生成的 `AppRun` 启动前跑 `unshare -Ur true` 试一下，失败就给应用加 `--no-sandbox`（`app-builder-lib/out/targets/appimage/appImageUtil.js`）。实测 ubuntu-24.04 默认设置下进程命令行带 `--no-sandbox`，应用正常显示。
- 用户想开着沙箱，可以给 AppImage 加一个 AppArmor 配置（实测：配置里写 AppImage 的完整路径，加了之后进程命令行里没有 `--no-sandbox`，应用进程正常起来；下面的通配路径写法没测）。路径按自己放 AppImage 的位置改：

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

## 启动时窗口一直透明（已修，2026-10-26）

启动时窗口在 `ready-to-show` 先以不透明度 0 显示，渲染进程等 `first-contentful-paint` 再通知主进程淡入（`App.tsx` → `windowReady`，spec §2.6"窗口出现 / 消失"）。Linux 打包版里 Chromium 只记了 `first-paint`、一直不记 FCP，窗口就永远透明：截屏是一整块底色，Playwright 的 `page.screenshot` 超时，但页面内容其实已经渲染好了（手动调 `windowReady` 后立刻正常）。未打包的 out/ 在同一台机器上有 FCP，所以 e2e 发现不了。

实测（ubuntu-24.04 CI，Xvfb）：没修的打包版连起 3 次都是 `visibility-state` 只有 `visible@0`、`paint` 只有 `first-paint@~180ms`，12 秒后不透明度还是 0。之前一次诊断看到 `visibility-state` 第一条是 `hidden`，按"页面开始时隐藏就改等可见"修过一版，在这个条件下不起作用。窗口变成不透明后 FCP 才出现（修后 `first-contentful-paint@~2300ms`）：看起来 Chromium 在透明窗口里不算"有内容的绘制"（推测，没查源码）。Windows 上 FCP 在导航后约 500ms 照常出现。

修法：设置读到后最多等 1 秒（`App.tsx` 的 `firstFrameFallbackMs`），FCP 还没来也通知主进程淡入。修后同样条件连起 3 次都在约 2.3 秒时淡入。`scripts/smoke-packaged.ts` 在 `linux.yml` 和 `mac.yml` 里启动打包好的应用，30 秒内窗口没显示并淡入就失败。注意窗口 `ready-to-show` 之前 `getOpacity()` 是默认的 1：只看不透明度的检查会在第一次轮询就通过（冒烟脚本第一版就是这样，撤掉修复也过），要先看 `isVisible()`。

## 进程

- 没有 Job Object，和 mac 共用 `sh` 看门狗（`platform/posix/watchdog.ts`）和按进程树 SIGKILL（`platform/posix/process-tree.ts`），见 `terminal.md`"POSIX（macOS / Linux）的进程结束和看门狗"。看门狗脚本写成 `kill -s 0`：Ubuntu 的 `/bin/sh` 是 dash，它的 `kill` 不认 `-0 --`。
- 实测（打包版）：服务进程 omp（`--mode rpc-ui`）启动时旁边有一个 `/bin/sh -c seen=0; …` 看门狗；`kill -9` 主进程 4 秒后，omp、看门狗、Electron 的子进程都没了。
- WSLg 实测：omp 的 bash 工具让命令自己开进程组（`python3 -c "import time; time.sleep(600)"` 的 pgid 是它自己的 pid）。看门狗原来只杀 omp 的进程组，`kill -9` 主进程后这个 python3 被 init 收养、一直留着；改成先 SIGSTOP 组、按父子关系收齐组里各进程的后代再一起 SIGKILL 后，8 秒内什么都不剩。
- WSLg 实测：只给主进程发 SIGTERM（注销、关机、`kill` 的默认信号）时，主进程 1 秒内退出，omp 子进程没有残留（没区分是走了 `shutdown.ts` 还是看门狗收的尾）。

## 从桌面启动时的 PATH

桌面环境启动的应用拿不到 `~/.bashrc` 里加的 PATH（omp 的安装脚本、bun 都写在那里）。主进程启动时用登录 shell（`$SHELL`，没有就 `/bin/bash`）`-ilc` 取一次 PATH 合并进来，和 mac 同一段代码（`platform/darwin/login-path.ts`，见 `terminal.md`"macOS / Linux 的 PATH"）。

实测：omp 放在 `~/.local/bin`、PATH 只写在 `~/.bashrc`，用 `env -i PATH=/usr/bin:/bin` 启动打包版，主进程的 PATH 变成 `~/.local/bin:/usr/bin:/bin:/snap/bin`，找到了 omp。注意 GitHub runner 的家目录有 `~/.bash_profile`，有它时登录 bash 不读 `~/.profile`，也就不读 `~/.bashrc`；Ubuntu 桌面默认没有这个文件。

找到用户自己装的 omp 后照常问是否接管（`omp-install.md`）；Linux 和 mac 接管不改 PATH，弹窗正文用 `omp.takeover.*StudioOnly`（spec §4.22）。

## 关窗口和退出

仓库所有者 2026-10-26 定：和 Windows 一样，× 只隐藏窗口，任务继续跑。

- GNOME 默认没有托盘（要装 AppIndicator 扩展），窗口隐藏后可能找不到托盘图标，所以 Linux 加了 `Ctrl+Q` 退出（`window/hide-on-close.ts`，主进程 `before-input-event`，不带 Shift / Alt / Super 才算；经 `app.quit()`，和托盘"退出"一样走 `shutdown.ts`）。第一次 × 时的系统通知写明按 Ctrl+Q 退出、再次打开应用找回窗口（`notify.tray.stillRunning.*Linux`）。
- 实测：AppImage 启动后用 xdotool 发 Ctrl+Q（XTEST 输入），主进程退出，没有残留进程（那次 omp 没起来）。Playwright 的 `page.keyboard` 和 `xdotool key --window`（XSendEvent）发的 Ctrl+Q 都没让应用退出，原因没查，不能用来测。
- WSLg 实测：服务进程 omp 和一个跑完的任务 omp 都在时，`webContents.sendInputEvent` 发 Ctrl+Q（走 `before-input-event`），主进程退出码 0，3 秒后 omp、看门狗、AppImage 的挂载进程都没有了。× 之后窗口 `isVisible()` 为 false、主进程还在。
- 没测：真实桌面上的托盘图标、系统通知、再次打开应用时把隐藏的窗口带回来（`second-instance`）。WSLg 的 D-Bus 会话上没有 `StatusNotifierWatcher`，托盘图标不会出现，和 GNOME 不装扩展时一样；`Notification.isSupported()` 为 true，但没有核对通知是否真的弹出来。

## 窗口

- 窗口图标用 `icon.png`（`main-window.ts` 的 `windowIconPath`）。
- 顶栏和 Windows 一样用 `titleBarOverlay`，Electron 在 Linux 上自己画最小化 / 最大化 / 关闭三个按钮。实测（Xvfb，没有窗口管理器）三个按钮在右上角正常显示；WSLg 里截 Windows 桌面，三个圆形按钮画在顶栏右端、和顶栏同底色，WSLg 不另加系统标题栏。

## WSL2 + WSLg 实测（2026-10-26）

开发机（Windows 11）上 `wsl --install` 装 Ubuntu 24.04（WSL 内核 6.18、WSLg 1.0.79），在 WSL 自己的文件系统里克隆仓库、`npm ci`（node-pty 由 node-gyp 编译）、`npm run dist:linux`。AppImage 的窗口经 WSLg 显示在 Windows 桌面上。和 CI 不同的地方：有显示服务和 D-Bus 会话；WSL 内核没有 `apparmor_restrict_unprivileged_userns`，`unshare -Ur true` 成功，所以**直接启动 AppImage 时不带 `--no-sandbox`，Chromium 沙箱开着**（Playwright 启动 Electron 时自己会加 `--no-sandbox`，看沙箱要不经 Playwright 启动）。Electron 选的是 X11（`--ozone-platform=x11`，走 XWayland），没测 Wayland 原生。

在新建的 WSL 用户下，用 Playwright 驱动 AppImage 走了一遍（omp 的 agent 目录指向临时目录）：

- 启动 4 秒内窗口淡入（这次有 FCP，约 2.5 秒）。
- PATH 上没有 omp：准备页 `missing`，点"下载并安装"，12 秒后自管 omp 18.12.6 装进 `~/.local/share/omp-studio/omp/bin/omp`，状态 `studio_managed`、不在 PATH 上。后来再启动时自管 omp 已经是 18.13.0（自管更新在 Linux 上走通了，没盯更新过程）。准备页正文原来写着"加入用户 PATH"，Linux / mac 上不会改 PATH，改用 `omp.missing.bodyStudioOnly`（spec §4.22）。
- 打开中文带空格的项目目录，用 `.env` 的 `STUDIO_TEST_MODEL` 发 `Reply with exactly: ok`，约 2 秒跑完，回答 `ok`，任务回到空闲。
- 内置终端（Ctrl+\`）打开 bash，提示符的 cwd 是项目目录（中文带空格的路径显示正常）。
- 关窗口、Ctrl+Q、SIGTERM、`kill -9` 见上面"进程"和"关窗口和退出"。

## 自动更新、自管 omp

- 自动更新见 `auto-update.md`"Linux"。
- 自管 omp 的下载和目录见 `omp-install.md`"Linux（x64）"。

## 没测

- 真实桌面环境（GNOME、KDE）、Wayland、托盘、系统通知、`.desktop` 集成（AppImage 不自动注册）。
- 真实桌面上打包版跑一轮 prompt：CI 只测到服务进程 omp 起来、窗口显示；WSLg 里跑过（见上），但 WSLg 不是真实桌面环境。
- 内置终端的 e2e（`terminal.e2e.ts` 的命令按 PowerShell / zsh 写）。
- 自动更新的下载、替换、重启整条路径。

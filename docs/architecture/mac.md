# macOS 版：打包与分发

只出 Apple 芯片（arm64）、不公证、不自动更新。**本仓库没有 Mac 真机，下面标"未实测"的都是依据 electron-builder 26 的源码和类型文档推出来的。**

## 打包

```
npm run dist:mac    # electron-vite build && electron-builder --mac --arm64 --publish never
```

必须在 macOS 上跑：在 Windows 上执行 `electron-builder --mac zip --arm64`（或 `--mac dir`）直接报
`Build for macOS is supported only on macOS, please see https://electron.build/multi-platform-build`（2026-10-25 实测，electron-builder 26.15.3），没有产物。

`electron-builder.yml` 的 `mac:` 段：

- 目标 `dmg` + `zip`，只有 arm64；类别 `public.app-category.developer-tools`；图标 `resources/icon.icns`。
- `files` / `extraResources`：顶层和平台级是合并的（app-builder-lib `fileMatcher.js` 先加 config 的，再加平台级的）。
  - node-pty 的预编译件按平台排除：Windows 包只留 `win32-x64`（Windows 部分的产物已用 `electron-builder --win dir` 核对：`app.asar.unpacked/node_modules/node-pty/prebuilds` 里只有 `win32-x64`）；
    mac 包排除 `win32-*` 和 `darwin-x64`，只留 `darwin-arm64`（`pty.node` 和 `spawn-helper`）。
  - 托盘图：Windows 带 `icon.ico`、`tray.png`；mac 带 `trayTemplate.png`、`trayTemplate@2x.png`。
- 签名：`identity: "-"`（显式 ad-hoc）。依据 `app-builder-lib/out/options/macOptions.d.ts`：不设 identity 时找不到证书就跳过签名，**没有**自动 ad-hoc 回退；`"-"` 是显式启用。arm64 的可执行文件必须带签名（至少 ad-hoc）才能启动。
- `hardenedRuntime: false`：同一文件说明默认的 hardened runtime 配 ad-hoc 签名会强制库校验，node-pty 的 `pty.node` 等会加载失败。不公证也用不上。
- `publish` 是顶层的 Windows 更新源，mac 构建一律带 `--publish never`；主进程在 mac 上不检查更新。mac 包里虽然也会有 `app-update.yml`，但没有人读它。

## 图标

`node scripts/make-icons.ts`（`npm run icons`）一并生成：

- `resources/icon.icns`：`icns` 头 + `ic11 ic12 ic07 ic13 ic08 ic14 ic09 ic10` 八个 PNG 条目（32–1024 px）。已校验头部总长等于文件长度、每个条目长度与 PNG 的 IHDR 尺寸吻合。和 `icon.ico` 一样是透明底，没有 macOS 常见的圆角方块底板，Dock 里看起来会偏小偏素（未在 Dock 里实际看过）。
- `resources/trayTemplate.png`（18×18）、`trayTemplate@2x.png`（36×36）：菜单栏模板图，只有黑色 + alpha、不画淡影，文件名带 `Template`，Electron 的 `nativeImage` 会按模板图处理，系统按菜单栏明暗自动反色。

## 用户怎么打开未公证的包

下载来的 dmg/zip 带隔离属性，Gatekeeper 会拦：

```
xattr -cr /Applications/omp-studio.app
```

或在 系统设置 → 隐私与安全性 里点"仍要打开"。

## 没实测的清单

- `zip` / `dmg` 的实际产物：Info.plist 的名字（`omp-studio`）和版本（来自 package.json）、`.app` 里 `Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/` 是否有 `pty.node` 和 `spawn-helper`、`spawn-helper` 是否保留执行位（node-pty 的 postinstall 会 chmod；asarUnpack 复制时是否保留，要在 Mac 上 `ls -l` 看）。
- ad-hoc 签名后 `pty.node` 能否被加载（`hardenedRuntime: false` 是依据文档推的）。
- arm64 版 Electron 44 加载 node-pty 1.1.0 的 `darwin-arm64` 预编译件。
- 菜单栏图标在深色 / 浅色菜单栏下的观感。

## 代码里的 mac 分支（都没有在 mac 上跑过）

| 方面 | 做法 | 详细记录 |
|---|---|---|
| 进程结束、主进程被强杀的兜底 | `ps` 列进程树逐个 SIGKILL；每个 omp / pty 一个 `sh` 看门狗 | `terminal.md` "macOS 的进程结束和看门狗" |
| Finder 启动时的 PATH | 启动时用 `$SHELL -ilc` 取 PATH 合并进来，最多等 3 秒 | `terminal.md` "macOS 的 PATH" |
| 自管 omp | 下载 `macos-arm64` 构建，`chmod 755`；放 `~/Library/Application Support/omp-studio/omp`；没有"加入 PATH" | `omp-install.md` 末节 |
| 自动更新 | 关掉，关于页提示手动下载 | `auto-update.md` 末节 |
| 窗口、菜单、菜单栏图标 | 红黄绿三键 `trafficLightPosition`；应用菜单只放 app / file / edit / window 四个 role 菜单（不放 view，免得抢 ⌘R） | `spec.md` §3.1 |
| 快捷键 | 主修饰键 ⌘，后退 / 前进 ⌘[ / ⌘]；发给 omp 的 Ctrl 键不变 | `spec.md` §5.1 |

第一次在 Mac 上跑时先看这几样：应用能起来、任务能发一句 prompt 并跑完（node-pty + TSP）、关任务和 `kill -9` 主进程后 `ps` 里没有残留的 omp 和 `sh` 看门狗、Finder 启动后能找到 Homebrew 装的 `git`、⌘C / ⌘V / ⌘W / ⌘Q。

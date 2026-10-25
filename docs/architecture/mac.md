# macOS 版：打包与分发

只出 Apple 芯片（arm64）、不公证、不自动更新。**本仓库没有 Mac 真机**：能在 mac 上验证的只有 GitHub Actions 的 macOS 机器（下面"CI"一节），其余标"未实测"的是依据 electron-builder 26 的源码和类型文档推出来的。

## 打包

```
npm run dist:mac    # electron-vite build && electron-builder --mac --arm64 --publish never
```

必须在 macOS 上跑：在 Windows 上执行 `electron-builder --mac zip --arm64`（或 `--mac dir`）直接报
`Build for macOS is supported only on macOS, please see https://electron.build/multi-platform-build`（2026-10-25 实测，electron-builder 26.15.3），没有产物。

`electron-builder.yml` 的 `mac:` 段：

- 目标 `dmg` + `zip`，只有 arm64；类别 `public.app-category.developer-tools`；图标 `resources/icon.icns`。
- `files` 只写在顶层，平台下不写：平台级的 `files` 会整个顶替顶层那份（不是合并），只剩排除规则时 electron-builder 退回 `**/*`，把整个仓库目录打进 `app.asar`。0.4.16 因此把 `.env`、本机日志、截图、源码和测试都打进了安装包（2026-10-25 用 `electron-builder --win dir` 对照实测：去掉 `win.files` 后 asar 顶层只剩 `out`、`package.json`）。`extraResources` 是合并的（产物里 `licenses/` 和平台托盘图都在）。
  - node-pty 的预编译件用宏排除别的平台：`!node_modules/node-pty/prebuilds/!(${platform}-${arch})/**`，Windows 包只留 `win32-x64`，mac 包只留 `darwin-arm64`（`pty.node` 和 `spawn-helper`）。
  - `scripts/check-package.ts` 在 `npm run dist` / `dist:mac` 和 mac CI 的"检查产物"里读 `app.asar` 的文件头：顶层只许 `out`、`package.json`、`node_modules`，node-pty 预编译件只许本平台的，不对就失败。
  - 托盘图：Windows 带 `icon.ico`、`tray.png`；mac 带 `trayTemplate.png`、`trayTemplate@2x.png`。
- 签名：`identity: "-"`（显式 ad-hoc）。依据 `app-builder-lib/out/options/macOptions.d.ts`：不设 identity 时找不到证书就跳过签名，**没有**自动 ad-hoc 回退；`"-"` 是显式启用。arm64 的可执行文件必须带签名（至少 ad-hoc）才能启动。
- `hardenedRuntime: false`：同一文件说明默认的 hardened runtime 配 ad-hoc 签名会强制库校验，node-pty 的 `pty.node` 等会加载失败。不公证也用不上。
- `publish` 是顶层的 Windows 更新源，mac 构建一律带 `--publish never`；主进程在 mac 上不检查更新。mac 包里虽然也会有 `app-update.yml`，但没有人读它。

## 图标

`node scripts/make-icons.ts`（`npm run icons`）一并生成：

- `resources/icon.icns`：`icns` 头 + `ic11 ic12 ic07 ic13 ic08 ic14 ic09 ic10` 八个 PNG 条目（32–1024 px）。已校验头部总长等于文件长度、每个条目长度与 PNG 的 IHDR 尺寸吻合。和 `icon.ico` 一样是透明底，没有 macOS 常见的圆角方块底板，Dock 里看起来会偏小偏素（未在 Dock 里实际看过）。
- `resources/trayTemplate.png`（18×18）、`trayTemplate@2x.png`（36×36）：菜单栏模板图，只有黑色 + alpha、不画淡影，文件名带 `Template`，Electron 的 `nativeImage` 会按模板图处理，系统按菜单栏明暗自动反色。

## spawn-helper 的执行位

node-pty 1.1.0 的 npm 包里 `prebuilds/darwin-*/spawn-helper` 是 `0644`（`tar -tvzf node-pty-1.1.0.tgz` 实测），它自己的 postinstall 不 chmod。没有执行位时 mac 上 `posix_spawnp` 失败，原生层抛 `Napi::Error` 直接 `abort`（不是 JS 异常，整个进程 SIGABRT）：2026-10-25 GitHub macOS runner 上 7 个起 pty 的单测文件 worker 全部这样崩掉。所以 `package.json` 的 `postinstall` 跑 `scripts/fix-node-pty.ts` 补执行位，electron-builder 从 `node_modules` 复制，安装包里的也带上；mac workflow 的"检查产物"一步用 `test -x` 核对。

## 用户怎么打开未公证的包

下载来的 dmg/zip 带隔离属性，Gatekeeper 会拦：

```
xattr -cr /Applications/omp-studio.app
```

或在 系统设置 → 隐私与安全性 里点"仍要打开"。

## CI（`.github/workflows/mac.yml`）

手动触发（`gh workflow run mac.yml`）或推 `v*` tag 时，在 `macos-15`（arm64）上依次跑：类型检查、全量单测、构建、一条 e2e 冒烟（`tsp.e2e.ts` 的"完整一轮"：Electron 里经 node-pty 起假 omp、回放录制、发一句 prompt 跑完一整轮）、`electron-builder --mac --arm64` 打 ad-hoc 签名的 dmg + zip、检查产物，dmg / zip 作为构建产物保留 14 天。推 tag 时还用 `scripts/publish-release.ts` 把 dmg / zip 传到这个版本的 GitHub Release（Windows 安装包由本机推 tag 后用同一个脚本传）。mac 产物只在发版时用得上，所以不在每次推送时跑（仓库私有期间 macOS 分钟还按 10 倍计；2026-10-25 起公开）。

2026-10-25 第一次跑通（run 40148794986，约 1 分 35 秒，产物 271 MiB）。由此确认：

- arm64 的 Electron 44 和 Node 24 都能加载 node-pty 1.1.0 的 `darwin-arm64` 预编译件（补了 spawn-helper 执行位之后，见上一节）。
- 包里 `app.asar.unpacked/node_modules/node-pty/prebuilds/` 只有 `darwin-arm64`，`pty.node` 在、`spawn-helper` 带执行位；没有 `win32-x64`。
- `codesign --verify --deep --strict` 通过，`Signature=adhoc`、`Identifier=dev.omp-studio.app`；Info.plist 的 `CFBundleName` 是 `omp-studio`，版本取 package.json。
- 结束 rpc-ui 进程树（`omp-connection.test.ts` 的强杀用例：omp 和它 detached 的孙进程都被 SIGKILL）。被杀的孙进程由 launchd 收养后异步回收，回收前 `kill(pid, 0)` 仍然成功，断言要等一会儿。

第一次跑时修掉的几处都是测试默认了 Windows：`realpath` 把 `/var` 解析成 `/private/var`、环境变量名 `PATH` 不是 `Path`、反斜杠在 POSIX 上是普通文件名字符、接管记录的 key 只在 Windows 上转小写、POSIX 上 `process.exit()` 会丢掉没写完的管道输出；以及 runner 是英文系统，断言中文文案的 e2e 要先显式切中文。

## 没实测的清单

- 装好的包（`/Applications` 里、ad-hoc 签名后）能否加载 `pty.node`：CI 的 e2e 跑的是构建目录里的应用，不是打出来的包（`hardenedRuntime: false` 是依据文档推的）。
- 菜单栏图标在深色 / 浅色菜单栏下的观感。

## 代码里的 mac 分支（除 CI 覆盖到的单测外，没有在 mac 上跑过）

| 方面 | 做法 | 详细记录 |
|---|---|---|
| 进程结束、主进程被强杀的兜底 | `ps` 列进程树逐个 SIGKILL；每个 omp / pty 一个 `sh` 看门狗 | `terminal.md` "macOS 的进程结束和看门狗" |
| Finder 启动时的 PATH | 启动时用 `$SHELL -ilc` 取 PATH 合并进来，最多等 3 秒 | `terminal.md` "macOS 的 PATH" |
| 自管 omp | 下载 `macos-arm64` 构建，`chmod 755`；放 `~/Library/Application Support/omp-studio/omp`；没有"加入 PATH" | `omp-install.md` 末节 |
| 自动更新 | 关掉，关于页提示手动下载 | `auto-update.md` 末节 |
| 窗口、菜单、菜单栏图标 | 红黄绿三键 `trafficLightPosition`；应用菜单只放 app / file / edit / window 四个 role 菜单（不放 view，免得抢 ⌘R） | `spec.md` §3.1 |
| 快捷键 | 主修饰键 ⌘，后退 / 前进 ⌘[ / ⌘]；发给 omp 的 Ctrl 键不变 | `spec.md` §5.1 |

第一次在 Mac 上跑时先看这几样：应用能起来、任务能发一句 prompt 并跑完（node-pty + TSP）、关任务和 `kill -9` 主进程后 `ps` 里没有残留的 omp 和 `sh` 看门狗、Finder 启动后能找到 Homebrew 装的 `git`、⌘C / ⌘V / ⌘W / ⌘Q。

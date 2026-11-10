# macOS 版：打包与分发

只出 Apple 芯片（arm64）、不公证、不自动更新。**本仓库没有 Mac 真机**：能在 mac 上验证的只有 GitHub Actions 的 macOS 机器（"CI"一节），其余标"未实测"的是依据 electron-builder 26 的源码和类型文档推的。

## 打包

```
npm run dist:mac
```

必须在 macOS 上跑：Windows 上 `electron-builder --mac` 直接报 `Build for macOS is supported only on macOS`（electron-builder 26.15.3 实测），没有产物。

`electron-builder.yml` 的 `mac:` 段：

- 目标 `dmg` + `zip`，只有 arm64；图标 `resources/icon.icns`。
- **`files` 只写在顶层，平台下不写**：平台级的 `files` 会整个顶替顶层那份（不是合并），只剩排除规则时 electron-builder 退回 `**/*`，把整个仓库目录（`.env`、本机日志、源码、测试）打进 `app.asar`（0.4.16 出过这个事故，`--win dir` 对照实测确认）。`extraResources` 是合并的。
  - node-pty 预编译件用 `${platform}-${arch}` 宏排除别的平台，每个包只留本平台的。
  - `scripts/check-package.ts` 在 `npm run dist` / `dist:mac` 和 mac CI 里读 `app.asar` 文件头：顶层只许 `out`、`package.json`、`node_modules`，node-pty 预编译件只许本平台的，不对就失败。
- 签名：`identity: "-"`（显式 ad-hoc）。依据 `app-builder-lib/out/options/macOptions.d.ts`：不设 identity 时找不到证书就跳过签名，**没有**自动 ad-hoc 回退。arm64 的可执行文件必须至少 ad-hoc 签名才能启动。
- `hardenedRuntime: false`：同一文件说明 hardened runtime 配 ad-hoc 签名会强制库校验，node-pty 的 `pty.node` 等会加载失败。不公证也用不上。
- `publish` 是顶层的 Windows 更新源，mac 构建一律 `--publish never`；主进程在 mac 上不检查更新，包里的 `app-update.yml` 没人读。

## 图标

`npm run icons`（`scripts/make-icons.ts`）一并生成：

- `resources/icon.icns`：八个 PNG 条目（已校验头部长度和每个条目的 IHDR 尺寸）。和 `icon.ico` 一样透明底，没有 macOS 常见的圆角底板，Dock 里可能偏小偏素（未实际看过）。
- `resources/trayTemplate.png` / `@2x`：菜单栏模板图，只有黑色 + alpha，文件名带 `Template`，Electron 按模板图处理，系统按菜单栏明暗自动反色。

## spawn-helper 的执行位

node-pty 1.1.0 的 npm 包里 `prebuilds/darwin-*/spawn-helper` 是 `0644`，它自己的 postinstall 不 chmod。没有执行位时 mac 上 `posix_spawnp` 失败，原生层直接 `abort`（不是 JS 异常，整个进程 SIGABRT；GitHub macOS runner 实测）。所以 `package.json` 的 `postinstall` 跑 `scripts/fix-node-pty.ts` 补执行位，安装包里也带上；mac workflow 用 `test -x` 核对。

## 用户怎么打开未公证的包

下载来的 dmg/zip 带隔离属性，Gatekeeper 会拦：

```
xattr -cr /Applications/omp-studio.app
```

或在 系统设置 → 隐私与安全性 里点"仍要打开"。

## CI（`.github/workflows/mac.yml`）

推 `main`、推 `v*` tag 或手动触发时，在 `macos-15`（arm64）上依次跑：类型检查、全量单测、构建、一条 e2e 冒烟（`tsp.e2e.ts` 的"完整一轮"）、打 ad-hoc 签名的 dmg + zip、检查产物，产物保留为构建产物。推 tag 时用 `scripts/publish-release.ts` 把 dmg / zip 传到 GitHub Release（Windows 安装包由本机推 tag 后用同一个脚本传）。公开仓库的 macOS 机器不计费，所以每次推送都跑；同一分支连推时取消旧的（`concurrency`）。

CI 实测确认：

- arm64 的 Electron 44 和 Node 24 都能加载 node-pty 1.1.0 的 `darwin-arm64` 预编译件（补了 spawn-helper 执行位之后）。
- 包里 node-pty 预编译件只有 `darwin-arm64`，`spawn-helper` 带执行位。
- `codesign --verify --deep --strict` 通过，`Signature=adhoc`、`Identifier=dev.omp-studio.app`。
- 结束 rpc-ui 进程树（`omp-connection.test.ts` 的强杀用例）。被杀的孙进程由 launchd 收养后异步回收，回收前 `kill(pid, 0)` 仍然成功，断言要等一会儿。

测试别默认 Windows：`realpath` 把 `/var` 解析成 `/private/var`、环境变量名 `PATH` 不是 `Path`、反斜杠在 POSIX 上是普通文件名字符、接管记录的 key 只在 Windows 上转小写、POSIX 上 `process.exit()` 会丢掉没写完的管道输出；runner 是英文系统，断言中文文案的 e2e 要先显式切中文。

## 没实测的清单

- 装好的包（`/Applications` 里、ad-hoc 签名后）能否加载 `pty.node`：CI 的 e2e 跑的是构建目录里的应用（`hardenedRuntime: false` 是依据文档推的）。
- 菜单栏图标在深色 / 浅色菜单栏下的观感。

## 代码里的 mac 分支（除 CI 覆盖到的单测外，没有在 mac 上跑过）

| 方面 | 做法 | 详细记录 |
|---|---|---|
| 进程结束、主进程被强杀的兜底 | `ps` 列进程树逐个 SIGKILL；每个 omp / pty 一个 `sh` 看门狗（和 Linux 共用） | `terminal.md` "POSIX（macOS / Linux）的进程结束和看门狗" |
| Finder 启动时的 PATH | 启动时用 `$SHELL -ilc` 取 PATH 合并进来（和 Linux 共用） | `terminal.md` "macOS / Linux 的 PATH" |
| 自管 omp | 下载 `macos-arm64` 构建；没有"加入 PATH" | `omp-install.md` "macOS" 一节 |
| 自动更新 | 关掉，关于页提示手动下载 | `auto-update.md` "macOS" 一节 |
| 窗口、菜单、菜单栏图标 | 红黄绿三键 `trafficLightPosition`；应用菜单只放 app / file / edit / window 四个 role 菜单（不放 view，免得抢 ⌘R） | spec §3.1 |
| 窗口淡入淡出 | 同 Windows。没验证 mac 上透明窗口在淡入的几百毫秒里会不会接住点击 | spec §2.6"窗口出现 / 消失" |
| 快捷键 | 主修饰键 ⌘，后退 / 前进 ⌘[ / ⌘]；发给 omp 的 Ctrl 键不变 | spec §5.1 |

第一次在 Mac 上跑时先看：应用能起来、任务能发一句 prompt 并跑完（node-pty + TSP）、关任务和 `kill -9` 主进程后 `ps` 里没有残留的 omp 和 `sh` 看门狗、Finder 启动后能找到 Homebrew 装的 `git`、⌘C / ⌘V / ⌘W / ⌘Q。

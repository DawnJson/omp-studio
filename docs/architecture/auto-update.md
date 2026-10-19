# 应用自身的自动更新

omp-studio 自己的版本更新，和 omp 的更新是两套（omp 的见 `omp-install.md`）。实现：`src/main/update/`，构建配置 `electron-builder.yml`。

## 结论和限制

- **只有安装版会检查更新。** 免安装目录（`npm run pack` 的 `win-unpacked`）和开发版（`npm run dev`）显示 `disabled`：前者没有安装器，后者的 `app-update.yml` 不存在。判断依据是 `app.isPackaged`。
- **不签名也能更新**，首次安装会弹 SmartScreen。不要设置 `publisherName`，设了就会要求安装包必须带签名，没签名的更新被拒。
- **NSIS 用单文件安装器**（`electron-builder.yml` 的 `nsis.oneClick`），装到用户目录，不需要管理员权限。
- **差分更新自动生效**：NSIS 目标会额外生成 `.blockmap`，`electron-updater` 按块下载。

## 更新源

按优先级：

1. 环境变量 `STUDIO_UPDATE_URL`（只在打包版生效）：http(s) 地址，或本机目录（绝对路径 / `file://`），里面放 `latest.yml`、安装包和 `.blockmap`。
2. 打包时写入的 `resources/app-update.yml` 的 `url`（`electron-builder.yml` 的 `publish` 生成）。**内测期间是仓库所有者本机的固定目录 `E:\work\code\omp-studio-updates`**（`file:///E:/work/code/omp-studio-updates/`）；`npm run feed` 写进同一个目录。
3. 都没有，或配置的本机目录不存在（别的机器上装的内测版）：`disabled`，设置页显示"这个版本没有配置更新源"。

electron-updater 只会走 http(s)，本机目录由 `src/main/update/local-feed.ts` 在 `127.0.0.1` 的随机端口上只读提供（只给目录第一层的文件，`..`、子目录一律 404），用本机目录时关掉差分下载（这个小服务不支持 Range，整包从本机磁盘读也很快）。不论哪种源，最后都写一份 `userData/app-update.yml`（`provider: generic` + 地址 + `updaterCacheDirName`）交给 electron-updater。

## 发一个新版本（装好的应用会自己更新）

1. 在"未发布"里记好改动，`npm run release -- <新版本>`（先 `--dry-run`）：改版本号、CHANGELOG、提交、打 tag、`npm run dist`、`npm run feed`。
2. 新的 `latest.yml`、安装包和 `.blockmap` 已经在 `E:\work\code\omp-studio-updates`。装着旧版本的应用启动 10 秒后、之后每小时，或在 设置 → 关于 点"检查更新"，就会下载新版本；下载完点"重启并安装"。
3. **版本号必须比装着的高**：同一个版本重新打包，已装的应用不会当成更新。

## 状态机

`UpdateState`（`src/shared/ipc.ts`）：

```
disabled ──(没启用)──┐
idle → checking → up-to-date
                └→ downloading(percent) → downloaded → 安装
                                 ↑
                              error（下一次检查重新开始）
```

- 启动后等 10 秒检查一次，之后每小时一次（`UpdateService.start`）。
- 手动检查走 `checkForUpdate`；检查中、下载中、已下载时不会重复发请求。
- `checkForUpdates` 不带任何事件就结束（更新器判定不活跃）时回到 `idle`，不会卡在 `checking` 把后续检查挡住。
- 所有状态变化通过 `updateState` 事件推给界面；设置 → 关于读 `getUpdateState` 拿初始值。

## 安装顺序

1. 界面点"重启并安装" → `installUpdate`。
2. `prepareInstall()` 调 `finishShutdown()`：跑一遍退出 hook，关掉所有 omp 子进程（`window/shutdown.ts`）。
3. 再调 `autoUpdater.quitAndInstall(false, true)` 安装并重启。

顺序不能反：`quitAndInstall` 自己会触发 `before-quit`，而 Job Object 是 `KILL_ON_JOB_CLOSE`，omp 还没关干净就安装的话，安装过程和子进程会被一起收掉。

`finishShutdown` 只跑一次，完成后 `before-quit` 不再拦截，所以 `quitAndInstall` 触发的退出不会被自己的退出流程挡住。

## 界面

设置 → 关于（`src/renderer/src/features/settings/AboutSection.tsx`）：当前版本、更新状态、下载进度、检查 / 重启并安装按钮。状态机没有单独的全局横幅，避免打扰写作。

## 本地验证（不发布任何东西）

1. `npm run dist`：生成 `release/omp-studio-0.1.0-setup.exe`。
2. 安装 0.1.0 的安装包（静默：`Start-Process release\omp-studio-0.1.0-setup.exe -ArgumentList /S -Wait`）。
3. 把 `package.json` 的版本改成 `0.1.1`，再 `npm run dist`、`node scripts/make-feed.ts <测试目录>`（不用 `npm run feed`，免得把测试版本写进固定更新目录）。
4. 测试目录直接当更新源（本机目录），不需要另起静态服务器。
5. 启动已安装的 0.1.0，指过去：`$env:STUDIO_UPDATE_URL = "<测试目录>"`。
6. 设置 → 关于 → 检查更新。观察：`正在检查…` → `正在下载 0.1.1（百分比）` → `新版本 0.1.1 已下载` → 点"重启并安装"。
7. 应用退出，安装器静默运行并自动重新启动；此时读 `resources/app.asar` 里的 `package.json` 版本应为 0.1.1。
8. 验证完把版本改回去，删掉测试目录。

实测（2026-10-18，omp-studio 0.1.0 → 0.1.1，Windows 10）：状态依次为"尚未检查 / 正在检查… / 正在下载（0%）/ 已下载"，点击后应用关闭、安装完成、自动重启，安装目录里的版本变成 0.1.1。

实测（2026-10-19，固定目录 + 本机回环服务，Windows 11 26300）：临时打一个 0.0.9 安装，不设 `STUDIO_UPDATE_URL`，检查 → `downloading 0.1.0` → `downloaded 0.1.0` → 安装后应用自动重启，安装目录里的版本变成 0.1.0。

## 待定

- 正式（对外）的更新源地址（单独的公开 releases 仓库 / 对象存储），见 `PLAN.md` 阶段 7；定了以后把 `electron-builder.yml` 的 `publish.url` 换成 http(s) 地址。
- 代码签名、stable/beta 渠道。

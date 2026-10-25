# 应用自身的自动更新

omp-studio 自己的版本更新，和 omp 的更新是两套（omp 的见 `omp-install.md`）。实现：`src/main/update/`，构建配置 `electron-builder.yml`。

## 结论和限制

- **只有安装版会检查更新。** 免安装目录（`npm run pack` 的 `win-unpacked`）和开发版（`npm run dev`）显示 `disabled`：前者没有安装器，后者的 `app-update.yml` 不存在。判断依据是 `app.isPackaged`。
- **不签名也能更新**，首次安装会弹 SmartScreen。不要设置 `publisherName`，设了就会要求安装包必须带签名，没签名的更新被拒。
- **NSIS 用单文件安装器**（`electron-builder.yml` 的 `nsis.oneClick`），装到用户目录，不需要管理员权限。
- **差分更新**：NSIS 目标会额外生成 `.blockmap`。electron-updater 下载新版本的 `.blockmap`，和本机缓存里已装版本的 `current.blockmap` 对比（缓存里没有才去下载旧版本的 `.blockmap`），只下载变了的块，没变的块从缓存里的旧安装包 `installer.exe` 拷；拼出来校验不过就整包下载（见下面"安装"）。

## 更新源

按优先级：

1. 环境变量 `STUDIO_UPDATE_URL`（只在打包版生效，本地测试用）：http(s) 地址，或本机目录（绝对路径 / `file://`），里面放 `latest.yml`、安装包和 `.blockmap`。
2. 打包时写入的 `resources/app-update.yml`（`electron-builder.yml` 的 `publish` 生成）：**本仓库的 GitHub Releases**（`provider: github`，`DawnJson/omp-studio`，只看正式版 Release；仓库所有者 2026-10-25 定）。electron-updater 找到最新的 Release，读里面的 `latest.yml`，再下载同一个 Release 里的安装包。
3. 都没有，或 `STUDIO_UPDATE_URL` 指的本机目录不存在：`disabled`，设置页显示"这个版本没有配置更新源"。

- **仓库必须公开**：私有仓库的 Releases 要 token 才能读，token 不能写进应用。仓库私有期间检查更新会失败（设置页显示"检查更新失败"）。
- `STUDIO_UPDATE_URL` 写成 `userData/app-update.yml`（`provider: generic` + 地址 + `updaterCacheDirName`）交给 electron-updater；本机目录由 `src/main/update/local-feed.ts` 在 `127.0.0.1` 的随机端口上只读提供（只给目录第一层的文件，`..`、子目录一律 404），用本机目录时关掉差分下载（这个小服务不支持 Range）。
- 没有覆盖时 electron-updater 直接读 `resources/app-update.yml`，里面有 electron-builder 写好的 `updaterCacheDirName`。
- 0.4.16 及以前的版本更新源是仓库所有者本机的一个固定目录，那些版本不会自动更新到用 GitHub 的版本，要手动装一次。

## 发一个新版本（装好的应用会自己更新）

1. 在"未发布"里记好改动，`npm run release -- <新版本>`（先 `--dry-run`）：改版本号、CHANGELOG、提交、打 tag、`npm run dist`（electron-builder 同时生成 `release\latest.yml`、安装包和 `.blockmap`）。
2. 推送 `main` 和 tag，再按脚本最后打印的命令运行 `node scripts/publish-release.ts <版本> release\latest.yml release\omp-studio-<版本>-setup.exe release\omp-studio-<版本>-setup.exe.blockmap`。这个 Release 没有就新建（说明取 CHANGELOG 里这一版）。推 tag 也会触发 mac 构建，它把 dmg / zip 传到同一个 Release，两边谁先到谁建。
3. 装着旧版本的应用启动 10 秒后检查，之后每小时一次，也可以在 设置 → 关于 点"检查更新"；有新版本就在后台下载。
4. **版本号必须比装着的高**：同一个版本重新打包，已装的应用不会当成更新。
5. `publish-release.ts` 最后才传 `latest.yml`，免得应用读到它时安装包还没传完。mac 构建先建好 Release、Windows 的文件还没传上去的那几分钟里，检查更新会因为找不到 `latest.yml` 报错，下一次检查就好了。

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

## 安装

下载完成（`downloaded`）后有两条路：

- **退出时自动安装**：electron-updater 默认 `autoInstallOnAppQuit`，应用正常退出（托盘 / 菜单退出，都经 `window/shutdown.ts`）后静默运行安装器（`--updated /S`），不自动重启。窗口 × 只隐藏，不算退出。
- **重启并安装**：侧栏的新版本标签、设置 → 关于、关于对话框三个入口共用 `features/settings/use-install-update.tsx`：有任务在 `running` / `needs_you` 时先弹确认框，否则直接 `installUpdate`：
  1. `prepareInstall()` 调 `finishShutdown()`：跑一遍退出 hook，关掉所有 omp 子进程（`window/shutdown.ts`）。
  2. 再调 `autoUpdater.quitAndInstall(true, true)`：静默安装（`/S`）并在装完后重启（`--force-run`）。安装器是向导式的（`electron-builder.yml` 的 `nsis.oneClick: false`），不静默会弹出欢迎页、进度页、完成页等用户点；静默时向导安装器只有带 `--force-run` 才会重启应用（`app-builder-lib/templates/nsis/installSection.nsh`）。

顺序不能反：`quitAndInstall` 自己会触发 `before-quit`，而 Job Object 是 `KILL_ON_JOB_CLOSE`，omp 还没关干净就安装的话，安装过程和子进程会被一起收掉。

`finishShutdown` 只跑一次，完成后 `before-quit` 不再拦截，所以 `quitAndInstall` 触发的退出不会被自己的退出流程挡住。

**差分下载要的本地文件**：缓存目录 `%LOCALAPPDATA%\omp-studio-updater`（`app-update.yml` 的 `updaterCacheDirName`）里的 `installer.exe`（NSIS 安装器每次安装时把自己拷进来）和 `current.blockmap`（electron-updater 下载完成时写入新版本的 blockmap）。两者对不上（比如下载了但没装）时差分结果校验不过，自动退回整包下载。

## 界面

- 侧栏底部 `设置` 右边的新版本标签（只在 `downloaded` 时出现，spec §4.5）。
- 设置 → 关于（`src/renderer/src/features/settings/AboutSection.tsx`）：当前版本、更新状态、下载进度、检查 / 重启并安装按钮。
- 不弹窗、不弹 toast，避免打扰写作。

## 本地验证（不发布任何东西）

**别和本机装着的正式版混在一起**：`npm run dist` 时用 `-c.appId=dev.omp-studio.updtest -c.productName=omp-studio-updtest -c.extraMetadata.name=omp-studio-updtest -c.extraMetadata.version=<版本> -c.directories.output=<目录>` 打测试版本，装到单独的 `Programs\omp-studio-updtest`（只改 `productName` 不改 `name` 的话还是装进 `Programs\omp-studio`，会覆盖正式版）。另外 `STUDIO_UPDATE_URL` 写死的缓存目录是 `omp-studio-updater`，和正式版共用：测试前把它挪开、测完挪回，否则测试版本会覆盖正式版的 `current.blockmap`，下次正式更新差分失败、退回整包。

1. 按上面的参数打两个版本（如 0.4.90、0.4.91），静默安装旧的：`Start-Process <安装包> -ArgumentList /S -Wait`。
2. `node scripts/make-feed.ts <测试目录>` 或手动把新版本的 `latest.yml`、安装包、`.blockmap` 和旧版本的 `.blockmap` 放进测试目录。本机目录不支持 Range，要测差分得用支持 Range 的 http 服务。
3. 启动装好的旧版本，指过去：`$env:STUDIO_UPDATE_URL = "<测试目录或 http 地址>"`。
4. 设置 → 关于 → 检查更新。观察：`正在检查…` → `正在下载`（百分比）→ 侧栏出现新版本标签。
5. 点标签"重启并安装"（应用重启），或者直接退出（静默安装，不重启）；之后安装目录里 exe 的版本是新版本。
6. 卸载测试版本（`Programs\omp-studio-updtest\Uninstall omp-studio-updtest.exe /S`），删掉 `%LOCALAPPDATA%\omp-studio-updtest-updater`、测试目录，把正式版的缓存目录挪回来。

实测（2026-10-25，Windows 11 26300，测试版本 0.4.90 → 0.4.91，本机支持 Range 的 http 服务）：后台下载完成，侧栏出现 `新版本 0.4.91`；正常退出后 electron-updater 打出 `Auto install update on quit`、以 `--updated,/S` 运行安装器，约 10 秒后安装目录里的 exe 版本是 0.4.91。缓存目录里放好 0.4.90 的 `installer.exe` + `current.blockmap` 时差分生效：`Full: 104,976.99 KB, To download: 1,003.93 KB (1%)`，一次 206 请求 8 段共 1.0 MB。缓存里的旧安装包和 blockmap 对不上时（第一次跑时它们是正式版 0.4.16 的），先下 6.3 MB 差分、校验失败，再整包下载 107 MB。GitHub provider 不发多段 Range（`isUseMultipleRangeRequest: false`），改成一段一个请求，下载量相同（读源码，没有对 GitHub 实测）。

实测（2026-10-18，omp-studio 0.1.0 → 0.1.1，Windows 10）：状态依次为"尚未检查 / 正在检查… / 正在下载（0%）/ 已下载"，点击后应用关闭、安装完成、自动重启，安装目录里的版本变成 0.1.1。

实测（2026-10-19，固定目录 + 本机回环服务，Windows 11 26300）：临时打一个 0.0.9 安装，不设 `STUDIO_UPDATE_URL`，检查 → `downloading 0.1.0` → `downloaded 0.1.0` → 安装后应用自动重启，安装目录里的版本变成 0.1.0。

## 待定

- 代码签名、stable/beta 渠道。

## macOS：不自动更新（没有在 mac 上实测）

仓库所有者 2026-10-25 决定：mac 版只出 ad-hoc 签名的包。Squirrel.Mac 要求应用签名，更新包的签名要和已装版本的 designated requirement 匹配；ad-hoc 签名的 DR 是 cdhash，每次构建都变，所以自动更新装不上（据 electron-updater 文档，没有在 mac 上实测）。

- `update/instance.ts` 在 mac 上不解析更新源、不写 `app-update.yml`、不给 `autoUpdater` 任何地址，`UpdateService` 以 `disabled` 状态启动，`disabledReason` 是 `manual-only`，不会联网检查。
- 设置 → 关于显示 `settings.about.disabled.manualOnly`："mac 版暂不支持自动更新，请手动下载新版本"。关于对话框因为 `phase === "disabled"` 不显示更新行。
- 要改成自动更新需要 Developer ID 证书和公证、`latest-mac.yml` + zip 的更新源，这些在"待定"里，改签名策略前要先问仓库所有者。

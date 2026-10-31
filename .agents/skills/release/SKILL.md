---
name: release
description: 发一个新版本：结束占着 release\ 的进程、跑发版脚本、推送 main 和 tag、上传 GitHub Release、确认 mac / Linux 构建。只在仓库所有者明确说"发版"时用；平时改完只收尾（skill finish），不发版。
---

# 发版

**只在仓库所有者说"发版"时才做**（2026-10-21 起）。只改了测试、文档、开发脚本（安装包内容不变）时不发版。先按 skill `finish` 把这一轮的改动提交干净：发版脚本要求工作区没有未提交的改动。

## 1. 定版本号

修 bug 和小改动升第三位（0.3.16 → 0.3.17），加功能升第二位。版本号必须比已发布的高：同一个版本重新打包，装好的应用不会当成更新。`CHANGELOG.md` 的「未发布」不能是空的。

## 2. 结束占着 `release\` 的进程

从仓库 `release\` 下启动的 omp-studio（多半是 `release\win-unpacked\` 里打出来测的）会占着文件，直接结束，不用先问。**装好的版本（`%LOCALAPPDATA%\Programs\omp-studio`）不碰**：那是仓库所有者在用的，里面可能有任务在跑，它也不占 `release\`。

在仓库根目录，按路径筛，不按名字：

```bash
powershell -NoProfile -Command '$r = (Resolve-Path release).Path; Get-Process omp-studio -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$r\*" } | Stop-Process -Force'
```

再用同样的筛选（去掉 `Stop-Process`，改成 `Measure-Object`）确认数量是 0。

- bash 里整条命令用单引号，否则 `$_`、`$r` 被 bash 先展开，筛选作废。
- 不用 `taskkill //IM ...`：参数会被改坏、什么也不结束（只回"键入 TASKKILL /?"），而且按名字会连装好的版本一起结束。
- eval 内核里读过 exe（`pefile`）的话先 `pe.close()`，否则内核一直映射着文件。

没结束干净的话，脚本已经提交并打了 tag 才在打包时 EBUSY，要手动补跑 `npm run dist` 和删旧安装包（v0.4.0、v0.4.19 都是这样）。

## 3. 跑发版脚本

```bash
npm run release -- <版本> --dry-run
npm run release -- <版本>
```

脚本会：要求本地名单 `.githooks/no-mention.local.txt` 在（不在直接失败），查「未发布」里有没有名单里的名字 → 跑 `scripts/check.ts`（lint、格式、类型检查、仓库扫描）和受改动影响的单测（`vitest --changed`，不跑 e2e）→ 把「未发布」改成这个版本 → 改版本号 → 提交 `chore(release): v<版本>` 并打 tag → `npm run dist`（`release\` 里的 `latest.yml`、安装包、`.blockmap`，`scripts/check-package.ts` 检查 `app.asar`）→ 删掉 `release\` 里旧版本的安装包。只在本地做，不推送。

- **打包时 makensis 报 `Can't open output file`**，又查不到占用的进程：commit 和 tag 已经打好，**不要重跑 `npm run release`**；直接重跑 `npm run dist`，再删 `release\` 里旧版本的安装包和 `.blockmap`。
- 其他打包排障见 `docs/architecture/auto-update.md`「发版排障」。

## 4. 推送和上传

本机环境变量里的 `GITHUB_TOKEN` 不是仓库所有者的账号、写不了这个仓库：`gh` 和发布脚本前面一律加 `env -u GITHUB_TOKEN`，用 `gh auth` 登录的账号。

```bash
git push origin main
git push origin v<版本>
env -u GITHUB_TOKEN node scripts/publish-release.ts <版本> release/latest.yml release/omp-studio-<版本>-setup.exe release/omp-studio-<版本>-setup.exe.blockmap
```

最后一条是发版脚本最后打印的命令，前面加上 `env -u GITHUB_TOKEN`。它把三个文件传到这个版本的 GitHub Release（没有就按 CHANGELOG 建；仓库所有者 2026-10-25 批准），`latest.yml` 最后传。装着的旧版本从这个 Release 自动更新（`docs/architecture/auto-update.md`），三个文件缺一不可。

## 5. 确认 mac 和 Linux 构建

推 tag 会触发 `.github/workflows/mac.yml`（dmg / zip）和 `linux.yml`（AppImage、`latest-linux.yml`），它们传到同一个 Release。确认那次构建通过：

```bash
env -u GITHUB_TOKEN gh run list --limit 5
env -u GITHUB_TOKEN gh run watch <run id>
```

失败了先看日志找原因，修好后按 skill `finish` 提交；不删 tag、不强推。

## 6. 报告

写明版本号、提交号和 tag、Release 上的文件、三个 workflow 的结果，以及没做或没确认的步骤。

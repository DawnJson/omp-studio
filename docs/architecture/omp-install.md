# omp 的来源和更新

omp-studio 用哪个 omp、怎么判断由谁更新、自己管理时怎么下载和替换。决策见 `PLAN.md` 第 3 节，验证过程见 `problem.md` 第 2 题。

实测版本：Tern 管理的 18.12.0、install.ps1 装的 18.8.7、从构建服务下载的 18.12.0 和 18.11.3。日期 2026-10-17。

## 发现 PATH 上的 omp

1. 按 `PATH` 的顺序，对每个目录用 `PATHEXT` 里的扩展名找 `omp`，取第一个命中的。这和用户在终端里敲 `omp` 得到的是同一个。Windows 上命中的如果不是 `.exe`/`.com`（比如 npm 全局安装生成的 `omp.cmd`），报 `UnsupportedOmpLauncherError`，不跳过它去找后面的：不用 shell 启动不了脚本（Node spawn 会报 EINVAL），而跳过的话用的就不是终端里那个 omp。**已定（2026-10-18）**：用户自己装的 omp（没有 `manager.json`，包括这种 `.cmd`），照 Tern 的做法首次发现时问一次要不要接管；同意就下载官方 exe 自己管理，并放到用户 PATH 最前面，原来那份不动。npm 装的 omp 在 Windows 上是不是 `.cmd` shim 没有实测。
2. 执行 `omp --version`，输出形如 `omp/18.12.0`，用 `^omp/(\S+)` 解析。
3. 读 exe 上两级目录的 `manager.json`。`manager` 是字符串就算受管，显示名取 `name`，没有 `name` 就用 `manager`，和 omp 自己的判断一致（源码 `managedInstallName`）；文件不存在就是用户自己装的。

| 安装方式 | exe 路径 | 上两级的 `manager.json` |
|---|---|---|
| Tern | `%LOCALAPPDATA%\Tern\omp\bin\omp.exe` | `{"manager":"tern","name":"Tern"}` |
| install.ps1 | `%LOCALAPPDATA%\omp\omp.exe` | 上两级就是 `%LOCALAPPDATA%`，没有这个文件 |

install.ps1 的布局下，上两级是 `%LOCALAPPDATA%` 本身，别的程序在那里放的同名文件也会被读到，所以读取时要校验字段类型。install.ps1 目录里的 `omp.exe.<时间戳>.<pid>.<序号>.bak` 是 omp 自更新留下的旧 exe（根据源码推测），不要碰。

## `omp update` 只看 PATH 上的 omp

omp 的 `omp update` 用 `which omp` 找 exe，再读那个 exe 的 `manager.json`，**不看当前运行的是哪个 exe**。

- 受管目录在 PATH 最前面时，`omp update`、`--check`、`--force` 都只打印 `<路径> is installed and kept up to date by <name>; update it from <name>.`，退出码 0，不动文件。
- PATH 上找不到 omp 时，`manager.json` 不起作用，`omp update` 会走 bun 路径，执行 `bun add -g @oh-my-pi/pi-coding-agent`，往用户的 bun 全局目录装一份 omp。阶段 0 验证时实测踩到过（本机装了 bun）。
- 没测（推测）：PATH 上有别的 omp 时，`omp update` 会作用在那个 omp 上；没装 bun 的机器上的行为。

因此：

- **不要对 omp-studio 自己管理的 exe 执行 `omp update`。** 它的检查和更新都由 omp-studio 请求构建服务完成。
- 用户点"升级"时，只对 PATH 上的那个 omp 执行 `omp update`。受管的会被拦住并提示去管理者那里更新，用户自己装的会按它自己的安装方式升级。
- 受管时 `--check` 也被拦住，omp 没有"只检查不安装"的办法。

## 自己管理时的下载

```
GET https://build.stencil.so/api/products/omp/latest/windows-x86_64?channel=stable
GET https://build.stencil.so/api/products/omp/versions/<version>/windows-x86_64
```

- 应答顶层有 `build`、`file`、`download`。`build` 里有 `version`、`commit`、`notes`、`files[]` 等；`file` 是匹配当前 target 的那一项，含 `name`、`size`、`sha256`；`download` 是 10 分钟有效的带签名直链，不要写进日志。
- 边下载边算 sha256，和 `file.size`、`file.sha256` 都对上才用。18.12.0 是 222,411,264 字节，sha256 与 Tern 的 `state.json` 记录一致。
- 目录：`omp\versions\<版本>.exe`、`omp\bin\omp.exe`（当前版本）、`omp\manager.json` = `{"manager":"omp-studio","name":"omp-studio"}`。
- exe 放在任意目录、用绝对路径启动都正常，grep 和 bash 工具也正常。原生 addon 解压到 `PI_NATIVES_DIR\<版本>\`，不设这个变量时是 `~/.omp/natives/<版本>`，每个版本约 115 MB。**已定：不设 `PI_NATIVES_DIR`**，和终端、Tern 用同一个目录。这样自管目录被加进 PATH 后，终端里运行的 omp 和 omp-studio 用的是同一份解压结果，不会存两份。代价是 omp-studio 删旧版本 exe 时不能顺手删 `~/.omp/natives` 里对应的目录（终端可能还在用），旧目录要靠 omp 自己清理（omp 会不会清理没测）。

## 差量补丁（只读了源码，没有线上实测）

来源：omp 源码 `packages/coding-agent/src/cli/build-service.ts`。

- 在上面两个接口后加 `?from_version=<已装版本>`。请求头 `Accept: application/json`、`User-Agent: omp/<版本>`。
- 应答多一个 `patch`：`{ format: "file", from_sha256, size, sha256, url }`。补丁只能用在 sha256 等于 `from_sha256` 的文件上，补丁本身也要校验 `sha256`。
- 格式是 HDiffPatch 单流（`HDIFFSF20`），omp 用 `@oh-my-pi/pi-natives` 的 `applyBinaryPatch` 应用。omp-studio 要用补丁，就得自己带一个 HDiffPatch 实现。
- 补丁还没生成时返回 `patch_pending`，下次检查才有。404 且 `{"error":"no_build"}` 表示该 target 没有发布。
- `PI_BUILD_URL` 可以改服务地址。

## 运行中替换 exe

在自管副本上实测（没有碰 Tern 的文件）：

1. 把 `bin\omp.exe` 改名为 `bin\.omp.exe.old-<时间戳>`：Windows 允许改名正在运行的 exe。
2. 放入新版本的 `bin\omp.exe`。
3. 正在运行的子进程继续响应 `get_state` 和新 prompt；新起的子进程是新版本。
4. `.old-…` 文件要等用它的进程都退出后才能删除，删除失败就留到下次启动再清理。

Tern 换 exe 时，已经在跑的 omp-studio 子进程不受影响，下一次启动的任务会用到新版本（推测，与上面的机制相同，没有在 Tern 上实测）。

## omp-studio 的实现（`src/main/omp-manager/`）

状态机在 `manager.ts`，决策在 `resolve.ts`（纯函数，`test/omp-manager-resolve.test.ts` 逐分支覆盖），下载校验在 `build-service.ts`，目录和换 exe 在 `installer.ts`，应用里的接线（`net.fetch`、`userData`、事件推送）在 `index.ts`。渲染进程的 `OmpStatus` 就是这个状态机的状态，界面见 `features/omp-setup/` 和设置 → omp。

- **自管目录**：`%LOCALAPPDATA%\omp-studio\omp\`（`versions\<版本>.exe`、`bin\omp.exe`、`manager.json`、`update.lock`）。未打包时 `STUDIO_OMP_HOME` 或测试的 `STUDIO_USER_DATA`（→ `<userData>\omp`）可以改位置，测试不碰真实目录。
- **每次启动的发现**（第一次 `getOmpStatus` 触发）：PATH 上没有 omp → 有自管副本就用，没有就直接下载（不再问，进度在准备页）；Tern 等有 `manager.json` 的 → 直接用，不问、不碰 PATH；用户自装的（含 `.cmd`）→ `ask_takeover`，回答按 exe 路径记在 `userData\omp-studio-state.json`（`takeover[exe 路径小写]`），同意 → 下载自管副本并把 `bin` 放到用户 PATH 最前面，拒绝 → 用用户那份（`.cmd` 则 `unusable`，"重新选择"会忘掉那次拒绝重新问）。
- **`missing` 状态**：PATH 上没有 omp 且没有自管副本时，不直接下载 220 MB：向构建服务问版本和大小，准备页写明大小和来源，用户点"下载并安装"（`installOmp`）才下载；下载中可以取消（`cancelOmpInstall`，丢弃 `.partial`，回到 `missing`）。上一条里"没有就直接下载"以本条为准。用户同意过接管（`takeover` 已记录为 accepted）时视为已授权，直接下载。
- **自管 omp 装好后直接放到用户 PATH 最前面**，照 Tern 做管理者，不另问：用户点"下载并安装"或同意接管的那一次就是授权（准备页和接管弹窗的文案写明会改 PATH）。以后启动发现 bin 被用户移出 PATH 不悄悄加回，设置 → omp 显示"加入 PATH"按钮（`addManagedOmpToPath`）。
- **写用户 PATH**：`platform/win32/user-path.ts`（koffi，不用 reg.exe/setx）。只做"去重 + 放最前"，值类型和 `%VAR%` 原样保留；写之前把原值存成 `userData\path-backup-<时间>.txt`。测试用 `HKCU\Software\omp-studio-test-<pid>` 临时子键（`test/user-path.test.ts`）。
- **下载**：`net.fetch`（系统代理）→ `…/latest/windows-x86_64?channel=stable`，`PI_BUILD_URL` 可改服务地址（omp 自己也认）。2026-10-18 实测应答：`build.version`（当时 18.12.1）、`file.{name,size,sha256,url}`、`download`（绝对地址的签名直链，字符串）。边下边算 sha256，size 和 sha256 都对上才从 `.partial` 改名；对不上删掉并报 `verify` 错误。`test/omp-manager-install.test.ts` 用本地假服务器覆盖损坏、长度不对、进度、目录有空格和中文。
- **换 exe**：先复制到 `bin\.omp.exe.new-<pid>`，旧的改名为 `.omp.exe.old-<时间戳>`，新的改名到位，失败回滚。`.old-*` 每次启动清理，删不掉的留着。`versions\` 保留最近 3 个（当前版本一定留）。
- **后台更新**：自管时每小时请求一次最新版，更新了就在后台下载换掉 `bin\omp.exe`，状态里 `stagedUpdate` 是装上的版本；不切到 `installing`（那会把界面换成准备页）。`update.lock` 用 `open(…, "wx")` 独占，超过 30 分钟的残留当作崩溃遗留。设置 → omp 的"检查更新"走同一条路径（`checkOmpUpdate`）。
- **没有做差量补丁**（决策 D5）：本版只做全量下载（约 220 MB），应答里的 `patch` 字段不读。要做时在 `build-service.ts` 加 `?from_version=` 和补丁应用，`installBuild` 的调用方不用改。
- **升级按钮**（`upgradePathOmp`）只在"用户自装且拒绝了接管"时对 PATH 上那个 omp 执行 `omp update`（不用 shell，输出原样返回，界面显示末 3 行）。自管、他人管理的会被拒绝。
- **启动子进程**时 `getOmpExecutable()` 返回 `{ path, managedBin }`，自管时 `managedBin` 非空，调用方把它前置到子进程 PATH，让 `omp update` 认到 `manager.json`。

测试注入（仅未打包）：`STUDIO_TEST_OMP` 设了之后，发现流程直接把它当作"别人管理的 omp"，不查 PATH、不下载。

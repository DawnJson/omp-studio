# omp 的来源和更新

omp-studio 用哪个 omp、怎么判断由谁更新、自己管理时怎么下载和替换。决策见 `PLAN.md` 第 3 节，验证过程见 `problem.md` 第 2 题。

实测版本：Tern 管理的 18.12.0、install.ps1 装的 18.8.7、从构建服务下载的 18.12.0 和 18.11.3。日期 2026-10-17。

## 发现 PATH 上的 omp

1. 按 `PATH` 的顺序，对每个目录用 `PATHEXT` 里的扩展名找 `omp`，取第一个命中的。这和用户在终端里敲 `omp` 得到的是同一个。
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
- exe 放在任意目录、用绝对路径启动都正常，grep 和 bash 工具也正常。原生 addon 解压到 `PI_NATIVES_DIR\<版本>\`，不设这个变量时是 `~/.omp/natives/<版本>`，每个版本约 115 MB。要不要隔离 natives 目录还没定。

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

# AGENTS.md

omp-studio：oh-my-pi（omp）的桌面端（Electron + React，Windows 为主，另有 mac / Linux 包）。代码由 agent 写，产品和设计由仓库所有者定；用户当前这句话优先于本文件。

## 命令（按 Git Bash 写；pwsh 里环境变量写成 `$env:X=1; …`）

- 收工前：`npm run check`（lint、格式、类型检查和仓库规则扫描；git hook 和 agent 的结束检查也跑它）。
- 单测：`npx vitest related <改过的源文件> --run`；新写或改了的测试 `npx vitest run <文件>`；改了 `fixtures/`、`test/fake-omp/` 就跑用到它们的测试文件。
- e2e：`npm run build` 后 `npx playwright test test/e2e/<功能>.e2e.ts`，只跑相关的 spec；何时跑全量见 `docs/architecture/testing.md`。
- 真实 omp 冒烟：`STUDIO_REAL_OMP=1 npx vitest run test/task-real-omp.test.ts`（要 `.env`）；探针做法见 `testing.md`「探针」。
- 跑会起 Electron 的命令，输出不接 `| head`（管道一关测试进程就死，来不及清理）。

## 动手前读

- 功能：`docs/architecture/<功能>.md`；界面：`docs/design/spec.md` 对应章节。改完同步更新。
- 测试、e2e、录制回放、探针、隔离：`docs/architecture/testing.md`。
- omp 的边界（`~/.omp`、配置写入的例外、rpc-ui / TSP、子进程和退出）：`docs/architecture/omp-boundaries.md`。
- Electron 安全、日志脱敏、私人信息：`docs/architecture/security.md`。
- 性能和卡顿排查：`docs/architecture/performance.md`。
- 协议字段以 omp 文档（`omp://rpc.md` 等）和生成类型 `src/shared/omp-wire/rpc-wire.generated.ts`、`src/shared/tsp/tsp.generated.ts` 为准，不凭记忆写。

## 先停下来问

说明理由和备选方案，等仓库所有者确认再动手：

- 换技术栈（构建、测试、打包、lint、状态管理、i18n）；新增任何依赖。
- 直接写 `~/.omp` 里的文件，或在 `omp-boundaries.md` 列的例外之外写 omp 配置；接管别人的 omp。
- 用 wire schema / TSP 规范里没有的命令、事件或 role。
- 给 omp 官方提 PR；`--force` 推送、改写已推送的历史；签名、改自动更新通道。
- 新增把用户内容发到外部服务的功能（上传、分享链接、第三方接口）。
- `.env` 不存在或缺 key（不去读真实 `~/.omp` 里的凭据）。

## 红线（不可逆，或会动到所有者的机器）

- PATH 上别人的 omp（Tern、install.ps1、bun、npm、brew 装的）只读：不改目录、不换 exe。
- `~/.omp` 和终端版共用：只读可以，修改只经 omp 的命令；例外只有 `omp-boundaries.md` 列的那几处。
- 不碰装好的 omp-studio（`%LOCALAPPDATA%\Programs\omp-studio`）、所有者在用的 Tern、全局 Node；升级 Node 前先问装好的版本里有没有在跑的任务（MSI 会让它们一起以 SIGINT 退出）。
- 多个子代理共用工作区时，谁都不跑 `git checkout` / `restore` / `stash` / `reset` / `clean`；要看原样用 `git show HEAD:<path>` 或 `git diff`。
- 常驻 shell 里不 `export` 隔离变量（`PI_CODING_AGENT_DIR`、`HOME`、`USERPROFILE`）：写成命令前缀或放进子 shell，探完 `echo` 确认回到真实值。否则后面的 omp 命令读写错的目录。
- 不留孤儿进程：所有退出路径都关掉 omp 子进程，新的退出入口走 `window/shutdown.ts`。
- 仓库公开：被跟踪的文件和提交信息里没有私人信息、密钥（`npm run check` 和 hook 会查，规则见 `security.md`）。

## 代码看不出来的事

- 任务只有 TSP 一种引擎（伪终端里的交互式 omp）；`--mode rpc-ui` 只用于后台服务进程（`service/`）。
- Windows PowerShell 5 的临时 `.ps1` 只用 ASCII 或带 BOM 的 UTF-8：无 BOM 按 GBK 读，中文注释会吞掉下一行。
- bash 里调 PowerShell，整条命令用单引号包、里面用双引号，免得 `$_`、`$r` 被 bash 先展开。
- 路径用 `path.join` / `path.resolve`，可能带空格和中文；跨平台脚本写成 Node `.ts`，参数用数组。
- 所有者的界面指示有歧义（"X 默认展开""X 在右边"）时，先拿截图或改动前后的排列给他确认再改；不确定就保持原样（返工过两次，一次进了发版）。
- 界面不写多余的字（2026-10-28 定）：不加次要标签、说明文字、冗余微文案，让布局、分组、控件和图标说明问题。新增一句前先问"删掉它用户会不会做错事"，不会就不写；错误、危险操作的确认、数据会丢的警告不算多余。

## 怎么干活

- 先判断大小：小改直接做；中大型（跨模块、改协议或数据格式、改界面结构）先用 skill `plan` 写计划，所有者批准再动手。
- 只做这次需要的：不顺手重构、不预留扩展点、不过度防御、错误不吞；同类 bug 一起修或说明为什么不修；没人用的代码一起删。
- 沿整条路径查：渲染进程 → preload → IPC → 主进程 → omp → 界面。
- 回归测试要撤掉修复跑一次，确认会失败；只读代码不算验证，改了主进程或协议要起应用真发一次 prompt。
- 交付带证据：跑了什么、结果、没试什么。评审用 skill `review`；收尾（CHANGELOG、提交、推送、清理）用 skill `finish`。
- 只在所有者说"发版"时发版，用 skill `release`。
- omp 行为的实测结论写进对应的 `docs/architecture/<功能>.md`，写明 omp 版本；没实测的标推测。

## 犯错之后

先把它变成 lint 规则、测试、`scripts/check.ts` 的扫描或 hook；做不到才在本文件对应小节加一行：正确做法 + 来由（日期或版本）。子系统的坑写进对应的 `docs/architecture/<功能>.md`。

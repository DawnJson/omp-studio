# omp 的边界

omp-studio 和终端版 omp、别人装的 omp 共用一台机器和一份 `~/.omp`。这里写 studio 能碰什么、不能碰什么，以及子进程怎么管。根文件 `AGENTS.md` 只留红线，细节在这里。

## exe 和安装

- **只用 omp 官方原版 exe，不 fork，不打补丁**，exe 不进 git、不打进安装包。缺的能力先写 omp 插件，补不了再给官方提 PR（提 PR 先问仓库所有者）。
- **PATH 上别人的 omp 只读**（Tern、install.ps1、bun、npm、brew 装的都算）：不改它的目录、不换 exe、不改 `manager.json`；唯一会对它执行的是用户点升级按钮时的 `omp update`。开发机装着 Tern，调试时也不能碰 `%LOCALAPPDATA%\Tern\omp\`。
- **接管别人的 omp 之前必须问用户**。自管的 exe 只由 omp-studio 请求构建服务更新，从不对它执行 `omp update`（它只认 PATH 上那个 omp 的 `manager.json`，找不到时会走 bun 往用户全局目录装一份）。做法见 [omp-install.md](omp-install.md)。
- 要给所有者看 Tern 里 omp 的表现时，另起一套隔离的 Tern，不连他正在用的那个，做法见 [tsp-real-omp-probes.md](tsp-real-omp-probes.md)「Tern 隔离实例」。

## `~/.omp`

- **和终端版共用**，只读可以；修改只经 omp 的命令（RPC、`omp config set`），不自己写配置或会话文件，否则两边互相写坏。改设置不另存副本、不用 `--config` 覆盖。
- **自动写入只有两处**，都是未设置时经 `omp config set` 写一次、用户设过就不碰：
  - `goal.continuationModes` 加上 `rpc`（`omp-config/goal-default.ts`）；
  - `startup.setupWizard` 设为 `false`，免得 omp 的首次运行引导占满第一个 TSP 任务（`omp-config/setup-wizard-default.ts`，仓库所有者 2026-10-21 批准）。
- **omp 已经算好的值直接用 RPC 给的**（模型的智能分 `int`、速度 `tps` 等，`get_available_models`），不自己读 omp 的库重算：omp 查库前会按 provider 的各种写法归一，studio 原样查时中转站和改过写法的 provider 大多查不到（2026-10-22，`model-insights.ts` 去掉 `models.db` 读取）。
- 让 omp 多出一种能力（provider、模型）时，先确认终端版 omp 和 `omp commit` 这类子命令也看得到；做法见 [client-accounts.md](client-accounts.md)「0. 结论」。

## 自己写 omp 配置的例外（只有这五处）

新增第六处之前先问仓库所有者。

1. **agent 目录 `models.yml` 的 `providers.<id>`**（`omp-config/models-file.ts`）：用 `yaml` 的 Document API，不手拼文本；只改这一层，注释和其他内容原样保留；原子写，写前留 `.bak`；只有旧 `models.json` 时不写；key 只进不出，日志不记 key；界面写不进以 `!` 开头的 key（那是 omp 的"命令取 key"）。写某个键之前读 `omp://models.md` 里这类 provider 的全部字段说明，见 [custom-models.md](custom-models.md)。
2. **agent 目录 `.env`**（`omp-config/env-file.ts`，仓库所有者 2026-10-24 批准）：自定义 provider 的 `apiKey` 引用的那个变量；以及内置 provider 的 key 变量已经写在 `.env` 里时，"设置 API key"改那一行（omp 优先用 `.env`，`setEnvKey`，同日批准；变量不在 `.env` 里就存凭据库，不新增行）。只改这一个变量的行，注释、`export`、CRLF、BOM 和别的变量原样保留；改完用 `util.parseEnv` 核对别的变量一个没变，对不上就不写；原子写，写前留 `.env.bak`；没人再引用、也不是内置 provider 认的变量名时才删那一行；key 只进不出。
3. **omp 自己的 MCP 配置文件**（agent 目录 `mcp.json`、项目 `.omp/mcp.json`）里 `mcpServers.<name>` 这一项（编辑 MCP 服务器，仓库所有者 2026-10-24 批准）：只改表单管的字段，这一项的别的字段、别的服务器、键的顺序和缩进、换行、BOM 原样保留；JSON 解析不了就不写；原子写，写前留 `.bak`；别的工具的配置（`.claude/`、`.cursor/` 等）只读；token 只进不出。
4. **skill 文件夹**（仓库所有者 2026-10-24 批准）：添加 = 把用户选的、带合法 `SKILL.md` 的文件夹复制进 `~/.agents/skills/<name>`（各家 agent 共用）或 agent 目录 `skills/<name>`（只有 omp 找得到），项目范围对应项目的 `.agents/skills/`、`.omp/skills/`；同名拒绝，不覆盖。删除 = 按 `omp skill list --json` 给的 `baseDir` 把整个文件夹移进回收站（`shell.trashItem`），不直接删；插件带的 skill 不能删。停用只经 `omp config set disabledExtensions`。
5. **内置账号插件的扩展目录** agent 目录 `extensions/studio-accounts/`（`client-accounts/deploy.ts`，仓库所有者 2026-10-26 批准；终端版 omp 和 `omp commit` 也要看到这些 provider）：只写这一个目录，不碰 `extensions/` 下别的东西；内容没变的文件不重写，变了的先写临时文件再换名；按 `.studio-files.json` 清单删旧文件，清单指向目录外的路径忽略，插件自己的缓存不动。卸载时由安装器删掉（更新时不删）。

"先写临时文件再换名"一律用 `src/main/tasks/atomic-write.ts`（只有它对 Windows 上的 EPERM / EBUSY / EACCES 重试），由 oxlint 拦住自写的 `rename`。

## 协议

- **RPC 类型不手写**：`npm run rpc:update-wire -- <omp 版本>` 从官方 tag 拷贝，不装 `@oh-my-pi/pi-coding-agent` npm 包（oxlint 拦这个 import）。生成类型：`src/shared/omp-wire/rpc-wire.generated.ts`、`src/shared/tsp/tsp.generated.ts`。
- 不用 wire schema / TSP 规范里没有的命令、事件或 role；要用先问仓库所有者。
- **任务只有一种引擎：TSP**（伪终端里的交互式 omp）。经典 rpc 任务引擎已在 0.3.26 删除（仓库所有者 2026-10-21 批准），见 [tsp-migration.md](tsp-migration.md) §11。
- **rpc-ui 后台进程**（`serviceOmp`、`service/project-omp.ts`；登录、模型列表、斜杠命令列表、内置命令，不跑任务对话）：启动参数用 `--mode rpc-ui`（`--rpc` 会退回 TUI、往 stdout 输出 ANSI）；先 `negotiate_protocol` 协商 v2，处理 `rpc_chunk` 分块，不假设一行就是一个完整事件。见 [omp-rpc.md](omp-rpc.md)。
- **TSP 任务**：用 node-pty 自带的 ConPTY（`useConptyDll: true`），系统 ConPTY 会吞掉 APC。节点 `role`（如 `omp.editor.ask*`）不是公开契约，按 role 判断的逻辑集中在 `src/shared/tsp/` 的纯函数里，用录制的帧测。
- 给 omp 的命令统一加参数前，对每个会走到的子命令真跑一次：各子命令有自己的 flag 表（`-e` 的教训见 [client-accounts.md](client-accounts.md)「加载」）。

## 进程

- **不能留孤儿进程。** 会话和 stdin 绑定；所有退出路径（托盘退出、菜单退出、安装更新、系统注销）都要明确关掉 omp 子进程。新增退出入口必须经过 `window/shutdown.ts`（`app.quit()` 或 `finishShutdown()`），否则会被窗口的 close 处理器拦成"只隐藏"。窗口 × 只隐藏窗口，任务继续跑。
- 主进程被强杀时 omp 的孙进程会留下，所以 omp 子进程放进 Job Object（`KILL_ON_JOB_CLOSE`）兜底。内置终端和 TSP 的 pty 各用自己的 Job（`assignToOwnJob`），结束时先 `taskkill /T /F` 再 `pty.kill()`，spawn 和 kill 都在 `withPtyLock` 里；归档任务、丢弃 worktree 前也要这样结束，否则目录被占着删不掉。细节见 [task-model.md](task-model.md)「进程树兜底」。
- macOS 没有 Job Object：同一个入口（`assignToAppJob` / `assignToOwnJob`）在 darwin 上起 `sh` 看门狗（`platform/posix/watchdog.ts`），杀进程树用 `platform/posix/process-tree.ts`（`ps` 列表 + SIGKILL），不另写一套。mac 分支没有真机验证，改动时在 [mac.md](mac.md) 记下哪些没实测。
- 启动子进程不用 `shell: true`，不把用户输入拼进命令字符串，参数一律用数组（`scripts/check.ts` 的 `shell-true`）。
- 原生调用用 koffi，只在 `src/main/platform/win32/ffi.ts` 里 `koffi.load`（oxlint 拦别处的 import）。

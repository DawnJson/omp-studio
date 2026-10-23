# 插件和市场（设置 → 集成与插件）

界面规格见 `docs/design/spec.md` §4.19「插件」。这里写数据从哪来、omp 18.12.5 实测了什么、哪里不能信文本。

## 通道

只用 omp 的 CLI：`omp plugin …`（`src/main/plugins/plugin-cli.ts`），不读写 `~/.omp` 下的任何文件（AGENTS.md）。
`ipc/plugin-handlers.ts` 用 `runOmpCommand`（和用量查询同一个，args 数组、不走 shell）跑：用户范围在 `userData/service/`，项目范围在项目目录（见下）。

IPC：`listPlugins(projectId | null)`、`discoverPlugins(marketplace)`、`getPluginConfig(plugin)`、`runPluginAction(action, projectId | null)`。
渲染进程只能发封闭联合 `PluginAction`（`src/shared/omp-output/plugins.ts`）；`parsePluginAction` 校验，`pluginActionArgs` 拼参数数组。
插件 id / 市场名 / 功能名 / 设置键必须匹配白名单正则，不能以 `-` 开头；设置值和市场来源不能含控制字符、不能以 `-` 开头（omp 会把它们当成选项，实测 `config set … -5` 报 `Unknown option`）。
改动类动作在主进程排队串行（omp 写同一份 lockfile / registry），一个失败不会卡住后面的。
退出码非 0：抛错，message 是 omp 自己的话（`✘ ` 前缀去掉，从 stdout 或 stderr 取），界面经 `reportError` 弹出。

## 项目范围（`--scope project`）

不需要 rpc-ui：在项目目录里跑同一个 CLI。渲染进程只传 `projectId`，主进程在 `ipc/plugin-handlers.ts` 用项目记录里的目录当 cwd（项目不存在 → IpcValidationError）；`action.scope === "project"` 却没有 projectId 时拒绝，不会悄悄装到用户范围。
`PluginAction` 的 enable / disable / uninstall / upgrade(id) / install 带可选 `scope: "user" | "project"`，拼成 `--scope <scope>`；`upgrade` 不带 id（全部）时 omp 忽略 scope。

实测（omp 18.12.5，临时 `PI_CONFIG_DIR` + 临时项目目录，样本 `list-project-both-scopes.json`、`install-project.txt`、`disable-ambiguous-scope.txt`）：

- 在项目目录里 `plugin list --json` 同时返回用户和项目范围的市场插件；在别的目录里只有用户范围。同一个 id 在两个范围都装了就是**两条记录**（各带 `scope` 和自己的 `entries`），`parsePluginList` 按 id 合并成一个插件的多个 `installs`，界面一个安装一行。
- 项目范围的文件在 `<项目>/<PI_CONFIG_DIR 名>/plugins/`（默认 `.omp/plugins/installed_plugins.json`、`omp-plugins.lock.json`、`node_modules`）；项目目录要有 `.git` 或 `.omp` 才被当成项目根。
- 两个范围都装了时，不带 `--scope` 的 enable / disable / uninstall 退出 1：`Plugin "x" is installed in both user and project scope. Use --scope user or --scope project …`。所以界面的每个动作都带自己那一行的 scope。

改完后设置页提示"在运行中的任务里重新加载"：对每个**空闲**任务发 `runTaskCommand(taskId, { kind: "reloadPlugins" })`（S0 的 `TaskCommand`，TSP 走 `/reload-plugins`，rpc 走 prompt），忙的任务不碰，提示数量。omp 文档（`marketplace.md`）：`/plugins enable|disable` 会刷新当前会话，其他市场改动只写磁盘，需要 `/reload-plugins`。

## omp 18.12.5 实测（样本在 `fixtures/omp-plugin/`，路径已脱敏）

测试环境：`PI_CONFIG_DIR=.omp-tmp-s6`（HOME 下的目录名）。**`PI_CODING_AGENT_DIR` 管不住插件目录**：插件、市场注册表在 `<HOME>/<PI_CONFIG_DIR>/` 下（`plugins/`、`marketplaces.json`），不在 agent 目录里。测真实 omp 一定要设 `PI_CONFIG_DIR`，用完删掉那个目录，否则会写进真实的 `~/.omp`。

`--json` 只对一部分子命令有效：

| 命令 | 输出 |
|---|---|
| `plugin list --json` | JSON：`{ npm: [{name, version, path, manifest:{features,settings,description?}, enabledFeatures, enabled}], marketplace: [{id, scope, entries:[{scope, installPath, version, installedAt, lastUpdated, enabled?}]}] }`；`enabled` 为 true 时**不出现**，只有停用时是 `false`；空时两个数组为空 |
| `plugin doctor --json` | JSON：`[{name, status: ok\|warning\|error, message}]`（`--fix` 加参数即可） |
| `plugin features <name> [--enable f\|--disable f] --json` | JSON `{plugin, enabledFeatures: null\|[…], availableFeatures}`；带 `--enable/--disable` 时前面多一行 `✔ Updated features for …` |
| `plugin config list <name> --json` | JSON `{settings, schema}`；`config set <name> <key> <value>`、`config delete <name> <key>`（没有 `reset`）输出 `✔ Set k` / `✔ Deleted k`；类型不对退出 1：`Expected number` |
| `plugin enable\|disable <id> --json` | JSON：`{"enabled": id}` / `{"disabled": id}` |
| `plugin link <dir> --json` | JSON（带 manifest） |
| `plugin marketplace list` | **纯文本**（`--json` 被忽略）：`Configured Marketplaces:` 空行 `  <名称>  <来源>`；空时 `No marketplaces configured` + 提示 |
| `plugin discover [<市场>]` | **纯文本**：`Available Plugins (<市场>):` 空行，每个插件 `  <名称>[@<版本>]`，下面缩进 4 格的说明；空时 `No plugins available`。**不带市场名时不标出每个插件属于哪个市场**，所以界面按市场逐个 `discover <市场>`；未知市场退出 1：`✘ Failed to discover plugins: Error: Marketplace "x" not found` |
| `plugin install <name@market> --json` | **纯文本** `✔ Installed … (0.0.0)`；`--dry-run --json` 是 JSON `{dryRun, action, plugin, marketplace}` |
| `plugin upgrade [id] --json`、`uninstall`、`marketplace add/remove/update` | **纯文本**（`✔ …` / `✘ …`）；链接插件升级退出 1（`nothing to upgrade`） |

市场插件（`name@marketplace`）没有 features / config：`plugin features|config … <id>` 退出 1 `Plugin "…" not found`，所以详情页只给 npm / link 插件显示这两项。

## 解析

`src/shared/omp-output/plugins.ts`：`parsePluginList`、`parseDoctor`、`parsePluginConfig`、`parseMarketplaceList`、`parseDiscover`、`extractJson`（跳过 JSON 前的提示行）、`actionMessage`。
纯文本格式不是 omp 的契约：认不出来就抛 `PluginOutputError`（message 带原文前 400 个字符），界面显示它，不吞。空列表的两句纯文本（`No marketplaces configured`、`No plugins available`）按"空"处理，不是错误。

单测：`test/omp-plugins-output.test.ts`（样本解析、动作校验与参数）、`test/plugin-cli.test.ts`（假的 `RunOmp` 回放样本：串行、错误原话、空状态）。

## 已知限制

- 项目范围见上节；npm / link 插件的 features / config 只在用户范围（omp 对它们读写用户 lockfile）。
- 不做 npm 包安装（只装市场插件）和 `plugin link`；已有的 npm / link 插件可以启停、改功能和设置、卸载。
- 安装拉仓库 / 装依赖，超时给了 10 分钟，超时会杀进程并报错。
- 实测中 `install p1@nope`（不存在的市场）在 Windows 上报了 `EPERM … symlink`，不是 "not found"；原话照样显示。

## Skills（设置 → 集成与插件 → Skills，只读）

实测版本：omp 18.12.6（临时 `PI_CODING_AGENT_DIR` + 临时项目目录，用后已删）。界面规格见 `spec.md` §4.19 集成与插件那一行。

**skill 从哪来**（`omp://skills.md`）：`<根>/skills/<名字>/SKILL.md`，只认一层；根包括用户的 `~/.omp/agent/skills`（`PI_CODING_AGENT_DIR` 下的 `skills/`）、项目的 `.omp/skills`、Claude / Codex / agents 等别家工具的目录（`~/.claude/skills` 等，各有开关）、市场插件和 `omp skill install` 装的包（Skillshare，`skills.lock.json`）、`skills.customDirectories`、MCP 服务器广告的 `skill://`。重名时高优先级的保留原名，其余变成 `<命名空间>/<名字>`。`skills.enabled` 为 false 时一个都没有。

**omp 有没有列出的官方途径**：

- `get_available_commands`（rpc-ui，TSP 任务的 `/` 补全也用它）：`source: "skill"` 的条目，`name` 是 `skill:<名字>`，另有 `description`、`input.hint`。**没有文件路径、来源层级、启用状态**。实测 21 个条目（用户目录 + 项目目录里放的测试 skill 都在，另有本机 `~/.claude/skills` 里的）。需要 `skills.enableSkillCommands`（默认开）；关掉后这条路里没有 skill。
- `omp skill list`（`--json`）只列 Skillshare 注册表装的包，看不到手写的 skill，所以不用。
- 没有 `omp skills` 命令，没有启用 / 停用 / 删除某个 skill 的命令或 RPC（只有 `skills.ignoredSkills`、`disabledExtensions` 这类配置，不是 skill 的操作）。所以卡片只读，不做“打开所在文件夹”（条目没给路径，不自己猜目录）。

**实现**：IPC `listSkills(projectId | null)`（`ipc/integrations-handlers.ts`）：用户范围向服务进程（`serviceOmp`，cwd 是 `userData/service`，没有项目层）取；项目范围向该项目目录的短命 rpc-ui（`projectOmp`）取。解析在 `shared/omp-output/skills.ts`（`skillsFromCommands`）。范围徽标是比对出来的：项目目录的列表里，服务进程列表也有的名字算 `用户（全局）`，只在项目里出现的算 `项目`（omp 不给来源）。[推测] 项目 skill 与用户 skill 重名时 omp 会把其中一个改成命名空间名，不会误判；项目范围的 e2e 没有覆盖，只实测过项目目录的 rpc-ui 列表里能看到项目 skill。

**测试**：`test/omp-skills-output.test.ts`；e2e `test/e2e/settings-functional.e2e.ts` 的 “Skills 分组”：agent 目录里放 `skills/e2e-probe-skill/SKILL.md`（应用启动前写好，omp 启动时才发现 skill），用户目录指到空目录，断言行、范围徽标、说明，中英文 × 900/1200 宽 `expectNoOverflow`。

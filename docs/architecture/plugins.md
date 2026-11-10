# 插件和市场（设置 → 集成与插件）

界面规格见 spec §4.19（`docs/design/spec/4.19-settings-page.md`）「集成与插件」。这里写数据从哪来、omp 18.12.5 实测了什么、哪里不能信文本。

## 通道

只用 omp 的 CLI：`omp plugin …`（`src/main/plugins/plugin-cli.ts`），不读写 `~/.omp` 下的任何文件（[omp-boundaries.md](omp-boundaries.md)）。
`ipc/plugin-handlers.ts` 用 `runOmpCommand`（和用量查询同一个，args 数组、不走 shell）跑：用户范围在 `userData/service/`，项目范围在项目目录（见下）。

IPC：`listPlugins(projectId | null)`、`discoverPlugins(marketplace)`、`getPluginConfig(plugin)`、`runPluginAction(action, projectId | null)`。
渲染进程只能发封闭联合 `PluginAction`（`src/shared/omp-output/plugins.ts`）；`parsePluginAction` 校验，`pluginActionArgs` 拼参数数组。
插件 id / 市场名 / 功能名 / 设置键走白名单正则；设置值和市场来源不能含控制字符、不能以 `-` 开头（omp 会把它们当成选项，实测 `config set … -5` 报 `Unknown option`）。
改动类动作在主进程排队串行（omp 写同一份 lockfile / registry），一个失败不会卡住后面的。
退出码非 0：抛错，message 是 omp 自己的话（去掉 `✘ ` 前缀，从 stdout 或 stderr 取），界面经 `reportError` 弹出。

## 项目范围（`--scope project`）

不需要 rpc-ui：在项目目录里跑同一个 CLI。渲染进程只传 `projectId`，主进程用项目记录里的目录当 cwd（项目不存在 → IpcValidationError）；`action.scope === "project"` 却没有 projectId 时拒绝，不会悄悄装到用户范围。
`PluginAction` 的 enable / disable / uninstall / upgrade(id) / install 带可选 `scope`，拼成 `--scope <scope>`；`upgrade` 不带 id（全部）时 omp 忽略 scope。

实测（omp 18.12.5，临时 `PI_CONFIG_DIR` + 临时项目目录，样本 `list-project-both-scopes.json`、`install-project.txt`、`disable-ambiguous-scope.txt`）：

- 在项目目录里 `plugin list --json` 同时返回用户和项目范围的市场插件；在别的目录里只有用户范围。同一个 id 在两个范围都装了就是**两条记录**（各带 `scope` 和自己的 `entries`），`parsePluginList` 按 id 合并成一个插件的多个 `installs`，界面一个安装一行。
- 项目范围的文件在 `<项目>/<PI_CONFIG_DIR 名>/plugins/`（默认 `.omp/plugins/`）；项目目录要有 `.git` 或 `.omp` 才被当成项目根。
- 两个范围都装了时，不带 `--scope` 的 enable / disable / uninstall 退出 1：`Plugin "x" is installed in both user and project scope. Use --scope user or --scope project …`。所以界面的每个动作都带自己那一行的 scope。

改完后设置页提示"在运行中的任务里重新加载"：对每个**空闲**任务发 `runTaskCommand(taskId, { kind: "reloadPlugins" })`（TSP 走 `/reload-plugins`），忙的任务不碰，提示数量。依据 omp 文档 `marketplace.md`：`/plugins enable|disable` 会刷新当前会话，其他市场改动只写磁盘，需要 `/reload-plugins`。

## omp 18.12.5 实测（样本在 `fixtures/omp-plugin/`，路径已脱敏）

**`PI_CODING_AGENT_DIR` 管不住插件目录**：插件、市场注册表在 `<HOME>/<PI_CONFIG_DIR>/` 下（`plugins/`、`marketplaces.json`），不在 agent 目录里。测真实 omp 一定要设 `PI_CONFIG_DIR`，用完删掉那个目录，否则会写进真实的 `~/.omp`。

`--json` 只对一部分子命令有效：

| 命令 | 输出 |
|---|---|
| `plugin list --json` | JSON：`{ npm: [{name, version, path, manifest:{features,settings,description?}, enabledFeatures, enabled}], marketplace: [{id, scope, entries:[{scope, installPath, version, installedAt, lastUpdated, enabled?}]}] }`；`enabled` 为 true 时**不出现**，只有停用时是 `false` |
| `plugin doctor --json` | JSON：`[{name, status: ok\|warning\|error, message}]` |
| `plugin features <name> [--enable f\|--disable f] --json` | JSON `{plugin, enabledFeatures: null\|[…], availableFeatures}`；带 `--enable/--disable` 时前面多一行 `✔ Updated features for …` |
| `plugin config list <name> --json` | JSON `{settings, schema}`；`config set` / `config delete`（没有 `reset`）输出 `✔ …`；类型不对退出 1：`Expected number` |
| `plugin enable\|disable <id> --json` | JSON：`{"enabled": id}` / `{"disabled": id}` |
| `plugin marketplace list` | **纯文本**（`--json` 被忽略）：`Configured Marketplaces:` 空行 `  <名称>  <来源>`；空时 `No marketplaces configured` |
| `plugin discover [<市场>]` | **纯文本**：`Available Plugins (<市场>):` 空行，每个插件 `  <名称>[@<版本>]` + 缩进 4 格的说明；空时 `No plugins available`。**不带市场名时不标出每个插件属于哪个市场**，所以界面按市场逐个 `discover <市场>` |
| `plugin install <name@market> --json` | **纯文本** `✔ Installed …`；`--dry-run --json` 才是 JSON |
| `plugin upgrade [id] --json`、`uninstall`、`marketplace add/remove/update` | **纯文本**（`✔ …` / `✘ …`）；链接插件升级退出 1（`nothing to upgrade`） |

市场插件（`name@marketplace`）没有 features / config：`plugin features|config … <id>` 退出 1 `Plugin "…" not found`，所以详情页只给 npm / link 插件显示这两项。

## 解析

`src/shared/omp-output/plugins.ts`（`parsePluginList`、`parseDiscover` 等）。纯文本格式不是 omp 的契约：认不出来就抛 `PluginOutputError`（message 带原文开头），界面显示它，不吞。空列表的两句纯文本按"空"处理，不是错误。

单测：`test/omp-plugins-output.test.ts`（样本解析、动作校验与参数）、`test/plugin-cli.test.ts`（假的 `RunOmp` 回放样本：串行、错误原话、空状态）。

## 预设市场

`PRESET_MARKETPLACES`（`src/shared/omp-output/plugins.ts`）列四个 Anthropic 市场，来源文档 https://code.claude.com/docs/en/plugins/anthropic-marketplaces 。omp 18.12.6 实测：`marketplace add <owner/repo>` 后 `marketplace list` 的来源列原样回显 `owner/repo`，**市场名取自仓库 `.claude-plugin/marketplace.json` 的 `name`，不一定等于仓库名**（如 `anthropics/claude-plugins-community` → `claude-community`）。"已添加"判断：市场名等于预设名，或来源（忽略大小写）等于预设来源。不预设 `anthropics/claude-code`（演示市场，插件与官方重复）。

## 已知限制

- npm / link 插件的 features / config 只在用户范围（omp 对它们读写用户 lockfile）。
- 不做 npm 包安装（只装市场插件）和 `plugin link`；已有的 npm / link 插件可以启停、改功能和设置、卸载。
- 安装拉仓库 / 装依赖，超时（`ipc/plugin-handlers.ts` 的 `ACTION_TIMEOUT_MS`）会杀进程并报错。
- 实测中 `install p1@nope`（不存在的市场）在 Windows 上报了 `EPERM … symlink`，不是 "not found"；原话照样显示。

## Skills（设置 → 集成与插件 → Skills：列出、停用 / 启用、删除、添加）

实测版本：omp 18.12.6（2026-10-24；临时 `PI_CODING_AGENT_DIR` + 临时 `USERPROFILE` / `HOME` + 临时项目目录）。界面规格见 `spec.md` §4.19 的 Skills 条。

**skill 从哪来**（`omp://skills.md`）：`<根>/skills/<名字>/SKILL.md`，只认一层；根包括用户 agent 目录的 `skills/`、`~/.agents/skills`、项目的 `.omp/skills` 和 `.agents/skills`、别家工具的目录、市场插件、`omp skill install` 装的包、`skills.customDirectories`、MCP 的 `skill://`。重名时高优先级的保留原名，其余变成 `<命名空间>/<名字>`。provider 分两类：用户放进 `skills/` 的文件夹（`native` / `agents` / `claude` / `codex` …）和插件类（`omp-plugins` / `claude-plugins` / `skillshare` / `omp-managed` …），后者不能删。

**读：`omp skill list --json`**（实测）：输出 `{ skills: [{ name, description, filePath, baseDir, source, hide }], warnings: [] }`，列出**所有**发现到的 skill，不只是注册表装的。`source` 是 `<provider>:<level>`，如 `native:user`、`agents:user`、`agents:project`。

**cwd 怎么选**（项目级发现会沿 cwd 往祖先目录找，所以 cwd 决定来源标注）：实测 cwd 在家目录**下面**时，`~/.agents/skills` 标 `agents:user`；cwd **就是**家目录时，`~/.codex/skills` 等被标成 `codex:project`。所以用户范围在中性目录（`serviceCwd()` = `userData/service`）里跑，项目范围在项目目录里跑（用户级 + 项目级都在，靠 `source` 后缀区分）；`level` 只按 `:project` 后缀判断，其余算用户级。

**停用 / 启用**：`disabledExtensions` 数组里放 `skill:<name>`（omp 自己的 `/extensions` 面板也改这个键；对原名和最终名都生效）。**被停用的 skill 不再出现在 `omp skill list --json` 里**（实测），所以主进程把配置里的 `skill:<name>` 补成"已停用"行（只有名字）。写：`omp config get --json disabledExtensions` 读出整个数组（这个键还装 `context-file:…`、`extension-module:…`），只加减 `skill:<name>`，别的条目按原顺序原样 `omp config set --json disabledExtensions -- '<JSON 数组>'` 写回；没变化不写。读写都在中性目录里跑。**项目层写不了**：`omp config set` 只写用户配置（没有 `--scope`），项目的 `.omp/config.yml` 能整个覆盖这个数组（数组设置被更高优先级的层替换、不合并，`omp://context-files.md`），studio 不自己改项目文件（[omp-boundaries.md](omp-boundaries.md)），所以项目层 skill 的开关禁用、悬停说明。已知限制：用户配置里停用的名字，在项目里同名的项目层 skill 也会被停用（按名字匹配）；项目的 `.omp/config.yml` 自己设了 `disabledExtensions` 时会盖过用户的，界面不知道。

**删除**：渲染进程只传 `name` + `scope`（+ projectId）。主进程重新跑 `omp skill list --json`，按名字和层级找到条目，校验：provider 不是插件类；`baseDir` 是绝对路径、形如 `…/skills/<目录>`；`baseDir/SKILL.md` 是文件。通过后 `shell.trashItem(baseDir)`（进回收站，不直接删）。列表给每行带 `removable`（同一套校验）、`folder`（脱敏路径，只用于确认框显示）、`shared`（provider 是 `agents`，确认框多一句其他 agent 工具也会失去它）。

**添加**：`pickSkillFolder`（主进程弹对话框，路径留在主进程，只给 token）：读 `SKILL.md` 的 frontmatter，必须有非空的 `name` 和 `description`；`name` 会成为目标文件夹名，所以要是合法文件夹名、且不含 `/` `\`（omp 保留给命名空间，`omp://skills.md`），规则见 `src/main/integrations/skills.ts`。`addSkill(token, target, scope, projectId)`：目标 `shared` = `.agents/skills`，`omp` = agent 目录 / 项目 `.omp` 下的 `skills/`；复制前重读一次 `SKILL.md`（名字变了就拒绝），目标已存在、或目标在被添加的文件夹里面都拒绝；复制不覆盖（`errorOnExist`）。这是 [omp-boundaries.md](omp-boundaries.md)「自己写 omp 配置的例外」第 4 项（所有者批准，2026-10-24：写进 skill 文件夹，别的不写）。

**让运行中的任务看到**：skill 在 omp 会话启动时发现，没有文件监视；`omp://marketplace.md` 说 `/reload-plugins` 会刷新 skills、斜杠命令、子代理和 MCP。添加 / 停用 / 启用 / 删除后显示插件区同一条 `plugins.reload.*` 提示（`plugins-store.ts` 的 `requestReload`）；[推测] 它也会重读 `disabledExtensions` 和 skill 文件夹，没有逐项实测；新任务一定读到最新状态。

**实现**：IPC 在 `ipc/integrations-handlers.ts`，参数校验后转调 `src/main/integrations/skills.ts`（不 import electron，回收站函数和 omp 执行器注入，单测直接用）。解析在 `shared/omp-output/skills.ts`。

**测试**：`test/omp-skills-output.test.ts`（解析、`disabledExtensions` 的加减）、`test/integrations-skills.test.ts`（真实临时目录，路径带空格和中文）；e2e `test/e2e/settings-functional.e2e.ts` 的 “Skills 分组” 和 “Skills 添加（共用 / 只有 omp）、停用与启用、删除进回收站”（`USERPROFILE` / `HOME` / `PI_CODING_AGENT_DIR` 全在临时目录，选文件夹对话框用 `app.evaluate` 打桩；删除是真的进系统回收站）。项目范围的添加 / 删除 e2e 没有覆盖，只有单测。

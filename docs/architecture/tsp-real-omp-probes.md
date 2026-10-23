# TSP 任务:真实 omp 盲区实测

> 实测日期 2026-10-21;omp **18.12.5**(PATH 上的 omp.exe),omp-studio v0.3.24 的 `out/` 构建,模型 `deepseek/deepseek-v4-flash`。
> 方法:临时 `PI_CODING_AGENT_DIR`(`omp config set modelRoles '{"default":"…"}'`、`startup.setupWizard false`)、临时 git 仓库、`STUDIO_USER_DATA` 隔离;key 从 `.env` 以环境变量传入;`PI_TUI_TSP_RECORD=<文件>` 录 omp 的双向 TSP 消息核对。探针脚本用完已删。证据截图在 `screenshots/gap/studio/blind/`(gitignore),清单见 `screenshots/gap/差距清单.md` §4。
> 结论汇总在差距清单;这里只记 omp 的行为和 studio 的现状,供改代码时对照。

## 1. 首次运行:omp 的 5 步引导会出现在第一个任务里

新的(空的)agent 目录里,`startup.setupWizard` 默认 `true`、`setupVersion` 为 0,omp 交互模式启动后在 `main` 里画 `omp.app.setup` 全屏式引导:Sign in(`omp.setup.sign-in`,provider 列表)→ 模型浏览器(`omp.setup.model`)→ 字形(`omp.setup.glyph`)→ 输入框(`omp.setup.composer`)→ 主题(`omp.setup.theme`),每步一个 `omp.select`;**Esc 前进一步**,实测连按 5 次才回到普通输入框。

- studio 的输入框这期间一直显示"有 omp 面板开着(例如 Agent Hub),按 Esc 关掉"(`screen_open`,§10.7),发送被拒("Not sent");新手第一句话发不出去(草稿保留在输入框)。
- 引导走完后模型胶囊显示 omp 的默认模型(`Opus 5.5`),没有 key 时第一次发送直接报 `Request failed`。
- 关掉引导只需 `omp config set startup.setupWizard false`(探针里这样做了,之后一切正常)。**已处理(仓库所有者 2026-10-21 批准,AGENTS.md"omp 的边界"):** studio 启动时没设过就设一次,做法和"设过"的判断见 [omp-settings.md](omp-settings.md)(`startup.setupWizard` 一条)。任务启动(`buildTspLaunch`)先等这个启动默认(上限 15 s,失败/超时照常启动),所以第一个任务就没有引导。两个启动默认依次执行(并发的 `omp config set` 会互相覆盖)。服务进程和项目 rpc-ui 池(`--mode rpc-ui`)不画 TUI 引导,不受影响。
- 证据:`s2-t20.png`(sign-in 步骤)、`s22-01…s22-03*.png`。

## 2. 键盘

- studio 的输入框是自己的 `<textarea>`;omp 自己的输入框节点(`omp.editor`)不画,所以 **omp 的全局快捷键一个都到不了 omp**:实测输入框聚焦时按 ⌃T、⇧Tab、⌃P、⌥P、⌥⇧P、⌃R、F5、⌥R 都没有任何效果(⇧Tab 只是把焦点移到顶栏按钮;⌃F 打开的是侧栏的"搜索任务和会话")。`keys.ts` 的 `encodeKey` 只在 list / 提问对话框 / 终端输入框这几个能拿键盘的 TSP 节点里用。
- studio 自己有的等价键:`Alt+T` 循环思考强度(实测 High→Max→Off,胶囊同步)、`Alt+M` 切模型(命令面板里列着)、`Ctrl+O` 展开过程、`Esc` 停止。没有等价的:⌃T(思考块显隐)、⌃P(循环角色模型)、⌥⇧P(计划模式)、⌃R(历史搜索)。
- omp 的节点上自带键帽提示:`Retry F5`、`Switch model ⌥P`、`Edit ⌥↑`、`esc Stop` 等。点按钮有效(见 §5、§6);只有按键无效。
- **对话内查找**:没有(⌃F 是侧栏搜索)。

## 3. 输入框前缀

| 输入 | 实测(omp 18.12.5,TSP) |
|---|---|
| `@` | studio 自己的文件补全(`FileMenu`,`features/composer/file-complete.ts`):`@REA` 弹出 `README.md`,Tab 补成 `@README.md `;发给 omp 后由 omp 展开。差距清单 F4 里"没找到 @ 补全"是错的。 |
| `$ print(1)` | 原样发给 omp,omp 当成 eval 执行:节点 `omp.eval` / `omp.tool.eval.input` / `omp.tool.eval.output`。 |
| `!echo x` / `!!echo x` | 原样发给 omp,执行 bash:`omp.bash` / `omp.tool.bash.*`。`!!` 也执行(是否进上下文由 omp 决定,没有逐项核对)。 |
| `#123` | 没有补全(studio 没做);文字原样发给模型。 |
| ⌃R | 没有历史搜索;↑ 翻本任务历史(`input-history.ts`)。 |

## 4. 计划模式

`/plan` 不在斜杠菜单里;手敲 `/plan` 回车,`slash-guard.ts` 弹 toast"This command is only available in terminal omp · Send as text anyway"(`terminalOnly` 表里有 `plan`)。⌥⇧P 不转发(§2)。设置 → "Subagents & planning" 页是 omp 配置项,不是模式开关。**studio 里没有进入计划模式的入口,也没有模式标识。**

## 5. Esc 中断与排队

- 运行中在 studio 输入框 Enter = steer(`send` 事件):实测 omp 对正在跑的 bash 发 "Backgrounded early to handle an incoming message; the command keeps running",steer 的消息立刻作为 `omp.user` 上屏,**不排队**。
- `Ctrl+Enter`("稍后")在 TSP 下也是 `send`:omp 把它放进 dock 的 `omp.queue`(`omp.queue.item` title `Steering` + `omp.queue.edit` "Alt+↑ Edit")。studio 没有自己的队列条。
- **排队中按 Esc**:omp 中断本轮("Stopped"),把排队文字还给**它自己的输入框**——录制里 `["text","3.line/input","append","<排队文字>"]`。studio 不画 `omp.editor`,studio 输入框保持空白,**这条消息从界面上消失**;之后下一次 `send`(带完整文本)会覆盖 omp 编辑器里的内容,所以不会串进下一条,只是丢了。Tern 会把它退回输入框(`09-interrupted.png`)。
- **B15 已修**:`TspRunner.stop()` 在 Esc 时若 omp 的 `omp.queue.item` 还在,就等 omp 输入框里出现那段文字(`shared/tsp/queue-restore.ts`,录制 `fixtures/tsp/queue-esc.jsonl`:Esc 那一帧同时 `del` 排队区和 `text … append` 输入框),作为 `RestoredQueue.steering` 返回给渲染进程放回 studio 输入框,并用 `edit` 事件清空 omp 的输入框。
- 证据:`s5-01-queued-later.png`、`s5-02-after-esc.png`、`s5-03-second.png`。

## 6. ask 超时倒计时

`ask.timeout`(默认 0 = 关)设为 25 秒实测:ask 对话框底栏左侧有圆环 + 秒数读数(`23s`,omp 的 `omp.actions` 行里的 `elapsed` 倒计时节点,`age<0`),studio 的 `nodes/motion.tsx` 画出来了。到期 omp **自动选第一项**:工具卡显示 `auto-selected after timeout — not a user choice`,模型继续("A: fast.")。到期后 `omp.editor.ask` 被撤掉,任务回到 idle。证据 `s6-01-ask-t2.png`、`s6-03-ask-t28.png`。

## 7. API 错误与自动重试

用 `HTTPS_PROXY=http://127.0.0.1:1` 造连接被拒(`retry.maxRetries=2` / `retry.enabled=false` 缩短时间):

- 每次尝试在 Windows 上约 33 秒才失败。这 33 秒里界面只有 `Working…` 和计时,**没有任何"正在重试"提示**。
- 失败后出现 `omp.error` 卡片:"Request failed / Couldn't connect to api.deepseek.com (connection refused)…",三个按钮 `Retry F5` / `Copy error` / `Switch model ⌥P`(节点 id `s.0/actions/retry` 等)。之后 omp 继续下一次尝试,工作行短暂显示 `Retrying · attempt 2 of 2 · esc Cancel`(0.6s 可见),任务状态全程 `running`。
- 重试预算用完:一条 `Retry budget exhausted after 2 retries: …` 文字,任务回到 idle。
- 点 `Retry` 按钮 → `action retry` 事件:空闲时重新发起请求(实测又失败一轮,出现第二张错误卡,旧卡的按钮仍在);omp 正在自动重试期间点它返回 toast `Nothing to retry`。
- F5、⌥R 键盘不生效(§2);F5 也不会刷新页面。
- `retry.maxRetries` 默认 10、`retry.maxDelayMs` 300 s,真实使用时一次 5xx 可能转很久且没有任何提示。证据 `s9-proxy-t10.png`、`s9-proxy-t50.png`、`s10-01-error.png`、`s12-01…03*.png`。

## 8. 斜杠命令:/trace /export /handoff /move /wt(/share 没跑)

| 命令 | 实测 |
|---|---|
| `/export` | studio 接管(TSP 走 `omp --export`),弹保存对话框后生成 HTML(870 KB),toast "Exported …html · Show in folder"。v0.3.24 里 B7 已不再出现。 |
| `/trace` | omp 在对话末尾打一行纯文字 `Trace: http://127.0.0.1:3847/#/traces?s=<会话文件路径,URL 编码>`;`127.0.0.1:3847` 实测返回 200(omp 起了本地 trace 查看器)。studio 画成普通文字,**不是链接**(没有 `<a>`),只能手动复制。 |
| `/handoff` | 执行了,但 omp 返回红字 `Error: Handoff failed: Nothing to hand off (already compacted)`:1 轮和 4 轮会话都是这样,没有拿到成功的交接;是 omp 对这类短会话的判断还是别的原因没有查清。 |
| `/move <目录>` | omp 把会话 cwd 换了("Moved to <目录>"),(2026-10-21 的缺陷,**已修**:omp 发 OSC 7,studio 解析成任务 cwd,见 tsp-migration.md §7「当前目录」。) |
| `/wt` | 在 git 仓库里:omp 在 `OMP_WORKTREE_DIR` 下建 `wt-<时间>-<id>` 目录和 `wt/<时间>` 分支,并把会话搬进去;之后模型写的文件落在新 worktree。(cwd 漂移已由 OSC 7 修复;studio 的 worktree 记录仍是原来的,任务行的工作树标记不会出现。)先 `/move` 到非仓库目录再 `/wt` 返回 `Worktree creation failed: Not inside a git repository`。 |
| `/share` | 会上传,按要求没跑。 |

证据 `s15-*.png`、`s16-*.png`、`s17-01-wt.png`、`s17-02-git-menu.png`。

## 9. 工作树任务(studio 的开关)

草稿里点工作树胶囊再发第一句话(真实 omp,TSP):omp 的 `worktree add` 在 `OMP_WORKTREE_DIR` 下建 `<id>-<id>` 目录,分支 `studio/<id>`;任务行有工作树标记、分支胶囊显示 `studio/<id>`;模型用 write 工具建的文件在 worktree 里、主仓库 `git status` 干净。证据 `s13-01…03*.png`。

## 10. 重启后恢复

发一句"记住 PINEAPPLE" → `app.quit()`(走 `window/shutdown.ts`)→ 用同一个 `STUDIO_USER_DATA` / agent 目录重启:启动按设计落在新任务草稿页(默认文件夹 `chats`),侧栏项目文件夹是**折叠**的,任务行(1 个)在里面;点开 → `--resume` 重放整段对话(带补回的每轮用量行),继续问"秘密词是什么"得到 `PINEAPPLE`。证据 `s14-tsp-0*.png`。

## 12. 系统通知

`GateNotifier` 的 `Notification.show` 在主进程里打桩后观察(没有看系统通知中心):窗口聚焦时 ask 到来 = 不发;`BrowserWindow.hide()` 后任务跑完 = `{title:"proj dir · <任务标题>", body:"Finished"}`;隐藏时 ask 到来 = `body:"Needs your confirmation: <问题>"`。系统层面的 toast 是否真的出现没有验证。

## 13. Agent Hub 的 Kill

2 个后台子代理(`task` 工具,各 `sleep 120`):点 `👥` 段进入 Hub(`picker` + tabs `agents`),底栏按钮 Revive / Kill / By parent / Filter / Close / Open transcript 都是真 `<button>`;点 `Kill` 发 `{"ev":"action","id":"w","act":"kill"}`,omp 把子代理的状态改成 `aborted`(tone `error`)。Hub 开着时输入框发送被拦(§10.7)。**B11 仍在 v0.3.24 复现**:Hub 详情栏的 "Recent activity" 一行一字(`s8-02-after-kill.png`)。

## 14. 审批:输入框里写的理由(§10.7 要求的实测)

`tools.approvalMode=always-ask`,模型要跑 `echo gate-test`:审批卡出现,输入框占位符 "Deny and tell omp what to do instead…";输入"Do not run it. Reply with exactly the word: REFUSED-OK"回车 → 工具卡 `Tool call denied by user: bash`,模型回复 `REFUSED-OK`。**拒绝理由送达模型,B4 在真实 omp 上确认。** 证据 `s19-01-gate.png`、`s19-02-after-deny-reason.png`。

## 15. 图标覆盖率(26 份录制 × `features/tsp/icons.tsx`)

录制里共 108 个不同的图标名(`k:"icon"` 的 `p.name`,加任意节点的 `icon` 属性):35 个有直接画法,54 个靠 `SUBSTITUTE` 换成近似图标,**19 个画不出来**:

- 14 个 `provider:<id>`(模型选择器里的供应商 logo,差距清单 I1)。
- `handoff`、`extension`、`voice`:在 `SUBSTITUTE` 里,但指向的 `forward` / `puzzle` / `wave` 自己也是 `SUBSTITUTE` 的键,而 `resolveIconName` 只查一层(`PATHS[alias]`),所以这三个(外加 `mic`→`wave`)实际不画。
- `ghost`、`omp`:没有映射。
- Nerd Font 私有区字符(录制里 16 种,如状态点 `\uf00c` / `\uf00d` / `\uf04d` 和模型选择器的字形)按 §8 不画。

## 16. 探针的隔离注意

- 设置 → Usage 读的是**真实** `~/.omp/stats.db`(`PI_CODING_AGENT_DIR` 对它无效,见 `omp-usage.md`),隔离启动要把 `USERPROFILE` / `HOME` 也指到临时目录,否则这一页截图里是真实用量(这次的截图已删)。
- PATH 上第一个 omp 是 Tern 管理的 `…\Tern\omp\bin\omp.exe`(只读使用,没有改它的目录)。

## 17. omp 快捷键转发(B18,实测 omp 18.12.5)

默认键表(`omp.exe` 里 `app.*` 的 `defaultKeys`):`app.thinking.cycle` ⇧Tab、`app.thinking.toggle` ⌃T、`app.model.cycleForward` ⌃P / `cycleBackward` ⌃⇧P、`app.model.selectTemporary` ⌥P、`app.model.select` ⌥M、`app.plan.toggle` ⌥⇧P、`app.history.search` ⌃R、`app.retry` F5 / ⌥R、`app.message.dequeue` ⌥↑ / ⇧↑、`app.tools.expand` ⌃O、`app.tools.toggleVisibility` ⌃⇧O、`app.agents.hub` ⌥A、`app.editor.external` ⌃G、`app.live.toggle` ⌃L。

方法:真实 omp(PATH)+ 临时 `PI_CODING_AGENT_DIR`(`config.yml` 写 `modelRoles.default` = `.env` 的 `STUDIO_TEST_MODEL`、`startup.setupWizard: false`)+ `PI_TUI_TSP_RECORD`,任务发 `Reply with exactly: ok` 跑完后,用 `studio.sendTspKeys` 把 `encodeKey` 编出的字节写给 omp(同一条路径),看 omp 回的帧:

| 键 → 字节 | omp 的反应 |
|---|---|
| ⇧Tab `ESC [ Z` | `set 3.bar/model/effort`,标题 `Thinking effort: max  ⇧⇥`(循环思考强度) |
| ⌃T `0x14` | 对话里的思考块被删,toast `Thinking blocks: hidden` |
| ⌃P `0x10` / ⌃⇧P `ESC [112;6u` | toast `Only one role model available`(只配了一个角色模型) |
| ⌥⇧P `ESC P` | `omp.composer.fact` "Plan" 徽标 + toast;再按一次 `Plan (paused)` |
| ⌃R `0x12` | `History` 选择器(`picker`,条目 = 本任务发过的提示) |
| ⌥P `ESC p` | `Switch model` 选择器("Session-only switch — role models stay unchanged") |
| F5 `ESC [15~` / ⌥R `ESC r` | toast `Nothing to retry`(没有失败的回合;有错误卡时才真的重试) |

结论:这些键的编码 omp 都认,studio 之前只是没写。转发规则见 `src/shared/tsp/forward-keys.ts`(白名单 = 上表里 studio 没占用的键 + 文档里 `kbd` 节点的键,studio 自己的键优先)。

## 18. 审批卡的选项列表：点一下就提交（实测 omp 18.12.6，2026-10-22，`deepseek/deepseek-v4-flash`，临时 agent 目录，`tools.approvalMode=always-ask`）

背景：studio 不再画审批卡底栏的 Deny / Approve 按钮（和选项列表重复，spec §4.17），鼠标批准 / 拒绝只剩点选项，所以实测选项列表的事件。门的结构固定：list `<G>.choices`，item `<G>.choices/once|session|deny`（`<G>` 每次不同）。

- `{ev:"activate", sf, id:"<G>.choices", item:"<G>.choices/once"}`：门消失，工具卡 `done`，命令执行。
- 同上 item `deny`：门消失，工具卡 `error`，输出 `Tool call denied by user: bash`，命令没跑。
- 同上 item `session`：命令执行，同一进程里第二次 bash 不再出门。
- **`select` 本身就提交**：只发 `select` 不跟 `activate`，结果和 activate 那一项一样（deny 两次、once、session 各验证过）；没观察到"只高亮不提交"的中间状态（轮询 0.3 秒）。`select` 和 `activate` 背靠背发，结果只算一次。
- 所以 `List.tsx` 点未选中项发 `select`、点已选中项发 `activate`，在审批卡里都是单击即提交该项，和 omp 自己的按钮一样没有二次确认。

## 19. 工具结果哪些是流式的（实测 omp 18.12.6，2026-10-23，`deepseek/deepseek-v4-flash`，Tern 0.9.5 和 studio v0.4.2 各跑一遍，`PI_TUI_TSP_RECORD` 录制）

omp 给 Tern 和 studio 发的帧一样（bash 输出两边都是 23 次 `text append`）；studio 的 DOM 在每帧后 13–77 ms 内跟上（50 ms 采样），没有找到延后或攒批的地方（主进程只攒 16 ms，`tsp-session.ts` 的 `BATCH_INTERVAL_MS`）。

- 流式：模型调用的 bash（`omp.tool.bash.output` 逐行 `text append`）、eval（每次输出一条 append）、write（`code` 节点约 250 字一次 append，头上 `meta` 的行数跟着变）、edit（`hunks` 整块 `set`，小改动 0.6 秒内）、思考和回答正文（md `text append`，结束时 `stream:null`）、task 的参数。
- 一次给全：web_search（pending 之后一帧带上回答和来源）、read 的结果、用户在输入框打的 `!命令`（`omp.bash`，结束时一帧带全部输出）、子代理运行期间（task / wait 卡片只有计时在走）。这些在 Tern 里也是一下子出来。
- 一轮结束时 omp 会把 bash 卡片 `del` 后重新 `add`，新卡片带完整输出。
- 证据：`screenshots/stream-probe/`（gitignore；`records/` 是两边的录制）。


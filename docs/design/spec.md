# omp-studio UI 规范 v1（定稿；2.6 起圆角、顶栏按方向 A「仪表」，见 `direction-2.6.md`；3.0 起色板换鸢尾紫、侧栏 / 气泡 / 改动卡片 / 输入框按方向 F，见 `direction-3.0.md`；3.1 起过程区、公式、模型选择、关于对话框照 Tern 里的 omp 改，见 `direction-3.1.md`；3.2 起控件统一用 `src/renderer/src/ui/`（§4.23）、设置页重排（§4.19），见 `direction-3.2.md`；运行脊线 2026-10-19 起去掉，见 §4.8）

> 范围：阶段 1 + 阶段 2 的全部界面。输入：`DesignCalm`（克制、结果优先）与 `DesignBold`（有辨识度的手感）两份方案，以这几条设计原则为硬约束：**过程信息的展开 / 折叠照 omp 的默认（2026-10-22 仓库所有者：没有“过程默认折叠”这条规则）、一个主导航、遥测克制、只用 token、中英双语、遵守 reduced-motion**。
> 配套文件：`src/renderer/styles/tokens.css`（全部变量，深浅两套，reduced-motion）。本文引用的 `--xxx` 都在那里。
> 证据标记：**✔** = 在仓库里核实过（fixture、wire schema、omp 文档）；**[推测]** = 没有实测，实现时要用回放或真机验证；未标记的是设计决定。

---

## 1. 裁决表

“采用”列：`[Calm]` / `[Bold]` = 采用该方案；`[融合]` = 两边各取一部分；`[新]` = 两份方案都没写、定稿时补的。倾向：**克制为底；只保留“不违反原则且低成本”的有性格细节**。

### 1.1 两份方案各自最可能被挑战的 3 个决定

| 决定 | 采用 | 理由 |
|---|---|---|
| Calm-1：审批/ask 就地替换输入框 | **否决，门停靠在输入框上方**（[Bold]）：门就是 omp 画在 dock 里的审批卡 / 提问对话框，dock 在 studio 输入框正上方（§4.17）。审批时输入框照常能用：`Enter` 不会批准（有草稿 = 拒绝并发送，空草稿不动作），批准要 `Ctrl+Enter` 或点 Approve。Calm 的“打字时不抢焦点”没有保留：门里的选项列表出现时会拿走键盘焦点（§4.17“焦点”） | omp 自己的设计就是“提示停靠在输入框上方，输入框保留光标，可输入文字来拒绝并改道”（`omp://approval-mode.md`）。替换输入框会丢掉“拒绝并告诉 agent 怎么做”这个真实能力 |
| Calm-2：叙述文本不留在正文，只剩结论 | **不适用**：对话是 omp 发来的 TSP 节点，助手文字和工具卡片按 omp 给的顺序排列，studio 不区分叙述和结论（§4.9） | 结构由 omp 决定、外观由 studio 的 CSS 决定（`docs/architecture/tsp-migration.md` §3）；“结果优先”靠 omp 节点的折叠（`collapsed`，§4.11）和每轮末尾的用量行 |
| Calm-3：自绘标题栏 + 无菜单栏 + 审批胶囊放在输入框 | **采用标题栏与无菜单栏**；**审批胶囊保留，显示和修改的是 omp 配置里的 `tools.approvalMode`**（见 §5.8） | 两份方案一致（`titleBarOverlay` 保留系统三键与 Snap Layouts [推测，需在 Win11 实测]）。审批模式没有运行中 RPC（`omp://approval-mode.md`），omp 在进程启动时读配置，所以胶囊的修改对之后启动的任务生效 |
| Bold-1：运行中展开 4 行“现场窗” | **否决，改为一行实时状态**（[Calm]）：`[点] 当前工具的 intent 原话 · 1:12 ›` | 一行已经回答“它在干什么、有没有卡住”；4 行滚动窗每次换行都是一次动画，并把“过程默认折叠”在运行中反过来。点击这一行展开完整工具列表。`intent` 的数据已核实 ✔：`fixtures/rpc/bash-tool.ndjson` 里 `tool_execution_start` 带 `"intent":"Running echo command"`，wire schema 中为可选字段（`src/shared/omp-wire/rpc-wire.generated.ts:836`），缺失时用工具名映射的动词兜底 |
| Bold-2：运行中 Enter=插话（steer）、Ctrl+Enter=稍后（follow-up）、Esc=停止并把排队消息放回输入框 | **采用**；设置页可对调 Enter / Ctrl+Enter；Esc 不做二次确认 | 两份方案一致。运行中发消息多数是纠偏；`abort_and_restore_queue` 保证 Esc 不丢字，终端用户零学习成本。误停的代价由 toast 说明消息去向 + 草稿保留来吃 |
| Bold-3：一批“有性格的小东西” | **部分采用**。保留：intent 原话、输入框首次发送“落下”、弹簧只用于浮层出现与发送↔停止形变、状态点用形状区分（菱形=等你）、`继续` 列表（含终端会话）、todo 进度胶囊；排队的消息由 omp 的 `omp.queue` 显示，studio 没有自己的队列条（§4.14）。**砍掉**：任务点卫星点、子代理字母头像与哈希色、4 行现场窗、流式文字平滑追赶、悬停显示模型署名、第二条“软弹簧”曲线 | 取舍标准：不增加常驻动效、不增加信息量、实现成本低、数据只依赖 omp 现有的输出。卫星点是侧栏常驻运动；子代理不靠头像 / 哈希色区分，右栏子代理面板（§4.28）用状态点和等宽名字 |

### 1.2 逐项裁决

#### Token

| 决定 | 采用 | 理由 |
|---|---|---|
| 字体来源 | 打包 Geist（正文、标题）+ Geist Mono（代码、路径、内置终端），中文用系统的微软雅黑 UI（仓库所有者 2026-10-21 定，照 Tern；原来是系统字体 Segoe UI Variable / Cascadia Code、不打包） | 字体文件取自 npm 包 `geist@1.8.2`，只放直立的可变字体 `src/renderer/styles/fonts/{Geist,GeistMono}-Variable.woff2`（各约 70 KB，100–900 字重，斜体由浏览器倾斜生成），`@font-face` 在 `tokens.css`，`font-display: block`；SIL OFL 1.1，许可证 `fonts/OFL.txt` 随安装包放在 `resources/licenses/Geist-OFL.txt`。`main.tsx` 在第一帧之前 `document.fonts.load` 两个字体栈：第一帧就是最终字体，xterm 打开时量到的是 Geist Mono 的字符宽度。Tern 的等宽是 Berkeley Mono（商业授权，不能打包），用同家族的 Geist Mono 代替 |
| 字体栈顺序 | [Calm/Bold 一致] Latin 在前，CJK 在后 | 浏览器逐字符回退，汉字走雅黑，两边字形互不污染 |
| 字号体系 | [融合] 命名用 `--fs-*`/`--lh-*`（Bold），数值取两边公共部分；正文 15px | 颜色里已有 `--text` 系列，字号再叫 `--text-sm` 会撞名。正文 15px 两边一致，中文行高 27、英文 24 |
| 字重 | [Bold] 状态不靠字重；500 只给 Latin 标签；中文标题用 600 | 雅黑 UI 只有 400/700，500 会回落，列表宽度与省略号位置会跳。Calm 的“选中行标题 500”被否决 |
| 间距 | [Calm] `--space-N` = N×4px，外加半档 `-0-5/-1-5/-2-5/-3-5` | 比 Bold 的非线性命名直观；半档是为了组件内边距（6/10/14）也能走 token |
| 圆角 | [融合] 两份几乎相同，取 4/6/8/12/16/pill | — |
| 表面层级 | [Bold] 五级表面；深色下侧栏比内容区更暗，浅色下更灰 | Calm 深色侧栏比内容区更亮，与“导航退后、内容突出”相反 |
| 强调色 | [3.0 改] 鸢尾紫（`#6B46D9` / `#A48BFF`；2.6 的松石绿作废） | 仓库所有者 2026-10-20 选定：取像素标志 π 渐变的中段，让标志和界面同一色系（`direction-3.0.md` §2.1）。强调色只出现在：进行中状态、主输入焦点环、链接、上下文圆环、开关、选中；主按钮近黑底（深色主题近白底），不用强调色 |
| 对比度修正 | [新] 深色 `--text-3` 调到 `#8A8D97`、浅色调到 `#666972`；浅色错误色调到 `#B93030`；代码注释与浅色数字色同步调亮 | 重算后 Bold 原值在深色 overlay 上 4.19、浅色悬停底上 4.17，低于 4.5:1。修正后全部主文本组合 ≥4.5:1（§2.5 表） |
| 阴影 | [Bold] 三级 + `--shadow-composer` | 输入框是视觉焦点，值得单独一档；2026-10-22 起 `--shadow-composer` 只剩一层贴底的小阴影（浅色 `0 1px 2px` + `0 2px 6px` 3%，深色 `0 1px 3px`），输入框靠 1px 边框和底色分开，不再浮起 |
| 动效曲线 | [Bold] ease-out-quint 为默认，一条弹簧（`linear()`） | Calm 的弹簧过冲 6%，偏弹；Bold 的 ζ≈0.8、过冲 1.5% 更克制。砍掉第二条软弹簧，只用 ease-out |
| 动效时长 | [Bold] 80/140/200/320/420 | — |
| reduced-motion | [Calm] 系统开启或应用内开关任一为真即生效；应用内**只能强制开，不能在系统要求减少时关闭**；保留 100ms 纯透明度渐变；位移/缩放通过 `--travel-*` / `--scale-pop` 归零 | AGENTS 把它列为硬约束；token 化位移量后，组件不用逐个写 reduced 分支 |
| 循环动画 | [新] 统一用 `animation-play-state: var(--play-state)`，keyframes 的 0% 帧即静态终态 | 比“时长设为 0 且无限循环”可靠，不依赖浏览器对 0s infinite 动画的行为 |
| 主题机制 | [新] CSS 默认跟随 `prefers-color-scheme`；`<html data-theme>` 显式覆盖 | 任务要求；Calm/Bold 都让主进程解析后写属性，仍然可以：主进程只在用户选择“浅色/深色”时写 `data-theme`，选“跟随系统”时移除属性 |
| 滚动条 | [融合 → 2026-10-21 改] 全局统一：细灰滑块，无轨道无底色，只在滚动时（和悬停到滑块上时）显示，停下约 0.8s 后淡出；不画横向滚动条。实现见 §5.4 “滚动条与横向溢出”。`.scroller` 等少数容器仍用自绘 `OverlayScrollbar`（`scrollbar-width: none`） | 仓库所有者 2026-10-21：不要经典的 Windows 滚动条，照 Tern/macOS 的覆盖式；全局一套样式，组件里不再各写各的 |
| 状态点 | [融合] 形状 + 颜色（2026-10-20 起改为图标）：进行中=转圈、等你=圆圈感叹号、未读完成=对勾、出错=圆圈叉号；已读完成与空闲**不画**（[Calm]） | 形状是第二信号（色盲友好）；已读无标记让列表安静。Bold 的“空心圆=空闲”和“卫星点”不要 |

#### 布局

| 决定 | 采用 | 理由 |
|---|---|---|
| 标题栏 | [Calm/Bold 一致] `titleBarStyle: "hidden"` + `titleBarOverlay`（系统绘制三键，高 40）；覆盖色取**顶栏**底色 `--bg-sidebar` | 保留 Snap Layouts、高对比度、DPI 行为 |
| 标题栏内容 | **仓库所有者 2026-10-18 指定：照 Claude 桌面版**。窗口最上方一条通栏的顶栏，横跨侧栏和主区：左边依次是菜单 `≡`、侧栏开关、后退 `←`、前进 `→`；右边是一个文字链接位和系统三键。侧栏和主区都在顶栏下面，主区是一块左上角圆角的内容面板（见 §3.1、§3.2） | 参考图：Claude 桌面版 Windows 顶栏 |
| 菜单栏 | 无系统菜单栏；顶栏左侧只有标志、切换侧栏按钮和“关于”按钮（帮助与反馈、关于；2026-10-19 起），其余命令在侧栏、快捷键和 `Ctrl K` | 菜单栏是“导航混乱”的来源（竞品的共同问题） |
| 窗口尺寸 | [融合] 默认 1200×800，最小 800×560 | Calm 最小 720 太窄，Bold 900 太保守；800 时侧栏已是抽屉 |
| 阅读列宽 | [融合] 840（2026-10-19 所有者要求输入框离两边近一些，由 720 加宽），输入框与对话列同宽同轴（[Bold] 的同轴） | Calm 把输入框做得更宽 40px，破坏同轴；列宽只改 `--content-w` |
| 侧栏宽 | 默认 240，可拖 200–360；折叠为 0（不留图标条）。2026-10-21 起（原 264，可拖 220–360）：仓库所有者要求侧栏窄一些。240 是实测定的：行内宽 = 240 − 2×8（侧栏列表内边距）= 224，扣掉 16 状态槽、20 `⋯`、间距，标题剩约 134px（13px 字号中文约 10 个字）；尾部是 `Just now` 这类长时间文字时（英文约 52px）标题还有约 104px；试过 224，英文 `Just now` 时标题只剩 88px（七八个字符就省略），搜索框占位也被截；200 是下限，给想要更窄的人，标题靠省略号，悬停提示全文 | 一个主导航。磁盘上存着旧默认值 264 的人从没拖过，读取时按新默认 240 处理；其它拖出来的宽度原样保留（只夹到新范围） |
| 窄窗口 | [融合] <1000px 侧栏改覆盖式抽屉 | 抽屉不挤压正文，保证“缩放后保住阅读位置” |
| “等你确认”的呈现 | [Bold] 侧栏头下方一条提示条（计数，点击依次跳转）+ 行内菱形，**不把行搬出文件夹**（所在文件夹默认展开，折叠时头上有琥珀菱形） | Calm 把等待行移到顶部聚合段，确认后再移回——列表在用户眼皮下重排，与“稳定>灵动”冲突 |
| 任务排序 | [Bold] 文件夹内任务和会话按最近活动混排（任务取 `lastActivityAt`，会话取修改时间），按时间排列时全部平铺；文件夹排列里默认文件夹永远第一个，其余文件夹按最近活动；不按 agent 活动重排 | 列表不跳；默认文件夹是新任务的落脚处（2026-10-20 仓库所有者定） |
| 每文件夹显示数 | 展开后 5 行（按时间排列 40 行，2026-10-22 仓库所有者定），“显示更多（N）”每次 +20；选中的、运行中的、等你确认的任务不会被藏起来 | 沿用历史会话的截断规则；任务和会话混排后不再单独给任务留 6 行 |
| 侧栏底部 | [Bold] `设置` 按钮 + `Ctrl K` 键帽 | Calm 的头像/账号名依赖账号信息，v1 没有 |
| 侧栏搜索框 | 在操作按钮最上一行；直接过滤侧栏里的任务和历史会话（不是命令面板，`Ctrl K` 才是命令面板） | 找任务和会话不必先开面板 |
| 空状态 | [Bold] 项目名作大标题 + 路径 + 最近 3 个任务（历史会话在侧栏，含终端会话） | Calm 的欢迎语是填充文案；“继续”列表是回答“已经在用 Tern 的人为什么还要装它”的零迁移卖点，成本只是读 `~/.omp`（只读） |
| 输入框位置 | [Bold] 空状态在内容区 38% 处，首次发送后弹簧落到底部，之后不再移动 | 一次性、仅 `transform`；reduced-motion 下瞬时 |

#### 组件

| 决定 | 采用 | 理由 |
|---|---|---|
| 任务行高度 | [Bold] 32 | 比 Calm 36 更密，仍 ≥28 |
| 选中行 | [Bold] `--bg-active` + 左侧 2×16 强调竖条 | 不靠字重 |
| 任务删除 | [Bold] 只做“归档”（隐藏 + 8 秒撤销 toast），不弹确认、不删 omp 会话文件 | AGENTS 禁止直接写 `~/.omp`；omp 无删除会话 RPC（Calm 同样存疑） |
| 重命名 | [Calm] 存应用自己的元数据，不调 `set_session_name` | 休眠任务没有 omp 进程，改名不应触发启动；Bold 的 RPC 方案只在有进程时可用 |
| 用户消息 | [Calm] 左对齐、`--bg-raised` 块、无气泡尾 | 与助手同一条阅读轴；长消息多行 |
| 助手消息 | [Calm/Bold 一致] 无头像、无气泡、纯文本 | — |
| 过程行（运行中） | [Calm] 一行实时状态 | 见 §1.1 Bold-1 |
| 过程行（已结束） | [融合] `Worked for 2m 14s · 12 tool calls · 2 subagents`；不足 1 秒或 0 次调用不显示；有失败时追加红色 `· 1 failure`（[Bold]）；等待时间从工作时长中扣除（[Calm]） | 对应设计原则“过程默认折叠”的原文 |
| 展开后的工具行 | 一个工具一个块：头一行 + 结果直接摆在下面，长内容最多若干行、底部渐隐 + `N more lines · Show all`（3.1，`direction-3.1.md` §2 行 1–4；细节见 §4.11） | 仓库所有者 2026-10-20 要求过程区照搬 Tern 里 omp 的显示 |
| 思考内容 | 永不进正文；过程里折叠成一行 `Thinking`（`process.thoughtShort`，不带时长，同 omp 的 Thinking），点开看全文（§4.11） | 两份一致；2026-10-20 起照终端版 omp 去掉时长 |
| 子代理 | 过程区里是 omp 的节点：`task` / `wait` 工具卡片的 body 是子代理 / 后台任务磁贴（`omp.job.tile`，两列，`tsp.css`）；查看、插话、结束、恢复在右栏的子代理面板（§4.28），入口是顶栏的子代理按钮、输入框上方药丸的 `👥 N`、`/hub`、命令面板 | 结构由 omp 决定（§4.11）；omp 的 Agent Hub 不弹出，面板由主进程在后台驱动 Hub（`docs/architecture/subagents.md`） |
| 改动卡片 | **没有**（2026-10-21 删除）：过程区和输入框上方都不显示本轮改动汇总；看改动用评审（§4.25），入口是顶栏评审按钮、提交对话框的“评审改动”、`Ctrl Shift D`、命令面板 | 评审已经能看全部改动（`docs/architecture/tsp-migration.md` §6 取舍 1） |
| 测试结果 | **不做**（[Bold]） | omp 不给结构化的测试结果；靠解析 bash 输出猜“通过/失败”会出错（Calm 也承认是推测）。设计原则“结果优先”提到的测试结果推迟 |
| 输入框正文字号 | [Bold] 15px（`--fs-prose`） | 所见即所得；Calm 的 14 是控件字号 |
| 胶囊 | [融合] 模型+思考强度合并为一颗，弹层里分段选择（[Bold]）；审批为独立一颗；⊕ 添加图片按钮 | 少一颗胶囊；Calm 的“思考”单独胶囊在不支持思考的模型上要隐藏，合并后自然消失 |
| 发送/停止 | [Bold] 运行中输入非空时并排显示“发送(↑)”和“停止(■)” | Calm 在这种状态让停止键让位，只剩 Esc，不直观 |
| 排队的消息 | omp 的 `omp.queue`（dock 里，studio 照画）；studio 没有自己的队列条 | 运行中 `Enter`（插话）和 `Ctrl+Enter`（稍后）都是 `send`，排队由 omp 管（`docs/architecture/tsp-real-omp-probes.md` §5） |
| 上下文提示 | [融合] 输入框工具行里的上下文圆环默认显示；≥90% 变琥珀；点击弹出上下文构成和本会话用量 | 琥珀而非红：不是错误 |
| 门（审批/ask） | [Bold] 停靠在输入框上方；两份方案的各自细节见 §4.17 | 见 §1.1 Calm-1 |
| 门的文字 | omp 原样的英文：标题、选项、按钮（Details / Deny / Approve，Hide / Note / Skip / Next / Submit）都不本地化（§4.17） | 门是 omp 的节点；过程区文字不汉化（§4.14） |
| 命令面板 | [融合] 宽 600；分组 任务/会话/命令/斜杠命令；无结果时“在新任务中提问”（[Bold]） | Bold 的“模型”分组由 `Alt M` 覆盖，不进面板 |
| 设置页 | [融合] 主区页面（不是弹窗），分节见 §4.19（2026-10-22 起 10 节，用量只在输入框旁的用量对话框） | Calm 的页面形态 + Bold 的卡片分组；Bold 的“快捷键/对话”并入“通用”，omp 的路径、版本和更新并入“关于” |
| 用量 | 输入框旁的用量对话框（`features/composer/UsageDialog.tsx`），打开就显示 | 原来的“默认折叠、点显示用量才请求”已删 |
| 首次启动 | [Bold] 一张居中卡片的状态流（找到/过旧/脚本/没有/下载中/连接模型/选文件夹） | 比 Calm 更完整；审批模式偏好**不在引导里问**（Bold 的建议被否决）：少一个配置型问题，默认值已安全 |
| 版本过旧提示 | [Calm] 主区顶部横幅；低于最低版本时禁用发送 | 不是引导，是持续状态 |
| 错误呈现 | [Calm] 人话一句 + 可复制详情 + 一个恢复动作；对话内用“左 2px 红线 + 浅红底”内联条 | 不用大块红色 |
| Toast | [Calm → 2026-10-20 改] 主区面板上沿正中的气泡，向下叠放，不占布局（见 §4 组件表的 Toast 行）| 仓库所有者 2026-10-20：“所有提示都应该用气泡悬浮提示,上方中间”；原先右下角宽 360 的卡片已废 |
| 通知 | [Bold] 只有“等你确认”会叫你：任务栏闪烁 + 角标 + 窗口失焦时系统通知；不播声音 | 这是对 Tern/终端的核心差异；**不做“任务完成”通知**（注意力预算），侧栏对勾足够 |
| todo 进度胶囊 | [Bold] 主区头部，仅有 todo 时出现 | omp 专属、是“进度”不是遥测；可砍，不影响布局 |
| 流式光标 | [Bold] 末尾 2px 强调色竖条，1.2s 透明度脉冲；结束淡出 | 低成本的“它在写”信号；reduced-motion 下常亮 |
| 流式文字淡入 | **不做** | 逐块淡入需要把文本拆成 span，破坏选区与 DOM 稳定 |
| 发送后滚动 | [Bold] 发送后吸底 | Calm 的“把用户消息钉在视口顶部”需要额外占位，和“内容不跳动”冲突 |
| “回到最新”药丸 | [Calm] 文案 `回到最新` | 中性；Bold 的“新内容”在没有新内容时不成立 |

#### 交互

| 决定 | 采用 | 理由 |
|---|---|---|
| 新任务创建时机 | [Calm] 草稿任务；**发送时才启动 omp 进程**，用户消息乐观上屏，过程行显示“正在启动…” | 审批模式和项目在进程启动时固定，打字前启动会让用户改了胶囊就要重启（Bold 的“第一次按键就启动”被否决） |
| 项目选择 | [融合] 空状态大标题可点换项目（草稿期间）；拖入文件夹等价于选择；发送后项目不可换 | omp 进程 cwd 已固定 |
| 快捷键 | [融合] 见 §5.1。冲突处：`Ctrl J` = 跳到等你确认的任务（Bold），`Ctrl L` = 聚焦输入框（Bold） | 单字符键永不抢占输入框 |
| 界面缩放 | **v1 禁用** Chromium 默认 `Ctrl +/-/0`（[Bold]） | 缩放要重算布局锚点；留一个状态不明的默认缩放比没有好 |
| Esc | [Bold] 一个栈，自上而下命中即停（§5.2） | — |
| 焦点 | [融合] 见 §5.3 | — |
| 流式不跳动 | [融合] §5.4 的 8 条规则 | 两份方案公共部分 |
| 窗口缩放保位置 | [融合] 阅读锚点 + 拖动侧栏时冻结列宽（[Bold]） | — |
| 会话历史 | [Calm → 已改] 点开休眠任务或历史会话立即启动 omp 并 `--resume`，旧对话由 omp 重发；不再先显示只读转录 | 所有任务都是 TSP，对话内容只有 omp 能画 |
| 草稿持久化 | [Bold] 主进程持久化，经 preload 读写 | 崩溃也不丢；渲染层不碰存储 |
| `@` 文件引用 | [新增] 输入 `@` 弹出项目文件补全菜单，插入 `@相对路径`，omp 自己展开 | 终端版 omp 的 `@` 补全是日常高频操作；展开由 omp 完成，studio 只补全（见 FileMenu） |

#### 文案

| 决定 | 采用 | 理由 |
|---|---|---|
| 运行中 Enter / Ctrl+Enter 的称呼 | 插话 / 稍后（Bold） | “引导/排队”不是人话 |
| 允许类措辞 | 审批 `select` 原样显示；`confirm` 用“确认/取消” | 见组件表 |
| 中英混排 | 汉字与英文/数字之间加空格（Calm） | 不依赖 `text-autospace`（Electron 44 支持情况未知，Bold 列为待实测） |
| 运行过程的文案 | 过程区（工具卡片、`Thinking`）、运行状态行、子代理表、每轮用时与 token、压缩提示在两种语言下都是英文（`Thinking…`、`Worked for 2m 14s`、`Exit code 1`），照 Tern 里的 omp；其余界面（按钮、输入框、提示、设置、错误、toast、门、改动卡片、侧栏、子代理详情面板的统计 / 页签 / 插话 / 取消）照常翻译 | 仓库所有者 2026-10-20 定：“汉化不是全部汉化，任务进行中的英文还是用英文”。实现：`src/shared/i18n/run/` 下的 `process`、`tool` 两个命名空间只有一份英文，`zh-CN` 和 `en` 两份字典共用（规则写在 `src/shared/i18n/index.ts` 文件头）；这些文字里的时长用紧凑的 `formatElapsed`（`3s` / `2m 14s`），不用本地化的 `duration.*` |
| 句末标点 | 句子保留句号；标签/按钮不加；不用感叹号；用“你”不用“您” | — |
| 复数 | 英文用 ICU `{n, plural, …}`，中文单一形式（`process.*`、`tool.*` 两种语言都是英文，照英文复数） | 见附录 A 说明 |
| 审批模式标签 | `总是询问` / `询问并记住` / `自动写入` / `全自动` 对应 `always-ask` / `always-ask-cached` / `write` / `yolo`（2026-10-21 由 `每次询问` / `每次询问并记住` / `写入自动，执行询问` / `全部自动` 简化）；英文直接用 omp 设置页的名字 `Always ask` / `Ask and remember` / `Write` / `Yolo`（omp 18.12.6 的 settings schema 里 `tools.approvalMode` 的 option label） | 与 omp 的四种模式一一对应（`omp://approval-mode.md`）；omp 设置页里 `tools.approvalMode` 的取值显示同一套文案（`approval.*`）。其余枚举设置的取值走 `ompcfg` 的 `<键>.opt.<值>` / `opt.<值>`，没有翻译的显示 omp 原值；设置键第一段的分组名走 `ompcfg` 的 `prefix.<段>` |
| 开发者常用的英文术语 | 中文界面里**保留英文**：MCP、Skill、Hook、token、worktree（独立出现的标签首字母大写：`Worktree`、`Token`、`Skill 清单`）、diff、LSP、Bash、API key（表单里统一叫 key，不混用"密钥"）、context（独立的标签写 `Context`：`Context 与记忆`、`扩展 Context`、`Context 构成`；句子里小写：`压缩 context`、`context 窗口`；仓库所有者 2026-10-22 补充，原来译作"上下文"）、数量单位 K / M（`每 M token`、`$0.3 / M`，不写"每百万"）、provider（`Provider 与订阅`、`添加 provider…`）、subagent / main agent（`Subagent 与规划`、`Subagent 面板`）、system prompt、reasoning、vision、模型目录的 Int（同 omp 表头；以上同为 2026-10-22 补充）；**照常翻译**：后台任务（omp 的 job，界面里不叫"作业"）、插件 / 插件市场、提交 / 分支 / 暂存 / 合并、会话、分叉、检查点、快照 | 仓库所有者 2026-10-22：“不是所有英文都要汉化的，常用的不需要汉化，例如 mcp skill”。判断标准：中文开发者口头和文档里直接说英文的保留（工作树、钩子、令牌、技能、差异这类直译反而要停一下才认得出）；Git 客户端（VS Code、GitHub Desktop）中文界面已经通用的中文说法照常翻译 |

---

## 2. Token（实现见 `tokens.css`）

### 2.1 主题

- 默认：浅色 `:root`；`@media (prefers-color-scheme: dark)` 下，只要没有 `data-theme="light"` 就套深色。
- 显式：`<html data-theme="light|dark">`。设置页选“跟随系统”时主进程**移除**该属性。
- 切换过渡（2026-10-22 仓库所有者要求）：用户切换主题时整页交叉淡入（`App.tsx` 用 `document.startViewTransition` 包住 `data-theme` 的改动，`app.css` 的 `::view-transition-old/new(root)` 时长 `--dur-fade`，期间 `pointer-events: none`）；启动时第一次套用主题不过渡；减少动效（系统或应用内）时 `--dur-fade` 为 100ms 的纯透明度渐变。
- 深色色板在 CSS 里出现两次（系统深色、显式深色），必须逐行一致——**加一条 Vitest 测试**，解析 `tokens.css`，比较两个深色块与两个 reduced-motion 块的声明集合，防止改一处漏一处。
- 主进程同步：`BrowserWindow.backgroundColor`（避免首帧闪白）与 `titleBarOverlay`（主题切换时 `win.setTitleBarOverlay`）：

| 主题 | `backgroundColor` / `color`（= `--bg-sidebar`，顶栏和侧栏的底色） | `symbolColor`（= `--text`） |
|---|---|---|
| 浅色 | `#EEEDF0` | `#131118` |
| 深色 | `#0C0B0E` | `#E8E6EC` |

有遮罩（`--bg-scrim`）的弹窗打开期间（模型选择、命令面板、会话树、确认框、关于、git 对话框、接管 omp 询问），系统三键也跟着变暗：渲染进程用 `useTitleBarDim` 计数，第一个打开时调 `setTitleBarDimmed(true)`，最后一个关掉时恢复；颜色是顶栏色上叠一层遮罩后的实色（三键不是网页画的，遮罩盖不到）：

| 主题 | 变暗后 `color` | 变暗后 `symbolColor` |
|---|---|---|
| 浅色 | `#A8A7AB` | `#131118` |
| 深色 | `#08070A` | `#69676B` |

三键变暗 / 恢复是渐变，不是瞬间换色，和遮罩的淡入 / 淡出同一时长、同一曲线（3.1，`direction-3.1.md` §2 行 13）：主进程 `fadeTitleBar`（`src/main/window/main-window.ts`）每 16ms 调一次 `setTitleBarOverlay`，在上下两张表的颜色之间插值。变暗 = 遮罩淡入：140ms（`--dur-fade`）+ `cubic-bezier(0.22, 1, 0.36, 1)`（`--ease-out`）；恢复 = 遮罩淡出（§2.6 `data-closing="fade"`）：84ms（`--dur-fast-exit`）+ `cubic-bezier(0.64, 0, 0.78, 0)`（`--ease-in`）。系统开了“减少动画”（`systemPreferences.getAnimationSettings().prefersReducedMotion`，应用内的减少动效开关不算，主进程读不到）时变暗 100ms、恢复立即换色，同 tokens.css 的减少动效取值。渐变中途反向时从当前插值的颜色接着走；窗口最小化或不可见时直接换色；切换主题不渐变，立即换成新主题的颜色。

### 2.2 字体

- `--font-sans`（正文/UI）、`--font-display`（仅 ≥20px：空状态标题、设置页标题）、`--font-mono`（代码、命令、路径）。
- 三个字体栈在最后的通用族（`sans-serif` / `monospace`）之前都接 `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"`（3.1，`direction-3.1.md` §2 行 14）：任务标题等文字里的 emoji 落到彩色 emoji 字体，不再显示成方框。
- 代码元素：`font-variant-ligatures: none`；计时、计数、百分比加 `font-variant-numeric: tabular-nums`。
- `<html lang>` 随界面语言切换（`zh-CN` / `en`），`:root:lang(zh)` 里的行高变量因此生效；**不用 JS 切换行高**。
- 标题 `text-wrap: balance`，正文段落 `text-wrap: pretty`。
- 不写 `-webkit-font-smoothing`（Windows 无效）。

### 2.2.1 小字和说明文字（仓库所有者 2026-10-18 要求）

- **非必要不用小字。** 先看标签、控件状态、图标、位置能不能把意思说清楚，能就不加说明。小号字（`--text-xs`/`--text-sm` 配 `--text-3`）只用于必须有的元信息，例如时间、计数、路径。
- **要说明时不额外占空间。** 按这个优先级放：① 放在已有行里（标签同一行的右侧，空间不够时单行省略）；② 放进悬停提示或 `ⓘ` 弹层；③ 放进展开后的详情区。不要在标签下面另起一行灰字，也不要为说明留固定高度。
- **排版检查**：同一组里各行高度、左缘、基线一致；控件统一右对齐；不出现孤立的短行、半空的卡片、没必要的分隔线。截图核对时，这一条和对比度一起看。

### 2.3 字号

| 变量 | 字号/行高 | 用在 |
|---|---|---|
| `--fs-2xs` | 11/16 | 键帽、角标、小标签 |
| `--fs-xs` | 12/16 | 文件夹名、过程行、元信息、tooltip |
| `--fs-sm` | 13/20（zh 22） | 侧栏、胶囊、按钮、菜单、改动卡片 |
| `--fs-base` | 14/20（zh 22） | 对话框正文、设置页正文、门的标题 |
| `--fs-prose` | 15/24（zh 27） | **对话正文、用户消息、输入框** |
| `--fs-lg` | 17/26 | 对话里的 h1、对话框标题、设置分组标题 |
| `--fs-xl` | 20/28 | 设置页大标题 |
| `--fs-code` / `--fs-code-sm` | 13/20 · 12/18 | 代码块 · 工具输出、行内代码 0.92em |

### 2.4 间距、尺寸、层级

见 `tokens.css`。规则：**组件里不出现表外的数**（除了 1px 描边、2px 焦点环/竖条、组件私有的固定像素如 8px 状态点，这些在 §4 里逐个写明）。窄窗断点（媒体查询不能用变量）：`<1000px` 侧栏抽屉并 `--gutter` 改 16px。命令面板不用断点，宽 `min(var(--palette-w), calc(100vw - var(--space-8)))`。

### 2.5 颜色语义与对比度

| 用途 | token | 规则 |
|---|---|---|
| 表面 | `--bg-sidebar` < `--bg-app` < `--bg-raised` < `--bg-overlay`；`--bg-sunken` 是凹进去的代码/展开区 | 用层级而不是颜色分区 |
| 交互态 | `--bg-hover`、`--bg-active`、`--bg-scrim` | `:active` 无位移、无缩放 |
| 线 | `--border-subtle`（分隔）/ `--border`（外框）/ `--border-strong`（hover、输入框默认描边） | — |
| 文本 | `--text` / `--text-2` / `--text-3` / `--text-disabled` / `--text-on-accent` | `--text-3` 只用于次要元信息，不用于可操作文字；在 `--bg-overlay`、`--bg-active` 等较亮的底上对比度较低，见下表与例外 |
| 强调 | `--accent` / `--accent-soft` / `--focus-ring` / `--link` / `--selection-bg` | 鸢尾紫（3.0）；只给进行中、主输入焦点、链接、上下文圆环、开关、选中 |
| 主按钮 | `--primary` / `--primary-hover` / `--text-on-primary` | 浅色近黑底白字，深色近白底深字；每个视图最多一个 |
| 状态 | `--st-running`（=强调色）、`--st-waiting`（点）+ `--st-waiting-text`（字）+ `--st-waiting-soft`、`--st-done`、`--st-error` + `--st-error-soft` | 四个语义色之外界面是灰的 |
| 代码 | `--syn-*`（7 色）；`--diff-add-fg` / `--diff-del-fg`（改动卡片的 +N/−N 文字和行数条） | 评审里的行背景 `--diff-add-bg` / `--diff-del-bg`（阶段 3 加入，深浅色各一份） |
| 气泡 | `--bg-bubble` | 只给"你的消息"气泡（§4.8，3.0 加入） |

3.0 起的色板（浅 / 深，均为带一点紫的灰：2.6 的矿物灰色相从 155° 换到 255°，HSL 饱和度和亮度不变；数值和理由见 `direction-3.0.md` §2.1，对比度按 WCAG 公式算过）：`--bg-sidebar` `#EEEDF0` / `#0C0B0E`，`--bg-app` `#F9F8FA` / `#121115`，`--bg-raised` `#FFFFFF` / `#18171C`，`--bg-overlay` `#FFFFFF` / `#1E1C22`，`--bg-bubble` `#ECE8F8` / `#251F38`，`--text` `#131118`（17.7）/ `#E8E6EC`（15.2），`--text-2` `#4E4B56`（8.0）/ `#A6A3AF`（7.6），`--text-3` `#625F6A`（在侧栏 5.4）/ `#87848F`（在 overlay 4.6），`--accent` `#6B46D9`（5.7）/ `#A48BFF`（6.9），`--st-waiting` 点 `#B76E00` 字 `#8E5A00`（5.5）/ `#F0B545`，`--st-error` `#B42E2E`（5.9）/ `#F27373`。**`--st-done` 是绿**（2026-10-21 起，原为中性灰）`#1F7A3F`（浅）/ `#5FCB86`（深），和 `--diff-add-fg` 同值，与紫（进行中）、琥珀（等你）、红（失败）色相分开；**`--diff-add-fg` 是独立的绿** `#1F7A3F`（卡片底上 5.4）/ `#5FCB86`（8.8），不跟强调色（紫色的 `+` 看不出是新增），`--diff-del-fg` = `--st-error`。圆角：`--radius-xs/sm/md/lg/xl` = 3 / 4 / 6 / 8 / 10（卡片 8、对话框 10、按钮 6），3.0 加 `--radius-bubble` 14、`--radius-composer` 22。

下表是 v1 旧色板的计算结果，仅作方法参考；新色板的组合以上面一段为准（`--accent` 在 `--bg-app` 5.7 / 6.9，`--text-on-accent` 在 `--accent` 6.0 / 7.2，`--text-3` 在 `--bg-sidebar` 5.4）：

| 组合 | 深色 | 浅色 |
|---|---|---|
| `--text` 在 `--bg-app` | 15.7 | 17.3 |
| `--text-2` 在 `--bg-app` | 8.0 | 6.6 |
| `--text-3` 在 `--bg-app` / `--bg-raised` | 5.3 / 4.9 | 5.3 / 5.5 |
| `--text-3` 在 `--bg-overlay` | 4.8 | 5.5 |
| `--accent` 在 `--bg-app` | 6.1 | 5.8 |
| `--text-on-accent` 在 `--accent` | 6.4 | 6.0 |
| `--link` 在 `--bg-app` | 8.0 | 7.5 |
| `--st-waiting(-text)` 在 `--bg-app` | 10.0 | 点 3.3（非文本）/ 字 5.6 |
| `--st-done` 在 `--bg-app` | 5.4（绿，同 `--diff-add-fg`） | 8.8 |
| `--st-error` 在 `--bg-app` / `--st-error-soft` 上 | 6.5 / 5.9 | 5.8 / 4.9 |

已知例外：`--text-3` 在“选中行”（`--bg-active`）上深色约 4.3:1——选中行的次要时间文字允许，不用于需要阅读的内容；`--st-waiting`（浅色，点）与 `--bg-sidebar` 是 3.1:1，靠形状（菱形）补足。

### 2.6 动效

| 事件 | 动画 | 时长/曲线 |
|---|---|---|
| 菜单、popover、tooltip 出现 | opacity 0→1 + `translateY(var(--travel-sm))→0` + `scale(var(--scale-pop))→1` | `--dur-base` `--ease-out`；消失 `--dur-fast-exit` `--ease-in` |
| 命令面板、对话框出现 | 同上，位移 `--travel-md` | `--dur-slow` `--ease-spring` |
| 过程行展开/折叠 | `grid-template-rows: 0fr↔1fr` + 内容 opacity | `--dur-base` `--ease-out` |
| 输入框首次发送 | 不做 FLIP：草稿发出第一句话后输入框留在原位，换成任务的输入框时不放换页入场（`motion.css`） | - |
| 发送 ↔ 停止 | `border-radius` + 图标交叉淡入 | `--dur-fast` `--ease-spring` |
| 用户消息出现 | `translateY(var(--travel-md))→0` + opacity | `--dur-base` `--ease-out` |
| 侧栏折叠/抽屉 | `translateX`；主区宽度**立即变一次**，不逐帧 | `--dur-slow` `--ease-out` |
| 状态点切换 | 旧点缩小淡出 + 新点放大淡入 | `--dur-fast` |
| 进行中转圈（状态点） | 一段弧旋转，循环 | `--dur-spin` linear，`animation-play-state: var(--play-state)`；减少动效时静止 |
| 加载环 | 旋转 | `--dur-spin` linear |
| 流式光标 | opacity 脉冲 | `--dur-caret` |
| Toast | 从上方滑入：`translateY(calc(var(--travel-md) * -1))→0` + opacity | `max(--dur-base, --dur-fade)`（减少动效时位移为 0，只淡入 100ms），停留 5s；退出反向（向上滑回 + 淡出，`max(--dur-base-exit, --dur-fade)`） |
| 浮层、菜单、对话框、toast **消失** | 反向：opacity→0 + 下沉 `--travel-sm` + 缩到 `--scale-pop`；遮罩只淡出 | `--dur-fast-exit` `--ease-in`；放完才卸载（`ui/presence.ts` 的 `usePresence`，`data-closing="pop"/"fade"`，规则在 `ui/motion.css`） |
| 折叠区域展开/收起（侧栏文件夹、设置分组、目标条、旁路提问面板等） | `grid-template-rows: 0fr↔1fr` + opacity；首次渲染就展开的不放 | 展开 `--dur-base` `--ease-out`，收起 `--dur-base-exit` `--ease-in`（`ui/Reveal.tsx`） |
| 主区换页（新任务页 / 对话 / 设置，含从设置返回任务时的过程区）、切任务、设置换节、侧栏位置在会话列表和设置导航之间切换 | `view-in`：opacity + `translateY(var(--travel-sm))→0`；例外：草稿发出第一句话变成任务时，输入框不播（`.composer-stack[data-from-draft]`，它在原位接着用，播了就是“闪一下”） | `--dur-base` `--ease-out` |
| 可交互元素的 hover / 选中 / 聚焦 | 背景、边框、文字颜色、阴影、透明度渐变 | `--dur-fast` `--ease-out`（`motion.css` 里 `:where(button, …)` 零优先级的默认值，组件自己写的优先） |

性能规则：只动 `transform` 与 `opacity`（外加折叠用的 `grid-template-rows`）；不动画 `height` / `width` / `top`。reduced-motion 下：所有位移、缩放、弹簧归零；循环动画暂停在 0% 帧（呼吸环=实心点带一圈淡环，光标常亮，加载环用静态 `…`，由 `useReducedMotion()` 切换字形）；只保留 `--dur-fade`（100ms）的透明度渐变；`scrollTo` 一律 `behavior: "auto"`；输入框“落下”瞬时。JS 里读取动效开关只走一个 `useReducedMotion()`（`matchMedia` + `data-motion`），组件不各自读。

---

## 3. 布局

### 3.1 窗口

- `BrowserWindow`：`titleBarStyle: "hidden"`，`titleBarOverlay: { color, symbolColor, height: 40 }`（取值见 §2.1），`backgroundColor` 同 `color`；默认 1200×800，最小 800×560；`Menu.setApplicationMenu(null)`，快捷键用窗口内 `keydown` 处理。窗口图标 `resources/icon.ico`（见下方“标志”）。
- **标志**（2026-10-20 仓库所有者选定“层叠”，取代圆环 + π 临时版）：omp 终端启动画面的块字符 π（12 × 10 像素，逐格粉→紫→蓝，左腿末格 ▒，颜色与主题无关），身后往右下错开 1 像素再叠一层同色 32% 淡影——终端里的 π 只有一层，到了桌面上多一层。数据只有一份：`src/shared/ui/pixel-pi.ts`；渲染进程 `ui/PiMark.tsx` 画 SVG（`shape-rendering: crispEdges`），整幅标志（π + 像素字 `omp studio`）是 `ui/PixelLogo.tsx`，新任务页和顶栏左上角用同一个组件，只是大小不同；应用图标 `resources/icon.ico`（透明底，只有 π 和淡影，尽量铺满宽度，2026-10-21 仓库所有者定：不要深色底，淡影要和界面里一样看得出两层，图标别显小；16–256 共 11 个尺寸，每个尺寸单独画，能整数倍就整数倍，整数倍铺不到四分之三宽的 20、24、36 按半像素放大）和托盘图标 `resources/tray.png`（64，透明底）由 `npm run icons`（`scripts/make-icons.ts`）从同一份数据生成并提交进仓库；改了 π 要重新生成。
- **顶栏 = 任务条（通栏，高 40 = `--titlebar-h`；仓库所有者 2026-10-19 选定方案 B「任务条 + 工具区」）**：底色 `--bg-sidebar`（与 `titleBarOverlay.color` 相同，系统三键融进同一条）。控件统一高 28（`--control-h-sm`），上下各留 6。三段：
  - 左段（宽 = 侧栏宽，侧栏收起/抽屉时自适应）：`padding-left: --space-2`，横排两样：标志（`topbar-brand`，2026-10-20 起和新任务页同一个像素标志 `PixelLogo`：π + 像素字 `omp`（`--text`）`studio`（`--text-2`），每像素 2 CSS 像素，124×22，不带版本号；见上方“标志”；顶栏里像素字往下挪半格 = 1px（`.topbar-brand .pixel-logo-text`），基线对上旁边标题的拉丁字母、x 高中线对上侧栏按钮的图标，2026-10-22），只是标识，不可点、可拖动窗口；切换侧栏按钮（`IconButton` 28×28 `topbar-sidebar`，悬停提示 `menu.toggleSidebar (Ctrl B)`，`aria-expanded` = 侧栏显示着，展开时 `--bg-active` 底，同 `Ctrl B`；2026-10-20 起图标随状态变：侧栏显示时左栏半透明填充、收起时淡出，`--dur-base` 过渡；侧栏本身的宽度收起/展开也有短过渡，拖拽调宽时关掉）。**2026-10-22 起顶栏没有信息（i）按钮**（`direction-3.2.md` §7 第 5 条）：“关于与反馈”对话框（`AboutDialog`，2026-10-21 照 macOS 标准关于面板、Chrome 的“关于”、VS Code 的关于框重做，只留有用的）从命令面板的 `about` 命令（`window.about`，§4.18）打开：`ui/Dialog` sm（`--dialog-w-sm`），标题 `shell.appName`（`omp-studio`），正文左对齐一列——π 标志（`PiMark`，每像素 4 CSS 像素）、一行 `--text-3` 的 `window.aboutVersion` · `window.aboutOmp`（omp 没就绪时 `window.aboutOmpMissing`；可选中）；安装版再多一行更新状态（与设置 → 关于同一句话），可检查时跟一个 sm 次要按钮“检查更新”，新版本已下载时跟 sm 主按钮“重启并安装”，开发版、免安装版、没配更新源时这一行不显示；页脚右对齐两个次要按钮：`window.aboutCopyInfo`（复制给报问题用的纯文本：omp-studio、omp、Electron、Chromium、Node、OS 的版本，标签固定英文，不带 omp 路径，成功 toast `common.copied`）、`window.aboutReportIssue`（打开 Issues 选模板页）。关闭是右上角 ×、Esc 或点遮罩；焦点和 Tab 循环按 `ui/Dialog` 通则（§4.23），关闭后还焦点。不再有一句话简介、运行时版本列表、omp 路径、日志文件夹和导出诊断（后两个在设置 → 关于 → 问题排查）。新任务、命令面板、设置、退出不在这里：新任务和设置在侧栏，命令面板 `Ctrl K`，退出走系统三键。语言和主题只在设置 → 通用 → 外观（§4.19），侧栏底部不再有这两个按钮（§4.5）。
  - 中段（左缘对齐主区面板）：**只有任务标题**（`--fs-sm`，`--text` 600 / 中文 700，过长省略，悬停提示完整标题；不显示项目名，项目在侧栏分组里）。2026-10-20 起不再有状态胶囊（运行中 / 等你确认 / 出错）：侧栏任务行的状态图标和输入框上方的状态行已经在说，不重复。空状态显示 `新任务`，设置页显示页面标题。
  - 右段（只在对话页出现，任务和新任务草稿都有，`data-testid="topbar-tools"`）：分支胶囊（`features/git/GitTools.tsx`；`--font-mono` `--fs-code-sm`，1px `--border-subtle`，`--radius-md`，最宽 32ch；内容 分支图标 + 分支名 + worktree 任务领先时 `↑N`（`--accent`）+ ⌄；点开是 Git 菜单（`ui/Menu`，从胶囊下沿弹出；动作项带图标：提交 ✓、推送 ↑、创建 PR ↗、合并回（分支图标），标签不带省略号，不重复顶栏评审按钮；创建 PR 只在 `canPush` 时列出；推送不可用时灰显、原因写在第二行；worktree 任务最后是一条分隔线 + 红字 `git.menu.discard`（垃圾桶图标），破坏性项永远放最后；再点胶囊、点窗口任意处（含顶栏空白拖动区，菜单开着时 `.git-menu-scrim` 盖住整窗并设为 no-drag）、Esc 都收回，Esc 把焦点还给胶囊）；"分支 · Worktree · 基于 main · 领先 N 个提交"在悬停提示里；窄于 1000px 只留图标和 `↑N`；任务目录不是 git 仓库时不渲染。**新任务草稿**（2026-10-22 起，仓库所有者定：原来输入框工具行里的 worktree 开关并进来）：草稿项目正好是 git 仓库根时（`getDraftGit`）显示同样外观的分支胶囊（`features/git/DraftGitTools.tsx`，`draft-git-menu`）：分支图标 + 项目当前分支 + ⌄，点开的菜单只有一个选择项 `在独立 worktree 里开始`（`menuitemradio`，勾上时第一列画 ✓）；胶囊的悬停提示是分支、worktree 的一句说明，有 setup 脚本时再加 `创建时会运行 .omp-studio/setup.ps1`；勾上后分支名后面多 `→ 新 worktree`（`--accent`，`--fs-xs`）。创建被拒绝（没提交、detached 等）后这一项灰显，原因写在它的第二行和胶囊的悬停提示里。默认文件夹和不是仓库根的项目不显示；发出第一句话后由任务的分支胶囊接手）→ 评审按钮（`topbar-review`，悬停提示 `review.open (Ctrl Shift D)`；只有任务有，不是 git 仓库时不渲染）→ 文件按钮（`topbar-files`，悬停提示 `preview.filesToggle (Ctrl Shift E)`，§4.27）→ 子代理按钮（`topbar-agents`，悬停提示 `agents.panelLabel`，只有任务有；一直在，没有子代理时打开是空状态，§4.28）→ 终端按钮（`topbar-terminal`，悬停提示 `terminal.toggle`，快捷键 Ctrl + 反引号）→ 任务菜单 `⋯`（`task-menu`，只有任务有，§4.6）→ 1px×16 `--border` 竖线，与系统三键隔开。评审、文件、子代理、终端、任务菜单都是 `IconButton`（28×28，§4.23）；文件、子代理和终端是开关（`aria-pressed` + `aria-expanded`），按下 = `--bg-active` 底、`--text` 图标（2026-10-22 起，原来是 `--accent-soft` 底、`--accent` 图标）。再往右是系统三键（`titleBarOverlay` 绘制）；顶栏 `padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))` 让位。
  - **没有后退/前进按钮**（仓库所有者 2026-10-18 确认）：后退/前进在 `Alt+←/→` 和鼠标侧键（button 3/4）。导航历史栈仍在渲染进程。
  - 其余空白全部 `-webkit-app-region: drag`，按钮和任务条 `no-drag`；双击空白最大化/还原（系统行为）。
- **主区面板（“纸面”）**：顶栏下方，侧栏右边。底色 `--bg-app`，1px `--border`，**四个角都是 `--radius-xl`**，右边和下边各留 `--space-2` 的窗口底色，像一张放在桌上的纸；侧栏收起或作为抽屉时左边也留 `--space-2`。面板与侧栏之间不画分隔线。
- 单实例（二次启动聚焦已有窗口）；记忆位置/尺寸/最大化/侧栏宽度/侧栏折叠/历史会话排列（文件夹或时间）。
- 不用 Mica/毛玻璃。

### 3.2 栅格

```
┌─ 顶栏 40px（通栏，--bg-sidebar）──────────────────────────────────────────────┐
│ [≡] [▯] [←] [→]                                         新功能    ─  ▢  ✕   │
├──────────────────────┬╭─────────────────────────────────────────────────────┤
│ [＋ 新任务   Ctrl N]   ││ 面板头 44：{任务标题} · {项目}          [进度] [⋯]   │
│ ◆ 1 个任务在等你 · x   ││ .scroller（唯一滚动容器，铺满主区面板）              │
│ ▾ 项目                ││   └ .column：width min(100% − 2×--gutter, --content-w)│
│   任务行 …            ││ ┌ 底部栈（钉底，同列宽）───────────────────────────┐ │
│ ▸ 项目                ││ │ [dock：门、排队] [输入框]                         │ │
│                      ││ └────────────────────────────────────────────────┘ │
│ ⚙ 设置               ││                         主区面板 --bg-app，左上圆角 │
└──────────────────────┴┴─────────────────────────────────────────────────────┘
```

- 侧栏底色 `--bg-sidebar`，与顶栏连成一片；主区面板 `--bg-app` 带左上圆角，两者之间不画线。侧栏拖拽条（命中区 4px）贴在面板左缘，hover 显示 `--border`；双击恢复 240（`--sidebar-w`；范围 200 – 360，`app/shell-store.ts` 的 `sidebarWidthRange`）。
- `.scroller` 铺满主区、滚动条贴窗口边缘；`.column` 在其中居中；底部 padding = 底部栈高度 + `--space-8`（栈高度由 `ResizeObserver` 写入组件私有变量 `--stack-h`）。
- 输入框距窗口底 `--space-4`；其上有 24px 高 `linear-gradient(transparent, var(--bg-app))` 软遮罩，内容从输入框后面淡出而不是被切。
- 对话列 840px：15px 正文下英文约 99 字符/行、中文约 54 字/行。

### 3.3 响应式

| 窗口宽度 | 行为 |
|---|---|
| ≥1000 | 侧栏常驻固定列；列宽 `min(100% − 2×--gutter, --content-w)` |
| <1000 | 侧栏默认隐藏，`Ctrl B` 或左上按钮以**覆盖式抽屉**滑出（宽 240，`--bg-scrim`；点击空白、Esc、选择任务后关闭）；正文不被挤压 |
| 高度 <560 | 输入框最大高度降为 120px |
| 侧栏折叠（任一宽度） | 侧栏宽 0（不留图标条）；主区头左侧出现同一个 `[≡]` 按钮；任务状态靠任务栏角标补偿 |

---

## 4. 组件清单（v1）

通则：所有可点击元素有 `:hover`（`--bg-hover`）、`:active`（`--bg-active`，无位移）、`:focus-visible`（`outline: 2px solid var(--focus-ring); outline-offset: 2px`，仅键盘）、`:disabled`（`--text-disabled`，`cursor: default`；2026-10-22 起浅色 `#8f8c96`、深色 `#6a6772`，在卡片底上约 3.2:1，禁用的按钮字也认得出，仍明显淡于 `--text-3`）；下表不再重复。输入类容器用 `:focus-within` 画 `--accent` 焦点环（`ui/controls.css` 的 `.ui-field`：1px `--accent` + 外圈 `--accent-soft`；2026-10-22 起侧栏搜索框也是 `TextField`，不再例外）。选中文字 `::selection { background: var(--selection-bg) }`。侧栏、按钮、标题栏 `user-select: none`；对话区全部可选。**选中即复制**（2026-10-20 起，设置项 `copyOnSelect`，默认开；`app/use-copy-on-select.ts`）：鼠标松开时页面上有选中的文字（拖选、双击、三击）就写进剪贴板，toast `common.copied`（1.2 秒）；同一段选区只复制一次；键盘选中不自动复制；输入框、文本域、可编辑区、内置终端里的选中不复制（在输入框里选中多半是要改写或粘贴覆盖）。写剪贴板要 `clipboard-sanitized-write` 权限，主进程只对应用自己页面的主框架放行，其余权限照旧全拒（`main/window/security.ts`）。

### 4.1 StatusDot（状态槽 16×16，居中；2026-10-21 起换成 14px 的图标，原来 8px 的点太不显眼）

| 状态（主进程为准，渲染层只收 `taskState` 事件） | 视觉 | token | aria-label |
|---|---|---|---|
| `running` / `starting` | 半径 6 的圆环：淡轨道（22% 不透明）+ 占三成的弧，弧按 `--dur-spin` 匀速转（`sb-spin`，0% 帧是静止的弧；`--play-state` 暂停或减少动效时静止） | `--st-running` | `status.running` |
| `needs_you` | 14px 实心圆底 + 白色 `!`（`--text-on-accent`），静止 | `--st-waiting` | `status.waiting` |
| `done` | 空心圆（描边 1.5）里一个对勾（描边 1.7），**绿色**（2026-10-21 起） | `--st-done`（绿） | `status.done` |
| `error` | 14px 实心圆底 + `×`（`--text-on-accent`） | `--st-error` | `status.error` |
| 从没跑过 / `aborted` | 不画（槽位保留，标题对齐）；`aborted` 在尾部显示 `task.stopped` | — | — |

`done` = 空闲且最后一轮正常结束（`lastTurn.status === "completed"`），**看过也一直在**（3.0 起，仓库所有者 2026-10-20 定：已完成、进行中、需要介入、失败四种状态各有样子；原来只在未读时画对勾）；未读靠标题用 `--text` 区分（§4.2）。判定在 `shared/ui/sidebar-model.ts` 的 `dotKind`。`error` 保持到用户在该任务开始新一轮。

### 4.2 TaskRow

- 高 `--row-task`(32)，`padding: 0 --space-2`，`--radius-md`，间距 `--space-2`；结构 `[状态槽][标题 flex:1][尾部]`。任务行和还没挂在任务上的会话行（同高、同一套 `.sb-row` 样式；会话没有进程，状态槽只画完成 / 失败两种，看会话文件里最后一轮的结果——`shared/ui/sidebar-model.ts` 的 `sessionDotKind`、`StatusDot.tsx` 的 `SessionStatusDot`；没有结果时不画但保留 16px，让标题和任务行对齐；标题 + 修改时间，§4.5）在文件夹里混排。标题去掉私用区图标字形（`stripIconGlyphs`）。
- 标题 `--fs-sm`，单行省略；默认 `--text-2`，选中、等待、有未读结果时 `--text`（只换颜色，不换字重）。
- 尾部（一次只放一个）：等待中不放；运行中满一分钟才放 `task.runningFor`（不满不放，状态点已在转）；否则相对时间 `--fs-2xs` `--text-3`；尾部是一列：右对齐、最小宽 `--control-h-sm`，任务行 hover 时行尾 `⋯` 盖在这一格上（尾部淡出），没有尾部的任务行也留着这一格，所以任务行和历史会话行的时间右边对齐（2026-10-22 起；原来任务行另外让出 ⋯ 的宽度，时间比会话行靠左一截）；所有行共用 15 秒一跳的时钟；`aborted` 放 `task.stopped`。**时间规则**（仓库所有者 2026-10-20 定）：时间是任务的最后活动时间，持久化在 `TaskRecord.updatedAt`（`lastActivityAt` 只读它），**只在两种时刻变**：用户发了消息（首条、插话、稍后都算），和一轮结束（完成、失败、中止；两个引擎的 runner 各自在这两处 `#touch`）。选中或打开任务、恢复历史会话、重命名、引擎迁移、存会话文件、采用标题、记模型、归档/撤销归档都不变；`TaskRegistry.updateTask` 不再自动刷新 `updatedAt`，要改只能在 patch 里显式给。从历史会话建的任务，时间起点是会话文件的修改时间（`ResumeInput.modifiedAt`），不是建任务的时刻。“等你确认”条按 `updatedAt` 从早到晚排，即这一轮是什么时候发出的。hover/键盘聚焦时尾部换成 `⋯` 图标按钮（`IconButton` 28×28，`.sb-row-more`，`task.more`；菜单开着时也显示）。
- 选中（3.0 起）：`--bg-raised` 底 + `box-shadow: 0 0 0 1px --border-subtle, --shadow-1`，像一张浮起的小卡；不画竖条。尾部相对时间用 `--font-mono` `--fs-2xs` `--text-3`。
- 重命名：行内 input（`F2` 或菜单），Enter 确认、Esc 取消；存应用元数据（不写 omp）。
- 菜单（2026-10-22 起只有一份：`features/sidebar/task-menu.tsx` 的 `buildTaskMenu`，侧栏任务行右键、行尾 `⋯`、顶栏任务菜单 `⋯`（§4.6）三个入口共用，项和顺序一致；`ui/Menu`，每项第一列一个图标）：重命名 `F2`、会话信息（`sessionInfo.menu.info`）、请求记录（`sessionInfo.menu.trace`）、分享链接…（`sessionInfo.menu.share`；后三项见 §4.31）—分隔线—打开工作目录（`task.openFolder`，`openTaskFolder`：系统文件管理器打开任务 cwd，开了 worktree 时是 worktree 根）、显示会话文件（`task.reveal`，选中 `~/.omp/agent/sessions/` 下 omp 自己存的会话记录，和工作目录不是一个地方；2026-10-20 起拆成两项，原来只有一项“在资源管理器中显示”却打开会话目录）、复制会话 ID、复制会话文件路径（会话还没有文件时 toast `task.noSession`）、导出为 HTML…（`task.exportHtml`，主进程弹保存对话框，见 `conversation.md`「导出 HTML」；命令面板 `cmd.exportHtml` 和输入框 `/export` 同一动作）—分隔线—归档 `Del`。归档立即从侧栏移除并 toast `task.archived` + `task.undo`（8 秒）。
- 标题来源：用户重命名 > 第一条用户消息的首行（折叠空白，最多 60 字符）。（RPC 模式下 omp 不自动生成标题，`PI_NO_TITLE=1`，见 `omp://rpc.md`。）

### 4.3 FolderGroup（文件夹头）

- 头高 28，`padding: 0 --space-2`，`--fs-xs` `--text-2` `--fw-medium`（3.0 起，原来 `--text-3`）；左 12px 箭头（折叠时旋转，`--dur-fast`），文件夹名（重名时 `上级/名称`，tooltip 完整路径）；右侧常驻一个 `＋`（`IconButton`，`data-testid="sidebar-project-new"`，`sidebar.newInProject`，`--text-3`，hover `--text`）：在这个文件夹新建任务；studio 项目直接开草稿，只在历史会话里出现的文件夹先由主进程 `ensureSessionProject`（按会话 id 查 cwd，加成项目但不建任务）加成项目再开草稿。`＋` 左边一格（2026-10-21 起，不再看悬停）：**折叠时是行数**（组内有等待任务时前面加琥珀菱形），**展开时是 `⋯`**（`IconButton`，`sidebar.projectMenu`；项目菜单 `ui/Menu`，每项带图标：`project.reveal` 在资源管理器中显示——打开这个文件夹本身，不是上一级；`git.menu.cleanup` 清理无主 worktree；分隔线后红字 `project.remove` 从列表移除——只移出列表，项目里还有任务时不移除、toast `project.removeBlocked`），两者叠在同一格，切换时一个缩小淡出、一个放大淡入（`--dur-base`）；名称始终让出这两格，展开折叠时不跳。**只有 studio 项目的文件夹才有 `⋯`**，纯历史文件夹展开后这一格是空的（右键也没有菜单）。
- 展开规则见 §4.5。
- 文件夹之间 `--space-1`；展开后先 5 行，`sidebar.showMore`（每次 +20）。
- 键盘：列表整体一个 Tab 停靠点（roving tabindex），`↑↓` 移动，`←/→` 折叠/展开，`Enter` 打开，`Home/End`。
- 空项目（展开后没有任务和会话）：一行 `--text-3` `sidebar.empty`。

### 4.4 WaitingStrip

仅当存在 `await` 任务时出现；高 32，`margin: 0 --space-2 --space-1`，`--st-waiting-soft` 底，`--radius-md`，`--fs-sm` `--st-waiting-text`，左 7px 菱形。1 个：`sidebar.waitingOne`；多个：`sidebar.waitingMany`。点击或 `Ctrl J` 跳到最早等待的任务，再点下一个。**不移动任务行。**

### 4.5 Sidebar 外壳

顶部竖排三行（3.0 起，`direction-3.0.md` §3.1；原来是搜索框 + `[新任务][打开文件夹]` 两个并排按钮）：搜索框 / `新任务` / `打开文件夹`（2026-10-20 起"添加项目"改名 `sidebar.openFolder`：选文件夹、加进项目列表，并把草稿切到它）。**搜索框**（2026-10-22 起是 `ui/TextField` sm：28 高、通宽、`role="searchbox"`、`data-testid="sidebar-search"`）：前面放大镜，占位 `sidebar.search`（搜索 / Search），空时右端一个 `--text-3` 的 `Ctrl F` 后缀（`.ui-affix`，常显），有内容时换成清除按钮（20 高的 `IconButton`，`sidebar.clearSearch`）；`Ctrl F` 聚焦并全选；有内容时 Esc 先清空，`↓` 直接进列表。聚焦样式和其他输入框一样（§4.23，不再是侧栏例外）；它直接过滤任务和历史会话，不是命令面板。`新任务` / `打开文件夹` 两行同一种样子：高 30、`padding: 0 --space-2`、`--radius-md`、无边框透明底，左 15px 图标 `--text-2`，文字 `--text` `--fs-sm`，hover `--bg-hover`；右边一个 `--font-mono` `--fs-2xs` `--text-3` 的快捷键提示（`新任务` `Ctrl N`、`打开文件夹` `Ctrl Shift O`；`aria-hidden`，**平时不显示，悬停或键盘聚焦这一行时才出现**，`opacity` 0→1，占位不变）；草稿页时 `新任务` 带 `aria-current="page"`，`--bg-active` 底、`--text` 600。默认文件夹（`AppInfo.chatsDir`）这个文件夹标题写 `empty.defaultFolder`，不露出 chats 目录名。

操作按钮和等待条下面只有**一个列表**（2026-10-20 仓库所有者定：原来上面是按项目分的任务块、下面单独一个"历史会话"区块，同一个文件夹出现两次，已合并；`features/sidebar/HistorySection.tsx`，数据整理在 `shared/ui/sidebar-model.ts` 的 `buildFolders` / `buildTimeline`）：区块标题行（`.sb-history-head`：`sidebar.searchHistory` + 排列切换，2026-10-21 起 `position: sticky; top: 0`、`--bg-sidebar` 底；`.sb-list` 上边没有内边距（`padding: 0 --space-2 --space-1`），标题行一开始就在滚动区顶部，上下滚动时它**完全不动**、行从下面滚过（滚动区有上内边距时 sticky 会先跟着走一段再钉住，或者上面留缝透出滚过的行）；顶部三行操作和等待条在滚动区外，本来就固定）`sidebar.searchHistory`（会话；2026-10-20 起不再叫“历史会话”），studio 任务和 omp 会话目录里还没挂在任务上的会话（含终端里开的）都在这个列表里，不搜索也显示。标题右边是排列切换：`ui/Segmented` sm（2026-10-22 起，`role="radiogroup"`，`aria-label=sidebar.historyOrder`，`data-testid="sidebar-history-by"`），两段 `sidebar.historyByFolder` / `sidebar.historyByTime`，选择记在外壳状态 `ShellState.historyOrder`（默认 `folder`）。**按文件夹**：文件夹 = studio 项目 ∪ 会话 cwd，按规范化路径合并（斜杠、大小写、尾斜杠归一，同一个文件夹只出现一次）；文件夹头见 §4.3；文件夹里任务行（§4.2，状态点、尾部、`⋯` 菜单、`F2` / `Del` 全部照旧）和会话行混排，按最近活动从新到旧（任务取 `lastActivityAt`，会话取修改时间）；文件夹按其中最新的一行从新到旧，没有任何行的项目（空项目）排最后（它仍在，所以 `＋` 可用），搜索时不显示。展开：用户点过的优先；没点过时，有选中的任务、正在跑或等你确认的任务的文件夹默认展开，其余折叠；展开后先 5 行（选中的、运行中的、等你确认的任务不会被藏进"显示更多"），`sidebar.showMore` 每次 +20；展开状态只在本次会话里，不持久化。**按时间**：任务和会话平铺一列（没有文件夹头），同样按最近活动从新到旧，先 40 行，`sidebar.showMore` 每次 +20。会话行（`sidebar-session`）= 状态槽（只画完成 / 失败，§4.2）+ 标题（无标题取首条消息）+ 修改时间，**和任务行同高（`--row-task`）、同一套 `.sb-row` 样式**（2026-10-22 起），悬停提示标题和 cwd，点开 = `resumeSession` 恢复成任务（项目不在列表里时自动加入）；任务列表变化（新建、恢复、第一轮结束）时重取，挂上任务的会话随即离开这个列表、以任务行出现。**标题清理**：任务和会话标题显示前去掉私用区图标字形（`shared/ui/clean-title.ts` 的 `stripIconGlyphs`：U+E000–U+F8FF 及补充私用区，和主进程 TSP 标题同一个集合；omp 的会话标题带这些字形，系统字体里没有，会显示成方框）。**搜索**同时过滤任务和会话（按清理后的标题，不区分大小写），两种排列一样；按文件夹时有匹配的文件夹全部展开，没有匹配行的文件夹不显示。键盘：整个列表（文件夹头、任务行、会话行、显示更多）一个 Tab 停靠点，`↑↓` 移动。侧栏自己没有头（标志和切换侧栏在顶栏）；列表区自绘覆盖式滚动条；底部 44 只有一个 `设置` 文本按钮（齿轮 + 文案；2026-10-22 起是开关，`aria-pressed`：在设置页时再点一次回到对话视图，同设置页里的 Esc）。**2026-10-22 起底部没有语言、主题两个按钮**（`direction-3.2.md` §7 第 5 条）：语言和主题只在设置 → 通用 → 外观（§4.19）。命令面板只走 `Ctrl K`，底部没有放大镜。底部不放键帽、不放小字。

### 4.6 顶栏任务标题与待办板

顶栏中段只有任务标题（`app/TaskCrumb.tsx`，`topbar-crumb`，§3.1）：设置页写 `menu.settings`，新任务草稿写 `menu.newTask`，否则是任务标题（没有标题时 `task.untitled`，悬停提示完整标题）；只显示，不可点。
- **重开会话**（2026-10-22 起）：任务标题右边一个 `IconButton`（`topbar-restart`，14px 环形箭头，`--text-3`），只在有任务时出现；也可按 `Ctrl Shift R`、命令面板 `重开会话`（`task.restart`）。动作：主进程结束这个任务的 omp 进程，再用 `--resume=<会话文件>` 起一个新进程（`TaskPool.restartTask`），新装的 skill、MCP 服务器、插件和改过的 omp 设置都重新读取；成功 toast `task.restarted`。任务在跑、等你确认（门开着）、正在启动、或还有后台作业 / 子代理 / 旁路提问时按钮置灰（`TaskState.restartable` 为 false），悬停提示写明原因（`task.restartBusy*`），快捷键同样被拒并提示同一句话；空闲、已停止、出错时可点。
- **任务菜单 `⋯`**（2026-10-21 加入，2026-10-22 起和侧栏同一份）：顶栏任务工具区最右（终端按钮之后、分隔线之前）一个 `IconButton` 三点按钮（`task-menu`，`sessionInfo.menu.label`，`aria-haspopup="menu"`，打开时 `aria-expanded` + `--bg-active` 底），只在对话页且选中了任务时出现（`features/session-info/SessionMenu.tsx`）；点开从按钮下沿弹出 `buildTaskMenu` 那份菜单（项和顺序见 §4.2）。其中“重命名”发 studio 命令 `rename`，在侧栏任务行里就地改名（侧栏收起时先展开）。
- `TodoBoard`（有 `todoPhases` 时才出现；`features/composer/TodoBoard.tsx`，2026-10-19 起取代对话流顶部的 `TodoStrip`）：输入框正上方状态行（`ComposerTop`，§4.14）右端的一个按钮（`ui-chip`），照 Tern 里的 omp（2026-10-22 起；实测 omp 18.12.6，从列出计划到全部完成逐帧截图，`screenshots/tern-todo-pill-progression.png`、`tern-todo-ring-zoom.png`）：**进度环** `TodoMark state="progress"`（14px，16×16 画布、`stroke 2`（约 1.75px，同 Tern）、圆角端点：`--border` 底圈 + `--accent` 弧从 12 点钟顺时针，弧长正好是 `完成 / 总数`、不夹取：0 是 12 点钟一个圆点，全部完成是整圈；完成一项时弧在 `--dur-slow` 里长过去；不转圈，进行中的那项不算半格）+ 当前项文字（`--text-2`，省略，容器 ≤480px 时隐藏；全部完成时写 `composer.todoAllDone`“全部完成 / All done”）+ `{done}/{total}`（`--text-3`，比文字淡，tabular）。全部完成后 omp 过 `tasks.todoClearDelay` 秒自己删掉 HUD 节点，`todoPhases` 变空，按钮跟着消失。点击向上弹 popover 列出阶段（罗马数字编号 + 每阶段 `完成/总数`，阶段图标同 `TodoMark`：完成 = 对勾、有进度 = 弧、未开始 = 细圈）与条目：`pending` 细圈、`in_progress` 转动的细弧、`completed` 对勾（文字 `--text-2`）、`blocked` 红色细圈 + 感叹号 + 原因、`abandoned` 淡化虚线圈 + 删除线。数据 `TaskState.todoPhases`。
- **TSP 任务的 `TodoBoard`**（2026-10-21）：数据 `TaskState.todoPhases` 由主进程从 omp 的 HUD 待办节点（role `omp.hud.todo`，`checklist` 的 `mode:"hud"`）换算（`src/shared/tsp/todos.ts`，`fixtures/tsp/task.jsonl` 逐帧测试，omp 18.12.3）：`active→in_progress`、`done→completed`、`dropped→abandoned`，阶段标题去掉 omp 加的罗马数字前缀（板自己编号）。位置由 `ComposerTop` 定（状态行右端，`data-testid="tsp-todo-bar"` 在 `.run-todo` 上，板按钮 `todo-board`，浮层 `todo-popover`）。omp 自己画的 HUD 药丸不画（`TspChildren.tsx`），避免两个入口；工具卡片里的 `omp.tool.todo` 清单仍在过程区里（omp 把它发成不可折叠的卡片，照画）。omp 在回合结束清理已完成的待办时 HUD 节点消失，板随之收起。`/todo` 由 studio 接管（`tsp:"studio"`，无待办时提示“还没有待办”）。
- `GoalStrip`（目标模式，`/goal`；`features/goal/GoalStrip.tsx`，样式 `goal.css`）：有 `TaskState.goal` 时出现在对话流顶部，一行：`goal.title`（`--text` medium）+ 目标文字（`--text` 省略，完整文字在悬停提示）+ 状态徽标（2026-10-22 起是 `Badge`，`goal-status`：进行中 accent、已暂停 warning、预算用尽 error）+ 用量（`已用 / 预算`，tabular，悬停是完整 token 数）+ sm 按钮（`Button` sm，`goal-<op>`：暂停 / 继续是次要按钮，放弃是 quiet）：进行中 `暂停 / 放弃`、已暂停 `继续 / 放弃`、预算用尽 `放弃`。最小高 `--control-h-sm`(28)，`--radius-lg`，`--bg-hover`，`--fs-xs`。点下后只有被点的那颗 `disabled`，另一颗不变灰；没有自动聚焦。数据 `get_state.goal` / `goal_updated` ✔；完成或放弃后目标条消失。创建和语义见 `docs/architecture/conversation.md` 的“目标模式”。 **TSP 任务**（2026-10-21）：同一个组件挂在 `TspView` 顶部（`.tsp-view` 的第一个子节点，`goal-strip`），数据同样是 `TaskState.goal`，但来自 omp 输入框卡片上的 `Goal …` 行 + 会话文件（`docs/architecture/tsp-migration.md` “目标模式(TSP…)”）；`/goal` 的创建 / 暂停 / 继续 / 放弃发 omp 的 `/goal …` 命令，放弃要点掉 omp 的 “Drop goal?” 确认；omp 自己的输入框卡片不画，所以没有重复。目标文字读不到时（会话文件还没落盘且不是 studio 创建的）目标条只有“目标 · 状态 · 用量”。

### 4.7 EmptyState

- **输入框贴主区底部**（2026-10-18 返工，空状态和对话中同一位置）；上方区域（垂直居中）**只有**居中的像素标志（`ui/PixelLogo.tsx`，照 omp 终端版启动画面：块字符 π 逐格粉→紫→蓝渐变、左腿末格 ▒，身后错开 1 像素的“层叠”淡影（§3.1“标志”），右边半块像素字 `omp`（`--text`）接 `studio`（`--text-2`），字的 x 高和 π 上下居中（2026-10-20 起，原来照终端贴着 π 的横，看着偏上），字下暗色 `v<版本>`（`--text-3` 等宽））。2026-10-19 起去掉标志下面的项目胶囊和最近任务卡片：最近任务和历史会话只在侧栏（搜索框能搜到任务和历史会话，含终端里的）。**没有欢迎语、插画、示例提示卡**（标志不算）。
- **项目标签在输入框工具行里，审批胶囊右边**（2026-10-20 起，原来在输入框下面单独一行 `.composer-below`，已去掉）：`empty-project` = 文件夹图标 + 文件夹完整路径（2026-10-20 起不写项目名；`--font-mono` `--fs-xs` `--text-2`，最多 40ch，太长时省略开头、留住末尾的文件夹名：外层 `direction: rtl` + 里面 `<bdi>`），纯文字、不画成胶囊（没有底色、边框、圆角），悬停提示完整路径。**只显示、不能点**：它只告诉你这个新任务会在哪个文件夹里运行；换文件夹走侧栏（`新任务` = 默认文件夹，文件夹头 `＋` = 那个文件夹，`打开文件夹` = 新文件夹）或拖入文件夹。项目目录正好是 git 仓库根时，顶栏右侧有草稿的分支胶囊，可勾选在 worktree 里开始（§3.1；2026-10-22 起，原来在标签右边的 worktree 开关已并过去）。发出第一句话后任务的输入框在同一位置接着显示任务的工作目录（`composer-folder`，有 worktree 时是 worktree 根，2026-10-21 起）。
- **默认文件夹**（2026-10-20 起）：新任务（侧栏 `新任务`、`Ctrl N`、启动时）一律在默认文件夹 `AppInfo.chatsDir`（`~/omp-studio/chats`）里，不沿用最近用过的项目，打开就能直接发送（同 Codex / Claude Code）。工具行标签直接写它的完整路径（侧栏文件夹标题才写 `empty.defaultFolder`）。第一次发送时主进程 `ensureChatsProject` 才建目录并加入项目（名为 `chats`），之后它在列表里是普通项目，但界面上一律叫"默认文件夹"。默认文件夹不是 git 仓库，没有 worktree 选项（顶栏没有草稿的分支胶囊）。不用用户主目录作 cwd：omp 默认会把主目录换成临时目录（`--allow-home`），搜索也会扫整个主目录。要在别的文件夹里工作：侧栏 `打开文件夹`、文件夹头的 `＋`、`Ctrl Shift N`（当前任务的项目）或拖入文件夹。
- 最近更新（照 omp 的 What's New，`startup.changelogMode = summary`；`features/empty/WhatsNew.tsx`）：升级后第一次启动时，标志下面居中一行，**只说一遍**（2026-10-22 起去掉行首的 `empty.whatsNew` 标题和行内的分项统计）：`empty.whatsNewUpdated`（“已更新到 v<版本> · N 项改动”），跨多个版本时 `empty.whatsNewUpdatedMany`（“已更新到 v<版本> · M 个版本共 N 项改动”）。悬停提示是 `empty.whatsNew` · 新增 / 变更 / 修复各几项（`empty.whatsNewAdded` / `Changed` / `Fixed`，为 0 的省略）。整行 `--fs-sm --text-3`，不换行，窄了省略号截断。只写统计，不列条目。显示 5 秒后慢慢淡出（`--dur-slow` × 4，2026-10-21 起），淡出后位置留着、标志不跳；这次启动里再进新任务页不再出现。数据来自打进主进程包的 `CHANGELOG.md`（`src/main/whats-new.ts`，解析在 `src/shared/changelog.ts`）：合计 `userData/last-changelog-version` 记的版本之后、当前版本为止的各节（没有记录 = 第一次装，只算当前版本；不含"未发布"），启动时算一次并立即写入当前版本，所以重载窗口仍显示、重启后消失；当前版本没有条目时不显示。
- 侧栏 `新任务` 按钮在草稿页带 `aria-current="page"`，用选中底色突出（§4.5）。

### 4.8 UserMessage

**没有运行脊线**（2026-10-19 起去掉）：对话列左侧不画竖线，也不给用户消息、过程行、结论画节点；`.turn` 不再缩进，内容占满列宽，和输入框左缘对齐。

聊天式**右对齐**（2026-10-19 起），最宽列宽的 85%，短消息只占文字宽度；气泡（3.0 起，`direction-3.0.md` §3.3）：`--bg-bubble` 底、无边框，左上 / 右上 / 左下 `--radius-bubble`、右下 `--radius-sm`（小"尾巴"），`padding: --space-2-5 --space-3-5`；`--fs-prose`；`white-space: pre-wrap; overflow-wrap: anywhere`。>12 行折叠成前 8 行 + 渐隐（渐隐到 `--bg-bubble`）+ `common.expand`（展开状态不记忆）。附件：文字上方一排靠右的 64×64 缩略图（`--radius-md`，点击用系统默认查看器打开）。hover 时气泡下方右侧一行（不换行）出现两个 28×28 图标按钮：复制（`CopyIcon`，复制后 1.2 秒变对勾）和从这里分叉（`Branch`）；文字只在 `aria-label` / 悬停提示里（`common.copy` / `common.copied`、`tree.fork` + `tree.forkTitle`）。出现动画见 §2.6。
- 状态：默认 / 发送失败（弹错误 toast：`msg.sendFailed` · 原因；清空输入框是乐观的，失败时草稿放回输入框，由用户重发——没有消息下方的失败行，也没有重试链接，`features/composer/actions.ts`）。运行中发出的消息：`Enter`（插话）由 omp 立刻作为用户消息上屏；`Ctrl+Enter`（稍后）进 omp 的排队（dock 里的 `omp.queue`），轮到时才上屏（`docs/architecture/tsp-real-omp-probes.md` §5）。

### 4.9 AssistantMessage 与 Markdown

- 助手消息是 omp 的 `omp.assistant` 节点（`col`）：思考块（`omp.thinking*`，`section`）和正文 `md`，由 `features/tsp/` 画（`nodes/layout.tsx` 的 `AssistantCol`）；无气泡、无头像、无名字。复制回答用 omp 放在每轮用量行里的图标（`omp.turn.copy`，悬停提示 `Copy answer`），或命令面板的“复制最后一条回答”。
- **没有“叙述 / 结论”之分**：一轮里的助手文字和工具卡片按 omp 发来的顺序排列，studio 不拆分、不挑结论，也没有“没有得到结果”兜底。
- 流式：`md` 节点带 `stream: true` 时按流式渲染（`nodes/text.tsx` 传给 `Markdown` 的 `streaming`）。
- 思考块折叠与否跟着节点的 `collapsed`（§4.11）；展开后的内容 `--text-2`、`--fs-sm`（`tsp.css`）。思考头照 Tern 里的 omp：斜体，折叠箭头跟在用时后面（`✳ Thinking… 2.7s ›`），不在行首（2026-10-22）。
- **每轮用量行**：omp 在每轮最后一个助手消息里发 `omp.turn.usage`（时长 · token · 费用，悬停提示是完整明细），文字是 omp 原样的英文。恢复会话时 omp 不重发这一行，studio 从会话文件补回（§4.14“恢复会话时补回的用量脚注和空闲回顾”）。
- Markdown：

| 元素 | 样式 |
|---|---|
| 段落 | `--fs-prose`；段间 `--space-3`；首段无上边距 |
| h1 / h2 / h3 | 17 / 15 / 15，`--fw-strong`；上边距 `--space-5`，下 `--space-1-5`；对话里不用大标题 |
| 列表 | 缩进 `--space-5`；项间 `--space-1`；标记色 `--text-3`；任务列表渲染为只读复选框 14px |
| 行内代码 | `--font-mono` 0.92em；`--bg-sunken` + `--border-subtle`；`padding: 1px 5px`；`--radius-xs` |
| 引用 | 左 2px `--border-strong`；`padding-left: --space-3-5`；`--text-2` |
| 表格 | 外层可横向滚动；单元格 `--space-2 --space-3`；表头 `--fs-xs` `--text-2`；行线 `--border-subtle`；无斑马纹 |
| 分隔线 | 1px `--border-subtle`，上下 `--space-5` |
| 链接 | `--link`，hover 才下划线；点击交给主进程用系统浏览器打开；tooltip 显示完整 URL |
| 原始 HTML | **转义成文本**，不渲染（AGENTS 安全规则） |
| 图片 | 仅 `data:` 与本地附件；远程图片不加载，显示为链接 |
| 公式 | KaTeX 渲染（3.1，`direction-3.1.md` §2 行 9；分隔符识别在 `markdown/math.ts`，渲染在 `render.ts` 的 `renderMath`）：行内 `$…$`、`\(…\)`；块级 `$$…$$`、`\[…\]`，分隔符在行首，块级居中、上下 `--space-3`、太宽时横向滚动。字号 1.1em，颜色 `--text`。`$` 按 pandoc 规则：开 `$` 后紧跟非空白，闭 `$` 前非空白且后面不是数字，所以 `$5 and $10` 不是公式；`\$` 是普通的 `$`。跨行的块级公式中间遇到空行就不算公式。没闭合的分隔符按普通文字显示（流式中公式还没写完时就是这样）。KaTeX 解析失败时显示原文（带分隔符），`--font-mono` 0.92em `--st-error`。`trust: false`：`\href`、`\url`、`\includegraphics` 不放行 |

- 用户文本不进 `dangerouslySetInnerHTML`；唯一例外是 KaTeX 渲染出的公式 HTML（`renderMath`，`trust: false`，公式里的文字由 KaTeX 转义；3.1，`direction-3.1.md` §2 行 9）。Markdown 库由架构方案选（要求：能拿到块边界、可关闭原始 HTML）。

### 4.10 CodeBlock

容器 `--radius-md`，`1px --border-subtle`，`overflow: hidden`，上下外边距 `--space-3`。头高 32、`--bg-raised`、`padding: 0 --space-3`：左语言名 `--fs-xs` `--text-3`（无语言显示 `text`），右 24×24 复制图标按钮（hover、聚焦代码块或键盘 Tab 到它时显示，复制后变对勾 1.2s，`aria-live` 播报 `common.copied`）。正文 `--bg-sunken`、`--font-mono` `--fs-code`，`padding: --space-3 --space-3-5`，长行折行（`pre-wrap` + `overflow-wrap: anywhere`，2026-10-20 起不再横向滚动；工具卡输出、门里的预览、设置里的 JSON 编辑框同样折行），`tab-size: 2`。**全文显示，不折叠**（2026-10-22 起；omp 的 `md` 节点不限行数，原来的“>24 行折叠到 20 行 + `code.expand`”已删）。流式中以最终样式创建，围栏闭合后**只改颜色**加高亮；闭合前不高亮。` ```diff ` 用 `--diff-add-fg/del-fg` 给整行着色，不加背景条。

**`svg` 代码块画成图**（2026-10-22，照 omp 18.12.6 在 TUI 里的做法：助手消息里的 ```` ```svg ```` 围栏渲染成图）：只在代码块闭合后画（流式中途还是源码）。颜色变量（`var(--fg)` `--muted` `--border` `--surface` `--accent` `--success` `--warning` `--error`、`--c1`…`--c6`，带默认值的写法也认）和 `currentColor` 在画之前替换成当前主题的实际颜色（`markdown/svg-figure.ts`，`FIGURE_TOKENS` 对到 tokens.css；`--c1`…`--c6` 是新增的 `--chart-1`…`--chart-6`），补上 `xmlns` / `xmlns:xlink`，转成 `data:image/svg+xml` 交给 `<img>`——`<img>` 里的 SVG 不执行脚本、不加载外部资源，CSP 本来就允许 `img-src data:`，不用 `dangerouslySetInnerHTML`。切深浅主题时重画。图左对齐，1 个 viewBox 单位 ≈ 1px，宽了按比例缩到列宽（`max-width: 100%`）；不铺底色（omp 约定画布就是读者的主题）。头部复制按钮左边多一个 `<>` 按钮（`codeblock-source`，`aria-pressed`）在图和源码之间切换，源码照常高亮；`<img>` 加载失败时退回源码，上面一行 `code.figureFailed`。

### 4.11 过程区（TSP 节点）

对话里 omp 的工作过程（工具卡片、思考块、子代理卡片、待办、压缩分隔、每轮用量脚注）都是 omp 发来的 TSP 节点，由 `features/tsp/` 渲染：结构由 omp 决定，外观由 `features/tsp/tsp.css` 决定（见 §4.14 末尾"过程卡片外观"和 `docs/architecture/tsp-migration.md` §8）。折叠 / 展开跟着节点的 `collapsed`，没有例外：派子代理的 Task 卡片（`omp.tool.task`）omp 发成收起、只剩标题，studio 照画；子代理的进度在下面等待卡片（`omp.tool.wait`）的磁贴上，omp 发的 `preview:"children"` 让磁贴收起时也一直显示（2026-10-22 仓库所有者）。`Ctrl O` 展开或收起所有工具卡片（`docs/architecture/conversation.md`）。运行状态、用时和当前活动在输入框上方的状态行（`ComposerTop`，§4.14），子代理在右栏的子代理面板（§4.28）。没有改动卡片：评审入口是顶栏评审按钮、提交对话框、`Ctrl Shift D` 和命令面板（§4.25）。

### 4.14 Composer

**尺寸与结构**
- 外容器宽 = 列宽；`--bg-raised`；`1px --border`（hover `--border-strong`）；`--radius-composer`（22，3.0 起，`direction-3.0.md` §3.6）；`--shadow-composer`；`padding: 6px 6px 6px 8px`，输入区和工具行在同一块底上，**中间不画分隔线**：输入区最小高 42、`padding: --space-2-5 --space-2-5 --space-1`，工具行最小高 36、左右不再留白；聚焦样式见通则。
- 文本区：`--fs-prose`，placeholder `--text-3`，最小 1 行（2026-10-19 由 2 行降低；常数高度，空状态与对话中一致），自动增高到 `min(40vh, 12 行)` 后内部滚动，`resize: none`。**高度可拖**（2026-10-21）：输入框顶边一条拖拽条（`composer-resize`，`role="separator"`，悬停 / 聚焦时露出一根 `--border-strong` 短横线）向上拖变高，下限一行、上限主区高度的 60%（窗口变矮时重新夹取）；拖过之后高度固定、内容内部滚动；键盘 ↑↓ 每次 16px，双击还原成自动增高；整个应用一个值（`localStorage["composer.fieldHeight"]`）。
- 底部工具行：左起 ModelChip、ApprovalChip、文件夹标签（草稿 `empty-project`、任务 `composer-folder`，§4.7；只读，高度和左右内边距同胶囊）、会话开关胶囊（只有任务有，见下“会话开关菜单与模型预设”）；**工具行上的胶囊（模型、审批、会话开关，以及输入框上方的待办板按钮）2026-10-22 起统一是 `.ui-chip`**（§4.23：28 高、无底色，悬停 / 打开时 `--bg-hover`）。没有附件按钮：2026-10-20 去掉 `⊕`，后来加回的 `＋`（`composer-attach`）2026-10-22 仓库所有者定再去掉，附件只来自粘贴和拖入；模型和审批两个胶囊后面不带 `⌄`（2026-10-21 仓库所有者定去掉；原来各有一个 12px `⌄` 提示能点）；**审批胶囊 2026-10-22 起写图标 + 模式名**（`direction-3.2.md` §7 第 10 条），见 §5.8，"全自动"用 `--st-waiting-text`；输出速度（`UsageMeter`，只在运行中，见下）；右起上下文圆环（`ContextMeter`，见下）、本会话费用（`SessionCost`，对应 omp 状态栏的 cost 段：`get_session_stats.cost`，按模型的 API 价格估算，订阅登录的模型也照样累计；等宽 `--fs-xs` `--text-2`，`$0.0001` 这种不到一美分的保留 4 位小数；一直显示，新任务草稿和还没有统计时是 `$0.00`；当前模型的 provider 有 OAuth 登录凭据时（omp 优先用 OAuth，`get_logout_accounts`，按 provider 缓存 5 分钟）后面跟 `--text-3` 的 ` (sub)`，悬停换成 `composer.usage.costTipSub`；悬停 `composer.usage.costTip` + 输入/输出/缓存读取/高级请求数；是按钮，点开居中的 `UsageDialog`，见下）、SendStop。仪表不收缩（`flex: none`），空间不够时的让位顺序：项目路径先缩到只剩文件夹图标（`flex-shrink: 100`），再是思考强度后缀（容器宽 401–460px 时隐藏，完整的“模型 · 强度”在胶囊悬停提示里），模型名最后才省略，且不窄过 `--chip-name-min-w`（9ch：`composer.css` 里模型名 `.chip-text` 的 `min-width`；模型胶囊 `.ui-chip.chip-model` 的 `min-width` = 它 + 两侧内边距 2 × `--space-2-5`）——开着子代理 / 文件面板时不再缩成 “D…” 或只剩 “· 高”；审批胶囊不收窄；≤860px 去掉速度，≤400px（比如开着文件预览）工具行折成两行：模型、审批胶囊在上，计数、圆环、费用、发送换到下一行靠右；圆环和费用一直在。胶囊 `overflow: hidden`，内容不会画到旁边。本会话 token 不在工具行里（2026-10-19 起去掉图标按钮），在上下文浮层的“会话用量”里。

**后台任务看板**（`JobsBoard`，`features/composer/JobsBoard.tsx`；2026-10-21 起改成药丸右半段的弹层，见 §4.14“输入框上方”；原来的 `后台任务` / `子代理` 两个独立按钮（`jobs-pill-bash` / `jobs-pill-task`）、状态行里等待后台任务的那句提示、rpc 的 `deriveJobs` 都已删除）：药丸 `⚡ N`（`pill-jobs`）点开向上弹出 `Popover` 看板 `jobs-board`，**只列 bash 后台任务**（子代理在右栏的子代理面板），每行 `job-row`：展开箭头、命令、状态（`job-dot` + 文字）、耗时（运行中实时走）；点一行展开动作（`.job-actions`：一行说明 `composer.jobs.tspOutputHint` + `ui/Button` sm，2026-10-22 起，原来是自绘的小按钮）：`在 omp 的后台任务窗口查看输出`（次要按钮，`tsp-job-view-output`：输出只在 omp 的 `/jobs` 弹窗里有，没有别的通道，所以让 omp 打开它——hud 有作业胶囊就点它，没有就 `sendPrompt("/jobs")`——再对弹窗里这个作业的列表项发 `select`，弹窗由 TspView 渲染）和运行中才有的 `结束`（danger 按钮，`tsp-job-kill`，`runTaskCommand {kind:"jobsKill", id}`，主进程拼 `/jobs kill <id>`；omp 成功时没有任何回应，出错才弹 toast `No running background job with id "x".`）。Esc 关闭并还焦点。
- **作业数据**（2026-10-21，S2Jobs）：从 omp 的节点推出（`src/shared/tsp/jobs.ts` 的 `deriveTspJobs` / `mergeTspJobs`，`tsp-jobs-store.ts` 每批文档消息后并一次）；药丸只数**运行中**的 bash 作业。`/jobs` 由 studio 接管（`tsp: "studio"`）：不带参数打开看板（有 bash 作业就开，**含已结束的**——药丸那一段没有时看板从药丸的位置弹出；没有 bash 作业提示“这个任务还没有后台任务”，`ComposerTop` 一直挂着收请求），`/jobs kill <id>|all` 直接结束。已结束的作业只有在 omp 的 `/jobs` 弹窗开着时才在文档里；看板按"运行中消失 = 完成"和结束动作自己记录，不保证重启 studio 后还在。omp 自己的 hud 作业胶囊（`▷ N`，`omp.hud.seg`）不画。
- **输入框上方**（2026-10-21，仓库所有者定，照 Tern；`features/composer/ComposerTop.tsx`，`data-testid="composer-top"`）：输入框正上方、列宽、`padding: 0 --space-1 --space-2`，自上而下最多两行，`Reveal` 展开收起：
  - **药丸行**：右对齐一颗描边药丸 `[👥 N | ⚡ N]`（`StatusPills.tsx`，`status-pills`；高 24、`--radius-pill`、1px `--border`、`--bg-raised`；两个半段是各自独立的按钮：高 20、`--radius-pill`、`--fs-xs`、`--text-2`、hover `--bg-hover`，13px 图标 + 个数 tabular，中间 1px 分隔线）。**左半段** = 运行中的子代理数（`pill-agents`，`data-count`；`shared/tsp/agent-hub.ts` 的 `countActiveAgents`，按名字去重），点击 = 打开 / 收起右栏的子代理面板（`toggleAgentsPanel`，§4.28，`aria-expanded` 跟面板）；**右半段** = 运行中的后台 bash 作业数（`pill-jobs`；`tsp-jobs-store`），点击 = 向上弹出后台任务看板（上面的 `JobsBoard`）。**每段只在个数 > 0 时画**，两段都没有就不画药丸（看板仍可由 `/jobs` 从药丸的位置打开）。悬停提示 / `aria-label`：`composer.pills.agents` / `composer.pills.jobs`（“子代理：2 个运行中”）。药丸本身不是按钮。**位置**：有待办板时药丸单独一行、在待办板（状态行）的正上方；没有待办板时并到状态行的右端（运行中）或直接在输入框上面（空闲）——不留空行。
  - **状态行**（`.run-status`，§4.11）：左 = 运行图标 + 翻牌计时 `FlipText` + 细分隔线 + 当前活动；右 = `TodoBoard`（§4.6，点击展开阶段与条目，最宽 55%）。只在任务启动中 / 运行中 / 等你确认或有待办时出现。
  - **删掉的**：独立的 `后台任务` 按钮（`jobs-pill-bash`）和 `子代理` 按钮（`jobs-pill-task`）、`TspJobsBar` / `TspTodoBar`、rpc 的 `RunStatus` / `QueueStrip` / `UsageLimitBanner`；omp 自己的 HUD（`omp.hud` 里的作业 / 子代理胶囊——就是之前那个孤零零的 `▷ 1`——和 `omp.hud.activity` 里的运行状态行、待办药丸，`HIDDEN_HUD_ROLES`，`TspChildren.tsx`）不画，数据都在 ComposerTop 里。omp 的 Stop 键帽也随运行状态行去掉了：停止用输入框的发送 / 停止键和 `Esc`。
  - **小窗口**（最小 800×600）：输入框和它上面这块是 `flex: none` 的整体，**永远完整可见**；让出高度的是上面的对话滚动区（`.tsp-view`、`.tsp-scroller` 都是 `min-height: 0`），e2e 在 1200×800 / 960×600 / 800×600 断言工具行底边在窗口内、药丸不压输入框、对话区 > 120px（`test/e2e/tsp.e2e.ts`）。
- **过程里的作业磁贴**（`omp.job.tile`，Task / wait 工具卡的 body，`tsp.css`）：磁贴落在 `--bg-raised` 的工具卡里，底色用 `--bg-sunken`（不是半透明的 `--bg-hover`：它叠在不同底上深色下一块亮一块暗、对比不均匀），1px `--border-subtle` 内描边。
- 草稿的工具行在审批胶囊右边多出项目标签（§4.7；worktree 选项在顶栏的分支胶囊里，§3.1）；输入框下面不再有单独一行。发出第一句话换成任务的输入框时：文件夹标签留在原位（`composer-folder`），焦点在绘制前就落到新输入框（App 的 layout effect），边框不从灰色过渡回聚焦色（`data-from-draft` 时 `.composer` 无过渡），所以看不出换了一个输入框。
- 工具行各项**从第一帧起都在原位**（2026-10-19）：模型胶囊、审批胶囊、上下文圆环、费用都直接画出来，数据到了再填，不等 omp。数据先用上次读到的（主进程每次现读成功就记进 `userData/startup-cache.json`：默认模型、模型目录、各项目的默认值、各 provider 是否订阅、审批模式；渲染进程在第一次渲染前取 `getStartupSnapshot()`），现读到了再替换；从没读到过（第一次启动）时模型胶囊写 `composer.modelLoading`、审批写 `approval.loading`，圆环是同位置同大小、不能点的空环（`data-pending`）。任务在进程起来之前，胶囊用上次读到的模型目录里的名字和窗口（不是模型 id）。主进程在应用启动时就拉起服务进程读默认模型和模型目录，不等输入框来要。
- **切项目时模型胶囊第一帧就是最终值**（2026-10-21）：草稿和任务的输入框都不再经过"上一个项目的模型 / `composer.modelLoading` / `composer.noModel`"这类中间状态。渲染进程按项目记最近一次现读的新任务默认值（`composer/new-task-default.ts`，没读过的项目退回启动缓存），草稿的胶囊每次渲染都按**当前项目**的记录算，现读到了才换、读不到就保持，绝不显示别的项目的值；任务在进程起来之前（`stopped` / `starting` 且任务状态里还没有模型）用同一份记录和算法先画出模型和思考强度，主进程随后报出的是同源的值，一般不再变化。草稿页的默认模型、模型目录同样先用本次运行里最近读到的值。**草稿胶囊的思考强度**（2026-10-21）：档位取项目里 `omp config list` 的 `defaultThinkingLevel`（没有就用 omp 自选默认模型的档位）；模型认出来后按它的档位钳制，不支持思考的模型不显示强度；模型认不出来（模型目录还没到，或项目 `.omp/config.yml` 的 `modelRoles.default` 指向目录里没有的模型）时没有档位可钳，原样显示配置的档位，不再因为"认不出模型"整段隐藏。
- **冷读占位与单一算法**（2026-10-21，逐帧复现后改）：切到一个这次运行和启动缓存里都没读过的项目时，旧做法在 `omp config list` 返回前拿 omp 自选的全局默认值和全局强度顶上，返回后再换成项目自己的——实测逐帧记录是 `模型…` → `模型…中`（模型没认出来，档位却用了全局的）→ `模型…高` → `Chip Global高`（全局模型配项目的档位）→ `Chip Alpha高`，同一个项目里连变四次。现在项目的默认值或模型目录有一样没读到，胶囊就是占位 `composer.modelLoading`，**不带强度**，两样都到了一次换成最终值（`shared/ui/new-task-default.ts` 的 `pending`）；读过的项目切回来第一帧就是最终值，逐帧只变一次（`test/e2e/model-chip.e2e.ts`）。读不到项目配置（omp 没就绪）时按“什么都没配”算，不一直占位。配置的 `modelRoles.default` 指向目录里没有的模型时胶囊写它的名字，不写 omp 自选的那个。显示什么模型、什么档位的计算草稿、起进程前的任务输入框、主进程的 TSP 任务状态（`tsp-runner.ts` 的新任务默认值）共用这一份：此前主进程那份不钳制档位，配的档位不在模型支持的档位里（如 `medium` 配 `low/high/max` 的模型）时任务状态里有模型名没有强度，胶囊只剩模型名。顶栏分支按钮（`GitTools`）的状态连同任务 id 一起记，切到非 git 目录的任务第一帧就不画，不会挂着上一个任务的分支（`test/e2e/git-worktree.e2e.ts` 逐帧断言）。
- **附件卡片与 `#N` 芯片**（2026-10-21 起，`features/composer/ComposerInput.tsx`、`Attachments.tsx`，机制和 omp 实测见 `docs/architecture/composer-attachments.md`）：附件卡片在输入框**顶部**（文本区上方），每张 `attachment`：32×32 缩略图 + `#N`（`--fs-xs` 500）+ 像素尺寸（`--font-mono` `--fs-2xs` `--text-3`，`1568×165`）；右上 ✕（`attachment-remove`，悬停 / 聚焦才显示，`composer.attachment.remove`）。来源是粘贴图片（截图、资源管理器里复制的图片文件）和拖入图片（2026-10-22 起没有附件按钮，见上）。**非图片文件**（拖到输入框、粘贴）同样是卡片（文件图标 + `#N 名字` + 大小）和 `[File #N, 名字]` 芯片，发送时内联换成 omp 的 `@"路径"` 提及；路径只在 preload / 主进程里，渲染进程只有不透明的 id（`docs/architecture/composer-attachments.md` §2.1）。当前模型不收图片时 toast `composer.attach.unsupported`。文字里引用附件的是 omp 的占位符 `[Image #N, WxH]`，在输入框里显示成 `#N` 芯片（`.composer-chip`，`--accent-soft` 底、`--radius-sm`）；芯片是原子的（光标 / 选区不能落进去，Backspace / Delete / ← / → 一步越过，删掉芯片 = 删掉附件，删卡片 = 删掉芯片）。**大段粘贴**（超过 10 行或 1000 字符，omp 的阈值）折叠成 `[Paste #N, +X lines]`，显示成 `#N +X 行` / `#N M 字符` 芯片（`--bg-sunken` 底、`1px --border-subtle`），发送时换回原文；`Ctrl+Shift+V` 原样粘贴不折叠（omp 的 `pasteTextRaw`）。发送时图片按文字里引用的编号重排、没引用的不发。
- **粘贴文件**（2026-10-20 起，照终端；2026-10-21 起普通文件改成文件附件，见上）：资源管理器里复制的文件夹粘贴进输入框时，插入它们的绝对路径，含空白的加双引号，多个用空格隔开；图片文件仍作附件。路径由 preload 在隔离世界里用 `webUtils.getPathForFile` 取，`document.execCommand("insertText")` 插进输入框（走输入框自己的 input 事件，`Ctrl Z` 能撤回），渲染进程拿不到路径，也没有传路径的函数（同拖入文件夹，`src/preload/index.ts`）。
- 草稿按任务保留，由主进程持久化。
- 占位符：新任务 `composer.placeholderNew`；有对话 `composer.placeholder`；运行中 `composer.placeholderRunning`（设置里对调后用 `…Swapped`）；有门时 `composer.placeholderGate`。
- **输入法**：`isComposing` 或 `keyCode === 229` 时 `Enter` 一律不发送；组合结束后才发送。（测试必写。）

**输入框与过程区的分工**：输入框上方的整个过程区——对话、工具卡片、待办、子代理、后台任务、HUD 状态行、omp 的排队（`omp.queue`）、提问 / 审批（`omp.editor.ask`、`omp.editor.ask.approval`）、选择器等浮层——是 omp 发来的 TSP 节点（`features/tsp/TspView`，见 `docs/architecture/tsp-migration.md`）；输入框和它下面的一切（本节的 Composer：模型胶囊、思考强度、审批胶囊、上下文圆环、费用、发送 / 停止）是 studio 的 `Composer`。所有任务都是 TSP，所以同一段对话在 studio 和 Tern 里显示一样。
- 布局：`TspView`（`flex: 1`，内部滚动，吸底）在上，`Composer` 在下；TSP 的 dock（HUD、排队、提问 / 审批）停在过程区底部、Composer 正上方，宽度同对话列（`--content-w`）。omp 自己的输入框卡片（dock 里 role `omp.editor`：编辑器、模型、思考强度、上下文、费用、发送 / 停止）**不渲染**（`TspChildren.tsx`），所以也没有看不见的编辑器抢键盘焦点；对话列宽度（`resizeTsp` 的列数）照旧量对话列。提问 / 审批被撤掉、拿着焦点的选项列表消失后，焦点回到 studio 输入框（`use-reclaim-focus.ts`）。过程区里的 `Esc` 是写给 omp 的按键，不触发 Composer 的“停止”。
- 过程区顶部的标题块（2026-10-20 起）：omp 自己的欢迎块（`omp.welcome`：logo、"omp"、版本、小提示）不渲染（`TspChildren.tsx`），inline surface 的对话列最上面改画 studio 自己的 `StudioHeader`（`features/empty/StudioHeader.tsx`，空状态用的同一个组件）：像素标志 `omp studio`（compact，`unit` 4，比空状态小一号）+ 版本号 + 任务工作目录的文件夹标签（`TaskState.cwd`，开了 worktree 时是 worktree 根；`PathLabel`，同空状态的 `empty-project` 样式）。它在滚动内容里，随对话一起滚走；screen surface（如 `/settings`）盖住一切，不画。testid：`studio-header`、`studio-header-folder`。
- 发送 / 停止：`sendPrompt` / `stopTask`；运行中直接发送（omp 自己排队并在 dock 里显示，studio 没有自己的队列条，`Enter` / `Ctrl+Enter` 都走 `send`，不分插话 / 稍后）。**提问**（合成门 `tsp-ask`）：发送键和 `Enter` 不发送，占位符 `composer.placeholderAsk`，回答在过程区里完成。**审批**（合成门 `tsp-approval`，2026-10-21）：输入框照常能发——写的字 `Enter` 发出去 = 拒绝待批的调用并把这句话告诉 omp（omp 自己的行为，studio 只是 `send`），占位符 `composer.placeholderGate`；`Ctrl+Enter` = 批准、`Ctrl+O` = Details（对审批卡上同名按钮发 `action`）；审批卡只画 Details 一个按钮（`omp.btn`，点击发 `action`，键帽留在按钮里），放在标题那一行的右端；omp 底栏的 Deny / Approve 和选项列表重复，不画（2026-10-22 仓库所有者："右下角怎么是单独的"），批准键 `Ctrl+Enter` 写在输入框占位符里。门的完整行为见 §4.17。**omp 的面板开着**（全屏 surface 或 Agent Hub 的 `picker`，2026-10-21）：不往主代理发——发送键禁用、`Enter` 不发、占位符 `composer.placeholderScreen`、工具行右侧一条 `composer-note`（`composer.screenOpenNote`，不加新行），`Esc` / 停止键只把 Esc 交给 omp 关面板。在 Hub 里选中子代理后 omp 进入聚焦模式，此时输入框照常发送，omp 把话交给那个子代理（`docs/architecture/tsp-migration.md` §10.7）。
- 输入框的功能不变：斜杠菜单、`@` 文件菜单、斜杠命令守卫、模型 / 思考强度 / 速度开关、输入历史照常。斜杠菜单的命令来自 omp 自己的命令列表（`listSlashCommands`，服务进程提供，不含项目本地命令 / skills）；选中后和手敲一样，`/命令` 文字原样 `sendPrompt` 给 omp，由 omp 处理并在过程区里画自己的界面（注意裸 `/model` 打开的是 omp 的“角色”选择器；切本会话模型用模型胶囊）。studio 接管的命令（`/btw` 旁路提问面板，见 §4.14 BtwPanel；`/tree` `/fork` 见 §4.14 SessionTreePanel；`/goal` 见 GoalStrip）不发给 omp；omp 有同名命令但 studio 没接管的，就是 omp 的（照发给 omp）。命令面板里的条目：压缩上下文、复制最后一条回答、展开或收起所有工具卡片、旁路提问、暂停 / 继续 / 放弃目标、会话树。`!` 开头的文字也原样发给 omp。omp 的 HUD / 排队取代了旧的状态栏和队列条（studio 不画）。
- 模型、思考强度、上下文、费用读 `TaskState` 的同名字段（主进程从 TSP 文档推导）；换模型 / 思考强度由主进程在 omp 的选择器 / `thinking.cycle` 上操作；速度开关由主进程发 `/fast on|off`、`/slow on|off` 并按 omp 的 toast 成功 / 失败。图片：主进程写成临时文件，把 `@"路径"` 附在文字后交给 omp（omp 读成图片附件），粘贴 / 拖入照旧。
- **没有改动条**（2026-10-21 删除）：TSP 任务的输入框上方不再有“N 个文件已更改 +a −d · 打开评审”那一行，过程区里也没有 ChangeCard；评审（§4.25）已经能看全部改动。评审入口是顶栏评审按钮（`topbar-review`）、提交对话框里的“评审改动”、`Ctrl Shift D`、命令面板。
- **过程卡片外观**（2026-10-21，`features/tsp/tsp.css`，结构由 omp 决定、外观由我们决定）：工具卡片 body 里的 `code` 不论 omp 有没有给 `wrap` 一律折行（`pre-wrap` + `overflow-wrap: anywhere`），不出横向滚动条；`code` / `rows` / `table` 真要滚动时用细滚动条（`scrollbar-width: thin` + `--scrollbar-thumb`，无箭头按钮）。bash / eval 的 body（一层 `col`：命令 `code` + 输出 `ansi` + 底栏）命令和输出共用卡片底色，中间一条 `--border-subtle` 细分隔线，底栏（`omp.run.foot`）和 Done / Running 状态用 `--text-3`；卡片头里的无色调徽章（语言、`background`）无底色、`--text-3`。卡片 body 里任何一层的 `code` 都不画路径块头（`.tsp-tool-body .tsp-code .tsp-code-head`，2026-10-22 起，原来只管直接子级）：read 的头、grep / ast-grep 的文件行已经写了路径，再画就是重复的一行。ask 卡片完成后 body 第一块 md 与头上的 `target` 相同时不再画第二遍（`work.tsx` 的 `duplicateId`），头上的问题允许折行；答案行（`omp.tool.answer`）和未选项（`omp.tool.answer.off`）同字号、同一列，未选项用等宽的空位代替勾。状态行（`omp.working`）的计时用正文字体 + tabular 数字，不再和文字混用等宽字形。
- **恢复会话时补回的用量脚注和空闲回顾**（2026-10-21，回顾部分 2026-10-21 改）：omp 的 `--resume` 只重发旧对话，不重发每轮末尾的 `omp.turn.usage`，也不重放空闲回顾 `omp.recap`（实测 18.12.4，见 `docs/architecture/tsp-migration.md` §10.1），所以重新打开任务后这两样会消失；studio 从 omp 的存档补回（只读）。① 用量脚注：每轮最后一个助手消息后面补一行 `[time 图标][11.2s · 2.9K tok · $0.0019 this turn]`，样式同 omp 实时的那行（`.tsp-row[data-role="omp.turn.usage"]`，`data-restored`），文字格式照抄 omp 的英文（`features/tsp/turn-footer.ts`，不走 i18n，费用用准确值）；数据来自会话文件（`getTspSessionExtras`），文档轮数和文件轮数对不上时不补。② 回顾：**对话里只显示最新的一条**，实时和恢复一样。样式：一行，**图标是 `※`（不是时钟 / `history` 图标）**，`--text-3` 斜体、`--fs` 同正文，悬停提示是 omp 原样的英文 `Recap while you were away`（过程区不汉化）；omp 实时发来的 `omp.recap`（节点里的 `history` 图标被隐藏、改画 ※）和恢复补的用同一套样式。实时：omp 每条回顾都留在对话中间，新回顾来了旧的收起（`RecapRow` 只画 main 里最后一个 `omp.recap`）。恢复：读 agent 目录 `history.db` 的 `session_recaps` 最新一条，按生成时间放回它的位置——第 `afterTurn` 轮之后、下一轮用户消息之前（`afterTurn` = 回顾之前开始的轮数；`shared/tsp/recap-slot.ts`，`features/tsp/MainFlow.tsx`），回顾之后又有新消息**不影响**显示；会话压缩过（文档轮数少于文件轮数，omp 只重发保留的最后几轮）时从末尾对齐，落在没重发的旧轮里的不画；实时已经收到过 `omp.recap` 时不再补。omp 的触发：`recap.enabled`（默认开）、`recap.idleSeconds`（默认 240 秒）、有模型、一轮结束后空闲。
- **压缩分隔**（2026-10-21）：omp 终端里上下文压缩后的分隔是整行 `──── 📷 snap-compacted · 48K→6.1K · Ctrl+O ────`（前后各空一行；方法名 `remote-compacted` / `soft-compacted` / `handed-off` / `snap-compacted` / `shaken`），TSP 里它是折叠的 `section`（role `omp.compaction`；交接 `omp.handoff`、分支摘要 `omp.branch` 同款），头文字 `Snap-compacted · 48K → 6.1K tokens`，body 是说明 + 摘要 md。studio 把头画成整行分隔（`tsp.css`）：两段连贯的 1px `--border` 横线（`::before` / `::after`，`flex: 1`）夹着文字，没有折叠箭头，上下各 `--space-3` 外边距；文字 `--fs-sm`（比过程里的小字 `--fs-xs` 大一号：它是上下文的分界，要一眼认出，但不比回答正文抢眼；颜色沿用 omp 的 `muted` / `dim` / `mono` span），点文字展开摘要、再点收起，悬停时文字变 `--text`、不铺底色。文字是 omp 原样的英文。
- **omp 的状态行**（2026-10-21）：omp 的 `showStatus`（切模型的 `Session-only model: deepseek/deepseek-v4-pro. Use Alt+M or /model for roles.`、`Session compacted 1 time`、`Fast mode enabled.` 等）在终端里是对话末尾一行暗色文字、一直留着；TSP 里它是 `main` 末尾的 `toast` 节点（role `omp.toast.status`，ttl 2400），下一帧就换成隐藏的占位。studio 在节点出现的那一帧把文字记进文档（`DocSurface.statusNotes`，`shared/tsp/status-notes.ts`；主进程和渲染进程各应用同一批消息、跟着快照走，所以任务界面晚于 omp 启动才打开时启动那几条也在），画成对话里的一行 `.tsp-status-note`（`--text-3`、`--fs-sm`，停在它出现时前面那个节点后面，之后的内容在它下面），**不再弹 toast 气泡**（§4.23 Toast）；surface 重开时清空。启动时 omp 发的状态行（`xdev: … mounted …`、恢复压缩过的会话时的 `Session compacted N time`）同样留在对话里。
- **过程区文字不汉化**（仓库所有者 2026-10-21：“任务过程中显示的以及常用的命令等不需要进行汉化，汉化主要是针对 UI 界面的设置功能的”，同 §1.2「运行过程的文案」）：`features/tsp/nodes/`、`Clamp.tsx`、`MainFlow.tsx` 里 studio 自己加的文字——`N more lines` / `N earlier lines` / `Show less`、diff 的 `No changes` / `N unchanged lines`、`Copy command`、图片和媒体的提示、工具 / 子代理状态名（`Pending` `Running` `Done` `Failed` `Canceled`）、子代理的 `N req` / `N% context` / `↻ retry a/b in 0:05` / `N tool calls`、待办的 `Todos` / `All done` / `N todos still open`、思考强度和旋转器的 aria 名、`No data`、回顾的悬停提示——都是 omp 原样的英文，两种语言一样，集中在 `features/tsp/labels.ts`，不走 i18n。仍走 i18n 的只有 studio 自己的壳：对话区的无障碍名称 `tsp.layoutRegion`、载入提示 `tsp.loading`、`Jump to latest` 按钮、复制 / 关闭 / 展开这类通用标签，以及选择器、设置（prefs）、toast 关闭提示（`tspi.*`）。
- **omp 弹窗**（`overlay`：`/jobs` `/session` `/usage` `/changelog` `/marketplace`…，2026-10-21）：卡片最高到 tsp-view 的 100%（`max-height`），内容多时在卡片里滚动，头和底部的 Close 行始终在视口内；`Esc` 关最上面一层（把 Esc 键写给 omp，不触发 Composer 的“停止”，见 `docs/architecture/tsp-migration.md` §10.6）。markdown 表格单元格用 `overflow-wrap: break-word`（`/tools` 是 `md` 管道表，名字列不再被挤成一个字宽）；`table` 节点每列也有字数下限（不撑开的列最多按 24 字、撑开的列最多按 12 字算，字宽 `--tsp-cw`）；`/jobs` 的列表与详情顶对齐（`omp.jobs.split` 拉伸），列表（master）列宽跟内容走、最宽三分之一，不出横向滚动条（2026-10-22 起，原来固定三分之一，左边留一大块空列）。omp 的选择器（`picker`）和设置（`prefs`）弹层 2026-10-22 起用 `ui/` 控件画：页签 `.ui-tabs`，按钮 `Button` sm（关闭按钮带 `Esc` 提示），徽标 / 芯片 `Badge`，开关 `Switch`，分段 `.ui-seg` sm，下拉 `.ui-field.ui-select` + `.ui-menu`（当前项打勾），多选项 `ui-btn` + `aria-pressed`；交互和状态仍全由 omp 的节点决定。
- **用户消息的悬停按钮和表情**（2026-10-21）：omp 的 `omp.user.tools`（复制等图标）浮在气泡上方，按钮行 `bottom: 100%` 贴着气泡，和气泡之间的间距用按钮行自己的 `padding-bottom` 补上，鼠标从气泡移到按钮的整条路都在悬停范围内，不会中途消失；带点击动作的图标是 `role="button"` + `tabIndex=0`，Tab 到也显示（`:focus-within`），回车 / 空格触发。气泡上的表情是 omp 的 Agent Reactions（`tui.reactions`，`omp.reaction` 徽章，omp 里也只是展示）：纯 emoji 文本，无底色、无描边、`cursor: default`，不像按钮。

**发送行为**

| 状态 | `Enter` | `Ctrl+Enter` | `Shift+Enter` | 按钮 |
|---|---|---|---|---|
| 空闲 | 发送（`prompt`） | 发送 | 换行 | 发送 ↑ |
| 运行中 | **插话**（`prompt` + `streamingBehavior: "steer"` 或 `steer`） | **稍后**（`follow_up`） | 换行 | 空文本=停止 ■；有文本=并排 发送 ↑ + 停止 ■ |
| 等你确认：审批（§4.17） | 有草稿：**拒绝并发送**；空草稿：不动作 | **批准**（有没有草稿都一样） | 换行 | 同运行中 |
| 等你确认：提问（§4.17） | 不发送 | 不发送 | 换行 | 发送键禁用 |

运行中发消息必须指明行为：wire 里 `prompt` 的 `streamingBehavior?: "steer" | "followUp"` ✔ 存在，`rpc.md` 说流式中缺省会失败（两份方案均引用；以 `rpc.md` 为准）。设置页可对调 `Enter` 与 `Ctrl+Enter` 在运行中的含义。

**SendStop 按钮（32×32，`--radius-pill`）**

| 状态 | 视觉 | 行为 |
|---|---|---|
| 空闲 + 空 | `--bg-active` 底、`--text-disabled` 箭头，不可点 | — |
| 空闲 + 有内容 | `--primary` 底、`--text-on-primary` ↑ 16px；hover `--primary-hover`（和主按钮一致，强调色只留给进行中和焦点） | 发送 |
| 发送中 | 14px 细旋转环（reduced：`…`），不可点 | — |
| 运行中 + 空 | `--text` 底、`--bg-app` 色 12px 实心方块 | 停止（`abort_and_restore_queue`） |
| 运行中 + 有文本 | 左：停止（32 描边按钮）；右：发送 | 见上表 |
| 停止中 | `composer.stopping`，不可点，直到 `agent_end`/`prompt_result` | — |
| 发送失败 | 按钮上出现 `--st-error` 小红点；错误见 UserMessage | — |

**停止**：`Esc`（见 §5.2 栈）调用 `abort_and_restore_queue`，响应里的 `steering`/`followUp` 按原文**追加**回输入框草稿（空行分隔，图片作为附件恢复）；`imagesDropped` → toast `composer.imagesDropped`；toast `composer.queueRestored`（无排队消息则只显示“已停止”）。

**ModelChip**：`.ui-chip`（§4.23；2026-10-22 起无底色，悬停 / 打开时 `--bg-hover`，原来常驻 `--bg-hover` 底），`--fs-sm` `--text-2`；2026-10-22 起拆成两颗挨着的 `.ui-chip`（外层 `chip-model`，`model-chip-group`；2026-10-22 起名字在前、刻度在后，原来刻度在前）：右边是**档位刻度**（`chip-thinking`，模型不支持思考时不出现）——这个模型的每个 effort 一根竖条（不算 `off`；2px 宽、间隔 2px，从低到高 4 → 12px），当前档及以下亮、`off` 全灭；亮条的颜色按档位变“热”：minimal / low `--text-2`，medium `--accent`，high `--accent` + 1.5px 柔光，xhigh / max 由 `--accent` 渐变到 `--st-waiting`、光晕更强；切档时逐根点亮（每根延迟 30ms）；任务运行中亮条从低到高波动，档位越高越快（medium 1600ms → max 700ms，`--play-state` 控制，reduced-motion 停住）。点刻度或 `Alt T` 换下一档，悬停提示 `composer.effort`（`思考强度：高（4/6）`）+ `Alt T`。左边是模型名（去 provider 前缀，>22 字符省略；原来的文字强度“· 高”去掉）。末尾没有 `⌄`（3.0 加的 12px `.chip-caret` 在 2026-10-21 去掉）。点击或 `Alt M` 打开 ModelPicker（见下，3.1，`direction-3.1.md` §2 行 10）。两颗按钮按下时不抢焦点（`mousedown` 阻止默认）：鼠标点开再关掉，焦点回到原来的输入框，胶囊上不留焦点框（2026-10-22 起）；键盘 Tab 到胶囊上的照常有焦点框、关掉后回到胶囊。`Alt T` 循环强度（`cycle_thinking_level`）。运行中可切换，提示 `composer.nextRequest`。数据：`get_available_models`、`set_model`、`set_thinking_level`、`get_state.model/thinkingLevel`。

**ApprovalChip**：见 §5.8。

**ModelPicker**（3.1 起照 Tern 改成一张表，`direction-3.1.md` §2 行 10；2026-10-22 起换成 `ui/Dialog`）：胶囊点开（`Alt M`、命令面板同）是 `ui/Dialog` lg 再加宽到 `--dialog-w-xl` 960（`className="mp-dialog"`，`data-testid="model-picker"`；遮罩、Esc、Tab 循环、关闭后还焦点按 Dialog 通则，§4.23），贴着窗口上方 8vh 放（`align-self: flex-start`），高度跟右栏内容走：正文最低 360、整框最高 `min(84vh, --content-w)`，表自己滚；左栏 `contain: size` 不撑高度、自己滚；打字过滤时只有下沿动，搜索框不跳（2026-10-22 起；原来定高 `min(85vh, --content-w)`，行少时下面一大片空白）。2026-10-22 起照 Tern 里 omp 的 `/models` 排：顶上搜索框，下面两栏——左栏范围，右栏表 + 底部；搜索框和底部固定、表自己滚：
- 顶栏（Dialog 的 `head`：没有标题和 ×，`model.title` 只作读屏名，Esc、点遮罩关闭；2026-10-22 起，原来是标题行“切换模型” + ×）：搜索框 `TextField` md（通宽，前面放大镜，`model-search`，占位 `model.search`，打开时聚焦，`combobox` + `aria-activedescendant` 指向选中行）+ 给角色选模型时的标记（`model-role-target`：accent `Badge`：角色图标 + `model.roleTarget`“为 Task 选模型” + 小 × `model.roleTargetClear` 改回用于此任务）+ 右端总数（`model-count`，等宽 `--fs-xs` `--text-3`；有搜索词时 `匹配数 / 总数`）。
- 左栏范围（`.mp-side`，宽 `--sidebar-w-min` 200，右边一条 `--border-subtle`；项的样子同设置页左栏 `.snav-item`：高 `--row-task`、选中 `--bg-active` 底，右端等宽计数）：`model.rolesGroup` 角色（`model-scope-roles`）、`model.all` 全部模型（`model-scope-all`，默认）、小标题 `model.providers` 下各提供商（`model-scope-provider`，按名称排，和表里的分组同序；正在生效的模型所在的提供商后面一个 6px `--accent` 圆点）（“添加提供商…”在页脚左边，见下）。角色范围列 omp 的角色（Default / Smol / Slow / Plan / Task / Commit / Advisor，外加 `modelRoles` 里指向可用模型的其它角色；数据 `getModelRoles(projectId)`），这时搜索框过滤角色。点一个角色 = 之后选的模型给它：回到全部模型，顶栏出现角色标记。Default 是切换本任务的模型（草稿里是新任务默认模型）；其它角色选模型就写 `modelRoles.<role>`（`setModelRole`，遵循 `modelRoleStorage` 的全局 / 项目层，去掉 `:thinking` 后缀），不影响当前会话。（角色 2026-10-20 起有；原来在标题下的 `ui/Tabs` 页签里，2026-10-22 起挪进左栏）
- 表：模型列没有表头，数字列表头照 omp 原文 `Int` | `t/s` | `Ctx` | `$/M`（`model.colIntelligence` / `.colSpeed` / `.colContext` / `.colPrice`，中英相同；2026-10-22 起）+ 勾，表头粘在顶部（`--fs-xs` `--text-3`）。模型列 = `provider/`（`--text-3`）+ 模型 id（`--text`），`--font-mono` `--fs-code-sm`，后面跟它被分配到的角色，只画图标（`mp-role-badge`：20×18、`--bg-hover` 底、`--radius-sm`，12px 角色图标，悬停提示 `@角色：用途`；2026-10-22 起，原来是写角色名的胶囊）。数字列按 px 定宽（36 / 40 / 48 / 88，表头和行共用 `--mp-cols`；2026-10-22 起，原来按 `ch` 定，表头和行字体不同、算出的列宽不同，表头和数字对不齐），等宽 `--fs-code-sm` `--text-2` 右对齐：智能分（`get_available_models` 每个模型带的 `int`，取整：omp 按 provider 的各种写法归一后查模型目录，和 omp 自己的 `/models` 一致；2026-10-22 起，原来 studio 按 provider/id 原样查 `models.db`，中转站和改过写法的 provider 大多查不到、显示 `–`，实测 omp 18.12.6）、速度（omp `agent.db` `model_perf` 实测的 t/s，没有实测时用 `get_available_models` 带的 `tps`，取整）、上下文（如 `1M`）、价格（输入·输出，美元 / 百万 token，如 `$0.3·1.2`）；没有数据写 `–`，智能分和速度读取中写 `…`（两个库都只读，`getModelInsights`，`src/main/omp-config/model-insights.ts`）。行高 `--control-h-md`、`--radius-md`；悬停行 `--bg-hover`；选中的行（点击、↑↓；打开时是当前模型）`--bg-active`；当前模型（给角色选时是该角色的模型）右端 14px `--accent` ✓。
- 分组（组头 `--fs-xs` 500 `--text-2` + 等宽 `--text-3` 计数）：全部模型范围、没有搜索词时 `model.pinned`（`常用`：当前模型、各角色绑定的模型、最近用过的 3 个，去重；打开时定下来，选了别的模型行也不跳）在前，其余按提供商分组（组头是 provider 名 + 计数，组内按名称排序）在后；提供商范围只列它的模型、不单列常用；有搜索词时（名称、provider、模型 id 包含即可）只有一组 `model.matches`（`匹配`）。角色范围、或搜索框以 `@` 开头时表里列角色（组 `model.rolesGroup`）：每行角色图标（`RoleIcon`，14px `--text-2`：default 星、smol 闪电、slow 沙漏、plan 地图、task 多人、commit 提交、advisor 灯泡，其它角色一个标签；2026-10-22 起）+ `@角色` + 它绑定的 `provider/id`（没设置写 `model.roleUnset`）和那个模型的数字列，悬停提示角色用途（`model.role.hint.*`）；选中 = 之后给那个角色选模型（见左栏），清空搜索、回到全部模型；没有匹配写 `model.noRoles`。
- 选中与应用（2026-10-22 起；原来点击就切换、对话框不关，每点一下都等 omp 往返，选的时候卡）：焦点留在搜索框，↑↓ 移动选中行；点击只是选中，参数行和思考强度跟着选中的模型走；双击、Enter 或页脚主按钮才应用：先关对话框，切模型和设思考强度在后台按顺序做（失败弹 toast），只有在分段条上点过档位才设思考强度（没点过由 omp 把原档位钳到新模型上）。Esc、“关闭”、点遮罩放弃，什么都不写。
- 底部（`.mp-foot`）：①参数行（`ModelDetails`，等宽 `--fs-code-sm`，标签 `--text-3`）：高亮行模型的 `上下文 1M`、`输出 393K`、`价格 $0.3/1.2 每百万`（全 0 写 `model.free`）、`推理 支持 / 不支持`，后面胶囊 `视觉`、`当前`（`--accent-soft` 底 `--accent` 字）和绑定的角色；放不下的在悬停提示里：`provider/id`、`压缩于`、完整上下文、完整价格（`输入 $4 · 输出 $20 · 缓存 $0.2（每百万 token）`）、`实测速度`、`智能分`、`输入类型`。`压缩于` = `触发 token · 怎么来的 · 来源`（如 `315,000 · 窗口的 90% · 全局设置`），按 omp 的 `compaction.thresholdTokens / thresholdPercent / reserveTokens / modelThresholds` 规则算（`src/shared/compaction-trigger.ts`），来源是全局 / 项目（项目目录里读到的和中性目录不同）/ 按模型设置。`实测速度` = `t/s · 首字 s · N 次采样`，只有模型目录的 `tps` 时写 `model.perf.catalog`，都没有写 `model.perf.none`。没有高亮行时写 `model.noSelection`。下面三行控件（`.mp-ctl`：88px 标签列 + 内容，左缘对齐）：②`思考强度` + 分段条（`ThinkingSegments`，`ui/Segmented` md、每档等宽至少 56px，`thinking-segments`；2026-10-22 起跟着选中的模型走、点了只记下，应用时才发，原来 sm、只对正在生效的模型可调、点了立即发：正在生效的模型列 omp 报的档位，其它模型按模型目录的档位（任务里 omp 报了 `off` 时也列 `off`）；亮的是点过的档位，没点过是现在的档位，这个模型没有那一档时按 omp 的规则钳到最近的；不支持思考写 `model.thinking.unsupported`；运行中加 `composer.nextRequest`）+ 速度开关（见下）；给角色选模型时这一行换成两句：`model.roleUse`（`用于 {用途}`）和 `model.roleSaved`，列角色时只有 `model.roleUse`（选中角色的用途），后两行都不出现；③Prewalk、④预设（任务里才有，见下“会话开关菜单与模型预设”⑦）。**页脚**（Dialog 页脚，2026-10-22 起）：左边 quiet md 按钮 `model.addProvider`（带 +，`model-add-provider`：关对话框、跳设置页“Provider 与订阅”；原来是左栏底部的 sm 按钮，太小），右边次要按钮 `common.close`（`model-close`）+ 主按钮 `model.use`（`用于此任务`：应用选中的模型和档位并关闭，都没变就只关闭；没有选中行时禁用；**只管这一个任务、不写配置**：任务里切这个会话的模型和档位，草稿里记给即将建的任务（`composer/draft-model-choice.ts`，草稿胶囊随即显示它），发第一条时以 `--model` / `--thinking` 起进程，2026-10-22 仓库所有者定，原来草稿里是改 omp 的默认值）；`@` 列表或角色范围里主按钮是 `model.pickRole`（`为它选模型`：点角色行同，转到给它选模型，表里选中它现在的模型），给角色选模型时是 `model.applyRole`（`应用`：一律写全局 `modelRoles`，所有项目共用，不动正在运行的会话；原来是 `应用角色`，按 `modelRoleStorage` 可能写项目文件）。

分段条只列这个模型实际支持的档位：任务里取 `get_available_thinking_levels`（含 `off`），草稿里取模型的 `thinking.efforts`（不含 `off`）；分段条、方向键、`Alt T` 共用同一份列表和顺序；草稿的胶囊显示 omp 钳制后实际采用的档位。**胶囊上的思考强度是乐观更新**：点刻度 / `Alt T` / 对话框应用后立即显示新档位，omp 往返在后台，失败退回并报错，写入成功 2 秒内新值没回到界面也退回真实值。分段条就是普通的 `ui/Segmented`（§4.23；2026-10-22 起，原来按档位分级的弹簧滑块和光晕动画已去掉）。胶囊上的强度文字按档位分级（`.chip-level[data-level]`：`off` / `minimal` `--text-3`，`high` `--accent` 加粗，`xhigh`/`max` 渐变字，`max` 缓慢流动）；流动动画写 `animation-play-state: var(--play-state)`，减少动效时不流动。数据来自 `get_available_models`（`ModelOption`：`contextWindow`、`maxTokens`、`cost`、`reasoning`、`acceptsImages`、`thinkingEfforts`）。

**ContextMeter**（发送键左边、费用之前，2026-10-19 起从模型胶囊旁移过来）：只有一个 20px 的上下文圆环（描边 2.5，`get_state.contextUsage.percent`，≥90 变 `--st-waiting`），不写文字；百分比在 `aria-label` / 悬停提示里（`composer.context` + 已用/总量 + `composer.context.tip`）。悬停和打开时按钮只加 `--bg-hover` 底，圆环本身的颜色和粗细不变。点开 `ContextBreakdown`（`Popover`，`align="end"`，Esc 关闭并还焦点，不触发"停止"；数字照 omp 的 `/context`，2026-10-22 起直接读 omp 算的）：头一行已用/窗口/百分比，一条完整的圆角横条（底色轨道 = 整个窗口，各段按占窗口的百分比宽度填色，段间 1px 露出底色把同色系的相邻类别分开，极小的段至少 2px，剩余空间就是轨道底色）+ 每类一行 `[色块][名称][token][占窗口%]`。**任务里**：类别、名称、顺序和 token 数都是 omp 的（System prompt / System tools / System context / Skills / 消息 / 剩余空间 / 自动压缩预留；omp 以后加的类别照样显示，用中间色）：打开浮层时主进程点 omp 输入框上的 meter，读完 omp 弹出的报告再点它的 Close 关掉（运行中也能读，不打断这一轮），读的期间不画 omp 的 layer，界面上不出现 omp 的弹窗；每个任务记住上次的报告，再打开先显示它、omp 现算的到了再换；第一次读还没回来时数字行位置显示 `composer.context.reading`，读不到（omp 不在运行、正在等回答 / 审批、子代理面板正在驱动 omp）显示 `composer.context.unavailable`。**新任务草稿**：已用 0，只有剩余空间和自动压缩预留（= 窗口 − 按 omp 规则算出的压缩触发点，`compaction-trigger.ts`；压缩设置按项目记住，圆环一出现就预读；从没读到过时不画这段）。有数字时下面没有说明小字。浮层打开时读会话文件（`getSessionModelUsage`）；**读到了按模型的用量（或读取出错）才有“会话用量”**，任务里还没有回复时没有这个按钮，浮层只有构成一栏（2026-10-22 起；`ModelBreakdown.tsx` 的 `hasModelUsage`）。有的时候构成下面最后是 `composer.breakdown.toggle`（“会话用量”，`session-usage-toggle`，`aria-expanded`；2026-10-20 起是无边框的文字链接，左边一个 `<`，展开后箭头翻成 `>`；压缩走 `/compact` 和命令面板）：点开后浮层向左加宽，构成留在原位，左边多出一栏 `ModelBreakdown`（`session-usage`，中间一条 `--border-subtle` 竖线）：头一行标题 + 本会话 token 总数（`get_session_stats`）；按 provider/model 合计输入、输出、缓存读写、费用，范围同 omp（当前分支，最近一次压缩保留下来的部分）；压缩过时另起一行写整个会话的合计。再点收回。omp 还没给出上下文占用时同一位置是不能点的空环（`data-pending`）。

**UsageMeter**（输入框工具行里，审批胶囊之后）：只剩输出速度（见下），不在运行中时不渲染。

**UsageDialog**（点发送键左边的费用打开，2026-10-19 起是居中对话框；2026-10-22 起是 `ui/Dialog` lg 再加宽到 `--dialog-w-xl` 960，`className="usage-dialog"`，`data-testid="usage-dialog"`，遮罩、Esc、Tab 循环、关闭后还焦点按 Dialog 通则，§4.23）。**没有页签**（2026-10-21 所有者定：原来的“订阅额度 / 每日用量”两页合并成一页）：标题 `composer.usage.overview`；标题行右边只有 ↻ 图标按钮（`IconButton`，`usage-refresh`，额度和热力图一起重读，读取中禁用）和 ×。**更新时间在 ↻ 的悬停提示里**（2026-10-22 起，标题行不再单独写一行字）：`usage.refresh` · `usage.updated.*`（如“刷新 · 7 秒前更新”，`useNow` 每秒重算；额度还没读到时只有“刷新”）。打开时焦点在 ×。正文一页内容（`.qm`，纵向排列，段间 `--space-5`）：先汇总条（2026-10-22 从原来的设置 → 用量页搬来，`usage-summary`：一个带 `--bg-sunken` 底的圆角卡，四格竖线分隔：`最紧的额度`（`usedFraction` 最大的窗口，大字 `剩余 76%`，小字 `窗口名 · provider`）、`过去一年`（花费 + 请求数）、`最近 30 天`（花费 + 30 根迷你柱 + 请求数）、`最忙的一天`；容器 <640px 变 2×2；算法在 `src/shared/ui/usage-summary.ts`，有单测；额度和热力图都没有数据时不画），再额度（`data-testid="quota-section"`），再最近一年（365 天）的每日用量热力图（`data-testid="heatmap-section"`；2026-10-21 起不带小标题，原来的“每日用量”标题由仓库所有者定去掉）。**高度跟内容走**（2026-10-22 起，原来固定 `min(80vh, 620)`）：没有额度账号时下面不留空；窗口矮了由 Dialog 正文滚动（Dialog 最高 `100vh − 96px`）。额度：各订阅账号的额度，当前 provider 排最前；每个账号一张卡（`.uq-block`，`--bg-raised` + 1px `--border-subtle` + `--radius-lg`，卡间 `--space-3`）：头一行 状态点 + provider（粗）+ 账号邮箱/备注（`--text-3`）；卡内窗口按 `repeat(auto-fill, minmax(16rem, 1fr))` 排成两列（窄了一列），每个窗口两行：第一行 名称（`--text-2`，占满剩余宽度）+ `--text-3` 的重置时间 + `剩余 N%`（`--text`，tabular，用尽 `--st-error`、warning `--st-waiting-text`），**重置时间在剩余的左边**，二者右对齐；第二行整宽 6px 进度条（`--accent`，warning `--st-waiting`）；未使用的账号合成一行 `未使用 · provider…` 放在最后。组件和样式都在 `features/composer/`：`usage-views.tsx`、`usage.css`、状态 `usage-store.ts`（2026-10-22 设置页的"用量"一节删掉后从 `features/settings/` 搬来）；`/usage`、命令面板"用量"打开的也是这个对话框（`usage-store` 的 `setUsageDialogOpen`）。每日用量：全年（53 周）热力图（`HeatmapView`，始终占满宽度）**占满对话框内容宽度**：格子边长由 `ResizeObserver` 按容器宽度和周数算出（`--uq-cell`，上限 24px，间距 3px），星期标签、月份标签跟着对齐，不出横向滚动条，右侧不留空白；只按花费着色，没有 token / 花费 / 请求数切换，悬停给日期、金额和请求数。打开时重读额度，热力图还没有数据时才读。没有"去设置看全年"的入口。

新任务草稿（`DraftComposer`）的工具行同一位置放 `DraftContextMeter`：还没有会话，圆环是 0，窗口取胶囊上默认模型的 `contextWindow`（模型还没读到或没报窗口时是不能点的空环），构成里只有消息 0、剩余空间和自动压缩预留，没有“会话用量”。费用显示 `$0.00`，同样能点开 `UsageDialog`（额度按默认模型的 provider 排序）。

**速度开关与指示**（`get_state.fastModeEnabled/fastModeActive/slowModeSupported/slowModeEnabled/slowModeScope`；命令 `set_fast_mode` / `set_slow_mode`）：ModelPicker 底部控件行里、思考强度右边（3.1，`direction-3.1.md` §2 行 10），只在高亮行是**正在生效的模型**时出现（草稿里没有任务，不出现）。两个开关在一行里排开，每个是标签 + `ui/Segmented` sm 两段（`model.off` / `model.on`；2026-10-22 起，原来是自绘的分段），方向键切换，说明在悬停提示里。`快速模式`始终可点（悬停 `model.fast.hint`；RPC 没有“是否支持”字段；不支持的模型 omp 返回错误 `Fast mode is unavailable for the current model.`，原文进 toast）。`慢速模式`只在 `slowModeSupported` 时出现，悬停提示说明范围：`global` → `model.slow.scope.global`（写进 omp 配置，所有会话共用），`session` → `model.slow.scope.session`；不支持时这里只写 `model.slow.unsupported`。ModelChip 模型名后面：`fastModeActive` 为真时一个 12px 实心闪电（`chip-fast`，`--st-waiting`，2026-10-22 起；原来是 `快速` 文字小胶囊，悬停提示仍写 `{模型} · 快速`）；慢速开着时 `--fs-2xs` 的 `--accent-soft` 小胶囊 `慢速`；都关时不显示。实测（Tern omp，临时 agent 目录）：fast 只对本会话有效，**不落配置**，切到不支持的模型会自动关；slow 在 Anthropic 模型上 scope 是 `global`，**落在 omp 配置里**并跨进程保留（`session` 范围对应 OpenAI/Google 的 flex 层级，未能实测）。studio 不存副本；键入的 `/fast`、`/slow` 照常走 omp，本地完成的斜杠命令（prompt 应答 `agentInvoked:false`）之后主进程会重读 `get_state`。

**输出速度**（`get_state.tokensPerSecond`）：UsageMeter 末尾一项，等宽 `--text-3`，`composer.usage.tps`，只在任务运行（running / needs_you）且值为有限正数时显示。实测 omp 在一条回复流式输出期间给 `null`，回复结束（message_end 之后）才有值，所以运行中显示的是上一条回复的速度；主进程在 `message_end` 等事件后按 1 秒节流重读 `get_state`，不另外轮询。

**SlashMenu**：行首 `/` 打开，浮在输入框上方，行高 32，最多同时显示 8 行，更多的在菜单内滚动（`↑↓` 选中行始终可见），`[/名称][描述 --text-3]`，`↑↓` 选，`Tab/Enter` 补全，`Esc` 关闭；数据 `get_available_commands` / `available_commands_update`，加上 studio 接管的命令（`studio-slash-table.ts`：`/new /resume /settings /hotkeys /git /rename /delete /model /effort /usage /context /export …`，描述 `slash.*Desc`，发送后开 studio 自己的界面而不是 omp 的终端弹窗；TSP 任务和新任务草稿页各取其中能用的子集）。任务输入框和新任务草稿页都有这个菜单。无匹配 `slash.empty`。

**斜杠命令守卫**：草稿以 `/名称` 开头、命令列表已载入（非空）、而 `名称`（含别名）不在 `get_available_commands` 里时，第一次发送不发出，输入框上方出现一条提示（`.suggest` 样式）+ `slash.sendAnyway` 按钮；对同一段文字再按一次发送键或点按钮才作为普通文字发出，改动文字提示即消失。终端版独有的命令（`plan` `copy` `hotkeys` `settings`）提示 `slash.terminalOnly`，其余未知命令提示 `slash.unknown`。列表未载入时不拦；`/usr/bin` 这类带第二个 `/` 的不算命令。判定在 `slash-guard.ts`。omp-studio 自己接管的斜杠命令（`studio-slash-table.ts`：`/goal`、`/tree`、`/fork` 等）在菜单和守卫里都算已知命令，发送时由 studio 处理、不发给 omp。


**BtwPanel**（旁路提问，`/btw [问题]` 或命令面板“旁路提问（/btw）”打开，`features/btw/`）：停在输入框正上方、宽 = 列宽、`margin-bottom: --space-2` 的卡片（`--bg-raised`，`1px solid --border`，`--radius-lg`），高度不超过对话区 45%，内部滚动。头部一行：`旁路提问`（`--fs-xs` medium）+ 回答中时一个 accent 带点 `Badge`（`btw.status.running`，`btw-running`）+ 右侧“新话题”（`+`，有选中话题时才有）和关闭（`✕`）两个 `IconButton`；有多个话题时下面一行话题 `ui/Tabs`（2026-10-22 起，`btw-topics`；页签文字是问题首行截断，悬停是完整问题）；正文是选中话题的问答：问题 `--fw-medium`，答案用 Markdown 流式渲染（`--fs-sm`），已取消/出错/中断在答案后加一行 `--fs-xs` 状态词（出错红字，悬停是 omp 给的原因）；底部一行 `TextField` sm（`btw-input`，占位 `btw.placeholder` / 有话题时 `btw.placeholderFollowUp`）+ sm 按钮 `提问`（`btw-send`），提问进行中按钮换成 danger sm 的 `取消提问`（`btw-cancel`）。**不进主对话流**；主轮在跑时也能问；omp 同一时刻只许一条在跑，所以提问中不能再发。输入框默认对当前话题追问（`recordId`），点“新话题”后下一条开新话题；`/btw 问题` 总是开新话题。`Esc`：提问中 = 取消提问（`btw_cancel`），否则关闭面板并把焦点还给打开前的元素；输入法选词时的 `Esc` 不处理。面板打开时向主进程对齐一次历史（`get_btw_history`，随会话落盘，恢复任务后仍在）。没有进程的任务打开面板不会拉起 omp（只显示主进程已知的记录），第一次提问才拉起。语义和实测见 `docs/architecture/conversation.md`「旁路提问」。**TSP 任务（2026-10-21）**：同一个面板、同样的外观和按键，挂在 `TspView` 和输入框之间（`App.tsx` 的 TSP 分支）；omp 自己的旁路提问弹窗（role `omp.overlay.btwHistory`）不画，问答由主进程从弹窗读出、话题 id 和历史读会话旁边的 `btw-history/`，提问 / 追问 / 取消是主进程在后台对弹窗发的事件（回答收尾后自动关弹窗），见 `docs/architecture/tsp-btw.md`。

**输入历史**：输入框为空（或光标在最开头）时 `↑` 翻看本任务发过的消息（最近的在前），`↓` 往回走，翻过最新一条恢复翻看前的草稿；翻看中 `↑` 要光标在第一行、`↓` 要光标在最后一行才接管，否则照常移光标。斜杠菜单/`@` 菜单打开时 `↑↓` 归菜单；刚翻出来的那段文本不开菜单，免得抢走后面的 `↑↓`。能翻的条目（2026-10-22 起，像终端里的命令历史）= 会话里的用户消息（omp 文档里的 `omp.user`，含恢复的旧会话、草稿页发出的第一句；`shared/tsp/user-messages.ts`）+ studio 记下但 omp 没画成用户消息的发送（斜杠命令、排队中、刚发还没回显的；只存在渲染进程内存，每任务最多 100 条），按发送顺序合并、相邻重复只留一条（`input-history.ts` 的 `mergeEntries`）。新任务草稿没有历史。

**FileMenu**（`@` 文件引用）：光标前的词以 `@` 开头（文本开头或空白之后）时，在输入框上方打开和斜杠菜单同款的菜单，每行一个相对路径（文件名 `--font-mono`，目录部分 `--text-3`），最多同时显示 8 行（超出滚动），`↑↓` 选，`Tab/Enter` 把 `@词` 换成 `@相对路径 `，`Esc` 关闭（到这个 `@词` 变化为止），空查询列出浅层文件。数据 `listProjectFiles({ kind: "task", taskId } | { kind: "project", projectId }, query)`：主进程按任务（新任务草稿按项目目录）查出 cwd，优先 `git ls-files -co --exclude-standard`，不是仓库时退回有界遍历（广度优先，跳过 `node_modules`、`.git`、符号链接）；缓存 10 秒，最多索引 10000 条，每次最多返回 20 条（前缀 > 文件名前缀 > 文件名包含 > 路径包含 > 子序列），只返回相对路径，含空白的路径不收；`query` 含绝对路径或 `..` 时 reject。引用本身由 omp 展开成 `fileMention` 消息，studio 只做补全。

**会话树与分叉**（`SessionTreePanel`，`App.tsx` 在 `TspView` 旁挂它；数据与动作见 `docs/architecture/session-tree.md`，实测 omp 18.12.5）：2026-10-22 起外壳是 `ui/Dialog` md（`data-testid="session-tree"`，标题 `tree.title` + ×，Esc / 点遮罩关闭并还焦点，Tab 在框内循环，打开时焦点在节点列表上；原来自绘的面板外壳已删）。①节点只读 omp 会话文件（不拉起进程），叶子 = 文件最后一个条目；当前叶子所在行有 accent `Badge` `tree.current`；②选中 = 驱动 omp 自己的 `/tree`（同一个会话文件里移动叶子，不新建文件，原来的分支留在文件里，omp 重画对话），文字追加进输入框；③每行右侧悬停/选中时出现“从这里分叉”`IconButton`（`session-tree-fork`，`tree.fork`；`Shift+Enter` 同效），新任务由 `omp --fork=<原会话文件>` 起、再在新进程里回溯，期间对话框标题换成 `tree.forking`，成功后关对话框并选中新任务（页脚左侧有勾选框 `tree.summarize`（`Checkbox`，`session-tree-summarize`，有节点时才有）：勾上后选中 = 让 omp 先给被放弃的分支写摘要再回溯，期间标题 `tree.summarizing`，对话框保持打开）；④omp 在用户消息卡片上画的“回退”图标（`actions.click: "rewind"`）由 studio 接管：点它打开这个对话框并把光标放在对应的那条消息上（按卡片从末尾数第几张对位），不把 `rewind` 发给 omp；⑤`/tree`、`/fork`、命令面板“会话树”都能用；`/fork` = 从当前分支最后一条用户消息分叉。

**会话开关菜单与模型预设**（S4，`features/session-toggles/`，语义和实测见 `docs/architecture/session-toggles.md`）：①输入框工具行里当前文件夹（`composer-folder`）右边一颗滑杆图标胶囊（2026-10-22 仓库所有者定，原来在审批胶囊右边；`.ui-chip.tg-button`，`toggles.button`，`data-testid="toggles-button"`），点开 `Popover`（宽 380，英文里浏览器窗口那一行的名称和说明不被挤成一窄条）：顶上一行 `--fs-xs` 说明（`toggles.note`：扩展上下文和浏览器窗口会写进 omp 的配置、以后的任务也用，其余只对本会话生效；圆点 = 和默认值不同。2026-10-22 起，原来笼统写“只对本会话生效”，实测 omp 18.12.6 这两项写配置），然后每行 `名称 + 一句短说明（--text-3，十几个字以内，2026-10-22 起）`、右侧 `ui/Switch`：Skill 清单、扩展上下文、电脑操作、顾问模型；浏览器窗口是“可见 / 后台”两段 `ui/Segmented` sm，和其他行同一种排法：名称和说明在左，“本会话”标记和分段控件在右、上下居中（说明长了在左侧换行）。Prewalk 2026-10-22 起不在这个菜单里，挪进模型选择器（见⑦后的 Prewalk 一行）。②**状态**：`TaskState.sessionToggles`（`{skillful, extendedContext, computer, advisor, browser, prewalk}`，`null` = 本会话没动过）由 `TspRunner` 在每次文档变化时读新出现的状态 toast（`statusNotes` + `omp.toast.status` 节点）用 `parseToggleToast`（`shared/omp-output/toggles.ts`，omp 18.12.5 原文入测）解析得到，所以用户在输入框里自己敲的 `/skillful` 也同步；新进程从头开始。没动过的开关显示 `omp config list --json` 的配置默认值（`skillful`、`extendedContext`、`computer.enabled`、`advisor.enabled`、`browser.headless`、`prewalk.enabled`），值读不到时按关显示、不画圆点。③**标记**：开关的值来自本会话的命令时，行上有 accent `Badge` `toggles.session`（“本会话”）；和配置默认值不同时，名称后一个 6px `--accent` 圆点（`role="img"`，`aria-label` = `toggles.differs`），胶囊角上同样亮一个圆点（`data-differs`）。快速 / 慢速 2026-10-22 起不在这个菜单里，只在模型选择器。④**电脑操作**：开启（菜单里点开关或 `/computer on`）先把同一个 `Popover` 换成确认页（`kind="confirm"`：标题 `toggles.computerConfirmTitle`、正文 `toggles.computerConfirmBody`：模型将能看屏幕、操作键鼠，只对本会话生效；sm 按钮 `common.cancel` + 主按钮 `toggles.computerConfirmYes`），确认才发命令，取消不发；关闭直接执行。⑤动作一律是封闭的 `TaskCommand`（`toggle` / `browserMode` / `prewalk` / `modelPreset`，主进程拼成 `/skillful on` 等文本，渲染进程不发自由文本）经 `runTaskCommand`；同一时间只有一条命令在飞（菜单里其余控件禁用）；omp 的拒绝（如“当前模型没有 /fast 的服务层级”）作为错误 toast 原文显示，认不出的回话（用法提示、预设保存结果）作为 info toast 原文显示。⑥**斜杠命令**：`/skillful` `/extended-context` `/computer` `/advisor` `/browser` 不带参数（或 `status`）打开这个菜单，`/prewalk` 不带参数（或 `status`）打开模型选择器；带 `on` / `off`（`/browser visible|headless`、`/prewalk restart|off`）直接执行，其中 `/computer on` 先弹确认；参数不认识抛出用法（草稿放回输入框）。`/modelpreset`（无参数 / `list`）打开模型选择器；`/modelpreset save|switch|delete <名字>` 直接执行：`save` 的新名字只许字母、数字和 `. _ -`（`presetNameUsable`）；`switch` / `delete` 的已有名字可以含空格（`presetRefUsable`，见下）。这些命令都由 studio 接管。⑦**模型选择器的 Prewalk 一行**（`session-toggles/PrewalkSection.tsx`，`data-testid="model-prewalk"`，任务里才有；2026-10-22 仓库所有者定，从会话开关菜单挪来，为的是看得到从哪个模型换到哪个）：在思考强度和速度开关之后、预设之前，占满一行（`.tg-prewalk`）：`Prewalk` 标签 + 说明 `toggles.prewalk.plan`（“先用 {当前模型} 规划，第一次改文件时换成 {smol 角色的模型}”）+ 三个 sm 按钮“启用 / 重来 / 关闭”（`prewalk-arm` / `prewalk-restart` / `prewalk-off`，对应 `/prewalk`、`/prewalk restart`、`/prewalk off`）；smol 角色没设置（或不在模型列表里）时说明换成 `toggles.prewalk.noSmol`，和当前模型相同时换成 `toggles.prewalk.sameModel`，这两种情况“启用 / 重来”禁用，“关闭”照常可点。omp 对 prewalk 的最近一次回话原文（`sessionToggles.prewalk`）显示在下一行（omp 没有 prewalk 状态查询，`/prewalk status` 是用法错误，只能记最后一句）。**模型选择器的“预设”一节**（`PresetSection.tsx`，`model-presets`，任务里才有，草稿没有）：在 Prewalk 之后；配置项 `modelPresets` 有预设时是一个 `Select` sm（宽 240，`model-preset-select`，占位 `toggles.presets.choose`；每项名字 + 附注“模型 · 思考强度”），没有时写 `toggles.presets.empty`。选一个 = `/modelpreset switch <名字>`（omp 文档 models.md：按 `modelRoleStorage` 把各角色的模型写进配置、预设的思考强度写全局配置，并把当前会话切到预设的默认模型——**不是只对本会话生效**），成功后重读配置快照并关闭选择器。右边 quiet sm 按钮 `toggles.presets.save`（“把当前设置存为预设…”，`model-preset-new`）把这一行换成名字输入框（`TextField` sm，`model-preset-name`，自动聚焦）+ sm `toggles.presets.cancel` + 主按钮 `toggles.presets.saveConfirm`（`model-preset-save`，名字为空时禁用）；Enter / 保存 = `/modelpreset save <名字>`（omp 自己写全局配置），之后重读配置快照；名字不合规时输入框标红，下面一行 `ui-help` 错误字 `toggles.presets.nameInvalid`。**带空格的预设名可以应用**（omp 18.12.5 实测：`/modelpreset` 把参数按空白切开再用单个空格拼回名字，`/modelpreset switch my preset` 切换成功；`delete` 同理）；只有含连续空格、首尾空白或控制字符的名字 omp 经命令找不到（`a  b` 回 `Preset not found: a b`），这样的预设在下拉里照常列出，附注换成 `toggles.presets.nameUnusable` 说明原因（需在 config.yml 里改名），选它不执行。注意 omp 的 `save` 自己只收 `^[a-zA-Z][\w-]*$`，所以通过界面存不出带空格的名字，带空格的预设来自手写配置。

### 4.15 JumpToLatest 药丸

仅当用户脱离吸底且有新内容时出现；对话区底部居中、距底部栈顶 `--space-3`，高 32，`--radius-pill`，`--bg-overlay`，`--shadow-2`，文案 `scroll.latest`；点击或 `End`/`Ctrl+End` 回到底部并重新吸底。

**对话线**（`ConversationLine.tsx`，2026-10-22 仓库所有者）：会话里有 2 条以上用户消息时，对话区右缘（覆盖式滚动条左边、距顶 `--space-6`）一列横刻度，每条用户消息一个，按发送顺序从上往下（消息取自 TSP 文档里的 `omp.user` 卡片，`shared/tsp/user-messages.ts`）。刻度 8×2 `--border-strong`，悬停 12 宽 `--text-2`，正在读的那一条（顶边在视口上 1/3 以上的最后一条；吸底时是最后一条）12 宽 `--text`、`aria-current="location"`。点刻度把那条消息滚到对话区顶部（留 `--space-4`）。悬停提示 / 读屏 `scroll.lineItem`（第几条 + 消息开头 80 字）。刻度间距 12，消息多时压缩到最小 3，整列最多占对话区一半高，再多就在列里滚动（不显示滚动条）。宽 12，落在对话列最小留白 `--gutter` 里，不压正文。

### 4.16 DropOverlay

拖入文件夹时全窗口覆盖（`--dur-fade` 淡入）：虚线 2px `--accent` 描边、`--accent-soft` 底，居中 `dropzone.folder`（`features/empty/DropOverlay.tsx`）。拖入的全是图片时不出这个覆盖层，由输入框自己接（`data-composer-drop`，没有覆盖层文案）。非支持类型无反应、不报错。窗口里自己拖起来的东西（预览里的图片、选中的文字）不算：`dragstart` 到 `dragend` 之间不出覆盖层（Chromium 拖图片时也带一个空类型的文件项，2026-10-22）。

### 4.17 门（omp 的审批卡与提问对话框）

门是 omp 在 dock 里画的 TSP 节点，studio 照画（`features/tsp/`），不自绘门，也不本地化门里的文字。dock 停在过程区底部、studio 输入框正上方，宽同对话列（§4.14“输入框与过程区的分工”）；门不是模态，对话照常可读、可滚动。

| 门 | 节点（role） | studio 输入框 |
|---|---|---|
| 审批 | `omp.editor.ask.approval`：插在 omp 的输入框卡片（`omp.editor`，studio 不画）前面；标题（如 `Allow tool: bash`，右端 Details 按钮）、命令详情、选项 `list`（Approve / Approve bash for this session / Deny，单击任一项即提交，omp 18.12.6 实测见 `docs/architecture/tsp-real-omp-probes.md` §18）；omp 底栏的 Deny / Approve 按钮不画（`gate.ts` 的 `isApprovalDuplicateButton`） | 照常能发。有草稿时 `Enter` = 拒绝待批的调用，并把这句话作为插话交给 omp；空草稿 `Enter` 不动作；`Ctrl+Enter` = 批准（有没有草稿都一样）；`Ctrl+O` = Details。占位符 `composer.placeholderGate` |
| 提问 | `omp.editor.ask`：把 omp 的输入框卡片整个换掉；问题 `md`、选项 `list`、“其他”输入；多题时有页签和 Review 页；底栏 Hide / Note / Skip / Next（最后是 Submit） | 不能发：发送键禁用，`Enter` 不发，占位符 `composer.placeholderAsk`。在提问对话框里回答 |

- **判断集中在 `src/shared/tsp/gate.ts`**，主进程 `TspRunner` 和渲染进程 `Composer.tsx` 共用：`findMessageTarget` 返回 `ready`（`approval: true` = 有审批在等）、`ask`、`panel`（omp 的全屏面板或 Agent Hub 开着）或 `pending`；`findGateButton` 找审批卡上 `actions.click` 为 `approve` / `expand` 的 `omp.btn`。role 和动作名是 omp 自己的，不在 TSP 规范里，omp 改名这条规则就失效。
- **任务状态**：dock 里有 role 以 `omp.editor.ask` 开头的节点 = `needs_you`（`shared/tsp/task-status.ts`）。主进程为它合成一个 `TaskState.dialogs[0]`（`kind: "confirm"`，id `tsp-approval` / `tsp-ask`，标题取审批 / 问题标题的第一行），给侧栏的等你提示条、托盘和系统通知（§5.7）用；输入框也按这个 id 区分审批和提问。同一时刻 dock 里只有 omp 画的那一个门，studio 不另外排队。
- **拒绝并发送**是普通的 `send`，不另发 deny：omp 收到消息就拒绝待批的调用，并把消息作为插话交给模型（`omp://approval-mode.md`；真实 omp 18.12.5 上确认过，`docs/architecture/tsp-real-omp-probes.md` §14）。批准和 Details 是对审批卡上对应按钮发 `action` 事件，和鼠标点按钮是同一个事件。键位在 `composer/send-logic.ts` 的 `decideEnter`：有审批时不带 Ctrl 且有内容 → `denyAndSend`，带 Ctrl → `gatePrimary`。
- **审批期间不做的事**：切模型、切思考强度、studio 代发的斜杠命令（`runTaskCommand`、`/fast`、`/slow` 等）立刻 reject（`composer_unavailable`），否则它们的 `send` 会顺手拒掉审批（`TspRunner.#awaitComposer`）。
- **焦点**：门里的选项 `list`（`interactive/List.tsx`）和提问对话框根节点（`interactive/AskGate.tsx`）出现时拿走键盘焦点，除非焦点已在另一个 TSP 输入控件（`[data-tspi-keys]`）里。studio 输入框不算这种控件，所以正在输入框里打字时焦点也会移到门上。门被 omp 撤掉、焦点掉到 `<body>` 时，焦点回到 studio 输入框（`composer/use-reclaim-focus.ts`）。
- **键盘**：焦点在门里时，方向键、`Enter`、`Esc` 等按键编码后写给 omp（`features/tsp/keys.ts` 的 `encodeKey`），选中、提交、取消都由 omp 决定；这些按键不会被输入框当成“停止任务”。omp 对提问的 `Esc` 是取消整个提问并结束这一轮。焦点在输入框里时 `Esc` 走 §5.2（运行中 = 停止，`stopTask` 把 Esc 写给 omp）。
- **门的外观与按钮**（2026-10-22 起）：两种门都有外框（`--bg-raised` + 1px `--border` + `--radius-lg`，`padding: --space-3 --space-4`；dock 和输入框同宽），不再像对话正文。`omp.btn`（审批卡的 Details，提问的 Hide / Note / Skip / Next / Submit）画成 `ui/Button` sm（`AskGate.tsx` 的 `AskButtonRow`：`tone` accent → primary，error → danger，其余次要），点击发节点自己的 `actions.click`，不抢焦点；按钮里的 `kbd` 子节点画成尾随的 `ui-hint` 小字，**键名按 Windows 写**（`fmt.ts` 的 `gateKeyHint`：`Ctrl+Enter`、`Alt+H`、`Esc`，不用 ⌃⌥⇧；`direction-3.2.md` §7 第 7 条；过程区的键帽不变）。提问的选项行前面画非交互的单选圈 / 勾选框（`ui-radio` / `ui-check`，`tspi-item-mark`；`shared/tsp/ask-gate.ts` 的 `askItemMarker`：单选题跟高亮走，多选题按 omp 节点的勾选状态），选项的推荐值（item 的 `value`）画成行内 accent `Badge`，说明缩进到名字下面；多题页签是 `.ui-tabs`。审批卡布局：根节点改成两列 grid，标题和只剩 Details 的底栏共用第一行，其余各占整行（`interactive.css` 的 `[data-role="omp.editor.ask.approval"]`）。
- **超时**：由 omp 自己处理。提问的 `ask.timeout`（omp 默认 0 = 关）打开时，倒计时画在提问对话框底栏，到期 omp 自动选第一项（`docs/architecture/tsp-real-omp-probes.md` §6）。
- 录制和测试：`fixtures/tsp/{approval,ask,ask-multi}.jsonl`；单测 `test/tsp-gate.test.ts`、`test/tsp-ask-gate.test.ts`。细节见 `docs/architecture/tsp-migration.md` §10.6（提问对话框）、§10.7（审批与输入框）。

### 4.18 CommandPalette（`Ctrl K`）

居中浮层（`features/palette/`，样式 `palette.css`），宽 `--palette-w`(600)，距顶 15vh，`--bg-overlay`，`--shadow-3`，`--radius-xl`。出现：面板 `pl-in` = `--dur-slow` `--ease-spring`（从上方 `--travel-md`、`--scale-pop` 缩放淡入；减少动效时 `--dur-slow`、`--travel-md` 归零，`--scale-pop` 为 1，`--ease-spring` 为 `linear`），背后 `--bg-scrim` 以 `--dur-fade` 淡入（点击/Esc 关闭）。输入行高 52（`--fs-lg`，无边框，下边 `--border-subtle`），左搜索图标 16px、右 `Esc` 键帽（悬停提示 `palette.hint`；没有底部提示行）。结果行高 `--row-palette`(40)，`padding: 0 --space-3`，`[图标 16][标题][右侧：项目名/快捷键键帽]`，当前行 `--bg-active` + 左 2px `--accent` 竖条（常驻，只切透明度）。分组标题高 `--control-h-sm`(28)，`--fs-xs` `--text-3`，**无结果的分组不渲染**。键帽一律 `<kbd class="ui-kbd">`（`ui/controls.css`：18 高、等宽 `--fs-2xs`）：`Esc`、命令的快捷键、终端历史会话的 `>_`、无结果行的 `↵`。
- 空查询：`palette.recent`（最近 5 个任务）→ `palette.commands`。有输入：任务（标题+项目名模糊匹配）→ `palette.sessions`（含终端历史会话，`>_` 标）→ 命令 → 斜杠命令（仅当前任务有进程时，`get_available_commands`）；输入以 `/` 开头时只显示斜杠命令。匹配字符 `--accent` 高亮。
- 无结果：`palette.noResults` + 一行 `palette.askNew`（把查询当成新任务的 prompt）。
- 命令清单（`palette-commands.ts` 的 `buildCommands`，“当前任务”类只在有任务时列）：新任务 `Ctrl N`、在当前项目新任务 `Ctrl Shift N`、打开文件夹 `Ctrl Shift O`、设置 `Ctrl ,`、切换侧栏 `Ctrl B`、切换主题、切换语言、切换模型 `Alt M`、切换思考强度 `Alt T`、压缩 context、目标（当前任务有目标时按状态列 `暂停目标` / `继续目标` / `放弃目标`，`goal.cmd*`）、会话树（`cmd.sessionTree`）、子代理（`agents.cmd`，§4.28）、导出对话为 HTML（`cmd.exportHtml`）、旁路提问（`cmd.btw`）、停止当前任务 `Esc`（运行中）、复制最后一条回答 `Ctrl Shift C`、展开或收起所有工具卡片 `Ctrl O`、打开评审 `Ctrl Shift D`、文件面板 `Ctrl Shift E`、切换终端 `` Ctrl ` ``、跳到等你确认的任务 `Ctrl J`（有等待的任务时）、查看用量（打开用量对话框，§4.14 UsageDialog）、管理插件和市场、MCP 服务器 / SSH 主机 / 可用工具 / 记忆 / omp 更新日志 / 检查 omp 更新（都跳到设置页对应分节）、**关于与反馈**（id `about`，`window.about`：`emitStudioCommand("about")`，`app/App.tsx` 订阅后打开 `AboutDialog`，§3.1）、快捷键、归档当前任务、会话信息 / 请求记录 / 分享会话链接… / 置顶或取消置顶本会话 / 重试上一轮（任务空闲时）（`sessionInfo.cmd.*`，§4.31）。**每个快捷键动作必须在此有一条**。每条命令按 id 配自己的 16px 图标（`palette/command-icons.ts` 的 `commandIcon`；会话树、导出、旁路提问是 `TreeIcon` / `ExportIcon` / `BtwIcon`，关于是 `Info`）；没登记的（目标、子代理、文件面板、插件、集成类、会话信息类等）回退到 `CommandIcon`（`>_` 形）。
- 键盘：`↑↓` 移动，`Enter` 执行，`Ctrl+Enter` 在新任务中执行，`Tab` 无动作（焦点陷阱）。打开前记住 `document.activeElement`，关闭后还原（那个元素已被移除时不抢焦点）。

### 4.19 SettingsPage

占据主区的页面（3.2 起改版，`direction-3.2.md` §4）。入口：侧栏底部 `设置`、`Ctrl ,`、命令面板 `设置`、斜杠 `/settings`；命令面板和斜杠命令可以直接定位到某一节（`showView("settings", { section })`：切到那一节、清掉搜索，焦点放到节标题；`/hotkeys` 和命令面板 `快捷键` 定位到通用页的快捷键分组并滚到眼前）。离开：`Esc`（搜索框里有内容时先清搜索）、导航顶上的 `返回任务`、`Alt ←` / 鼠标后退键，回到对话视图（进入前选中的任务）；进入前的焦点元素还在 DOM 里时焦点还给它。进设置不停止任何任务。**只有一列分节，不分"omp-studio 的 / omp 的"**（omp 的设置和终端共用一份，就是 omp-studio 的设置；仓库所有者 2026-10-19 定）：`通用 / 模型 / Provider 与订阅（2026-10-22 仓库所有者改名，原"Provider 与账号"） / 工具与权限 / Context 与记忆 / Subagent 与规划 / 集成 / 插件 / 高级 / 关于`，10 节固定、平铺，没有二级标题（`SettingsNav.tsx` 的 `settingsPages`；2026-10-22 仓库所有者定：原来 13 节里"对话行为 / 语音 / 其他"三节只有一两项或全是没翻译的 omp 原文，"用量"和输入框旁的用量对话框重复，"omp 版本"和"关于"各有一个检查更新）。`ui-store` 的 `SettingsSection` 是这 10 节 + `shortcuts`（通用页的快捷键分组）；`SettingsPage` 是导航里的 10 节；当前节 `settingsPage` 和搜索词 `settingsQuery` 也在 `ui-store`，导航和内容共用。**各节只放常用项**（有人话标签的 omp 设置：`ompcfg` 字典里有 `<key>.label` 的键，`config-meta.ts` 的 `commonItems`，按字典顺序），和该节的管理列表放在同一页；其余 omp 键全部进 `高级`。

**导航**（`SettingsNav.tsx`；2026-10-22 起占侧栏的位置，`direction-3.2.md` §7 第 1 项）

- 进设置时侧栏列里渲染 `SettingsNav` 代替会话列表（`App.tsx`：`view === "settings"` 且不是窄窗），宽度就是侧栏宽度，照样可拖；退出时换回会话列表。自上而下：`返回任务`（`settings.back`；`Button` quiet sm，左 `‹`，右端淡色 `Esc` 提示，`settings-back`）；搜索框（`TextField` sm 通宽，`settings-search`，前面放大镜，占位 `settings.search.placeholder`，有内容时右端一个 × 清除）；10 个节按钮（`settings-nav-<节>`，高 `--row-task`(32)，`--fs-sm` `--text-2`，悬停 `--bg-hover`；当前节 `aria-current="page"`、`--bg-active` 底、`--text`；搜索中没有当前节）；最底下版本行（`--fs-2xs` `--text-3`，`settings-nav-version`）：只写 omp-studio 的版本号，如 `0.4.0`（2026-10-22 仓库所有者定；原来是 `omp-studio 0.4.0 · omp 18.12.6`，omp 的版本在“关于”里）。
- 窄窗（<1000px，侧栏变抽屉）或侧栏被收起时，导航改成内容顶上一行（`SettingsCompactNav`，`settings-nav-compact`）：节下拉（`Select` sm 200 宽，`settings-nav-select`；搜索中显示占位 `settings.search`）+ 搜索框（220 宽）。窄窗的抽屉里仍是会话列表。
- 设置页里 `Ctrl F` 聚焦搜索框（导航和内容共用 `onSettingsKeyDown`）。

**内容列与页头**（`SettingsView.tsx`、`settings.css`）

- 内容列**最大 1080、左对齐**（2026-10-22 起，原来 880；格子、快捷键、卡片在这个宽度里排到 3 列，再宽才在右侧留白），内边距 `--space-6 --space-10 --space-12`。节标题是页面的 `h1`。管理块（MCP、SSH、自定义提供商、插件市场）的根节点带 `.st-section`，和上一块之间留分组间距。滚动条用 `ui/OverlayScrollbar`。换节或开始搜索时滚回顶部，换节时新节整体淡入（`motion.css`）。
- 页头一行（最小高 36）：左边节标题（`--font-display` `--fs-xl` `--fw-strong`；搜索中写 `settings.search`）；右边是页头动作槽（`PageHeadActions.tsx`，各节把 sm 控件 portal 进来）：Provider 与订阅 = `连接 provider…`（§4.20）；集成、插件 = `范围` 标签 + `Select` sm 168 宽。一页最多一个主按钮。
- 节内分组用 `ui/SectionHead`（标题 + 个数，右侧 ↻ `IconButton` 或 sm 按钮，可带一行说明）。

**行**（`ui/Row`，样式 `ui/controls.css` 的 `.ui-row`；omp 设置的行是 `ConfigRow.tsx`）

- 一组行上边一条 1px `--border`；每行最小高 40、下边 1px `--border-subtle`、无底色。网格 `标签列 | 控件 | 28 宽的恢复默认位 | 余下留白`：标签列 200（`高级` 里 236），控件紧跟标签列、左对齐，一律 sm(28)。
- 标签 `--fs-sm` `--text`，是普通文字块；说明放标签后的 `ⓘ`（`ui/InfoTip.tsx`，跟在最后一个字后面，英文折两行时不漂到列尾），不另起灰字。omp 设置的 ⓘ 里先写 key（等宽），再写说明；说明是 omp 英文原文时中文界面加 `omp 原文` 徽标。没有人话标签的项，标签就是 key（等宽，长 key 在标签列里折行，不截断）。
- 改过的值（和 omp 默认不同，`config-meta.ts` 的 `isModified`）：标签左侧一道 2px `--accent` 竖线，控件后一个"恢复默认"`IconButton`，悬停提示写默认值 `默认：{value}`（`settings.cfg.default`；没有默认值写 `未设置`）。
- 控件后面可能跟：保存反馈（`正在保存…` / `已保存`，`aria-live`）；warning 徽标 `被 {name} 覆盖`（实际生效的值来自项目配置、叠加配置、运行时参数或环境变量，悬停写原因）。只有保存或校验出错时控件下才多一行红字；搜索命中的是说明而不是标签时，控件下就地显示那句说明。
- 凭据类（omp 标为 redacted 的项）不显示、不编辑，只有 `已设置` / `未设置` 徽标，ⓘ 里说明去终端用 `omp config` 设置。

**控件怎么选**（`ConfigControls.tsx`；只看类型和选项个数，不看语言和宽度，两种语言一致）

| omp 的类型 | 控件 | 何时保存 |
|---|---|---|
| boolean | `Switch` | 切换即存 |
| enum，≤4 个值 | `Segmented` sm | 选中即存 |
| enum，>4 个值 | `Select` sm | 选中即存 |
| number | `NumberField` sm（112 宽，右对齐，单位写在框内，从 key 末段后缀推：`Ms` → ms、`Seconds` → 秒 / s、`Percent` → %，标签里不再写单位）。omp 说明里写了特殊含义的值（`compaction.thresholdPercent`、`compaction.thresholdTokens` 的 -1，`task.maxRuntimeMs`、`retry.maxDelayMs` 的 0）在框里显示成占位文字，清空即存回这个值 | 停手 700ms、失焦或 Enter；不是数字时不存，就地报错 |
| string | `TextField` sm，260 宽 | 同上 |
| 字符串数组（如 `task.disabledAgents`） | 标签输入（`TagInput.tsx`：Enter 或逗号添加，输入框空时 Backspace 删最后一个） | 每次增删即存 |
| `modelRoles`、`retry.fallbackChains` | `编辑…` sm 按钮 + 等宽摘要（角色名 / `N 条回退链`），点开对话框里是专门的编辑器（`StructuredEditors.tsx`：角色 → 模型下拉；角色或模型 → 有序的回退模型，可增删、上下移）；值的结构认不出时退回下一行 | 编辑器里改动即存，`完成` 关闭 |
| 其余对象 / 数组 | `编辑…` + 等宽摘要，对话框里是等宽 `Textarea`；JSON 能解析、类型对（数组 / 对象）且有改动时 `保存` 才可用 | 点 `保存` |
| `goal.continuationModes` | 开关「目标自动推进」（见本节末） | 切换即存 |

枚举的取值：有人话标签的常用项显示翻译后的取值；其余原样显示 omp 的取值，用等宽字。当前值不在可选项里（omp 版本变了、手改过配置）时保留为一项，不让控件悄悄显示成别的。omp-studio 自己的设置（通用页）用同一套 `Row` 和控件。

**高级**（`ConfigSection.tsx` 的 `AdvancedConfig`；2026-10-22 起页内目录 + 平铺，`direction-3.2.md` §7 第 4 项）

- 页头下一行说明 `其余 {count} 项 omp 设置，和终端版共用`（`settings.advanced.note`）。
- 左侧页内目录（196 宽，随页面吸顶，`advanced-toc`）：omp-studio 的分组（`shared/ui/config-groups.ts`：模型与 reasoning、工具与权限、Context 与记忆、Subagent 与规划、对话行为、集成、语音、其他；没有项的组不出现）一行一个，带项数；当前分组加粗，下面列出它的前缀小组（带项数，左边一条 `--border` 线，当前小组 `--bg-active`），点小组滚到它。选中的分组和小组记在模块里，换节再回来保持原样。
- 右侧只显示当前分组的行，**全部平铺、没有折叠**：按 key 第一段分小组（`prefixGroups`，保持 omp 的顺序；只有一项的前缀和没有点号的键并进最后的 `其他`），每个小组一个分组标题：前缀的中文名 + 等宽淡色 `prefix.*`，右端 `N 项 · M 项改过`（没改过的不写后半）。行里的 key 去掉小标题已经写出的前缀。
- 常用项只在各节页面上，不在高级里重复；终端专用的键（`config-groups.ts` 的 `terminalOnly`）哪里都不显示。

**搜索**（`OmpConfigPane.tsx`，`config-meta.ts` 的 `matchesQuery`）

- 只搜 omp 的设置（常用项和高级，不含终端专用的键）：key、omp 原描述、中英两种语言的标签和说明，不区分大小写，多个词要全部命中。omp-studio 自己的设置（语言、主题、减少动效、通知、选中即复制、运行中按 Enter）不在搜索范围里。
- 有搜索词时内容换成结果：按 omp-studio 的分组各一个分组标题（带个数），行全部展开；没有结果时显示 `settings.search.empty` + `settings.search.emptyHint`。点任何一节、清空搜索框（× 或框里 `Esc`）回到节内容。
- omp 没就绪时 omp 设置的位置显示 `settings.cfg.notReady`；读取中 `settings.cfg.loading`；读取失败是 error `Notice` + `重试`。

| 节 | 内容 |
|---|---|
| 通用 | **格子排法**（2026-10-22 仓库所有者定，`.st-cells`：一行 2 或 3 格，每格一条 `ui/Row`，标签靠左、控件靠右，"恢复默认"夹在两者之间、出现时控件不动；内容区窄于 700 时三格减到两格，窄于 480 一格一行，`.settings-content` 是 `inline-size` 容器）。各节的 omp 常用项也这样排：按小块（`config-meta.ts` 的 `commonBlocks`，按 key 前缀归块，每块一个小标题 `settings.block.<id>`：默认与角色、出错重试、备用模型、审批与执行、自动压缩、记忆后端、Subagent、目标）两列逐行填，所以字典里成对的项挨着放；开关、数字、分段 / 下拉、`编辑…`按钮（结构化编辑和 JSON）进格子（`ConfigControls.tsx` 的 `fitsCell`，格子里 `编辑…` 后的摘要最宽 120，悬停看全文），文本框和标签输入整行排在格子下面；`记忆后端` 独占一行，下面左列 Mnemopi、右列 Hindsight。高级也用格子，右栏窄于 760 时一格一行（标签是很长的等宽 key）。分组 `外观`：第一行语言（分段：跟随系统 / 简体中文 / English）、主题（分段：跟随系统 / 浅色 / 深色）；第二行减少动效（开关；系统已要求时开关禁用在"开"，后面徽标 `系统已要求`）、选中即复制（开关，默认开，见 §4 通则）；第三行有任务在等你时通知我（开关）、任务完成时响提示音（`settings.soundOnDone`，开关，默认关，2026-10-22：正常跑完一轮响一声系统默认提示音 `shell.beep()`，窗口可见也响；出错、中止不响；窗口在托盘、已发完成通知时不另响，`gate-notifier.ts`）。外观六项两两一行。分组 `任务运行中`（`settings.whileRunning`）：运行中按 Enter（分段：插话 / 稍后，studio 自己的设置）+ omp"对话行为"组的常用项（插话的处理方式、稍后消息的处理方式、插话何时打断工具），两格一行。分组 `快捷键`（带个数，`id="settings-shortcuts"`）：只读，三列（窄时同上减列），键名用 Kbd，v1 不可自定义（`GeneralSection.tsx`） |
| 模型 | 一组行：新任务的默认模型（`Select` 280 宽，第一项 `由 omp 自动选择`）、默认思考强度（`Select`）——**就是 omp 的 `modelRoles.default` / `defaultThinkingLevel`，经 `omp config` 读写**，草稿输入框的模型胶囊显示的就是它（omp 的设置就是 omp-studio 的设置，不另存；胶囊里改只管即将建的那个任务，不写这里）；接着各角色每个一行下拉（Smol / Slow / Plan / Task / Commit / Advisor，外加 `modelRoles` 里另有的角色；`setting-role-<角色>`，280 宽，第一项 `model.roleUnset`，悬停 i 是 `model.roleUse`），改了经 `omp config set modelRoles` 写全局，和模型选择对话框里给角色“应用”一样（2026-10-22 起直接展开，原来是 `modelRoles` 一行“编辑…”）；后面接 omp"模型与 reasoning"组的常用项（出错重试与备用模型），`defaultThinkingLevel`、`modelRoles` 不重复一行（搜索里照旧有；`ModelsSection.tsx`）。`modelRoleStorage`（模型角色的保存位置）只影响 omp 终端里的模型选择器，2026-10-22 起移到“高级”。审批模式不在这里：在输入框胶囊或"工具与权限"里改 |
| Provider 与订阅 | 见 §4.20 |
| 工具与权限 | omp"工具与权限"组的常用项（工具审批模式、按工具的审批策略、工具调用格式、允许执行命令）+ 分组 `可用工具`（`ToolsCard.tsx`，`/tools` 的列表）：标题带个数、右侧 ↻，说明写明这是全局列表（项目插件和 MCP 的工具不在内）；网格（每格最小 220 宽）每格一样：等宽工具名 + 状态徽标（`已启用` / `未启用` / `xd 设备`）+ 有对应 `<工具>.enabled` 设置项的在格尾放开关（就是那一项设置）。关掉的工具会从 omp 的列表里消失，所以不自动重读，格子保留，点 ↻ 才重读 |
| Context 与记忆 | omp"Context 与记忆"组的常用项（自动压缩及其阈值、记忆后端、Mnemopi / Hindsight 的自动回忆、自动记住、记忆范围）+ 分组 `记忆`（`MemoryCard.tsx`）：标题右侧 ↻ 和 `清空`（`danger` sm，先 `ConfirmDialog` danger；正文写明本地记忆下次会话启动时重新生成、Hindsight 只清本地）；`项目` 行（下拉只有项目，默认当前任务所在项目，记忆按项目目录分）；`统计 / 诊断 / 待整理 / 注入内容` 是 `Tabs`，原文放等宽 `<pre>`。没有项目时只一句 `integrations.memory.noProject`。没有 `立即整理` / `重建`：实测它们在 omp 18.12.5 里没有可观察的效果，记忆只在会话启动时生成 |
| Subagent 与规划 | omp"Subagent 与规划"组的常用项（子代理并发、嵌套层数、任务隔离与合并方式、委派积极程度、批量派发、运行时限、最高思考强度、停用的子代理、子代理的模型覆盖、目标自动推进） |
| 集成 | 页头 `范围` 下拉（`用户（全局）` / 各项目；MCP 和 SSH 共用，`integrations-store.ts` 的键 `integrations`）。分组 `MCP 服务器`、`SSH 主机`，见下"管理列表"。这一节没有常用项 |
| 插件 | 页头 `范围` 下拉。分组 `已安装`、`市场`、`诊断`，见下"管理列表" |
| 高级 | 见上 |
| 关于 | 分组 `版本`（`settings.about.versions`；两行内容宽，不排格子）：低于最低版本时顶部 error `Notice` `omp.outdated`（§4.21）；`omp-studio` 行 = 版本号 + 更新状态 + `检查更新`（下载完成后换成主按钮 `重启并安装`），下载中行内一条 4 高进度条（`AboutSection.tsx`）；`omp` 行（`OmpSection.tsx`）= 版本号 + 来源徽标（`由 {name} 管理` / `由 omp-studio 管理` / `你自己安装的`）+ 有新版时 `omp.newVersion` + `检查更新`（这一个查的是 omp）+ 只有用户自装的才有 `升级`（执行 `omp update`，下面显示输出最后 3 行）；ⓘ：omp-studio 自管时 `omp.autoUpdate.note`，受管者管理时 `omp.updateByManager` + `omp.autoUpdate.noteOther`；`omp 路径` 行；自管且不在用户 PATH 上时多一行 `omp.addPath`（按钮 `加入 PATH`）。分组 `更新日志`（`integrations.changelog.title`，`Changelog.tsx`）：`omp-studio`、`omp` 各一项，**都只显示最新一版**（2026-10-22 仓库所有者），默认收起；每项一行 `Disclosure`（整行可点，高 `--control-h-md`，下一条 `--border-subtle`）= 名字（`--text`）+ 版本号（`--font-mono` `--fs-code-sm` `--text-2`）+ 日期（`--text-3`），展开后正文缩进到名字下面，用对话流的 `Markdown`。omp-studio 的是当前版本在打包进来的 `CHANGELOG.md` 里那一节（`AppInfo.releaseNotes`，没有这一节时不显示这一项）；omp 的点开才读 `/changelog`（输出很长），取最新一节，正文上面一行 `integrations.changelog.hint`（只有英文），omp 没就绪时不显示这一项。分组 `问题排查`（`TroubleshootCard.tsx`）：一行两格，日志（`打开日志文件夹`）、诊断信息（`导出…`）。命令面板"检查更新""omp 更新日志"、斜杠 `/changelog` 都定位到这一节 |

**管理列表**（集成、插件；提供商、自定义提供商见 §4.20。2026-10-22 起，`direction-3.2.md` §4 第 5 条、§7 第 2 项）

- 每项一个 `ui/ListRow`；MCP、SSH、市场里的可安装插件、诊断结果排成卡片（`.ui-cards`，同 §4.20 的卡片），已安装插件和市场列表一行一项（下边 1px `--border-subtle`，最小高 48；要整行展开详情）。28 方图标块（名称前两个字）、名称 + 徽标（范围、状态都用 `Badge`）、一行元信息（`--fs-xs` `--text-3`，单行省略）、右侧动作（sm 按钮、开关）。删除 / 移除 / 卸载收进行尾 ⋯（`RowMenu.tsx`：`IconButton` + `ui/Menu`，红字项）。
- MCP、SSH 的分组标题右侧是 ↻ 和一个 sm 的 `添加…` 按钮。添加表单（MCP、SSH、市场）是对话框（`ui/Dialog` md，字段竖排 `FormField`，说明写在字段下的 help，页脚 `取消` + 主按钮），不在列表里展开。
- 错误显示 omp 的原话（`errorDetail`），不吞；MCP、SSH 读取或写入失败是 error `Notice`。入口：斜杠 `/mcp` `/ssh` `/tools` `/memory` `/changelog`（`integrations-slash.ts`）、`/plugins` `/marketplace`（`plugins-slash.ts`）都由 studio 接管并定位到对应节，带参数时报错、草稿放回输入框；`/reload-plugins` 在当前任务里重新加载并弹 toast；命令面板有同名项和 `管理插件和市场`。
- **范围**（集成）：`用户（全局）`（服务进程 / 中性目录）或某个项目（项目目录里的短命 rpc-ui / CLI；列表同时含用户和项目两层，每行带范围徽标）。换范围时关掉添加对话框、清掉上一个范围的失败提示。数据 `integrations-store.ts`（按范围键缓存，回来先显示上次结果再后台刷新）、`integrations-data.ts`。
- **MCP**（`McpCard.tsx`）：行 = 名称 + 范围徽标，元信息 `传输 · 目标`（stdio 只有命令，参数 omp 不显示）；动作 `测试连接`（sm，进行中 loading；结果写在卡片的元信息下面：`已连接，N 个工具：…` 或 omp 原话）+ 启用开关 + ⋯ `删除`（先 `ConfirmDialog` danger）。名字里有空格或特殊字符的服务器（别处建的）只读，卡片里写 `integrations.mcp.unmanageable`。分组标题下面一行说明 `integrations.mcp.note`（已开的任务要在自己的会话里 `/mcp reload`；`reauth` / `unauth` 只在终端界面支持）。`添加服务器…` → 对话框 `添加 MCP 服务器`：名称、范围（页头选了项目时才有，分段 用户 / 项目）、类型（分段 本地命令 / HTTP / SSE）、命令 + 参数（`Textarea`，一行一个；含空格的参数由主进程加引号，参数里不能有双引号）或 URL + 可选 Token。omp 把失败也当普通输出，只认已知成功句式，其余显示原话。
- **SSH**（`SshCard.tsx`）：行 = 名称 + 范围徽标（+ `兼容模式` 徽标），元信息 `user@host:port · 密钥路径 · 说明`，⋯ `删除`（先确认）。`添加主机…` → 对话框：名称、主机地址、用户名 + 端口、密钥路径、说明、范围（页头选了项目时才有）、兼容模式（`Checkbox`）。经 `omp ssh … --json`，值写成 `--flag=value`（`src/main/integrations/ssh.ts`）。
- **插件**（`PluginsSection.tsx` + `PluginRow.tsx` + `PluginDetails.tsx` + `MarketplacesCard.tsx`，状态 `plugins-store.ts`，样式 `plugins.css`）：数据和动作都经 `omp plugin …` CLI（主进程 `src/main/plugins/plugin-cli.ts`，输出解析在 `src/shared/omp-output/plugins.ts`，见 `docs/architecture/plugins.md`）；渲染进程只能发封闭的 `PluginAction`，不传命令文本。页头 `范围`（`用户` / 各项目，默认用户）：选项目后列表同时显示该项目范围的安装，项目范围的行带 `项目` 徽标，同一个插件两个范围都装了就是两行，每行的动作带各自的 `--scope`；项目目录由主进程按 projectId 取。页头下一行简介 `plugins.intro`。改动后出现 info `Notice`：`plugins.reload.title` + `稍后`（quiet）+ `在运行中的任务里重新加载`——只对空闲任务发 `reloadPlugins`，忙的不碰并 toast 个数。
  - `已安装`（个数；右侧有市场插件时 `升级全部`，再一个 ↻）：行 = 名称 + 元信息 `版本 x · 说明`，动作 `详情`（`Disclosure`）+ `升级`（只有市场插件）+ 启用开关 + ⋯ `卸载`（先 `ConfirmDialog` danger）。展开后 npm / link 插件有 `功能`（每项一行开关，默认开的功能名后 `默认` 徽标）和 `设置`（布尔 = 开关、枚举 = 下拉、其余 = 输入框 + `保存`；已设置的算改过，有恢复默认；值不能以 `-` 开头，omp 会当成选项），市场插件只有一句 `plugins.settings.marketplaceOnly`。
  - `市场`（个数；说明 `移除只删来源`；右侧 `添加市场…`）：选了项目时上面多一个 `安装到` 分段（用户 / 项目，装到项目时确认正文多一句 `plugins.install.projectNote`）。行 = 名称 + 来源，动作 `浏览` / `收起`、`更新目录`、⋯ `移除`（不确认，已装的插件不卸载）。`浏览` 在行下展开可装插件（有搜索框；按要装进的范围判断，已装的是 `已安装` 徽标，其余 `安装`）；**安装前必须确认**（`ConfirmDialog`，确认键 `安装并信任`，正文写明会把第三方代码装进 omp、以你的权限运行）。`添加市场…` 对话框只有一个来源字段（owner/repo、Git 地址、catalog 的 .json 地址或本地目录）。
  - `诊断`：`运行诊断` / `诊断并尝试修复`，结果每项一行，徽标 `正常` / `警告` / `错误`。
  - 同一时间只执行一个改动（主进程串行 + 渲染进程按钮禁用）；失败时报 omp 的原话（`✘` 前缀去掉）。测试：`test/omp-plugins-output.test.ts`、`test/plugin-cli.test.ts`、e2e `settings-functional.e2e.ts` 的"插件"；集成的测试 `test/omp-output-integrations.test.ts`、`test/integrations-ssh.test.ts`、e2e 同文件的"集成"。细节与实测见 `docs/architecture/omp-settings.md`「集成卡片」。

"Subagent 与规划"里的「目标自动推进」（常用项）：开关，是 omp 的 `goal.continuationModes` 里有没有 `rpc`，切换时只增减 `rpc`、别的条目保留（`shared/ui/goal-continuation.ts`）；读写走 `omp config`，和终端里的 omp 共用同一份，不另存副本。omp 就绪后主进程检查一次：用户没明确设过（`config.yml` 里没有这个键）就加上 `rpc`，设过的不碰（`src/main/omp-config/goal-default.ts`）。

### 4.20 Provider 与订阅（设置页的一节；登录流）

代码 `features/settings/`：`ProvidersSection.tsx`（页面）、`ProviderRow.tsx`（一行）、`ProviderPickDialog.tsx`（连接提供商）、`ProviderFlowDialog.tsx` + `ProviderPanels.tsx`（登录 / 填 key / 选账号 / 失败）、`CustomProviders.tsx` + `CustomProviderForm.tsx` + `CustomModelList.tsx`（自定义提供商）、`RowMenu.tsx`（⋯），分组规则 `src/shared/ui/provider-list.ts`，样式 `providers.css`、`custom-providers.css`，文案 `login.*`、`custom.*`。omp 列出 80 多个提供商，**没连接的不在页面上铺开**（2026-10-22 起，`direction-3.2.md` §7 第 3 项；原来是 `显示其余 N 个提供商` 展开）。

- **数据**：`accounts-store.ts` 一次读 `get_login_providers`（提供商列表）、studio 存了 key 的提供商、模型列表，再对已认证的提供商逐个读 `get_logout_accounts`（账号）；有缓存先显示，进入时后台刷新；登录、退出、改 key 之后强制重读。读取失败是 error `Notice` `login.loadFailed`；后台刷新失败时保留上次结果，上面一条 warning `Notice` `login.refreshFailed`。
- **分组**（`splitProviders`）：**已连接** = omp 认为已认证（登录过、环境变量或配置里有凭据）或 studio 存了 key 的；其余是"没连接"。两组内都保持 omp 的顺序。
- **页面自上而下**：页头右侧 `连接 provider…`（`login.connect`，sm 次要按钮带 `+`，`providers-connect`；还在读取或没有未连接的提供商时禁用）。分组 `已连接`（`login.connected`，带个数）：每个一行；一个都没有时一句 `login.connected.empty`。分组 `自定义提供商`（见下）。最后分组 `其他提供商`（`login.others`，带个数，`providers-others`）：只有一行说明 `login.others.note`，不列行。
- **卡片**（2026-10-22 起，仓库所有者嫌一行一个太占地方；`ProviderRow.tsx`，`ui/ListRow` 放进 `.ui-cards`，`provider-<id>`）：已连接和自定义提供商都排成卡片网格（每格最小 260，内容列 1080 时一行 3 张，窄了减列），同一行卡片等高。卡片内：左上 28 方图标块（provider 的单色 logo，16px、`currentColor` 跟主题：`ProviderLogo.tsx`，图形拷自 LobeHub Icons，MIT，许可证随安装包放进 `resources/licenses/`；没有 logo 的写名称首字母），右边名称 + 状态 `Badge`（名称放不下时徽标换到下一行，名称先占满一行再省略）、元信息（可换行）；底部靠右是 sm 按钮和 ⋯。选择对话框里同一个 `ProviderRow` 仍是一行。

| 状态（按顺序取第一条命中的） | 徽标 | 元信息 |
|---|---|---|
| 已认证且有账号 | `已登录`（success） | 账号名；多个时 `第一个 +N` |
| studio 存了 key | `已设置 API key`（success） | 环境变量名 |
| omp 已认证、没有账号（环境变量或配置里的 key） | `环境变量或配置`（neutral） | 环境变量名（已知时） |
| 只能在终端登录（`provider-login.ts` 的 `loginKind` = `terminal`） | `需在终端登录` | `login.terminalOnly` |
| omp 报不可用 | `当前不可用` | — |
| 其余 | `未登录` | `OAuth 登录` / `API key` |

- **按钮**（都是 sm 次要按钮）：有已知环境变量名的（`provider-keys.ts` 的 `apiKeyEnvName`）给 `设置 API key`（存过 key 时写 `更换 key`），打开 key 对话框；已登录的给 `退出登录`——只有一个账号时直接 `logout`，多个时打开对话框选账号；没登录的 OAuth 类给 `登录`；登录方式就是粘贴 API key、又没有已知环境变量名的给 `添加 API key`（走 omp 自己的 `login`，key 存进 omp 的凭据库）；只能在终端登录的没有按钮。登录方式按实测分类（omp 的 `get_login_providers` 没有这个字段；`src/shared/provider-login.ts`，`docs/architecture/login.md`），表里没有的按 OAuth 处理。studio 存了 key 的行尾多一个 ⋯（`RowMenu`）：`清除 API key`（红字，直接执行）。
- **连接提供商…**（`ProviderPickDialog.tsx`，`ui/Dialog` md，`provider-pick`）：标题 `login.connect.title`，说明 `login.connect.desc`；顶上搜索框（`login.search`，打开时焦点在它上，`provider-search`），按名称和 id 过滤，每个词都要命中；下面是未连接提供商的行（同上面的行，最高 360 后滚动），没有匹配时 `login.noMatch`；页脚只有 `关闭`。点行里的按钮，选择对话框换成流程对话框（同一时间只有一个对话框）。
- **流程对话框**（`ProviderFlowDialog.tsx`，`ui/Dialog` md，标题是提供商名，`provider-flow-<id>`）：从选择对话框进来、且不在登录进行中时，页脚左侧有 quiet `返回`，回到选择对话框。四种内容：

| 内容 | 正文 | 页脚 |
|---|---|---|
| 登录（OAuth，或经 omp 粘贴 key） | 一打开就发 `login`。先是 `login.opening`；收到 `open_url` 时主进程已经用系统浏览器打开它（只放行 http/https），对话框里显示 `login.fallback` + 只读等宽的 `launchUrl ?? url` + `复制` + `login.reopen`；有 `instructions`、进度句时作为淡色文字；omp 要输入（授权码等）时出现输入框（标题和占位用 omp 给的，没有占位时 `login.pasteCode`；登录方式是粘贴 key 的遮住），Enter 提交 | `取消`（同时取消 omp 的登录）；有输入框时加主按钮 `提交` |
| 填 API key | `API key` 字段（等宽、遮住，占位 `粘贴 API key`），说明 `login.apiKey.note`：key 由主进程用 `safeStorage` 加密存在 userData，启动 omp 时以环境变量传入，不写 `~/.omp`，终端版看不到 | `取消` + 主按钮 `保存` |
| 选账号退出 | `login.chooseAccount` + 每个账号一行按钮（账号名 + 淡色详情），点了就 `logout` 那个账号 | `取消` |
| 失败 | 红字 `login.failed` + 一句原因（omp 的原话；原话里有 secret / terminal 时换成 `login.terminalOnly`） | 只能在终端登录时多一个 `复制命令`（复制 `omp`）；`关闭` + 主按钮 `重试`（重新走同一个动作） |

流程对话框成功（登录完成、key 已保存、已退出）后关闭并重读列表；登录结果是 `cancelled` 时直接关闭，不报错。

- **自定义提供商**（`CustomProviders.tsx`，`custom-providers`）：omp 的 `models.yml` 里 `providers.*` 的列表，直接读写 omp 的文件（`docs/architecture/custom-models.md`）。分组标题 `自定义提供商`（带个数），右侧 `显示 models.yml`（quiet sm）+ `添加 provider…`（sm，读取中或读取失败时禁用）。一行 = 首字母图标块 + ID，元信息 `接口类型 · Base URL · N 个模型（或 运行时发现模型） · key 状态（无需 key / 已设置 key / 环境变量 X / 命令取 key）`，动作 `编辑`（sm）+ ⋯ `删除`（先 `ConfirmDialog` danger，正文写明只去掉这个提供商、留一份 `models.yml.bak`）。读取失败是 error `Notice`；没有时一句 `还没有自定义提供商`。
- **添加 / 编辑对话框**（`CustomProviderForm.tsx`，`ui/Dialog` md，标题 `添加自定义提供商` / `编辑 {id}`）：字段竖排——ID（编辑时禁用）、Base URL、接口类型（`Select`：OpenAI Chat Completions / OpenAI Responses / Anthropic Messages）、API key（分段：直接填 key / 环境变量 / 无需 key，编辑原来是直接填或命令取 key 的提供商时前面多一个 `保持不变`；直接填的 key 默认遮住，框尾 quiet `显示 / 隐藏`）、模型（`拉取模型` sm；有模型后 `全选` / `全不选` quiet + `已选 n / m`；超过 12 个时出现筛选框；每个模型一个 `Checkbox`；底部手动添加框 + `添加`；拉取的结果或失败原因用 `Notice` 写一句）。页脚 `取消` + 主按钮 `保存`；保存后 toast `custom.saved`，新模型出现在模型选择器。
- **没有可用模型时没有引导卡片**：输入框的模型胶囊显示 `composer.noModel`；模型选择器底部的 `添加 provider…` 关掉选择器、打开设置页的这一节。首次启动不另走一套登录流程，登录都在这一节。

### 4.21 omp 版本过旧

不全屏，**没有主区顶部横幅**（OutdatedBanner 没做）。低于最低版本时：设置 → 关于的 omp 卡片顶部一条错误 `Notice` `omp.outdated`（`OmpSection.tsx`，挂在 `AboutSection.tsx` 里），同时**禁用发送**（输入框区显示 `composer.versionTooOld`，`Composer.tsx`）。升级也在这张卡片里：PATH 上用户自装的 omp 有 `omp.upgrade` 行（执行 `omp update`，显示输出尾部）；受管者管理（Tern 等）没有升级按钮，行说明写 `omp.updateByManager`。运行中有任务时升级没有额外提示。有新版但不强制：只在这张卡片里显示 `omp.newVersion`，不弹窗不横幅。

### 4.22 OmpSetupCard（首次启动与 omp 管理）

`features/omp-setup/OmpSetupView.tsx`，样式 `omp-setup.css`。只在需要用户参与或在等待时出现，omp 就绪后自己消失（淡出）。盖住顶栏以下的整个窗口（不透明 `--bg-app`），居中一张卡片：宽 `--dialog-w-md`(520)，`--bg-raised`，`--radius-xl`，`--shadow-2`，内边距 `--space-6`，`role="dialog"`。只有问接管时底下的应用照常画出来、只压一层 `--bg-scrim`（顶栏系统三键一起调暗，`ui/title-bar-dim.ts`）。标题 `--font-display` `--fs-xl`；路径放等宽的 `--bg-sunken` 块。

**按钮**（3.2 起，原来左对齐，`direction-3.2.md` §2.4）：卡片底部一行右对齐（`flex-wrap`，不设固定宽度），**次要在前、主按钮在最后**，一张卡最多一个主按钮。

| 状态（`OmpStatus.state`） | 条件 | 内容 | 按钮（左 → 右；★ = 打开时的焦点） |
|---|---|---|---|
| `discovering` | 启动检测 | 一句 `omp.finding`（超过 300ms 才出现，免得一闪而过） | — |
| `ask_takeover` | PATH 上的 omp 首次发现 | 三种标题和正文：别人管理的（`omp.takeover.otherTitle/otherBody`）、能启动的自装版（`omp.takeover.exeTitle/exeBody`）、`.cmd` 这类脚本（`omp.takeover.title/body`）；正文都写明会另装一份并改用户 PATH，原来的不动。有版本时一句 `omp.found`；路径块 `omp.takeover.where` | ★ 保守的一项（`继续用 {name} 的` / `继续用我的` / `取消`）、主按钮 `由 omp-studio 管理` |
| `missing` | PATH 上没有 omp | `omp.missing.title`（知道版本时 `omp.missing.titleVersion`）+ `omp.missing.body`（含大小；不知道时 `omp.missing.bodyNoSize`） | `我已安装，重新检测`、★ 主按钮 `下载并安装` |
| `installing` | 下载中 | `omp.downloading`（版本未知时 `omp.downloading.latest`）+ `omp.install.note` + 进度条（高 4，`--accent`，`--radius-pill`）+ `omp.progress`；下载完进入 `omp.verifying` | `取消下载`（校验中不显示） |
| `unusable` | 拒绝接管，而 PATH 上的是脚本 | `omp.unusable.title` + `omp.takeover.declined` + 路径块 | ★ 主按钮 `重新选择` |
| `error` | 检测、下载、校验、安装、改 PATH 失败 | `omp.error.title` + 红字一句人话原因（`omp.error.<stage>`；校验失败是 `omp.verifyFailed` + `omp.error.verify`）+ `显示详情`（`ui/Disclosure`，默认收起，展开是等宽的原始报错，最高 320 后滚动） | `打开设置`（隐藏卡片直到状态再变化，进设置页）、★ 主按钮 `重试` |

没有"连接模型"一步：omp 就绪后直接进 §4.7 新任务草稿页，没有可用模型时见 §4.20 末条。下载由用户点击授权；omp-studio 管理 omp 的细节见 `docs/architecture/omp-install.md`。

### 4.23 通用控件（3.2 起，`direction-3.2.md` §3）

全部在 `src/renderer/src/ui/`：React 组件 `controls.tsx`（Button、IconButton、Switch、Checkbox、Radio、Segmented、Tabs、Badge、Notice、TextField、NumberField、Textarea、FormField、SectionHead、Row、ListRow、Disclosure）、`Select.tsx`、`Menu.tsx`（`Menu` / `MenuList`）、`Popover.tsx`、`Dialog.tsx`（`Dialog` / `ConfirmDialog`）、`InfoTip.tsx`；样式只在 `controls.css`，类名前缀 `ui-`，只用 token。各功能目录**不再自己写**按钮、开关、分段、下拉、菜单、对话框外壳的样式。样张 `docs/design/3.2/components.html`（浏览器直接打开，`?theme=dark` 看深色）。

**尺寸只有两档**：md `--control-h-md`(32，表单、对话框、设置页)、sm `--control-h-sm`(28，工具条、面板和分组标题、列表行、浮层)。圆角：按钮、输入框、分段外框 `--radius-md`；分段内块、勾选框 `--radius-sm`；胶囊形只给输入框工具条的 Chip 和 Toast。**一个视图最多一个主按钮**；链接只出现在句子里，不当独立按钮。**互斥取值**：≤4 个短选项用 Segmented，更多用 Select，由选项个数决定，不由语言或宽度决定（例外：模型选择器的思考强度是有序的档位，仍是一排分段，`direction-3.2.md` §5）；**切视图**用 Tabs。

**通则**（2026-10-22 仓库所有者同意）：

| 规则 | 做法 | 范围 |
|---|---|---|
| 输入框聚焦不画外描边 | 边框隐去，换成两层阴影 `0 0 0 1px --accent` + `0 0 0 4px --accent-soft`（错误态 `--st-error` / `--st-error-soft`），同时 `outline: 2px solid transparent`（Windows 高对比度模式清掉阴影时靠它显示焦点） | Field、Select、Textarea；按钮、菜单项、开关的键盘焦点仍是全局 `:focus-visible` 的 2px 外描边 |
| 句子里的图标下移 0.125em | `vertical-align: -0.125em`（现在只有 ⓘ `.ui-info`）；设置行标签是普通文字块，ⓘ 跟在最后一个字后面，英文标签折两行时不漂到列尾 | 只给夹在文字里的图标；flex 容器里的图标（按钮、菜单项、胶囊）不加 |
| 多行文字 `text-wrap: pretty`，短标题 `balance` | `pretty`：帮助文字、菜单项第二行、浮层正文、对话框说明、分组说明、提示条；`balance`：浮层标题、对话框标题 | 对话流正文属于过程区，不动 |

| 控件 | 规格 |
|---|---|
| Button `.ui-btn` | `data-variant`：`primary`（`--primary` 底、`--text-on-primary`）、默认次要（透明底 + 1px `--border-strong`）、`quiet`（无框 `--text-2`，"稍后""显示全部"）、`danger`（红字 + 红框）、`danger-solid`（`--st-error` 底、`--text-on-danger`，只给破坏性确认框的确认键）。`data-size="sm"`（28 高，`--fs-sm`；2026-10-22 起，原来 `--fs-xs`；sm 的 TextField、Segmented 同样是 `--fs-sm`）。加载：文字透明、**宽度不变**、14px 环，同时禁用。禁用：`--text-disabled` + `--border`。快捷键提示 `.ui-hint`：按钮里尾随的等宽淡色小字，不画键帽框 |
| IconButton `.ui-icon-btn` | 28 方（md 32），无框，`--text-2`，悬停 `--bg-hover`，按下 / 展开 `--bg-active`；必须有悬停提示（`label`，可另给 `tip` 带快捷键）。"刷新"永远是 ↻ 图标按钮 |
| Field `.ui-field`（TextField / NumberField） | 文本、数字、搜索、下拉触发器共用：`--bg-raised`，1px `--border-strong`，`--radius-md`；错误时 `--st-error` 边，错误文字在框下一行（`.ui-help[data-tone=error]`）。数字框 112 宽、右对齐、`tabular-nums`，单位写在框内（`.ui-affix`）。前后可放 14px 图标（搜索、清空） |
| Select `.ui-select` | Field + 右侧 chevron；展开的列表是选择菜单（portal 到 body、`fixed` 定位，下方放不下向上展开，滚动或窗口变化时关闭）。键盘：焦点留在触发器（combobox + `aria-activedescendant`），`↑↓` / `Home` / `End` 移动，`Enter` / 空格选择，`Esc` 关闭，首字母跳转 |
| Textarea `.ui-textarea` | 同 Field 的框，`resize: vertical`；`mono` 变体用 `--font-mono` |
| Switch `.ui-switch` | 36×20，关 `--border-strong`（两套主题都看得见），开 `--accent`；被系统强制打开的：禁用的开 + 旁边一个徽标说明原因 |
| Checkbox / Radio `.ui-check` `.ui-radio` | 16px，1.5px `--border-strong`，选中 `--accent` 底；ask 门单选题用单选圈、多选题用勾选框 |
| Segmented `.ui-seg` | 设一个值：外框 `--bg-active`，选中块 `--control-on`（浅色白、深色 `#2b2931`）+ `--shadow-1`；`role="radiogroup"`，方向键移动并选中 |
| Tabs `.ui-tabs` | 切一个视图：文字标签 + 当前项 2px `--text` 下划线，可带计数；`role="tablist"`，方向键移动并切换 |
| Badge `.ui-badge` | 18 高、`--radius-sm`、`--fs-2xs`；neutral / accent / success / warning / error，可带圆点。状态、范围、来源、"推荐""默认"都用它，不再用整句彩色文字 |
| Menu `.ui-menu` | `--bg-overlay` + `--shadow-2` + `--radius-lg`，`padding: --space-1`，项高 `--row-menu`(32)。第一列 16px：动作菜单放图标，选择菜单放 ✓（**当前项只靠 ✓**，灰底只表示悬停 / 键盘焦点）；破坏性项红字、放最后、前面一条分隔线；不可用项灰字，原因写在第二行小字；小节标题 `--fs-2xs` `--text-3`；最宽 320。`Menu` 按锚点 `fixed` 弹出，贴边时翻到锚点另一侧；打开时焦点进第一项，`↑↓` 移动，`Esc` / 点外面关闭，焦点回到打开它的元素。`MenuList` 是嵌在 Popover 里的同一种菜单。文本框的右键菜单（`app/EditMenu.tsx`，2026-10-22）也是它：撤销 / 剪切 / 复制 / 粘贴 / 全选，按有没有选区、能不能写列出（密码框不给剪切 / 复制），命令经 `editField` 交给主进程对聚焦的输入框执行（渲染进程不读剪贴板，粘贴照常走 paste 事件）；自己画右键菜单的地方先 `preventDefault`，它就不弹 |
| Popover `.ui-popover` | 输入框胶囊上方弹出的浮层：`--bg-overlay`、`--shadow-2`、`--radius-lg`；确认类内容宽 300，标题 `--fs-sm` 粗、正文 `--text-2`、按钮 sm 右对齐。**同一时刻只开一个**：新开的会关掉已开的（`/todo` 再 `/jobs` 不叠放）；`Esc` 只关最上面（最后打开）的一个并被消耗（不会再当作"停止任务"），焦点在输入框、胶囊或浮层里都管，焦点在 `aria-modal` 对话框或 TSP 过程区里不管；从输入框用斜杠命令打开的，关闭后焦点留在输入框 |
| Dialog `.ui-dialog` | **唯一外壳**：sm 400 / md 520 / lg 720（要横向空间的用量、模型选择再加宽到 `--dialog-w-xl` 960），`--radius-xl`、`--shadow-3`，居中、遮罩 `--bg-scrim`；标题 `--fs-lg` + 可选一句说明，右上 ×（选择器类对话框可以用 `head` 换掉标题行：顶上是搜索框，标题只作读屏名、没有 ×，如模型选择）；正文竖排字段（`FormField`：标签在上，帮助 / 错误在下）；页脚按钮右对齐、取消在前确认在后，附带选项放页脚左侧。`Esc` 关闭并被消耗，`Tab` 在对话框内循环，打开时焦点进 `[data-autofocus]`（没有就进 ×），关闭时焦点回到打开前的元素。焦点掉到 body（按下的按钮转成 loading 被禁用、获得焦点的元素被卸载）时，`Esc` 照样关最上面的对话框、`Tab` 把焦点拉回对话框。自己管开关的对话框（打开即挂载，放完退出动画才通知父级）由父级用 `useDialogSlot`（`ui/presence.ts`）记开着的是哪一次：退出动画没放完又点打开，立刻开一个新的，旧实例迟到的通知不会把它关掉。确认框（`ConfirmDialog`）是 sm 宽的同一外壳，破坏性确认用 `danger-solid`，打开时焦点在**取消**。**不叠对话框** |
| SectionHead / Row / ListRow | 分组标题 `.ui-section-head`：`--fs-sm` 粗 + 计数，右侧图标按钮或一个 sm 按钮，可带一行说明。设置行 `.ui-row`：最小 40 高，标签列 200，控件紧跟标签列，改过的值左侧 2px `--accent` 竖线、控件后面一个"恢复默认"图标按钮（悬停提示写出默认值）。列表行 `.ui-list-row`：28px 图标、名称 + 徽标、一行元信息、动作；删除 / 移除收进 ⋯ 菜单。外面包 `.ui-cards` 时排成卡片网格（`repeat(auto-fill, minmax(260px, 1fr))`，`--bg-raised` 底、1px `--border`、`--radius-lg`，动作在卡片底部靠右，元信息可换行） |
| Notice `.ui-notice` | 内联提示条：左 2px 等级色 + 同色 soft 底，`--radius-md`，`padding: --space-2 --space-3`；info（`--accent`）/ warning（`--st-waiting`）/ error（`--st-error`）；一句人话 + 最多一个动作 |
| Chip `.ui-chip` | 输入框工具条专用：28 高胶囊，**无底色**，悬停 / 打开时 `--bg-hover`；审批胶囊写出模式名，全自动用 `--st-waiting-text` |
| Disclosure `.ui-disclosure` | 展开 / 收起一律 chevron 转 90°，内容用 `ui/Reveal.tsx` 包；不用原生 `<details>` |
| InfoTip `.ui-info` | 设置行、表单字段的说明：标签后面一个 ⓘ，悬停 250ms 出现，点击固定，点外面或 `Esc` 关闭（`Esc` 只关它，不退出设置页）；弹层从 ⓘ 往右展开，右边会被最近的滚动 / 裁剪容器切掉时改成往左展开（`data-align="end"`，2026-10-22） |
| Tooltip | 2026-10-22 起全应用的 `title` 都由 `ui/Tooltip.tsx`（`TooltipLayer`，挂在 `App` 末尾，`data-testid="tooltip"`）画，不出 Windows 原生提示：指针停 500ms 出（刚收起一个时 400ms 内移到下一个元素 0ms），键盘 `:focus-visible` 立即；画在元素下方 6px，下方放不下翻到上方，左右离窗口边 ≥8px；离开、按下、按键、滚动、窗口失焦收起。`--bg-overlay`，1px `--border`，`--shadow-2`，`--fs-xs`，`--radius-sm`，最大宽 280，层级 `--z-tooltip`（80，在对话框和命令面板之上）；文字末尾的 `(Ctrl …)` 拆成尾随 Kbd |
| Toast | **气泡**（2026-10-20 起，仓库所有者："所有提示都应该用气泡悬浮提示,上方中间"）。`position: fixed`，不占布局：顶边在顶栏下 `--space-2`，水平居中于主区面板（侧栏之外那块纸，不是整个窗口；`Toasts.tsx` 用 `ResizeObserver` 量 `[data-testid="main-panel"]` 的左缘和宽度写进 `--toasts-left` / `--toasts-width`，侧栏收起 / 拖宽 / 抽屉、窗口缩放都跟着）；**层级 `--z-toast`(30) 低于菜单、浮层(40)和对话框(50)**，不盖住用户正在点的东西；多条向下叠放，最多 3；每条是一个 `--radius-pill` 的单行气泡：`--bg-overlay`、`--shadow-2` + 1px `--border-subtle`，`--fs-sm`，`[8px 等级圆点][文字（单行省略，完整文字在悬停提示）][×N 合并计数][可选一个文字按钮][×]`，最宽 `--toast-w` × 2。等级色只落在圆点上（`info` `--accent`、`success` `--st-done`、`warning` `--st-waiting`、`error` `--st-error`），警告和错误再加一圈同色 1px 细框。5 秒（`common.copied` 这类确认 1.2 秒）；`role="status"`（错误 `role="alert"`）；跨任务"等你确认"toast 点击切到该任务，不抢焦点。动效见 §2.6。omp 自己的提示（TSP 的 `toast` 节点）画成同一种气泡、排在同一叠放区里（`features/tsp/interactive/Toast.tsx` portal 进 `Toasts.tsx` 的 `.toasts-host`），停留时间仍按 omp 节点的 `tone` / `ttl`（成功 2.2 秒、其余 5.2 秒，`ttl` 只能缩短），整个窗口同一时刻一条，点一下收起；**例外**：role `omp.toast.status` 的状态行（`Session-only model: …` 等）不弹，留在对话里（§4.14「omp 的状态行」） |
| Kbd | 高 18，`padding: 0 5px`，`--fs-2xs`，`--bg-sunken`，`1px --border`，`--radius-xs`，`--font-mono`；Windows 显示 `Ctrl`，macOS 显示 `⌘` |
| OverlayScrollbar | 命中区 `--scrollbar-hit`，滑块宽 `--scrollbar-thumb-w`（hover 8px），`--scrollbar-thumb`（hover `--scrollbar-thumb-hover`）；平时隐藏，滚动时出现，停止 800ms 后淡出；**覆盖**在内容上不占布局宽度；原生滚动行为与键盘不重写；reduced-motion：常显、无淡入淡出。用于 `.scroller`、侧栏列表、设置页、命令面板、下拉列表等自绘的容器；其余容器的滚动条走全局样式（§5.4 "滚动条与横向溢出"） |

### 4.24 空状态与错误汇总

| 场景 | 呈现 | 恢复动作 |
|---|---|---|
| 侧栏无任务 | `sidebar.empty`（`--text-3`） | — |
| 搜索/面板无结果 | `palette.noResults` | `palette.askNew` |
| omp 进程意外退出 | 侧栏该行变错误态（`shared/ui/sidebar-model.ts`）；某个操作因此失败时弹错误 toast `error.exitedNoCode`（`TaskError.kind` 由 `shared/ui/errors.ts` 映射）。没有对话流末尾的内联条，也没有“重新连接”按钮 | — |
| 协议错误 | 同上：toast `error.protocol` | — |
| `prompt` 被拒 | 错误 toast：`msg.sendFailed` · 原因；草稿放回输入框（`features/composer/actions.ts`） | 用户重发 |
| 模型不可用 | 恢复任务时模型不可用：toast `error.modelUnavailable`（`TaskError.kind` = `restore_model_failed`）；没有输入框上方的内联条 | — |
| 本轮以错误结束（含模型返回错误） | 对话末尾 omp 自己的错误卡（`omp.error`；dock 里重复的错误横幅不画，`shared/tsp/error-turn.ts`） | `sessionInfo.retry.button`（发 `/retry`；只在末尾那张错误卡且任务空闲时出现，`RetryButton.tsx`） |
| 工具失败 | 工具卡片显示失败状态（omp 的节点，studio 照画） | — |
| 项目目录 / 工作区不存在 | 从历史恢复会话时目录已不在：toast `history.resumeFailed`（`TaskPool.resume` 先 `stat` 目录，不替用户迁移会话）；worktree 任务的工作区被删：输入框禁用，占位文案 `error.worktreeMissing`（`Composer.tsx`） | — |
| 渲染层崩溃（`render-process-gone`） | 只写日志（`main/log/instance.ts`），没有自动重载窗口，也没有 toast | — |
| 渲染层未捕获错误 | 没有全屏错误页，也没有错误边界 | — |

错误文案原则：说发生了什么、数据有没有丢、下一步按什么；不显示堆栈（堆栈只在“复制详情”里）。

### 4.25 ReviewView（全屏评审，阶段 3）

入口：顶栏评审按钮（`topbar-review`，`Diff` 图标，在分支胶囊右边）、提交对话框页脚左侧的 `评审改动`（关掉对话框再打开评审，提交前想看看改了什么）、`Ctrl Shift D`、命令面板 `打开评审`。分支菜单里**不放**评审项（2026-10-21 复核仍不放：顶栏按钮就在胶囊右边一步到位，菜单只放会改 git 的动作）；输入框上方没有改动条（2026-10-21 删除）。盖住顶栏以下的整个窗口（`position: fixed`，`z-index: --z-sticky + 2`，比输入框栈的 `--z-sticky + 1` 高一层，输入框不会透出来盖住评审底部；仍低于菜单 / 对话框），`--dur-fade` 淡入，底下的页面 `inert`；`Esc` 或 `退出评审` 关闭，焦点回到触发它的元素（已不在则回输入框）。切到别的任务或任务被删除时自动退出。实现在 `features/review/`，样式只用 token（`--diff-add-bg` / `--diff-del-bg` 是评审行背景，`--review-tree-w`(240) 是文件树宽）。

- **头**（`rv-head`，高 `--panel-head-h`(40)，下边 1px `--border-subtle`；3.2 起，`direction-3.2.md` §5）：左起 `退出评审`（`Button` quiet sm，× 图标，`review-close`）、标题 `review.title`、分支名（等宽 `--fs-xs` `--text-3`，`review-branch`）；右侧依次是视图选项、↻ 刷新（`IconButton`，`review-refresh`）、`评论 N`、主按钮 `发给 agent 修改`（`Button` primary sm，`review-send`；队列为空时禁用，发送中 loading；任务在运行时悬停提示说明是插话还是排到本轮之后（`review.sendSteer` / `review.sendFollowUp`），取输入框同一个设置 `enterWhileRunning`）。
  - **视图选项**（`ViewControls.tsx`）：窗口 ≥1100px 时是两个 `Segmented` sm——`统一 / 并排`（`review.layout`，`mode-unified` / `mode-split`）和 `改动块 / 文件`（`review.scope`，`scope-hunks` / `scope-file`）——加 `折行` `IconButton`（`Wrap` 图标，`pressed`，`wrap-toggle`，悬停提示 `折行 (W)`）。<1100px（`(max-width: 1099px)`）三者收进一个 `视图` 按钮（`Button` sm，`Sliders` 图标，`view-menu`，`review.view`），点开 `ui/Menu`：小节 `对比方式`（统一 / 并排，当前项 ✓）、分隔线、小节 `查看范围`（改动块 / 文件）、分隔线、`折行`（✓，右侧提示 `W`）。选择存 `review-store`，会话内记住，关掉评审再打开沿用。
  - **`评论 N`**（`CommentQueue.tsx`）：`Button` sm（`Comment` 图标，`comment-queue-button`），文字 `review.tabComments` + accent `Badge` 计数（`comment-count`）；没有评论时禁用，悬停提示 `review.queueEmpty`。点开 `ui/Menu`（`comment-queue`，`review.queue`）：每条一项 `文件:行`（`queued-comment`），第二行是正文前 80 字（评论旧版本时前缀 `旧版本 ·`）；按文件首次出现顺序、文件内按起始行排序（`sortComments`，与发出去的消息一致）。点一项切到那个文件，并把 diff 里对应的行内评论卡滚到中间。
- **两栏**（2026-10-22 起，`direction-3.2.md` §7 第 6 条：评论只留 diff 里的行内卡片；原来的右栏 `改动说明 / 评论（n）` 两个页签已删除）：左 `rv-side`（`--review-tree-w`，`--bg-sidebar`，右边 1px `--border-subtle`）= 文件树 + 提交框；右 diff（`rv-main`）。<1000px 文件树收窄到 `--sidebar-w-min`。
  - 文件树：`已暂存 / 未暂存 / 未跟踪` 三组，空组不显示；同一文件两侧都有改动时各出现一次；行 = 状态字母 + 路径（目录部分 `--text-3`）+ 行尾 `+a −d`（`--diff-add-fg` / `--diff-del-fg`，等宽 `--fs-2xs`，数字来自主进程一次 `getGitChangeStats`：暂存 / 未暂存各一次 `git diff --numstat`，未跟踪文件直接数行；二进制、过大的文件没有数字）。
  - **提交框**（`CommitBox.tsx`，`review-commit`，`--border-subtle` 上边线）：标题 `提交改动` + `已暂存 n 个文件`；摘要 `TextField`（通宽，32 高，占位 `review.commitSummaryPlaceholder`，必填）；说明 `Textarea`（3 行，不可拖大小，可选）；底行左 `Checkbox` `先暂存全部改动`（默认不勾：评审里暂存是显式动作）、右主按钮 `提交`（`Button` primary sm，摘要为空时禁用，提交中 loading）；`Ctrl Enter` 在摘要 / 说明里提交。走和提交对话框同一条路径（`git-actions.ts` 的 `commitChanges` → `commitGit`，提交信息 = 摘要 + 空行 + 说明，`composeCommitMessage`），成功后清空摘要和说明，无论成败都重取状态；失败 / 没有可提交内容走同样的 toast。没做 `生成提交信息` 和 `Amend`（没有对应的 IPC）。
- **diff**：文件头（路径、`+a −d`、`暂存`（已暂存一侧是 `取消暂存`）、`丢弃`；都是 `Button` sm，丢弃是 danger）；每个 hunk 一个带 1px `--border-subtle` 的块，头部 `@@ … @@` + 区段名 + 该 hunk 的 `暂存 / 取消暂存 / 丢弃`（同样 `Button` sm；未跟踪文件没有 hunk 级操作）；当前 hunk 边框 `--accent`。**改动块 / 文件**（头里的分段，默认改动块）：改动块 = 上面这种每处改动加 3 行上下文；文件 = 整个文件连成一个 hunk（主进程用 `-U1000000` 取 diff，`getGitFileDiff(…, "file")`），不画 `@@` 头和 hunk 级暂存 / 丢弃（hunk 级操作按 `-U3` 的 header 对账，文件视图里只剩文件头的整文件操作），`N / P` 改成在改动块之间走（连续的增删行算一块，当前块的第一行描 1px `--accent`）。**折行**默认开；关掉后代码 `white-space: pre`，每个 hunk 自己横向滚动（`overflow-x: auto`，行撑到最长一行那么宽，背景和竖条铺满；评论框和 hunk 头 `position: sticky; left: 0` 贴在可见区左边）。行等宽 `--fs-code-sm`，自动换行；新增行 `--diff-add-bg`、删除行 `--diff-del-bg`；语法高亮复用 Shiki（`--syn-*`）。统一视图**一列行号**（2026-10-21 起照 Tern，原先是旧 / 新两列；宽 `--rv-no-w` = `--space-12` + `--space-2`，能放下 4 位行号再留出悬停的 `＋`），删除行写旧行号、其余行写新行号（和评论按钮的一侧一致：删除行评论旧版本，其余评论新版本）；**新增 / 删除行左缘有 2px 绿 / 红竖条**（`--diff-add-fg` / `--diff-del-fg`，`box-shadow: inset`；已评论的行在它外面再叠一条 2px `--accent`，两条并排不抢位置）；并排视图左旧右新（删除块与新增块逐行配对）。**行号永远显示**（不论悬停与否），长行折成几行时行号和符号贴着第一行，不在整块的垂直中间（Tern 里 omp 的 diff 也这样）。二进制、过大、没有文本改动、非 git 仓库、没有 git、没有改动都有各自的一句话状态。
- **丢弃**一律先确认（`ConfirmDialog` danger，`review-discard-dialog`：sm 宽、确认键 danger-solid、打开时焦点在取消，Esc 取消；§4.23），文案说明哪个文件 / 哪处改动、不可撤销（未跟踪或新增的文件写“会被删除”）；确认框放完退出动画才执行丢弃。
- **评论**：行号就是评论按钮（键盘 Tab 可达）；悬停或键盘聚焦时在**行号左边**出现一个 `＋`（`--accent`，绝对定位在行号列左缘，不占位），行号本身不动、不变透明，只是文字色从 `--text-3` 提到 `--text`。2026-10-21 之前 `＋` 和行号叠在同一格里、悬停时行号被换成 `＋`，被删除的长行（行很高）悬停后旧行号列只剩一个 `＋`，看上去像“删除行没有行号”（`test/e2e/review.e2e.ts` 的“删除行的旧行号一直在”钉住）。点一下 = 对这一行评论，Shift 点击把范围扩到这一行（只能在旧或新同一侧内，跨侧则从该行重新开始）。删除行评论旧版本行号，其余评论新版本行号。评论框（`comment-box`）画在范围最后一行下面：3 行 `Textarea` + `取消`（`Button` sm）/ `添加评论`（primary sm，空时禁用；编辑已有评论时是 `保存`），`Ctrl Enter` 提交，`Esc` 只取消评论框。已添加的评论是行下的卡片（`comment-card`：`--bg-raised`、1px `--border-subtle`、`--radius-md`；评论旧版本时正文前一枚 `旧版本` 小标签），编辑 / 删除收在右上角 ⋯（`IconButton`，`comment-more`，`review.commentActions`）点开的 `ui/Menu` 里：`编辑`（铅笔图标，`comment-edit`）、分隔线、红字 `删除`（垃圾桶，`comment-delete`）。被评论的行左侧 2px `--accent` 竖条。
- **评论队列**：队列在评审关闭后继续保留（同一任务再打开还在），只在发送成功后清空、任务删除时丢弃，不持久化；超过上限（`REVIEW_COMMENTS_MAX`）时不收并 toast `review.queueFull`。`发给 agent 修改`：成功后关闭评审、清空队列、toast `评论已发给 agent`；失败保留队列并报错。
- **键盘**（不带修饰键、焦点不在输入框 / 文本域、命令面板没开时生效）：`J / K` 下/上一个文件，`N / P` 下/上一处改动（滚到可见并高亮），`V` 切换统一/并排，`F` 切换改动块/文件，`W` 切换折行，`Esc` 退出（提交框的输入框里不触发）。`Tab` 序：头 → 文件树 → 提交框 → diff（行号按钮）。
- 数据：状态在 打开、窗口重新聚焦、任务状态变化、手动刷新、每次暂存/丢弃之后向主进程重取，diff 和文件树的 `+a −d` 随之重取；不缓存第二份。
- **对标 Tern**（2026-10-21，用 `tern web serve` + 临时 git 仓库实测，截图 `screenshots/tern-review-{split,inline,hunks}.png`）：Tern 的评审是点开分支标签出来的全宽 diff 加右侧文件面板（`3 changes on master`、路径 / 树切换、`Unstaged / Staged` 分组 + `Stage all`、每个文件 `+6 −2` 和状态字母、底部提交框 `Summary / Description / Generate message / Amend`），diff 头一行：文件名、`+a −d`、`Unstaged` 徽章、上/下一个文件箭头、`File / Split / Inline / Hunks` 分段、换行开关、`Stage file`、快捷键提示、关闭。已采纳：行号贴着折行后的第一行（见上）。2026-10-21 所有者批准了下面五项，已全部做进上面各条：① 文件树每行 `+a −d`（我们新增了 `getGitChangeStats`，一次出所有文件的数，不逐个取 diff）；② 变更行左缘红 / 绿竖条（和“已评论”的 `--accent` 竖条并排）；③ 统一视图一列行号；④ `改动块 / 文件` 视图和折行开关（Tern 另有 `Split / Inline` 与 `File / Hunks` 并列，我们把统一 / 并排和改动块 / 文件拆成两个分段）；⑤ 评审里内嵌提交框（没有 `Generate message` / `Amend`：没有对应的 IPC，不为它加 git 功能）。Tern 的评审里没有逐行评论。
- **git 菜单与对话框**（`features/git/`，3.2 起；主进程一侧见 `docs/architecture/git.md`）：
  - 分支胶囊的 Git 菜单（`GitTools.tsx`）是 `ui/Menu` 动作菜单，每项带图标：`提交`（✓）、`推送`（↑）、`创建 PR`（↗，`canPush` 时才列）；worktree 任务再加 `合并回 <基分支>`（分支图标）、分隔线、最后一项红字 `丢弃 worktree`（垃圾桶）。不能用的项灰显、不执行，原因写在第二行（如推送：`git.push.noRemote` / `git.push.detached`）。新任务草稿的分支胶囊（`DraftGitTools.tsx`）是选择菜单，只有一项 `在独立 worktree 里开始`，开着时第一列 ✓（`menuitemradio`），不能用时第二行写 `git.draft.blocked`。
  - 对话框（`GitDialogs.tsx`）都是 `ui/Dialog`：**提交**（`git-commit-dialog`）= `提交信息` `Textarea`（4 行，`Ctrl Enter` 提交）；页脚左侧（`footStart`）`Checkbox` `先暂存全部改动`（默认勾）+ quiet sm `评审改动`（`git-commit-review`，关掉对话框并打开评审）；右侧 `取消` / 主按钮 `提交`（loading）。**创建 PR**（`git-pr-dialog`）= 标题 `TextField` + 说明 `Textarea`，主按钮 `推送并创建`。**丢弃 worktree** = `ConfirmDialog` danger（`git-discard-dialog`，焦点在取消）；确认后对话框先关，丢弃失败由 toast 报错，对话框不再回来。合并冲突、清理无主 worktree 是只有一个主按钮 `关闭` 的列表对话框；setup 脚本确认是 sm 对话框（焦点在取消，任何方式关闭都算拒绝）。

### 4.26 TerminalPanel（内置终端，阶段 6）

入口：顶栏右端的终端图标按钮（`aria-pressed` = 面板开着）、`Ctrl \``、命令面板 `切换终端`。在对话页出现：已有任务的页面和新任务草稿（空状态）页都有——草稿页顶栏只有终端按钮，没有分支/评审工具；设置页不显示。实现在 `features/terminal/`，样式只用 token，细节和主进程一侧见 `docs/architecture/terminal.md`。

- **位置**：主区面板最底部（输入框下方），顶边 1px `--border`，上边缘压一条 4px 拖拽条（`row-resize`，悬停 `--border-strong`）。对话区在上方 `flex: 1`，面板打开时对话区只是变矮：吸底时继续吸底，没吸底时阅读锚点不动（面板高度变化走和窗口缩放同一套 `ResizeObserver`）。
- **高度**：默认 280px，最小 120px，最大主区面板高度的 70%（窗口变矮时渲染时重新夹取，最小值优先）；拖动中只改内存，松手写进外壳状态（`terminalHeight`，和侧栏宽度同一处持久化）；拖拽条获得焦点时 `↑ / ↓` 每次 16px，双击恢复默认。
- **头**（高 `--row-tool`）：终端图标、shell 名（等宽，如 `pwsh.exe`）、目录最后一段（`--text-3`，悬停显示完整路径）、右侧 `重启终端`、`隐藏终端`。`隐藏` 只收起面板，shell 继续在主进程里跑；`重启` 结束当前 shell 并在同一目录新起一个。
- **正文**：xterm.js（DOM 渲染器），背景 `--bg-sunken`，前景 `--text`，光标 `--accent`，选区 `--selection-bg`；字体 `--font-mono`，字号 `--fs-code`。ANSI 16 色从语义 token 推：红 `--st-error`、绿 `--syn-string`、黄 `--st-waiting-text`、蓝 `--syn-func`、品红 `--syn-keyword`、青 `--syn-type`，黑/白两端随主题翻转，亮色朝 `--text` 走一段；`minimumContrastRatio` 4.5。设置里切主题或系统深浅色变化时重新读 token。
- **打开**：每个任务一个终端；面板按任务记开关（切到别的任务再回来仍是开着的，接着原来的 shell；重启应用后默认收起）。用户主动打开时焦点进终端，切换任务时挂载的面板不抢焦点。目录（worktree 根或项目目录）已不存在时在终端区显示一句错误，按任意键重试。
- **草稿的终端**：新任务草稿也能开终端，面板在空状态下方，目录是草稿项目的目录（没有项目时是 chats 目录）。发出第一条消息创建任务时，草稿的终端（同一个 shell、同一份屏幕）连同面板的打开状态交给新任务，面板保持打开；开了 worktree 的任务目录不同，草稿的终端被关掉，任务的面板重新起。草稿切换项目时关掉上一个项目草稿的终端。
- **退出**：shell 自己退出时终端里追加一行灰色（`--text-3`）提示 `[进程已退出，代码 N] 按任意键重新启动`，按任意键在同一目录重新启动（新屏幕）。
- **键盘**：终端聚焦时按键归 shell（包括 `Esc` 和 Ctrl 组合键，它们不会冒泡成全局快捷键）；例外：`Ctrl \`` 回到输入框并收起面板，`Ctrl C`（有选区时）和 `Ctrl Shift C` 复制，`Ctrl V` / `Ctrl Shift V` 粘贴。没有选区的 `Ctrl C` 照常是 `^C`。

### 4.27 FilePreviewPane（右侧文件面板：文件树 + 预览，2026-10-20 起照 Tern 里 omp 点文件 chip 的侧栏，2026-10-21 加文件页）

入口两个：① 工作记录里工具卡上的文件路径（`FileLink`，`file-link`，显示文件名，完整路径在悬停提示里）直接打开**预览页**；② 顶栏右侧工具区的“文件面板”按钮（`IconButton`，`topbar-files`，`Folder` 图标，在分支/评审之后、终端之前，`aria-pressed` = 当前任务的面板开着；悬停提示带 `Ctrl Shift E`）、快捷键 `Ctrl Shift E`（§5.1）和命令面板的 `文件面板`，打开**文件页**，再按一次关闭。新任务草稿也有：选了项目时根目录是项目目录，没选项目（默认文件夹）时根目录是 `AppInfo.chatsDir`（2026-10-21 起；目录第一次发送时才建，没建时文件页显示 `preview.emptyDir`，只读浏览不建目录）。面板开合状态按任务 / 草稿各记各的（草稿发出第一条消息后变成任务，那个任务的面板是关着的）。主区右侧打开面板（`file-preview`，默认占主区约 36%，左缘可拖动或用 ←/→ 调宽，最宽 70%，宽度只存内存），主区（对话 + 输入框）不低于 `--main-min-w`（480px），窗口窄时面板先缩（最小 280px），输入框工具行不会被挤成多行；同一时间只有一个面板；只在对话页、且面板属于当前任务（或当前草稿）时显示。

头部（`file-preview-head`，高 `--panel-head-h`）：左边顶层页签 `ui/Tabs` `文件 | 预览`（`preview.pageFiles` / `preview.pagePreview`，`file-preview-page-files` / `file-preview-page-preview`；没打开过文件时“预览”页签禁用；3.2 起，`direction-3.2.md` §5，原来是自绘的分段按钮），右边是文件页才有的刷新 ↻（`IconButton`，`file-tree-refresh`，重读根目录和所有展开的目录）+ 关闭 ×（`IconButton`，`file-preview-close`，悬停提示带 `Esc`）。两页同时挂载、切页只是显隐，所以树的滚动位置和已加载的目录不丢。

**文件页**（`file-tree`，`role="tree"`）：根目录跟着任务的工作目录（开了 worktree 就是 worktree 目录），草稿用草稿的项目目录。只在展开时才向主进程要那一层（`listDirectory(target, relDir)`，见下）：目录在前、文件在后，同类按名字排（不区分大小写，数字按数值）；不列 `.git`；被 `.gitignore` 忽略的条目照列，文字用 `--text-3` 调暗（主进程在该目录里跑 `git check-ignore`，不在仓库里或 git 不可用时没有标记；不隐藏，所以 `node_modules`、`dist` 看得见但不抢眼）；指到根目录外的符号链接和断链不列出。行高 `--row-tool`，定高虚拟化，只画眼前的行（一层 1500 项也只有几十个 DOM 节点）；缩进每层 `--space-4`，目录前是 12px 箭头 + 14px 文件夹图标，文件前是 14px 文件图标，图标 `--text-3`，名字单行省略、悬停提示相对路径；hover `--bg-hover`；正在预览的文件 `--accent-soft` 底；光标行（键盘）在树获得焦点时有 2px `--focus-ring` 内描边。一层超过 20000 项时只留排序靠前的，末尾一行 `preview.truncated`（`--fs-xs` `--text-3`）。空目录（根）显示 `preview.emptyDir`。展开状态、光标行和滚动位置按任务（或草稿）记在内存里，关掉面板、切走任务再回来仍在；切回文件页和点刷新时重读已展开的目录。读目录失败（不该发生）走 `reportError` 并收起那个目录。

键盘（树有焦点时；打开文件页时焦点自动进树）：`↑ ↓` 移动光标，`→` 展开目录 / 已展开则进入第一个子项，`←` 收起 / 回到父目录，`Enter` 或空格 = 文件打开预览（切到预览页）、目录展开收起，`Home / End`，`Esc` 关闭面板。点击：目录展开收起，文件在同一面板里切到预览页。

**预览页**：工具栏（`file-preview-bar`，高 `--control-h-md`）：文件图标 + 文件名 + 路径（和文件名相同时不重复）；右边按需出现：`渲染 / 源码`（`Segmented` sm，`preview.mode`，`file-preview-mode-preview` / `file-preview-mode-source`；只有 Markdown、SVG、HTML 有）、HTML 渲染时的 `运行脚本` `Checkbox`、图片渲染时的缩放组（`−` / `+` 两个 `IconButton` 夹一个 quiet sm 按钮，按钮写 `适应窗口` 或当前百分比，点它回到适应窗口；每步 ×1.25，10%–800%；从适应窗口开始缩放时以当时的实际比例为起点，大图适应窗口只有 25% 时点 `−` 是变小不是变大；放大后按住左键拖动平移，`cursor: grab`，图片不能原生拖出，2026-10-22）、用系统默认应用打开（`IconButton`，`file-preview-open`，`openTaskFile` 白名单里的类型才有）、在文件夹中显示（`IconButton`，`file-preview-reveal`，`revealTaskFile`）；后两个只有任务有，草稿的项目目录里没有。按类型渲染：`.md` / `.markdown` 渲染 Markdown，可切到源码；图片（png/jpg/gif/webp/svg）用 `<img>` 加载 data URL，适应面板宽度，可缩放，SVG 也只当图片、可切源码；`.html` 放进没有 `allow-same-origin` 的 `<iframe sandbox>`，脚本默认关，勾“运行脚本”才放行，可切源码；其他文本用 `CodeBlock` 语法高亮整段显示；二进制（前 8000 字节含 NUL）和过大（文本 > 2 MB、图片 > 20 MB）只给提示和“默认应用打开”。

主进程：内容一律经 `readPreviewFile(target, path)` 读，目录经 `listDirectory(target, relDir)` 列，`target` 是 `{ kind: "task", taskId }`、`{ kind: "project", projectId }` 或 `{ kind: "defaultFolder" }`（渲染进程不传根路径，由主进程按 id 查；`defaultFolder` 不带任何字段，主进程自己取 `chatsDir()`，`@` 补全用同一个 target，默认文件夹的草稿里也能用）。相对路径按根目录解析，落在根内的绝对路径先换成相对路径，越界（绝对路径、`..`、符号链接解析后在根外，`resolveInsideReal` / `listDirectory` 的 realpath 校验）拒绝；读文件不存在返回 `missing`，列目录不存在返回空列表，`@` 补全根目录不存在时没有候选（`@` 补全不收名字里有空白的文件，这是已有行为）。打开面板时焦点进面板（预览页）或进树（文件页），Esc 或 × 关闭并把焦点还给打开前的元素。实现在 `features/file-preview/`（`FilePreviewPane` 外壳、`FileTree` + `tree-model.ts` 纯逻辑、`PreviewPage`/`PreviewContent`）与 `src/main/files/`（`list-directory.ts`、`preview-file.ts`）、`src/main/ipc/file-handlers.ts`（`parseFilesTarget` / `targetCwd`）。参照说明：Tern 的命令行帮助里只有 `tern open [--preview] PATH`（在标签页旁开文件块），没有文件树（只查了 `tern help` / `tern open --help`，没有逐个点界面），所以树的交互参照常见编辑器的资源管理器。

**工作区目录（`/add-dir`，2026-10-21 起；只有任务有，草稿没有）**：文件页头部下面一行（`workspace-roots`，`file-preview-roots`，`--fs-xs`，下沿 1px `--border-subtle`，窄时折行）：有额外目录时先是一枚 `任务目录`（`workspace-root-0`）和每个额外目录一枚胶囊（`workspace-root-<n>`，显示目录名、悬停提示完整路径，`aria-pressed` = 树当前看的根，高 22、`--radius-sm`、1px `--border-subtle`，选中 `--bg-raised`）+ 紧挨着的 × `IconButton`（`workspace-root-remove-<n>`，`aria-label` = `preview.removeDir`，悬停提示 `preview.removeDirTitle`“从工作区移除（不会删除文件夹）”）；行尾总有 `添加文件夹…`（`Button` quiet sm，`Plus` 图标，`workspace-add-dir`，悬停提示 `preview.addDirTitle`；3.2 起，原来是虚线描边的独有按钮）。有额外目录时整行的悬停提示 `preview.dirsNote`：额外目录只在这次运行里有效（实测 omp 不把它们写进配置，进程退出就没了，所以列表随进程清空，树里选的根落回任务目录）。点胶囊 = 树换成那个根（展开状态、光标、滚动位置按“任务 + 根”分别记）；预览页看的是打开文件时的那个根（`PanelState.root`），切根不会让预览读错目录。`添加文件夹…`：主进程弹系统文件夹选择框（`addWorkspaceDir(taskId)`，渲染进程不传路径），选中后在这个任务自己的 omp 里执行 `/add-dir <路径>`，成功后选中新根并弹一条 `preview.dirAdded` toast；取消什么都不做；omp 拒绝（目录不存在、已在工作区）时错误 toast 显示 omp 原文（`reportError`）。× = `removeWorkspaceDir(taskId, 下标)`，主进程按它记的列表取路径执行 `/remove-dir`，成功后如果正看着这个根就回任务目录。执行期间 `添加文件夹…` 和各个 × 禁用。命令走 `TspRunner.runSessionCommand`：没有进程时先启动 omp，在任务的界面操作队列里串行执行，不等这一轮结束；有审批或提问在等、或 omp 的面板开着时立刻 reject（`#awaitComposer`），同样是错误 toast。斜杠命令是快捷入口（`tsp: "studio"`，`features/file-preview/dirs-slash.ts`）：`/dirs` 向 omp 重新问一次列表并打开文件页；`/add-dir` 不带路径弹选择框、带路径把用户输入的整行交给 omp（相对路径按任务目录解析）；`/remove-dir` 不带路径只打开文件页、带路径执行。

数据流：`TaskState.workspaceDirs`（额外目录，不含任务 cwd，按 omp 给的顺序）只来自 omp 的输出——`/dirs`、`/add-dir`、`/remove-dir` 的状态 toast（`omp.toast.status`），解析在 `src/shared/omp-output/dirs.ts`（`parseDirsOutput`，用 omp 18.12.5 实测原文写单测）；主进程 `tasks/workspace-dirs.ts` 记最近一次的列表，`TaskPool.runWorkspaceDirsCommand` 执行并更新，解析不了或 omp 拒绝时以 omp 原文 reject、列表不变。命令文本由封闭的 `TaskCommand`（`addDir` / `removeDir` / `dirs`）拼，路径是命令名后面的整行，**绝不加引号**（实测引号会被当成路径的一部分），含换行 / 控制字符的路径被拒绝。

**路径校验放宽（2026-10-21 所有者拍板）**：从“只能在任务目录内”变成“在任务目录内，或在这个任务的某个工作区目录内”。渲染进程只能用整数下标选根：`ProjectFilesTarget` 的 `{ kind: "task", taskId, root? }`（`root` 缺省 / 0 = 任务 cwd，n = 第 n 个额外目录，0…64 的整数，`parseFilesTarget` 校验；别的 kind 的 `root` 被丢掉），`openTaskFile` / `revealTaskFile` 的第三个参数同理；绝对根路径由主进程从自己记的 omp 列表里按下标取（`files/task-roots.ts` 的 `rootDir`），下标过期（目录刚被移除）直接 reject，不会落到别的根。选定根之后的校验和以前完全一样：相对路径、`..`、符号链接解析后（`resolveInsideReal` / `listDirectory` 的 realpath）必须在**那个根**内——额外目录里的链接指向任务目录或别的地方同样被拒绝。`@` 补全仍然只在任务 cwd 里找（不扫额外目录）；工具卡上的文件链接按任务 cwd 解析，落在额外目录里的绝对路径不会被换算。

### 4.28 子代理面板（右栏，TSP 任务，S1Agents；2026-10-21）

代码 `features/agents/`（`AgentsPanel` 外壳 + `AgentRow` + `AgentDetail` + `SteerBox`，`agents-store.ts` / `agents-actions.ts` / `agents-slash.ts`，样式 `agents.css`），文案 `agents.*`。**不弹 omp 的 Agent Hub**：`👥` 胶囊、`/hub`、命令面板都打开这个面板。数据来源和后台驱动 Hub 的步骤见 `docs/architecture/subagents.md`。

**入口**：① hud 里 `👥 N agents running` 胶囊（omp 的 `omp.hud.seg`，点击动作 `agents.open`）——`tsp/actions.ts` 的 `runAction` 认出这个动作名（`shared/tsp/agent-hub.ts` 的 `isHubOpenAction`）就改开面板，**不把动作发给 omp**；② 命令面板 `子代理（查看、插话、结束、恢复）`（`agents`，只在 TSP 任务里列，再选一次关闭）；③ 斜杠命令 `/hub`（`tsp: "studio"`）；④ 后台任务弹层里子代理作业的“查看”（S2Jobs 调 `openAgentsPanel(taskId, name)`，打开并选中那一个）；⑤ 顶栏文件按钮右边的子代理按钮（`AgentsToggle`，`topbar-agents`，2026-10-22 起；只在任务里有，`toggleAgentsPanel`，子代理都结束、药丸左半段消失后仍能从这里打开）。面板和文件面板同一栏，**同一时间只开一个**：开子代理面板先关文件面板（`openAgentsPanel`），文件面板一打开 `App` 就收起子代理面板；Esc 或 × 关闭，焦点还给打开前的元素。只在对话页、且面板属于当前 TSP 任务时显示；宽度和文件面板共用（`usePreviewWidth`，默认约 36%，左缘拖动 / ←→ 调宽，最宽 70%）。

**布局**（`agents-panel`，外框沿用 `.file-preview`，其余样式都是 `agents.css` 里的 `agents-*` 类；2026-10-22 重做，仓库所有者提的"该优化"）：头部 `子代理` + 个数（`agents-count`）+ 关闭 ×（`IconButton`，`agents-close`）；中间一个滚动区（`agents-body`：列表 + 详情），**插话框钉在面板底边**不随详情滚动。**列表**（`agents-list`，每行 `agents-row`，`data-name` / `data-status`）：状态点、名字、`后台` 小标签（类型只在不是默认的 `task` 时显示）、右端状态文字（运行中且 omp 给了完成度估计时换成小进度环 + 百分比，`agents-row-progress`，悬停提示 `子代理自己估计的完成度：55%`；2026-10-22，照 Tern 里 omp 的子代理磁贴）；第二行是正在用的工具和意图（`bash · Running sleep 75`），没有工具时是任务说明的第一句（去掉 Markdown 的 `#`）；运行 / 等待中的排在前面；总有一行选中（没点过就是第一行，同 omp 的 Agent Hub；2026-10-22 起再点不取消），选中行 `--accent-soft`。**详情**（`agents-detail`，在列表下方，不再套卡片）：标题行 = 名字 + 模型（等宽、`--text-3`）+ 右端 `结束`（`Button` danger sm，`agents-kill`，运行中才有）或 `恢复`（`Button` sm，`agents-revive`，被结束或挂起的才有）；统计格（`agents-stats`，`--bg-sunken` 圆角块，数字在上、标签在下：完成度（只在运行中有估计时）、费用、token、请求、工具调用、用时、上下文；**费用和 token 折在详情里，不进列表行**）；下面三块的标题都是 `SectionHead`（3.2 起，`direction-3.2.md` §5，原来是 12px 灰字）：**任务**：omp 给的原文 Markdown（`agent` 节点下 `omp.task.assignment` 子节点，带换行；`# Target / # Change` 这类标题和正文同字号只加粗），全文显示（同 omp Hub 详情的 Task 字段）；**最终输出**（Markdown，来自 omp 写在会话目录里的 `<名字>.md`；运行中显示 `agents.outputRunning`）；**对话记录**（`agents-record`；标题是 `Disclosure`（`agents-record-toggle`），**默认展开**，同 omp Hub 详情里一直显示的 Recent activity；展开时标题行右端一个 quiet sm `重新读取`（`agents.recordRefresh`）；子代理历史里的工具调用、叙述、思考，读 `<名字>.jsonl`，用 `features/conversation/` 留下的 `buildTurns` + `ProcessDetails` 渲染；运行中每多一次工具调用自动重读，结果还没写进来的那次调用显示转圈 + `Running`、叙述不当结论；2026-10-22）。**插话框**（`agents-steer`）：2 行 `Textarea`（`agents-steer-input`，占位 `给 {name} 插话，例如：先别改测试`，长度上限 `subagentLimits.steerChars`）+ 右下主按钮 `发送`（`Button` primary sm，`ArrowUp` 图标，`agents-steer-send`，空文字时禁用）。没有子代理时列表位置显示空状态 `agents.empty`。**历史子代理**：同一个 omp 进程里，之前回合的子代理（`done`）一直在列表里；`--resume` 恢复的会话里旧子代理显示为"已挂起"（可恢复，见 `docs/architecture/subagents.md`）。

**操作**（都是主进程在后台驱动 omp 的 Agent Hub，见 `docs/architecture/subagents.md` "后台驱动 Hub"）：**插话**（`SteerBox`：Enter 发送，Shift+Enter 换行，输入法组字时不发；运行 / 等待 / 空闲 / 挂起的子代理才有，已完成 / 被结束 / 失败的没有）、**结束**（运行中才有；omp 自己对 kill 没有确认框，所以点 `结束` 先弹 `Popover` 行内确认（`agents-kill-confirm`，`kind="confirm"`：宽 300、最小 280，右对齐、向下展开）：标题 `结束`、正文 `agents.killConfirm`（`结束 X？它正在做的事会被中止（之后可以恢复）。`），按钮 `不结束`（sm，打开时获得焦点）/ `结束子代理`（danger-solid sm，`agents-kill-yes`））、**恢复**（被结束或挂起的才有）。**驱动期间**（`useTspDrive`，调 IPC 前后）面板顶部出现一条 `agents-driving`（`role="status"`，`data-op` = steer / kill / revive，`data-name`）：`正在发给 Beta…` / `正在结束 Beta…` / `正在恢复 Beta…` + 一行小字说明 studio 在后台操作 Agent Hub、完成后自动恢复主输入框；面板里所有操作按钮和插话框此时停用。**omp 的 Hub 不画出来**（`TspView` 的 layer 区在驱动期间不渲染 picker），过程区压暗且不可点（`.tsp-surface[data-driving]`，`opacity: 0.45`；聚焦模式里过程区暂时是那个子代理的记录，不能当成主对话）；`useTspPanelOpen` 在驱动期间不把这个 Hub 当“面板开着”，主输入框照常可输入——此时发出的消息主进程让它等驱动结束再发到主会话，**不会变成对子代理的插话**。结果用一条 toast（`已发给 Beta` / `已结束 Beta` / `已恢复 Beta`），失败用 `reportOmpError` 带 omp 的原文（例如恢复运行中的子代理时 `Only parked or killed agents can be revived`），插话失败时文字留在框里。

**列表的数据**直接来自 TSP 文档（`shared/tsp/agent-hub.ts` 的 `listAgents`：task 工具卡片下的 `agent` 节点，按名字去重取“更活”的；卡片已结束而节点还写着等待 / 运行的当作挂起），渲染进程用 `useTspDerived` 推导，随 omp 的帧实时更新，**不需要 IPC**；记录和最终输出经 `getTspSubagentRecord(taskId, name)`（主进程只读会话目录里的 `.jsonl` / `.md`，名字限 `isAgentName`、路径必须落在会话目录内，读不到给 `unavailable` + 原因，界面显示原因不吞错）；三个操作经 `steerTspSubagent` / `killTspSubagent` / `reviveTspSubagent`（渲染进程只传任务 id + 名字 + 文字，名字必须是文档里确有的子代理）。

**降级**：omp 改了 Hub 的 role / action 名（`agents.open`、`kill`、`revive`、`omp.composer.focus`、`focus:Main`）时三个操作超时失败，主进程照样走恢复（Esc 关 Hub、退出聚焦），恢复不了才以明确错误抛出；列表、详情、记录不依赖 Hub，不受影响。

**可访问性与动效**：面板 `aria-label`，列表项是真按钮（`aria-current` = 选中），`agents-driving` 是 `role="status"`；驱动横幅的圆点呼吸动画沿用 `--play-state`（减少动效时静止）。

### 4.31 会话信息、请求记录与分享（对话框，S3；2026-10-21）

代码 `features/session-info/`，样式 `session-info.css`，文案 `sessionInfo.*`。**不弹 omp 的 `/session`、`/trace`、`/pin`、`/share`、`/retry` 界面**：这五条斜杠命令由 studio 接管（`tsp: "studio"`），数据和动作的取舍见 `docs/architecture/session-history.md` "会话信息"。

入口：① 任务菜单（顶栏任务工具区最右的 `⋯`，`task-menu`，`SessionMenu.tsx`，只在对话页且有任务时出现；和侧栏任务行的 ⋯ / 右键是同一份 `buildTaskMenu`，§4.6）里的 `会话信息`、`请求记录`、`分享链接…`；② 命令面板：会话信息、请求记录、分享会话链接…、置顶 / 取消置顶本会话、重试上一轮（任务空闲时）；③ 斜杠命令 `/session`（概览页）、`/trace`（请求记录页）、`/pin`（切换置顶，提示一条 toast）、`/share`（确认框）、`/retry`。**分享只从这三处进**，会话信息框里没有分享入口（3.2 起，`direction-3.2.md` §2.3：从框里点会在对话框上再叠一个对话框）。

**外壳**：两个框都是 `ui/Dialog`（§4.23：居中、遮罩、右上 ×、Esc 关闭且不触发“停止任务”、Tab 在框内循环、关闭后焦点还给打开前的元素、点遮罩关闭、开着时 `useTitleBarDim`）。会话信息框是 lg（`--dialog-w-lg` 720，`session-info-dialog`），两个页签共用这个宽度，页面区最小高 360；分享框是默认的 md。两个框由 `SessionInfoHost.tsx` 挂载，状态在 `session-info-store.ts`（已开着时再打开只切页签）。任务被归档 / 删除时会话信息框自动消失。

**会话信息框**：标题 `会话信息` + 页签条 `ui/Tabs`（概览 `si-tab-info`、请求记录 `si-tab-trace`）；没有页脚。读取中写 `sessionInfo.loading`，读取失败是一条 error `Notice`。概览的“模型”行是 `名称 · provider`，provider 为空时只写名称（不留尾随的 ·）；“思考”行用输入框同一套 `thinkingLabel`（中文“高”而不是 `high`）。
- **概览页**（`si-grid` 两列键值，标签列固定 112px，值可换行、路径等宽字；下面“用量与请求”用同一套网格，两张表的标签对齐）：标题、会话 ID（`si-id` + quiet sm “复制”）、会话文件（`si-file` + quiet sm “在文件夹中显示”，`revealTaskSession`）、项目目录、工作目录（和项目目录不同时）、Worktree 分支（有 worktree 时，标签里带基分支）、模型（名称 · provider）、思考强度、上下文（`已用 / 窗口 (百分比)`）、开始时间、来自会话（`parentSession`）、额外工作区目录（会话头里的 `additionalDirectories`）。前五项之外的行没有数据就不画。任务还没有会话文件时只显示任务自己的那几行 + 一句说明（`si-no-file`），没有置顶开关和用量。
- **置顶开关**（`si-pin`，`Switch`）：标签“置顶”，下面一行 `--fs-xs` `--text-3` 说明 `sessionInfo.pin.hint`（“在侧栏历史会话里排在前面（omp 的 /pin，记在 omp 自己的文件里）”）。点击发 `/pin`（切换），之后重读 `session-pins.json`；状态没变就把 omp 的原话当警告 toast，不假装成功。
- **用量与请求**（`si-usage`，上面一条 `--border-subtle` 分隔，标题 `SectionHead` `用量与请求`）：请求数（`si-requests`）、Token 总数（`si-tokens`，旁边一行输入 / 输出 / 缓存读取 / 缓存写入）、费用（`si-cost`，有“没有价格”的请求时注明不含它们）、工具调用数、用过的模型、起止时间。数据来自 omp 的 `stats.db`（`session_rollup` + `messages`），它**只在 `omp stats` 运行时同步**：打开时先读现有库，同时让 omp 同步一次再重读，底行显示“正在让 omp 同步统计…”/ 同步失败原因 / 一句“只统计已同步的部分，可能比输入框里的实时费用略少” + quiet sm “刷新”（同步中禁用）。库里没有这个会话（`si-no-rollup`）或没有库时各给一句说明。

**请求记录页**（`TraceTab.tsx`）：顶行汇总（`trace-summary`：N 次请求 · N 次失败 · N 次工具调用 · 费用）+ quiet sm “刷新”；同步中一句说明，同步失败一条 error `Notice`；没有请求时 `trace-empty`。下面一张列表（`trace-list`）：表头（28 高，`--fs-xs` `--text-3`，sticky）和每一行共用同一套列——`.si-trace` 是网格，表头 / 条目都是 `subgrid`，列宽只在一处定义（`9ch` / 模型 / Token / `8ch` / `11ch` / `8ch`，中英文都对齐）。**每行 32 高**（3.2 起，原来约 52）：时间（`HH:mm:ss` tabular，悬停是完整时间）、模型（悬停 `provider/model`；子代理请求带“子代理 {类型}”）、Token（入 / 出，K/M 缩写）、费用、结果（完成 / 调用工具 / 长度截断 / 出错 / 已停止；出错的 `--st-error`；omp 以后加的取值原样显示）。**每行的“详情”默认折叠**（遥测克制）：`<details>` 的“详情”折在同一行的最后一列，展开后才往下长：耗时、首字耗时、输出速度（token/s，studio 按输出 ÷（耗时 − 首字）算，不是 omp 的聚合列）、缓存读取 / 写入、服务等级、发起的工具调用（出错的标注）、错误信息；这些都没有时不画“详情”。最多显示最近 500 条，更早的注明被截掉。

**分享确认框**（`ShareDialog.tsx`，`share-dialog`，标题 `分享会话链接`；**会把会话上传到外部**，2026-10-21 所有者拍板，必须先确认）：打开先读 `share.serverUrl` / `share.store` / `share.redactSecrets`（`omp config list --json` 在任务目录下读，项目配置可覆盖；读取中写 `sessionInfo.loading`，读不到是一条 error `Notice`）。正文：① warning `Notice`（`share-warning`）：“这会把本会话的加密快照上传到 {服务器}。拿到完整链接的人都能看到会话内容（解密密钥在链接的 # 之后，不会发给服务器）”——勾选 gist 时换成 GitHub secret gist 的说法（`gh` 不可用时 omp 退回上传到服务器）；② 脱敏状态一句（`share-redact`，`data-redact`）：开着 = “上传前 omp 会把识别出的密钥打码”，关着 = “密钥、token 会原样上传”；③ “改为上传到 secret gist” `Checkbox`（`share-gist`，`share.store` 是 gist 时默认勾上，上传中禁用）。页脚：`取消` / 主按钮 **上传并生成链接**（`share-confirm`，设置读到前禁用，上传中 loading 并写 `上传中…`）。成功后：正文是链接（`share-url`，等宽、点一下全选；有 gist 链接时多一块 `share-gist-url`），页脚换成 `复制链接`（`share-copy`）+ `在浏览器中打开`（`share-open`，`openExternal`，只放行 http/https）+ 主按钮 `关闭`；omp 的输出里认不出链接时原样显示 omp 的输出（`share-raw`），页脚只有 `关闭`。失败时正文多一条 error `Notice`（`share-error`，`role=alert`，omp 的错误行），确认按钮还在，可以再试。没有会话文件的任务点分享会失败并说明。

**TSP 错误卡的“重试”按钮**（`RetryButton.tsx`，`retry-turn`）：omp 一轮以错误结束时画的错误卡（role `omp.error`）里，对话末尾那张卡（它之后没有新消息、没有成功的回答）下面加一个 `Button` sm“重试”（悬停提示 `sessionInfo.retry.title`），任务空闲时才显示；点击发 `/retry`（`runTaskCommand {kind:"retry"}`）。成功时 omp 不发提示、直接重跑这一轮；没有可重试的内容时 omp 的 toast `Nothing to retry` 以错误提示显示。判断在 `src/shared/tsp/error-turn.ts`（`fixtures/tsp/error-turn.jsonl`，omp 18.12.5，无效 key → 401）。 **错误只显示一份、重试只有一个**：omp 的节点里有两处和 studio 重复，不画（`isOmpErrorDuplicate`，`TspChildren.tsx` 与 omp 的输入框卡片、HUD 待办药丸同一处）——dock 里的红色错误横幅（`omp.errorBanner`，同一段错误文字加 Details / Dismiss；**只在对话里有收尾的错误卡时才不画**，没有卡片时它是这条错误唯一的显示，照常画）、错误卡里的 `Retry F5`（`omp.error.action` 且 `actions.click = "retry"`）；卡片里保留复制错误、换模型。键盘 F5 照常（输入框里的 F5 由 studio 转发给 omp）。

**侧栏历史会话的置顶排序**：`SessionSummary.pinned`（会话 id 在 omp 的 `<agentDir>/session-pins.json` 里，只读）。历史会话行（还没挂在任务上的）排在时间线和文件夹里最前面，其余按最近活动；文件夹之间的顺序仍按各自最新的一行（`sidebar-model.ts`）。任务行没有置顶信息，不受影响；置顶 / 取消置顶只能在有进程的任务里做（`/pin <id>` 在服务进程里报 not found）。

**输入框费用的悬停提示**（`SessionCost`）：TSP 任务的 token 分项和请求数（`TaskState.sessionUsage.requests`）由主进程从会话文件补（omp 的 TSP 输入框卡片只给费用），见 `tsp-runner` 的 `#sessionUsageFor`；费用或上下文用量变了就重读（只看费用的话，费用一直是 0 时分项永远是 0）。订阅登录的模型 omp 不写 `$`：花费前面是订阅记号（`S0.44`，nerd 字形时是一个图标），还没花费时只有 `(sub)`（omp 18.12.6 `formatBillingSummary`），`parseCost` 都认（2026-10-22 起，原来只认 `$`，订阅时费用显示 `$0.00`、和用量对话框对不上）。

---

## 5. 交互

### 5.1 快捷键

Windows 用 `Ctrl`，macOS 以后映射 `⌘`。输入框/文本域里**只有带 Ctrl 修饰的快捷键和 Esc 生效，单字符键绝不抢**。快捷键只在窗口聚焦时生效，不注册系统级快捷键。设置页只读展示（`shortcut.*`），菜单项/tooltip 里以 Kbd 展示。

| 动作 | 键 | 说明 |
|---|---|---|
| 命令面板 | `Ctrl K` | 再按或 `Esc` 关闭 |
| 新任务（选项目） | `Ctrl N` | 草稿任务，§5.5 |
| 在当前项目新任务 | `Ctrl Shift N` | 不弹选择器 |
| 打开文件夹 | `Ctrl Shift O` | 同侧栏 `打开文件夹`（2026-10-21 起；`Ctrl O` 是展开/收起过程行，不动） |
| 搜索任务和会话 | `Ctrl F` | 聚焦侧栏搜索框并全选，侧栏收起/抽屉没开时先展开（2026-10-21 起）；设置页里 `Ctrl F` 是设置搜索，由设置页先处理（`preventDefault`，全局监听跳过 `defaultPrevented`） |
| 设置 | `Ctrl ,` | |
| 切换侧栏 | `Ctrl B` | |
| 聚焦输入框 | `Ctrl L` | 并滚到底 |
| 终端 | `Ctrl \`` | 收起 → 打开并聚焦；开着但焦点不在终端 → 聚焦终端；焦点在终端 → 收起并回到输入框。命令面板的 `切换终端` 和任务条按钮是纯显隐切换 |
| 跳到等你确认的任务 | `Ctrl J` | 已在该任务时聚焦门；无待确认时无动作 |
| 第 N 个任务 | `Ctrl 1…9` | 侧栏眼前画出来的任务顺序（合并列表里展开着的文件夹里的任务行；按时间排列时是时间顺序；折叠的文件夹、被“显示更多”藏起来的行不算；`features/sidebar/visible-order-store.ts`） |
| 上/下一个任务 | `Ctrl Shift [` / `Ctrl Shift ]` | 循环；2026-10-21 起由 `Ctrl Alt ↑ / ↓` 改来（Intel/AMD 显卡驱动的屏幕旋转热键同一组合）；按物理键位认，Codex 桌面版同款 |
| 发送 / 运行中插话 | `Enter` | IME 组合中无效 |
| 换行 | `Shift Enter` | |
| 空闲发送 / 运行中稍后 | `Ctrl Enter` | 有门时见 §4.17 |
| 停止并取回排队消息 | `Esc` | §5.2 栈第 4 层 |
| 门：主操作 / 拒绝 | `Ctrl Enter` / `Esc` | §4.17 |
| 门：选第 N 项 | `1…9` | 门聚焦时 |
| 模型弹层 / 循环思考强度 | `Alt M` / `Alt T` | 与 omp TUI 一致 |
| 展开/收起最近一个过程行 | `Ctrl O` | 与 omp 终端习惯一致 |
| 复制最后一条回答 | `Ctrl Shift C` | 开发版改用 `Ctrl Alt C`（与 DevTools 冲突） |
| 重命名 / 归档（侧栏聚焦） | `F2` / `Del` | |
| 区域循环 | `F6` / `Shift F6` | 侧栏 → 对话区 → 门/输入框 |
| 打开评审 | `Ctrl Shift D` | 当前任务；评审内的单字符键见 §4.25 |
| 文件面板 | `Ctrl Shift E` | 当前任务或新任务草稿（含默认文件夹）；打开文件页，再按一次关闭；面板内的键见 §4.27 |
| 回底部 | `End` / `Ctrl End` | 焦点在对话区 |
| omp 自己的键（TSP 任务） | `Shift Tab` / `Ctrl T` / `Ctrl P` / `Ctrl Shift P` / `Alt P` / `Alt Shift P` / `Ctrl R` / `F5` / `Alt R` / `Alt ↑` | 焦点在输入框或过程区、studio 没占用这个键时原样写给该任务的 omp（`features/tsp/use-forward-omp-keys.ts`，判定 `src/shared/tsp/forward-keys.ts`）：思考强度、思考块显隐、角色模型、临时切模型、计划模式、历史搜索、重试、取回排队消息。另外文档里 `kbd` 节点上写着的带 `Ctrl` / `Alt` 的键和功能键也转发。`Shift Tab` 只在输入框里转发（别处是焦点反向移动）。omp 的键帽提示（`Retry F5`、`Switch model ⌥P`、`Edit ⌥↑`）因此键盘也能触发 |

**转发的优先级**：studio 自己的键先于 omp 的（`STUDIO_RESERVED`，不转发）。同键不同义的冲突：`Ctrl L`（omp 实时模式；studio = 聚焦输入框）、`Ctrl Shift O`（omp 切工具可见；studio = 打开文件夹）、`Ctrl D` / `Ctrl Z` / `Ctrl C`（omp 退出 / 挂起 / 清空；输入框里是删字符 / 撤销 / 复制）、`Alt ←/→`（omp 树折叠；studio = 后退 / 前进）；同键同义的由 studio 自己处理：`Alt M`（模型弹层）、`Ctrl O`（展开过程行）、`Ctrl Enter`（稍后发送）。`Alt T`（studio 循环思考强度）omp 没有这个键，不转发；omp 的 `Ctrl T` 是思考块显隐，两者不冲突。已被别处 `preventDefault` 的键（斜杠菜单的 Tab、输入法组合期间）不转发；list / 提问对话框 / omp 编辑器节点自己写键的控件里不重复转发。

`Alt ↑`（omp 取回排队消息）：omp 把最后一条排队消息写进它自己的输入框（studio 不画），渲染进程在键写出前先订阅文档，读到那段文字后追加进 studio 输入框的草稿并清空 omp 的输入框（同 Esc 取回，`queue-restore.ts`），3 秒内没有就放弃；队列里没有消息时只是把键交给 omp。转发后 omp 里改了思考强度 / 模型（`Shift Tab`、`Alt P` 选择器），输入框的模型 / 思考胶囊跟着变（读 omp 输入框卡片，实测 high → max → off、`DeepSeek V4 Flash` → `Fable 5.1`）。

v1 **禁用** Chromium 默认缩放 `Ctrl +/-/0`。

### 5.2 Esc 栈（自上而下，命中即停）

1. 有菜单/弹层/面板/对话框打开 → 关闭最上层
2. 焦点在过程区里（门的选项列表、提问对话框、omp 的选择器 / 弹窗）→ Esc 写给 omp（取消提问、关选择器 / 弹窗，由 omp 决定），不当成停止
3. 斜杠菜单打开 → 关闭
4. 任务正在运行 → 停止（`stopTask`：主进程把 Esc 写给 omp）；omp 的面板开着时只把 Esc 交给 omp 关面板，不停止主代理
5. 侧栏抽屉打开 → 收起
6. 否则无动作（**不**清空输入框）

### 5.3 焦点去向

| 时刻 | 焦点 |
|---|---|
| 应用启动 | 输入框（有项目）/ 引导主按钮 |
| 新建任务、点任务/`Ctrl 1…9` 切换 | 输入框（光标在草稿末尾）；例外：在侧栏里用键盘 `↑↓` 移动时留在侧栏，`Enter` 才进输入框 |
| 发送后 | 仍在输入框 |
| 本轮结束 | **不动焦点** |
| 门出现 | §4.17 的 1.5 秒规则 |
| 门答复/关闭 | 回到出现前的元素；不存在则输入框 |
| 命令面板/弹层/菜单/对话框打开、关闭 | 面板输入 / 关闭后回到触发器（记 `activeElement`，已移除则输入框） |
| 设置打开、返回 | 分节列表 / 回到进入前的元素 |
| 展开/折叠过程行 | 留在该行按钮上 |
| 对话区文本选择 | 流式追加不得清除选区（只在末尾 DOM 节点上追加） |

Tab 顺序：侧栏头 → 任务列表（一个停靠点，内部方向键）→ 主区头 → 对话区（过程行、代码块按钮、卡片）→ 门 → 输入框 → 输入框工具行。对话区 `tabindex=0` 用于键盘滚动，Tab 序在输入框之后，聚焦环用 inset 样式。除 `autofocus` 与上表外，不用 JS 抢焦点；每个程序化聚焦都有对应用例。

### 5.4 滚动与流式不跳动

**滚动**（单一 `.scroller`）：
1. 吸底判定：距底 ≤48px（`IntersectionObserver` 观察底部哨兵）。吸底时每次布局变化后在 `requestAnimationFrame` 里 `scrollTop = scrollHeight`（瞬时，不用 smooth），每帧至多一次。
2. 用户主动向上滚动（滚轮、拖动滚动条、PageUp/Home/↑、触摸）立即脱离吸底；此后追加内容不改变 `scrollTop`；程序性滚动不算。滚回距底 ≤48px 自动重新吸底。
3. 脱离吸底且仍有新内容 → 显示 JumpToLatest（§4.15）。
4. 用户发送消息 → 强制吸底。
5. 展开/折叠任意块（过程行、代码块、长用户消息）以被点击元素为锚：它在视口里的位置不变，必要时补偿 `scrollTop`。
6. 切换任务：各自记住滚动位置和吸底状态。
7. 门出现不改变滚动位置。
8. 性能：离屏的已结束 turn 用 `content-visibility: auto; contain-intrinsic-size: auto 400px`（最近 20 轮不用）；不上虚拟列表。

**流式不跳动**（AGENTS 硬要求，每条要有测试）：
1. **块级增量渲染**：Markdown 按块解析，已闭合的块渲染一次后冻结（`React.memo`，DOM 节点不重建），只更新最后一个未闭合块；选区、hover、展开状态因此不丢。
2. 歧义前缀延迟一行：行首 `|`、`#`、`>`、`-`、`*`、`1.`、围栏的未完成行，等该行结束再渲染，避免“先是普通文字再变表头”的跳变。
3. 未闭合的行内标记按纯文本显示，闭合时才变样式。
4. 代码块在围栏打开时就以最终样式创建（头部 32px 占位），追加只增高；闭合时只改颜色。
5. 助手消息容器的最小高度流式期间只增不减。
6. 图片/附件/表格有 `aspect-ratio` 或最小高度；不用骨架屏；运行中的过程行在回合开始就占位且高度固定 28。
7. 流式更新节流：IPC 事件在渲染层按 `requestAnimationFrame` 合并；主进程用 `set_event_filter { messageUpdates: "delta" }`（`omp-rpc.md`：默认每帧完整快照，一轮短对话就 550KB）；子代理的 `message_update` 不受此设置影响，v1 只取 `subagent_progress` 级别。**不做**“积压 ≤250ms 追完”的平滑放出。
8. 开启 `overflow-anchor: auto`；已完成消息 `contain: layout paint style`；字体不换入（系统字体，无 FOUT）。

**窗口缩放保位置**：自由态下记录阅读锚点（视口顶部下方第一个可见块的 id 与相对偏移），`ResizeObserver` 观察 `.column`，重排后还原；吸底态保持吸底。列宽 = `min(100% − 2×--gutter, --content-w)`，主区宽 >约 890px 时缩放不改变列宽，不重排。侧栏折叠/抽屉切换：主区宽度**立即变一次**（一次重排 + 一次补偿），不逐帧；拖动侧栏分隔线时对话列宽度冻结为拖动开始时的像素值，松手时一次性提交并补偿；`ResizeObserver` 回调合并到 rAF，不在 `mousemove` 里同步测量。验收：滚到中间 → 窗口宽度 1200→800→1200，锚点块视口偏移变化 ≤2px。

**滚动条与横向溢出**（仓库所有者 2026-10-21；`ui/scrollbars.css` + `ui/scroll-activity.ts`，`main.tsx` 里装一次，组件里没有任何滚动条代码）：
1. 外观：`::-webkit-scrollbar` 宽 `--scrollbar-hit`（10px），滑块 `--scrollbar-thumb-w`（6px，两边各 2px 透明描边撑出来，`background-clip: content-box`）、`--radius-pill`、颜色 `--scrollbar-thumb`（浅 / 深各一份），悬停或拖动时 `--scrollbar-thumb-hover`；轨道、两端按钮、角落全部 `display: none`，没有任何底色。平时滑块透明，滚动时变成 `--scrollbar-thumb`，用 `--dur-fade` 淡入淡出（reduced-motion 下 100ms，不闪现）。
2. 滚动活动：`document` 上一个捕获阶段、`passive` 的 `scroll` 监听（scroll 不冒泡，捕获才收得到所有容器），给正在滚动的元素挂 `data-scrolling`，停 800ms 摘掉；已挂着只续期，不重复写属性。不需要每个组件登记。
3. 不挤内容：滚动条一直占着 10px 宽（只有滑块颜色在变），出现和消失不改变内容宽度，阅读列不横移。（Chromium 对 `::-webkit-scrollbar` 没有真正的覆盖模式；只要容器可滚动就占 10px，这一点和 `OverlayScrollbar` 不同。）要“完全不占位”的容器（`.scroller`、侧栏、设置页、命令面板、下拉列表）继续用 `OverlayScrollbar` + `scrollbar-width: none`。
4. **不要在组件里写 `scrollbar-width: thin` 或 `scrollbar-color`**：Chromium 里它们不是 `auto` 时整套 `::-webkit-scrollbar` 失效。`scrollbar-width: none` 只用于自绘滚动条的容器和不要滚动条的标签条。
5. **横向滚动条一律不画**（`::-webkit-scrollbar:horizontal { display: none }`）。能折行的先折行，不能折行的容器仍可用 Shift+滚轮 / 触控板横滑，但看不到条。逐处决定：
   - 折行（本来就折）：对话里的代码块与工具卡输出、门里的预览、设置里的 JSON 与原文输出、omp 安装详情、TSP 的 diff 行和工具卡里的 `code`（`.tsp-tool-body .tsp-code` 一律 `pre-wrap`）。
   - 评审 diff：有自己的 `折行` 开关，默认开；关掉时每个 hunk 自己横向滚动（行不折，hunk 头和评论框贴左），无条。
   - 不折、无条、可横滑：Markdown 表格（整词不拆，`.md-table`）、KaTeX 块级公式、TSP 的 ANSI 行（`.tsp-rows`，列对齐，折了会错位）和 TSP `code` 节点没有 `wrap` 时、用量热力图（`usage-scroll`）、评审的标签条。
   - 其余 `overflow: auto` 的容器内容本身折行，实际只有纵向滚动。
6. 验收（800×600 窗口）：走新任务页、TSP 对话（edit / eval 卡）、设置全部分节、命令面板、终端，断言页面自身 `scrollWidth <= clientWidth`，且没有任何元素下沿被横向滚动条占高（`offsetHeight − clientHeight − 边框 = 0`）；滚动时 `data-scrolling` 出现、停后消失，且元素 `clientWidth` 不变。

### 5.5 新任务与项目

1. `Ctrl N` / `新任务` → **草稿任务**：主区显示 §4.7，主区头标题 `task.untitled`，侧栏顶部出现临时行；**此时不启动 omp 进程**。项目一律是默认文件夹（2026-10-20 起，不再沿用当前或最近的项目）。
2. 草稿期间可换项目（侧栏文件夹头 `＋`、`打开文件夹`、拖入文件夹）、可改模型/思考/审批；发送后项目不可换。
3. **发送第一条消息 = 创建任务**：主进程用 `omp`（伪终端里的交互式 omp，TSP，不传 `--approval-mode`，§5.8）起进程，等输入框就绪后用 `send` 事件提交第一句话（`TspRunner.sendPrompt`）。用户消息乐观上屏（`first-prompt-store`），omp 回显后接上；握手期间状态行显示 `composer.status.starting`；失败走 §4.24。
4. 离开草稿时输入为空则丢弃，不留空任务；同一文件夹可并行多个任务（各一个进程）。
5. 文件夹头 `＋` 与 `Ctrl Shift N` 直接在该项目下新建。

### 5.6 会话历史

历史来自 `~/.omp` 的只读扫描（主进程）[推测：RPC 没有“列出会话”命令]，渲染层只拿到 `{id, title, projectPath, updatedAt, status}`。点击历史会话或休眠任务：主进程立刻拉起 omp 并用 `--resume` 恢复该会话（`TaskPool.resume` / `openTask`），不等第一次发送；启动期间状态行显示 `composer.status.starting`；会话对应的目录已不存在时恢复失败，弹 toast `history.resumeFailed`。恢复的任务和新任务一样，用启动时 omp 配置里的审批模式。

### 5.7 通知（只有“等你确认”会叫你）

任务进入 `await` 且它不是当前窗口正在看的任务，或窗口未聚焦：① 侧栏菱形 + 提示条；② 任务栏闪烁（`win.flashFrame(true)`，聚焦后停止）+ 覆盖角标数字；③ 窗口未聚焦且设置开启 → 一条系统通知，标题 `notify.title`，正文 `notify.body.gate`，点击聚焦窗口并跳到该任务；④ 窗口聚焦但在看别的任务 → 顶部气泡 toast `toast.needsYou`（不抢焦点，8 秒）。不播声音。任务完成：只有侧栏对勾，**不发通知**。

### 5.8 审批模式（完全跟随 omp 的配置）

**核实（`omp://approval-mode.md`、`omp://settings.md`，`omp config list` 的 enum 选项实测 omp 18.12.5）**：四种模式 `always-ask`（读自动；写、执行询问）、`always-ask-cached`（omp 界面叫 Ask and remember：读文件、写、执行都询问，批准时可记住文件或文件夹；记住的批准可用 `/forget-approvals` 清掉）、`write`（读写自动；执行询问）、`yolo`（全自动）。配置项 `tools.approvalMode`，**omp 默认 `yolo`**。omp 在进程启动时读一次；文档里没有运行中切换的 RPC。

**设计**（仓库所有者 2026-10-18 定：审批模式完全按 omp 的设置来，omp-studio 不另设一层）
1. **启动时从不传 `--approval-mode` / `--yolo` / `--auto-approve`。** omp 用配置里的 `tools.approvalMode`；没设置过就是 omp 的默认 `yolo`，此时不会出现审批门。`tools.approval.*` 与 `bash.patterns` 由 omp 按文档规则叠加，我们不改。
2. **ApprovalChip 显示 omp 对这个项目目录实际生效的值和来源**：项目 `.omp/config.yml` 设了 `tools.approvalMode` 就盖过全局（实测 18.12.5：全局 `write`、项目 `always-ask-cached`，在项目目录里 `omp config list --json` 给 `always-ask-cached`；omp 只看 cwd 下的 `.omp/config.yml`，不找父目录）；没设置过显示 omp 默认值。主进程 `getApprovalMode(projectId)` 在项目目录里跑 `omp config list --json` 取值，来源 = 项目文件有没有设这一项（只读解析，`omp-config/approval-mode.ts`）；草稿和任务都按它的项目取（无项目的聊天只看全局）。来源写进悬停提示 / `aria-label` 的最后一段（`approval.sourceProject` / `approval.sourceGlobal`），不加新的行。读到之前先用上次读到的全局值（启动缓存，见 §4.14；项目覆盖的值不进缓存），从没读到过才显示 `approval.loading`。全局快照（`config-store.ts`）里的值变了会重读，设置页和胶囊一致。
3. **在胶囊里选一个模式 = `omp config set tools.approvalMode <模式>`**（写入只经 omp，AGENTS；改的是用户全局配置，终端里的 omp 也跟着变）。**项目 `.omp/config.yml` 设了这一项时不可改**：omp 没有写项目层的命令（实测 18.12.5，在项目目录里 `omp config set` 仍写全局并提示被项目覆盖），studio 也不自己改项目文件，所以四档灰显，每项第二行写 `approval.projectLocked`（“由项目配置决定（.omp/config.yml）”）。之后启动的任务生效，已在运行的任务要重启。弹层里不再写这段说明（2026-10-20 起去掉）；胶囊不再区分"有没有进程"。
4. **外观**（2026-10-22 起图标 + 模式名，`direction-3.2.md` §7 第 10 条；2026-10-21 到 10-22 只有图标）：`.ui-chip`（§4.23，28 高、无底色，悬停 / 打开时 `--bg-hover`，同其它胶囊）；一个 14px 线性图标（`always-ask` = 盾牌 `Shield`，`always-ask-cached` = 带勾的盾牌 `ShieldCheck`，`write` = 铅笔 `Pencil`，`yolo` = 划掉的盾牌 `ShieldOff`（2026-10-21 起；原来的闪电 `Bolt` 和输入框上方后台任务药丸的图标撞了，意思也不对），都在 `icons.tsx`）+ 模式名（`.chip-mode`：`approval.alwaysAsk` / `approval.alwaysAskCached` / `approval.write` / `approval.yolo`，没读到档位时 `approval.loading`），没有 `⌄`；完整名称 `审批模式 · {档位名} · {来源}`（`approval.title` · 档位名 · `approval.sourceProject` / `approval.sourceGlobal`，来源没读到前不写）放在悬停 `title` 和 `aria-label`；`yolo` 时胶囊的图标和文字用 `--st-waiting-text`（`data-tone="warning"`，不铺底色）。点开是胶囊上方的 `Popover`（宽 320），里面是 `ui/MenuList` 选择菜单（§4.23 Menu）：四档，当前项第一列画 ✓，档位名下面第二行小字是描述（`approval.desc.*`，`yolo` 再加 `approval.subagents`）；分隔线后一项「清除已记住的批准」（`approval.forget`，第二行 `approval.desc.forget`）：给当前任务的 omp 会话发 `/forget-approvals`（`sendPrompt`，`whenBusy: "followUp"`，同 `/retry` 的做法；实测 18.12.5 rpc-ui 下会回一条 `command_output` “Remembered approvals forgotten; the next read or write asks again.”，显示在对话流里）。清的是整个 agent 目录的批准库和所有会话的临时批准，和模式、项目无关。草稿里、以及还没发过消息的任务里这一项灰显，第二行写 `approval.forgetUnavailable`（任务标题为空时发斜杠命令会被当成标题）。打开时焦点落在当前项，↑↓ / Home / End 在项之间移动（灰显项也停留，原因要能读到），Enter 选，Esc 关闭。
   四档灰显（项目覆盖）时第二行是 `approval.projectLocked`，不再显示描述；「清除已记住的批准」不受影响。
5. 在胶囊里把模式切到 `yolo`：首次在同一个 `Popover` 里换成确认（`kind="confirm"`，宽 300：标题 `approval.yoloConfirmTitle`、正文 `approval.yoloConfirmBody`、sm 按钮 `common.cancel` + 主按钮 `approval.yoloConfirmYes`，`approval-yolo-confirm`），确认后记住（`StudioSettings.yoloConfirmed`）。omp 本身默认就是 `yolo` 时不弹（没有"切换"动作）。

### 5.9 无障碍

- 对话区 `role="log"`，流式期间 `aria-busy="true"`、**不逐字播报**；轮次结束时一次性更新 live region 为 `a11y.done`（结论首句）。
- 门（审批卡、提问对话框）是 omp 的 TSP 节点，studio 不给它加 `alertdialog`；出现时任务变 `needs_you`，侧栏状态、提示条和通知照 §5.7。
- 状态点有 `aria-label`（§4.1）；侧栏列表 `role="tree"`/roving tabindex；侧栏拖拽条 `aria-label=a11y.resizeSidebar`。
- `forced-colors: active`：状态点靠形状仍可辨；选中行加左 2px 条；边框用 `CanvasText`。
- 所有颜色对比见 §2.5。

---

## 6. 第一版不做（只留位置）

| 功能（阶段） | 为它预留的位置 | v1 的做法 |
|---|---|---|
| diff 评审（3）**已落地（待设计方向确认）** | 见 §4.25；入口：顶栏评审按钮、提交对话框的 `评审改动`、`Ctrl Shift D`、命令面板 | 全屏评审、逐行评论、发给 agent |
| worktree / git / PR（4）**已落地（待设计方向确认）** | 新任务草稿的顶栏分支胶囊里的勾选项 `在独立 worktree 里开始`（`features/git/DraftGitTools.tsx`；只在草稿项目是"项目目录正好是 git 仓库根"时出现，`getDraftGit`；默认文件夹不是项目仓库所以没有；§3.1）；任务条右侧的分支胶囊（点开是 `Git` 菜单：提交、推送、开 PR（有可用远端时才列）、合并回、丢弃）和评审按钮（§3.1）；侧栏任务行的分支图标；项目菜单“清理无主 worktree” | 不是 git 仓库（或项目目录不是仓库根）时没有 worktree 选项，分支胶囊和评审按钮不渲染 |
| 子代理（5）**已落地** | 右栏的子代理面板（§4.28、`docs/architecture/subagents.md`）：列表、详情、插话 / 结束 / 恢复；输入框上方药丸 `👥 N` 打开它。子代理字母头像 / 哈希色 token 没做 | — |
| 内置终端（6） | 右栏或底部面板；每任务终端在其 worktree 目录 | 不做 |
| 子代理费用/token **已落地** | 右栏子代理面板详情里的一行统计：费用、token、请求数、工具数、用时（§4.28） | — |
| 门的“收起” | 提问对话框底栏 omp 自己的 Hide 按钮（§4.17） | studio 不另做；审批卡没有收起 |
| 任务删除、自定义快捷键、界面缩放、角色（default/plan）选择、测试结果显示 | — | 不做 |
| 编辑/分叉用户消息、会话树（读会话文件 + omp `/tree` + `--fork`） | omp 用户消息上的回退图标、`/fork`、`/tree`、命令面板“会话树” | 已做，见 §4.14 SessionTreePanel；原地编辑已发出的消息不做（omp 没有改写历史的命令） |
| macOS | 侧栏头左侧 inset（红绿灯）、`⌘` 映射、系统菜单 | Windows 优先；CSS 已不写死三键宽度 |
| API key 登录输入 | 设置 → Provider 与订阅 的提供商行 | 只显示终端登录指引 |

---

## 7. “手感”验收清单（每个阶段都按此验收）

1. 动画只用 `transform`/`opacity`（+折叠用的 `grid-template-rows`）；reduced-motion 开启后 `getAnimations()` 中无位移/缩放动画。
2. 流式时选区不丢；已冻结块的 DOM 节点引用不变（测试：分 1/5/50 字符一帧喂入，最终 DOM 与一次性渲染一致）。
3. 上滚 1 个滚轮格后不再被拉回；吸底时 `scrollTop + clientHeight == scrollHeight`（±1）。
4. 缩放窗口：锚点块的视口偏移变化 ≤2px。
5. IME 组合态 `Enter` 不发送；组合结束后才发送。
6. `Esc` 停止不丢字（排队消息放回草稿）。
7. 门：输入框里 `Enter` 不会批准（有草稿 = 拒绝并发送，空草稿不动作）；`Ctrl+Enter` = 批准、`Ctrl+O` = Details；提问时发送键禁用；门被 omp 撤掉后焦点回到 studio 输入框（§4.17）。
8. 英文长文案不撑破胶囊/按钮/侧栏（无溢出、无意外换行）；中/英 × 浅/深 4 种组合截图。
9. Tab 顺序与 `F6` 循环可预期；侧栏列表只占一个 Tab 停靠点。
10. 冷启动到可输入 <1.5s（窗口先出骨架，omp 握手在后台）；流式时主线程每帧脚本 <8ms。
11. `tokens.css` 的两份深色块、两份 reduced-motion 块一致（单元测试）。

---

## 附录 A. i18n key 表

格式约定（前端转 JSON）：本附录每个表格的数据行都是 `` `key` | 中文 | English ``；key 为扁平的点分名，取第一列去掉反引号。值使用 ICU MessageFormat 子集：`{name}` 插值；英文复数写成 `{n, plural, one {…} other {…}}`；中文**不用 plural**（单一形式）。所选 i18n 库必须支持 ICU 复数，否则在构建时转换。文案规则：中文用“你”不用“您”；不加感叹号；动词在前；汉字与英文/数字之间加空格；错误句先说发生了什么再说怎么办；英文句首大写、按钮用动词。所有按钮/胶囊/行用 `min-width` 不用固定宽度（英文通常比中文长 1.6–2 倍）。

### A.1 通用与窗口

| key | 中文 | English |
|---|---|---|
| `common.cancel` | 取消 | Cancel |
| `common.close` | 关闭 | Close |
| `common.copy` | 复制 | Copy |
| `common.copied` | 已复制 | Copied |
| `common.retry` | 重试 | Retry |
| `common.expand` | 展开 | Expand |
| `common.collapse` | 收起 | Collapse |
| `duration.s` | {s} 秒 | {s}s |
| `duration.ms` | {m} 分 {s} 秒 | {m}m {s}s |
| `duration.hm` | {h} 小时 {m} 分 | {h}h {m}m |
| `time.now` | 刚刚 | Just now |
| `time.minutes` | {n} 分钟 | {n}m |
| `time.hours` | {n} 小时 | {n}h |
| `time.yesterday` | 昨天 | Yesterday |
| `window.about` | 关于与反馈 | About & feedback |
| `window.aboutVersion` / `window.aboutOmp` / `window.aboutOmpMissing` | 版本 {version} / omp {version} / 未找到 omp | Version {version} / omp {version} / omp not found |
| `window.aboutCopyInfo` / `window.aboutReportIssue` | 复制版本信息 / 报告问题 | Copy version info / Report an issue |
| `menu.toggleSidebar` | 切换侧栏 | Toggle sidebar |
| `menu.edit` | 编辑 | Edit |
| `menu.undo` / `menu.cut` / `menu.copy` / `menu.paste` / `menu.selectAll` | 撤销 / 剪切 / 复制 / 粘贴 / 全选 | Undo / Cut / Copy / Paste / Select all |
| `dropzone.folder` | 松开以用这个文件夹新建任务 | Drop to start a task in this folder |

### A.2 侧栏与任务

| key | 中文 | English |
|---|---|---|
| `sidebar.newTask` | 新任务 | New task |
| `sidebar.waitingOne` | 1 个任务在等你 · {project} | 1 task waiting for you · {project} |
| `sidebar.waitingMany` | {n} 个任务在等你 | {n} tasks waiting for you |
| `sidebar.empty` | 还没有任务 | No tasks yet |
| `sidebar.settings` | 设置 | Settings |
| `sidebar.newInProject` | 在此项目新建任务 | New task in this project |
| `sidebar.searchHistory` | 会话 | Sessions |
| `sidebar.historyOrder` | 会话排列 | Arrange sessions |
| `sidebar.historyByFolder` | 文件夹 | Folder |
| `sidebar.historyByTime` | 时间 | Time |
| `project.reveal` | 在资源管理器中显示 | Show in File Explorer |
| `project.remove` | 从列表移除 | Remove from list |
| `task.untitled` | 新任务 | New task |
| `task.rename` | 重命名 | Rename |
| `task.archive` | 归档 | Archive |
| `task.archived` | 已归档 | Archived |
| `task.undo` | 撤销 | Undo |
| `task.openFolder` | 打开工作目录 | Open working folder |
| `task.reveal` | 显示会话文件 | Show session file |
| `task.copyId` | 复制会话 ID | Copy session ID |
| `task.copyPath` | 复制会话文件路径 | Copy session file path |
| `task.exportHtml` | 导出为 HTML… | Export as HTML… |
| `toast.exported` | 已导出 {name} | Exported {name} |
| `toast.revealExport` | 在文件夹中显示 | Show in folder |
| `task.stopped` | 已停止 | Stopped |
| `status.running` | 进行中 | Running |
| `status.waiting` | 等你确认 | Waiting for you |
| `status.done` | 完成 | Done |
| `status.error` | 出错 | Error |

### A.3 空状态

| key | 中文 | English |
|---|---|---|
| `empty.defaultFolder` | 默认文件夹 | Default folder |
| `sidebar.openFolder` | 打开文件夹 | Open folder |
| `empty.fromTerminal` | 来自终端 | From the terminal |

### A.4 输入框、模型与审批模式

| key | 中文 | English |
|---|---|---|
| `composer.placeholderNew` | 让 omp 做点什么… | Ask omp to do something… |
| `composer.placeholder` | 回复… | Reply… |
| `composer.placeholderRunning` | 告诉 omp 要改什么（Enter 插话，Ctrl+Enter 稍后）… | Tell omp what to change (Enter to steer, Ctrl+Enter for later)… |
| `composer.placeholderRunningSwapped` | 告诉 omp 要改什么（Enter 稍后，Ctrl+Enter 插话）… | Tell omp what to change (Enter for later, Ctrl+Enter to steer)… |
| `composer.placeholderGate` | 拒绝并告诉 omp 该怎么做… | Deny and tell omp what to do instead… |
| `composer.send` | 发送 | Send |
| `composer.stop` | 停止 | Stop |
| `composer.stopping` | 正在停止… | Stopping… |
| `composer.attach.unsupported` | 当前模型不支持图片 | The current model doesn't accept images |
| `composer.attachment.remove` | 移除 | Remove |
| `composer.queue.promote` | 现在插话 | Steer now |
| `composer.queueRestored` | 已停止 · {n} 条排队消息已放回输入框 | Stopped · {n, plural, one {# queued message} other {# queued messages}} put back in the box |
| `composer.imagesDropped` | 图片太大，没能放回 | The images were too large to restore |
| `composer.nextRequest` | 下一次请求生效 | Applies from the next request |
| `composer.context` | Context {p}% | Context {p}% |
| `composer.usage.tps` | {n} token/s | {n} tok/s |
| `composer.usage.tpsTip` | 最近一条回复的输出速度 | Output speed of the latest reply |
| `composer.badge.fast` / `composer.badge.slow` | 快速 / 慢速 | Fast / Slow |
| `composer.context.tip` | 接近上限时 omp 会自动压缩 | omp compacts automatically near the limit |
| `composer.breakdown.toggle` | 会话用量 | Session usage |
| `composer.noModel` | 未连接模型 | No model connected |
| `composer.modelLoading` | 模型… | Model… |
| `composer.versionTooOld` | omp 版本过旧 | omp is too old |
| `model.search` | 搜索模型，@ 选角色… | Search models, @ for roles… |
| `model.empty` | 没有可用模型 | No models available |
| `model.pinned` / `model.all` / `model.matches` / `model.rolesGroup` | 常用 / 全部模型 / 匹配 / 角色 | Frequent / All models / Matches / Roles |
| `model.scopes` / `model.providers` | 模型范围（左栏读屏名）/ Provider | Model scopes / Providers |
| `model.roleTarget` / `model.roleTargetClear` | 为 {role} 选模型 / 改回用于此任务 | Picking for {role} / Back to this task |
| `model.noRoles` | 没有匹配的角色 | No matching roles |
| `model.thinking` | 思考强度 | Thinking |
| `model.thinking.unsupported` | 这个模型不支持思考 | This model doesn't support thinking |
| `model.context` / `model.compactsAt` / `model.out` | Context / 压缩于 / 输出（单次输出上限） | Context / Compacts at / Output (max tokens per response) |
| `model.compact.percent` / `.percentOfBase` | 窗口的 {percent}% / 基数 {base} 的 {percent}% | {percent}% of window / {percent}% of {base} base |
| `model.compact.fixed` / `.capped` | 固定值 / 到达窗口，改为窗口减预留 | fixed / capped by window |
| `model.compact.reserve` / `.reserveOfBase` | 窗口减预留 {reserve} / 基数 {base} 减预留 {reserve} | window − {reserve} reserve / {base} base − {reserve} reserve |
| `model.compact.source.global` / `.project` / `.model` | 全局设置 / 项目设置 / 按模型设置 | global / project / per-model |
| `model.price` · `model.price.input` / `.output` / `.cache` / `.line` | 价格 · 输入 {value} / 输出 {value} / 缓存 {value} / {parts}（每 M token） | Price · {value} in / {value} out / {value} cache / {parts} per M |
| `model.perf` · `model.perf.tps` / `.ttft` / `.samples` | 实测速度 · {value} t/s / 首字 {value} s / {count} 次采样 | Speed · {value} t/s / {value} s TTFT / {count} sample(s) |
| `model.perf.catalog` / `model.perf.none` | 模型目录给出 / 还没有实测 | from the model catalog / Not measured yet |
| `model.intelligence` / `model.input` · `.text` / `.image` | Int / 输入类型 · 文本 / 图片 | Intelligence / Input · text / image |
| `model.fast` | 快速模式 | Fast mode |
| `model.fast.hint` | 更快的服务层级，只对本会话生效；模型不支持时 omp 会拒绝。 | A faster service tier for this session only; omp rejects it on models that don't support it. |
| `model.slow` | 慢速模式 | Slow mode |
| `model.slow.scope.global` | 写入 omp 配置，所有会话共用 | Saved in the omp config, shared by every session |
| `model.slow.scope.session` | 只对本会话生效 | This session only |
| `model.slow.unsupported` | 这个模型没有慢速模式 | This model has no slow mode |
| `model.on` / `model.off` | 开 / 关 | On / Off |
| `model.addProvider` | 添加 provider… | Add a provider… |
| `model.colIntelligence` / `.colSpeed` / `.colContext` / `.colPrice` | Int / t/s / Ctx / $/M（照 omp 原文，中英相同） | Int / t/s / Ctx / $/M |
| `model.out` / `model.price.perM` | 输出 / {value} / M | Output / {value} per M |
| `model.use` / `model.pickRole` / `model.applyRole` | 用于此任务 / 为它选模型 / 应用 | Use for this task / Pick its model / Apply |
| `thinking.off` | 关 | Off |
| `thinking.minimal` | 极低 | Minimal |
| `thinking.low` | 低 | Low |
| `thinking.medium` | 中 | Medium |
| `thinking.high` | 高 | High |
| `thinking.xhigh` | 超高 | X-High |
| `thinking.max` | 最大 | Max |
| `approval.title` | 审批模式 | Approval mode |
| `approval.alwaysAsk` | 总是询问 | Always ask |
| `approval.alwaysAskCached` | 询问并记住 | Ask and remember |
| `approval.write` | 自动写入 | Write |
| `approval.yolo` | 全自动 | Yolo |
| `approval.desc.alwaysAsk` | 读取自动；写入和执行前询问 | Reads run automatically; asks before edits and commands |
| `approval.desc.alwaysAskCached` | 读取文件、写入和执行前都询问；批准时可记住这个文件或文件夹 | Asks before reading files, edits and commands; an approval can remember the file or folder |
| `approval.desc.write` | 读取和写入自动；执行命令前询问 | Reads and edits run automatically; asks before commands |
| `approval.projectLocked` | 由项目配置决定（.omp/config.yml） | Set by the project config (.omp/config.yml) |
| `approval.desc.yolo` | 不询问 | Never asks |
| `approval.sourceProject` | 项目配置 | project config |
| `approval.sourceGlobal` | 全局配置 | global config |
| `approval.forget` | 清除已记住的批准 | Forget remembered approvals |
| `approval.desc.forget` | 清掉“询问并记住”记下的所有文件和文件夹批准（所有会话都生效） | Clears every file and folder approval that Ask and remember has recorded (all sessions) |
| `approval.subagents` | Subagent 在后台以全自动运行，不会单独询问。 | Subagents run in the background in Yolo mode and don't ask separately. |
| `approval.loading` | 审批… | Approval… |
| `approval.yoloConfirmTitle` | 使用全自动？ | Use Yolo? |
| `approval.yoloConfirmBody` | 全自动模式下，omp 不会在执行命令前询问你。 | In Yolo mode, omp won't ask before running commands. |
| `approval.yoloConfirmYes` | 使用全自动 | Use Yolo |
| `slash.empty` | 没有匹配的命令 | No matching commands |

### A.5 对话流（过程、消息、改动卡片）

`process.*`、`tool.*` 是运行过程的文案（过程区、工具卡片、运行状态行、子代理表、每轮用时与 token、压缩提示），两种语言共用 `src/shared/i18n/run/` 下的同一份英文（见 §1.2「文案」），所以这两组的中文列和 English 列相同，复数也照英文写。

| key | 中文 | English |
|---|---|---|
| `process.toolCalls` | {count, plural, one {# tool call} other {# tool calls}} | {count, plural, one {# tool call} other {# tool calls}} |
| `process.thoughtShort` | Thinking | Thinking |
| `process.earlier` | {n} earlier | {n} earlier |
| `tool.verb.read` | Reading {target} | Reading {target} |
| `tool.verb.edit` | Editing {target} | Editing {target} |
| `tool.verb.write` | Writing {target} | Writing {target} |
| `tool.verb.bash` | Running {target} | Running {target} |
| `tool.verb.search` | Searching {target} | Searching {target} |
| `tool.verb.other` | Calling {tool} | Calling {tool} |
| `tool.failed` | Failed | Failed |
| `tool.info.matches` | {count, plural, one {# match} other {# matches}} | {count, plural, one {# match} other {# matches}} |
| `tool.info.files` / `tool.info.readFiles` | {count, plural, one {# file} other {# files}} | {count, plural, one {# file} other {# files}} |
| `tool.info.agents` / `tool.info.background` | {count, plural, one {# agent} other {# agents}} / background | {count, plural, one {# agent} other {# agents}} / background |
| `tool.output.more` | {count, plural, one {# more line} other {# more lines}} | {count, plural, one {# more line} other {# more lines}} |
| `tool.output.unchanged` | {count, plural, one {# unchanged line} other {# unchanged lines}} | {count, plural, one {# unchanged line} other {# unchanged lines}} |
| `tool.output.showAll` / `tool.output.collapse` | Show all / Collapse | Show all / Collapse |
| `tool.output.empty` | No output | No output |
| `tool.bash.done` / `tool.bash.exit` | Done / Exit code {code} | Done / Exit code {code} |
| `tool.bash.earlier` | {count, plural, one {# earlier line} other {# earlier lines}} | {count, plural, one {# earlier line} other {# earlier lines}} |
| `tool.ask.count` / `tool.ask.note` | {count, plural, one {# question} other {# questions}} / Note | {count, plural, one {# question} other {# questions}} / Note |
| `tool.todo.pending` / `tool.todo.in_progress` / `tool.todo.completed` / `tool.todo.blocked` / `tool.todo.abandoned` | Pending / In progress / Completed / Blocked / Abandoned | Pending / In progress / Completed / Blocked / Abandoned |
| `msg.sendFailed` | 没有发出 | Not sent |
| `code.expand` | 展开全部（{n} 行） | Show all ({n} lines) |
| `scroll.latest` | 回到最新 | Jump to latest |
| `scroll.line` | 对话线 | Conversation outline |
| `scroll.lineItem` | 第 {n} 条：{text} | Message {n}: {text} |

### A.6 门（审批、ask、其它请求）与通知

| key | 中文 | English |
|---|---|---|
| `toast.needsYou` | {task} 需要你确认 | {task} needs your confirmation |
| `toast.view` | 查看 | View |
| `notify.title` | {project} · {task} | {project} · {task} |
| `notify.body.gate` | 需要你确认：{title} | Needs your confirmation: {title} |

### A.7 命令面板与快捷键

| key | 中文 | English |
|---|---|---|
| `palette.placeholder` | 搜索任务或命令… | Search tasks or commands… |
| `palette.recent` | 最近任务 | Recent tasks |
| `palette.tasks` | 任务 | Tasks |
| `palette.sessions` | 会话 | Sessions |
| `palette.commands` | 命令 | Commands |
| `palette.slash` | 斜杠命令 | Slash commands |
| `palette.noResults` | 没有匹配“{q}” | No matches for “{q}” |
| `palette.askNew` | 在新任务中提问 | Ask in a new task |
| `palette.hint` | ↑↓ 选择　↵ 执行　Esc 关闭 | ↑↓ Select　↵ Run　Esc Close |
| `cmd.newTask` | 新任务 | New task |
| `cmd.newTaskHere` | 在当前项目新任务 | New task in this project |
| `cmd.openFolder` | 打开文件夹… | Open folder… |
| `cmd.settings` | 设置 | Settings |
| `cmd.toggleSidebar` | 切换侧栏 | Toggle sidebar |
| `cmd.theme` | 切换主题 | Switch theme |
| `cmd.language` | 切换语言 | Switch language |
| `cmd.model` | 切换模型 | Switch model |
| `cmd.thinking` | 切换思考强度 | Cycle thinking level |
| `cmd.compact` | 压缩 context | Compact context |
| `cmd.exportHtml` | 导出对话为 HTML… | Export conversation as HTML… |
| `cmd.stop` | 停止当前任务 | Stop current task |
| `cmd.copyLast` | 复制最后一条回答 | Copy last answer |
| `cmd.jumpWaiting` | 跳到等你确认的任务 | Jump to a task waiting for you |
| `cmd.usage` | 查看用量 | View usage |
| `cmd.checkUpdate` | 检查 omp 更新 | Check for omp updates |
| `cmd.shortcuts` | 快捷键 | Keyboard shortcuts |
| `cmd.archive` | 归档当前任务 | Archive current task |
| `error.worktreeShared` | 还有其它任务（包括已归档的分叉）共用这个工作区，不能丢弃。 | Other tasks, including archived forks, share this worktree, so it can’t be discarded. |
| `error.forkNoMessage` | 没有找到可以分叉的用户消息。 | Couldn’t find a user message to fork from. |
| `slash.treeDesc` | 打开会话树：回到这个会话里任意一条用户消息之前 | Open the session tree: go back to before any user message in this session |
| `slash.forkDesc` | 从最后一条用户消息分叉出新任务；也可以在任意消息上点“从这里分叉” | Fork a new task from the last user message (or use “Fork from here” on any message) |
| `task.forkTitle` | {title}（分叉） | {title} (fork) |
| `cmd.btw` | 旁路提问（/btw） | Ask a side question (/btw) |
| `btw.title` | 旁路提问 | Side question |
| `btw.slashDesc` | 问一个旁路问题，回答不进对话流 | Ask a side question; the answer stays out of the conversation |
| `btw.placeholder` | 问点别的，回答不会进入主对话 | Ask something on the side; it won't enter the main conversation |
| `btw.placeholderFollowUp` | 追问这个话题 | Follow up on this topic |
| `btw.send` | 提问 | Ask |
| `btw.cancel` | 取消提问 | Cancel question |
| `btw.close` | 关闭旁路提问 | Close side question |
| `btw.newTopic` | 新话题 | New topic |
| `btw.topics` | 旁路提问的话题 | Side-question topics |
| `btw.status.running` | 回答中 | Answering |
| `btw.status.cancelled` | 已取消 | Cancelled |
| `btw.status.error` | 出错 | Error |
| `btw.status.interrupted` | 已中断 | Interrupted |
| `btw.askFailed` | 提问失败 | Couldn't ask |
| `btw.cancelFailed` | 取消失败 | Couldn't cancel |
| `btw.cancelNothing` | 没有可取消的提问 | There is no question to cancel |
| `goal.slashDesc` | 设定目标，omp 会连续推进直到完成；不带文字时显示当前目标 | Set a goal; omp keeps working until it is done. Without text, shows the current goal |
| `goal.pause` | 暂停 | Pause |
| `goal.resume` | 继续 | Resume |
| `goal.completed` | 目标已完成 | Goal complete |
| `goal.drop` | 放弃 | Drop |
| `goal.cmdPause` | 暂停目标 | Pause goal |
| `goal.cmdResume` | 继续目标 | Resume goal |
| `goal.cmdDrop` | 放弃目标 | Drop goal |
| `goal.status.active` | 进行中 | Active |
| `goal.status.paused` | 已暂停 | Paused |
| `goal.status.budget-limited` | 预算用尽 | Budget used up |
| `goal.usageTitle` | 已用 {used} tokens | {used} tokens used |
| `goal.usageBudgetTitle` | 已用 {used} / 预算 {budget} tokens | {used} of {budget} tokens used |
| `goal.current` | 当前目标（{status}）：{objective} | Current goal ({status}): {objective} |
| `goal.none` | 当前没有目标。用 /goal 加上目标文字来设定一个 | No goal right now. Use /goal followed by the goal text to set one |
| `goal.pauseFailed` | 暂停目标失败 | Couldn't pause the goal |
| `goal.resumeFailed` | 继续目标失败 | Couldn't resume the goal |
| `goal.dropFailed` | 放弃目标失败 | Couldn't drop the goal |
| `ompcfg.goal.continuationModes.label` | 目标自动推进 | Let goals keep going |
| `tree.title` | 会话树 | Session tree |
| `tree.empty` | 这个会话里还没有用户消息 | No user messages in this session yet |
| `tree.loading` | 正在读取会话树… | Reading the session tree… |
| `tree.imageOnly` | （图片） | (image) |
| `tree.pick` | 回到这条消息之前，并把它放进输入框 | Go back to just before this message and put it in the composer |
| `tree.forkFailed` | 分叉失败：{message} | Couldn’t fork: {message} |
| `tree.branchFailed` | 回到这条消息失败：{message} | Couldn’t go back to that message: {message} |
| `tree.loadFailed` | 读取会话树失败：{message} | Couldn’t read the session tree: {message} |
| `tree.forking` | 正在分叉… | Forking… |
| `tree.summarize` | 回溯时让 omp 摘要被放弃的分支 | Summarize the abandoned branch when going back |
| `tree.summarizeHint` | 回到这条消息之前时，让 omp 先把被放弃的那条分支写成一段摘要留在会话里（会调用一次模型） | Before going back, omp writes the branch you are leaving as a short summary kept in the session (one model call) |
| `tree.summarizing` | 正在摘要… | Summarizing… |
| `shortcut.send` | 发送 | Send |
| `shortcut.newline` | 换行 | New line |
| `shortcut.later` | 运行中：稍后 | While running: later |
| `shortcut.stop` | 停止并取回排队消息 | Stop and recall the queue |
| `shortcut.toggleProcess` | 展开或收起所有工具卡片 | Expand / collapse tool cards |
| `shortcut.focusComposer` | 聚焦输入框 | Focus the message box |
| `shortcut.nthTask` | 切到第 N 个任务 | Go to task N |
| `shortcut.prevNext` | 上一个或下一个任务 | Previous or next task |
| `shortcut.regions` | 在区域间切换 | Move between areas |

### A.8 设置与登录

| key | 中文 | English |
|---|---|---|
| `settings.general` | 通用 | General |
| `settings.models` | 模型 | Models |
| `settings.providers` | Provider 与订阅 | Providers & subscriptions |
| `settings.tools` | 工具与权限 | Tools & permissions |
| `settings.context` | Context 与记忆 | Context & memory |
| `settings.agents` | Subagent 与规划 | Subagents & planning |
| `settings.integrations` | 集成 | Integrations |
| `settings.advanced` | 高级 | Advanced |
| `settings.whileRunning` | 任务运行中 | While a task is running |
| `settings.language` | 语言 | Language |
| `settings.language.system` | 跟随系统 | System |
| `settings.language.zh` | 简体中文 | 简体中文 |
| `settings.language.en` | English | English |
| `settings.theme` | 主题 | Theme |
| `settings.theme.system` | 跟随系统 | System |
| `settings.theme.light` | 浅色 | Light |
| `settings.theme.dark` | 深色 | Dark |
| `settings.motion` | 减少动效 | Reduce motion |
| `settings.motion.desc` | 系统已要求减少动效时始终生效 | Always on when your system asks for it |
| `settings.enterBehavior` | 运行中按 Enter | Enter while running |
| `settings.enterBehavior.steer` | 插话 | Steer |
| `settings.enterBehavior.later` | 稍后 | Queue for later |
| `settings.notifyWaiting` | 有任务在等你时通知我 | Notify when a task needs me |
| `settings.soundOnDone` | 任务完成时响提示音 | Sound when a task finishes |
| `settings.copyOnSelect` | 选中即复制 | Copy on select |
| `settings.copyOnSelect.desc` | 在对话里用鼠标选中文字后自动复制到剪贴板；输入框和终端不受影响 | Text you select with the mouse in the conversation is copied to the clipboard; the input box and terminal are unaffected |
| `settings.shortcuts` | 快捷键 | Keyboard shortcuts |
| `settings.defaultModel` | 新任务的默认模型 | Default model for new tasks |
| `settings.defaultThinking` | 默认思考强度 | Default thinking level |
| `settings.ompPicksModel` | 由 omp 自动选择 | Let omp choose |
| `login.providers` | Provider | Providers |
| `login.signIn` | 登录 | Sign in |
| `login.signOut` | 退出登录 | Sign out |
| `login.signedIn` | 已登录 · {account} | Signed in · {account} |
| `login.notSignedIn` | 未登录 | Not signed in |
| `login.viaEnv` | 通过环境变量或配置使用 | Using an environment variable or config key |
| `login.opening` | 正在打开浏览器… | Opening your browser… |
| `login.fallback` | 如果浏览器没有打开，复制这个链接： | If your browser didn't open, copy this link: |
| `login.reopen` | 重新打开浏览器 | Open the browser again |
| `login.pasteCode` | 粘贴授权码 | Paste the authorization code |
| `login.terminalOnly` | 这个 provider 需要在终端里登录：运行 omp，再输入 /login。 | This provider has to be set up in the terminal: run omp, then type /login. |
| `login.copyCommand` | 复制命令 | Copy command |
| `login.chooseAccount` | 选择要退出的账号 | Choose an account to sign out |
| `login.failed` | 登录没有完成。 | Sign-in didn't complete. |

### A.9 omp 管理与首次启动

| key | 中文 | English |
|---|---|---|
| `omp.finding` | 正在查找 omp… | Looking for omp… |
| `omp.found` | 检测到 omp {version}（{source}） | Found omp {version} ({source}) |
| `omp.source.studio` | 由 omp-studio 管理 | managed by omp-studio |
| `omp.source.user` | 你自己安装的 | installed by you |
| `omp.missing.title` | 需要安装 omp | omp is required |
| `omp.missing.body` | omp-studio 不内置 omp。可以由 omp-studio 下载并管理一份官方版本（约 {size}），之后自动更新。 | omp-studio doesn't bundle omp. It can download and manage an official copy (about {size}) and keep it up to date. |
| `omp.install` | 下载并安装 | Download and install |
| `omp.recheck` | 我已安装，重新检测 | I've installed it, check again |
| `omp.addPath` | 加入用户 PATH，让终端也能用 | Add to your user PATH so the terminal can use it |
| `omp.addPath.note` | 只修改当前用户的 PATH，原来的 omp 不动。 | Only your user PATH changes. Your existing omp is untouched. |
| `omp.downloading` | 正在下载 omp {version}… | Downloading omp {version}… |
| `omp.progress` | 已下载 {done} / {total} | {done} of {total} downloaded |
| `omp.verifying` | 正在校验… | Verifying… |
| `omp.verifyFailed` | 文件校验失败，已丢弃。 | The file failed verification and was discarded. |
| `omp.takeover.title` | 检测到脚本形式的 omp | Found a script-based omp |
| `omp.takeover.body` | omp-studio 无法启动脚本形式（如 npm 安装）的 omp。可以另装一份官方 omp，并修改你的用户 PATH，把它放到最前面（之后新开的终端里 omp 也会指向它）。原来的那份原样保留。 | omp-studio can't launch script-based installs (such as npm). It can install its own official copy and change your user PATH to put it first (omp in newly opened terminals will point to it). Your existing install stays as is. |
| `omp.takeover.yes` | 由 omp-studio 管理 | Let omp-studio manage it |
| `omp.takeover.no` | 取消 | Cancel |
| `omp.takeover.declined` | 这种安装方式暂时用不了。 | This kind of install can't be used right now. |
| `omp.outdated` | omp 版本过旧（{current}），需要 {min} 或更高。 | omp {current} is too old. Version {min} or newer is required. |
| `omp.upgrade` | 升级 | Upgrade |
| `omp.upgrading` | 正在升级… | Upgrading… |
| `omp.newVersion` | 有新版本 {version} | {version} is available |
| `omp.checkUpdate` | 检查更新 | Check for updates |
| `omp.upToDate` | 已是最新版本 | You're up to date |
| `omp.path` | omp 路径 | omp path |
| `settings.about.versions` | 版本 | Versions |
| `omp.source` | 来源 | Source |
| `omp.error.title` | 没能启动 omp | Couldn't start omp |
| `omp.error.details` | 显示详情 | Show details |
| `omp.retry` | 重试 | Try again |
| `omp.openSettings` | 打开设置 | Open settings |

### A.10 错误、会话与无障碍

| key | 中文 | English |
|---|---|---|
| `error.exited` | 这个任务的 omp 进程退出了（退出码 {code}）。会话已保存。 | The omp process for this task exited (code {code}). Your session is saved. |
| `error.protocol` | 和 omp 的通信出错了，已断开。可能是版本不兼容。 | Communication with omp failed and was disconnected. The version may be incompatible. |
| `error.model` | 模型返回错误：{message} | The model returned an error: {message} |
| `error.modelUnavailable` | 这个会话用的模型现在不可用。 | The model used by this session isn't available. |

---

## 附录 B. 对主进程/协议的依赖、待核实与需要仓库所有者拍板的事

**需要仓库所有者拍板**

| # | 事项 | 本规范的选择 |
|---|---|---|
| 1 | 审批模式默认值 | **已定（2026-10-18）：完全跟随 omp 的配置**（`tools.approvalMode`，omp 默认 `yolo`），启动时从不传 `--approval-mode`；胶囊改的就是 omp 配置（§5.8）。原方案"Studio 默认 `write`"和"Studio 自己存一份默认值"都作废 |
| 2 | 审批模式切换语义 | omp 在进程启动时读配置；胶囊改配置后，之后启动的任务生效，运行中的任务要重启（见 §5.8）。备选"重启进程并恢复会话"需先实测 `open_session` 无损恢复 |
| 3 | 测试结果显示 | 不显示（设计原则“结果优先”提到）；若要做，需先决定识别规则（omp 不给结构化的测试结果） |
| 4 | API key 类提供商登录 | **已定**：设置页输入，Electron `safeStorage` 加密存在 `userData/api-keys.json`，启动 omp 时以环境变量传入，不写 `~/.omp`（`docs/architecture/login.md`） |
| 5 | 新增运行时依赖 / 未定技术选型 | **已定**：语法高亮 `shiki`、Markdown `markdown-it`、公式 `katex`；i18n 和覆盖式滚动条自己写（`src/shared/i18n/`、`ui/OverlayScrollbar.tsx`） |
| 6 | 字体是否打包 | **已定（0.3.29）**：打包 Geist / Geist Mono，中文仍用微软雅黑 UI；只改 `--font-*` |
| 7 | 阅读列宽 / 正文 15px 是否偏大 | 已定 840（2026-10-19）；正文仍可凭肉眼调，只改 `--fs-prose` |
| 8 | 任务完成不发系统通知 | 取“只有等你会叫你”的立场；若内测反馈需要，再加一个默认关闭的设置项 |
| 9 | 产品名/Logo | 暂定名 omp-studio，侧栏头不放 Logo/应用名 |

**需要实测 / 录制 fixture（[推测] 项）**

1. `titleBarOverlay` 在 Win11 上是否保留 Snap Layouts；无应用菜单时编辑快捷键是否正常；Electron 44 的 `linear()` 弹簧、`text-wrap: pretty` 支持。
2. 终端正在使用同一会话文件的探测方法；运行中 `set_model` 的生效时机（决定 `composer.nextRequest` 文案是否保留）。

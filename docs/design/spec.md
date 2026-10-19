# omp-studio UI 规范 v1（定稿；2.6 起色板、圆角、顶栏、脊线按方向 A「仪表」，见 `direction-2.6.md`）

> 范围：`PLAN.md` 阶段 1 + 阶段 2 的全部界面。输入：`DesignCalm`（克制、结果优先）与 `DesignBold`（有辨识度的手感）两份方案，以 `PLAN.md` §2 为硬约束：**结果优先、过程默认折叠、一个主导航、遥测克制、只用 token、中英双语、遵守 reduced-motion**。
> 配套文件：`src/renderer/styles/tokens.css`（全部变量，深浅两套，reduced-motion）。本文引用的 `--xxx` 都在那里。
> 证据标记：**✔** = 在仓库里核实过（fixture、wire schema、omp 文档）；**[推测]** = 没有实测，实现时要用回放或真机验证；未标记的是设计决定。

---

## 1. 裁决表

“采用”列：`[Calm]` / `[Bold]` = 采用该方案；`[融合]` = 两边各取一部分；`[新]` = 两份方案都没写、定稿时补的。倾向：**克制为底；只保留“不违反原则且低成本”的有性格细节**。

### 1.1 两份方案各自最可能被挑战的 3 个决定

| 决定 | 采用 | 理由 |
|---|---|---|
| Calm-1：审批/ask 就地替换输入框 | **否决，改为停靠在输入框上方的“门”**（[Bold]），但保留 Calm 的防误触规则：打字时不抢焦点、Enter 不隐式允许 | omp 自己的设计就是“提示停靠在输入框上方，输入框保留光标，可输入文字来拒绝并改道”（`omp://approval-mode.md`）。替换输入框会丢掉“拒绝并告诉 agent 怎么做”这个真实能力，还要为输入框消失/草稿还原写额外状态 |
| Calm-2：叙述文本不留在正文，只剩结论 | **采用，加一条兜底**：一轮结束时若没有“不带工具调用的最后一条消息”，把最后一条助手文本当结论显示，只有整轮没有任何文本才显示“没有得到结果”（Calm 原文是后者） | 守住“结果优先”；叙述仍在展开的过程里可读。启发式的误判风险用兜底吃掉，并要求用 `fixtures/rpc/` 的回放做测试（见 §7）。Bold 的“候选结论迁移进现场窗”动画被否决：对话流里不允许有块迁移 |
| Calm-3：自绘标题栏 + 无菜单栏 + 审批胶囊放在输入框 | **采用标题栏与无菜单栏**；**审批胶囊保留，显示和修改的是 omp 配置里的 `tools.approvalMode`**（见 §5.8） | 两份方案一致（`titleBarOverlay` 保留系统三键与 Snap Layouts [推测，需在 Win11 实测]）。审批模式没有运行中 RPC（`omp://approval-mode.md`），omp 在进程启动时读配置，所以胶囊的修改对之后启动的任务生效 |
| Bold-1：运行中展开 4 行“现场窗” | **否决，改为一行实时状态**（[Calm]）：`[点] 当前工具的 intent 原话 · 1:12 ›` | 一行已经回答“它在干什么、有没有卡住”；4 行滚动窗每次换行都是一次动画，并把“过程默认折叠”在运行中反过来。点击这一行展开完整工具列表。`intent` 的数据已核实 ✔：`fixtures/rpc/bash-tool.ndjson` 里 `tool_execution_start` 带 `"intent":"Running echo command"`，wire schema 中为可选字段（`src/shared/omp-wire/rpc-wire.generated.ts:836`），缺失时用工具名映射的动词兜底 |
| Bold-2：运行中 Enter=插话（steer）、Ctrl+Enter=稍后（follow-up）、Esc=停止并把排队消息放回输入框 | **采用**；设置页可对调 Enter / Ctrl+Enter；Esc 不做二次确认 | 两份方案一致。运行中发消息多数是纠偏；`abort_and_restore_queue` 保证 Esc 不丢字，终端用户零学习成本。误停的代价由 toast 说明消息去向 + 草稿保留来吃 |
| Bold-3：一批“有性格的小东西” | **部分采用**。保留：intent 原话、输入框首次发送“落下”、弹簧只用于浮层出现与发送↔停止形变、状态点用形状区分（菱形=等你）、可操作的 steer/later 队列条、模型切换细分隔线、`继续` 列表（含终端会话）、todo 进度胶囊。**砍掉**：任务点卫星点、子代理字母头像与哈希色、4 行现场窗、流式文字平滑追赶、悬停显示模型署名、第二条“软弹簧”曲线 | 取舍标准：不增加常驻动效、不增加信息量、实现成本低、数据只依赖 omp 现有帧。卫星点是侧栏常驻运动；头像/哈希色属于阶段 5 的泳道，提前做会和泳道设计打架 |

### 1.2 逐项裁决

#### Token

| 决定 | 采用 | 理由 |
|---|---|---|
| 字体来源 | [Calm] 系统字体，不打包 | Segoe UI Variable → 雅黑 UI；零依赖、安装包小。Bold 的 Inter + JetBrains Mono 打包留给截图评审后再议（只改 `--font-*`） |
| 字体栈顺序 | [Calm/Bold 一致] Latin 在前，CJK 在后 | 浏览器逐字符回退，汉字走雅黑，两边字形互不污染 |
| 字号体系 | [融合] 命名用 `--fs-*`/`--lh-*`（Bold），数值取两边公共部分；正文 15px | 颜色里已有 `--text` 系列，字号再叫 `--text-sm` 会撞名。正文 15px 两边一致，中文行高 27、英文 24 |
| 字重 | [Bold] 状态不靠字重；500 只给 Latin 标签；中文标题用 600 | 雅黑 UI 只有 400/700，500 会回落，列表宽度与省略号位置会跳。Calm 的“选中行标题 500”被否决 |
| 间距 | [Calm] `--space-N` = N×4px，外加半档 `-0-5/-1-5/-2-5/-3-5` | 比 Bold 的非线性命名直观；半档是为了组件内边距（6/10/14）也能走 token |
| 圆角 | [融合] 两份几乎相同，取 4/6/8/12/16/pill | — |
| 表面层级 | [Bold] 五级表面；深色下侧栏比内容区更暗，浅色下更灰 | Calm 深色侧栏比内容区更亮，与“导航退后、内容突出”相反 |
| 强调色 | [2.6 改] 松石绿（`#0B7A66` / `#3FCBAE`；原 Iris 紫作废） | 方向 A「仪表」（仓库所有者 2026-10-18 选定）。强调色只出现在：进行中状态、主输入焦点环、链接、上下文圆环、开关、选中竖条；主按钮改为近黑底（深色主题近白底），不再用强调色 |
| 对比度修正 | [新] 深色 `--text-3` 调到 `#8A8D97`、浅色调到 `#666972`；浅色错误色调到 `#B93030`；代码注释与浅色数字色同步调亮 | 重算后 Bold 原值在深色 overlay 上 4.19、浅色悬停底上 4.17，低于 4.5:1。修正后全部主文本组合 ≥4.5:1（§2.5 表） |
| 阴影 | [Bold] 三级 + `--shadow-composer` | 输入框是视觉焦点，值得单独一档 |
| 动效曲线 | [Bold] ease-out-quint 为默认，一条弹簧（`linear()`） | Calm 的弹簧过冲 6%，偏弹；Bold 的 ζ≈0.8、过冲 1.5% 更克制。砍掉第二条软弹簧，只用 ease-out |
| 动效时长 | [Bold] 80/140/200/320/420 + Calm 的 `--dur-stream` | — |
| reduced-motion | [Calm] 系统开启或应用内开关任一为真即生效；应用内**只能强制开，不能在系统要求减少时关闭**；保留 100ms 纯透明度渐变；位移/缩放通过 `--travel-*` / `--scale-pop` 归零 | AGENTS 把它列为硬约束；token 化位移量后，组件不用逐个写 reduced 分支 |
| 循环动画 | [新] 统一用 `animation-play-state: var(--play-state)`，keyframes 的 0% 帧即静态终态 | 比“时长设为 0 且无限循环”可靠，不依赖浏览器对 0s infinite 动画的行为 |
| 主题机制 | [新] CSS 默认跟随 `prefers-color-scheme`；`<html data-theme>` 显式覆盖 | 任务要求；Calm/Bold 都让主进程解析后写属性，仍然可以：主进程只在用户选择“浅色/深色”时写 `data-theme`，选“跟随系统”时移除属性 |
| 滚动条 | [融合] 自绘覆盖式，原生滚动行为保留，`scrollbar-width: none` | PLAN §2 要求；覆盖式保证阅读列不因滚动条出现而横移 |
| 状态点 | [融合] 形状 + 颜色：进行中=实心圆带呼吸环、等你=静止菱形、未读完成=对勾、出错=圆内感叹号；已读完成与空闲**不画**（[Calm]） | 形状是第二信号（色盲友好）；已读无标记让列表安静。Bold 的“空心圆=空闲”和“卫星点”不要 |

#### 布局

| 决定 | 采用 | 理由 |
|---|---|---|
| 标题栏 | [Calm/Bold 一致] `titleBarStyle: "hidden"` + `titleBarOverlay`（系统绘制三键，高 40）；覆盖色取**顶栏**底色 `--bg-sidebar` | 保留 Snap Layouts、高对比度、DPI 行为 |
| 标题栏内容 | **仓库所有者 2026-10-18 指定：照 Claude 桌面版**。窗口最上方一条通栏的顶栏，横跨侧栏和主区：左边依次是菜单 `≡`、侧栏开关、后退 `←`、前进 `→`；右边是一个文字链接位和系统三键。侧栏和主区都在顶栏下面，主区是一块左上角圆角的内容面板（见 §3.1、§3.2） | 参考图：Claude 桌面版 Windows 顶栏 |
| 菜单栏 | 无系统菜单栏；顶栏左侧的 `≡` 按钮弹出应用菜单（照 Claude 桌面版），每个命令也必须能在 `Ctrl K` 找到 | 菜单栏是“导航混乱”的来源（PLAN §1） |
| 窗口尺寸 | [融合] 默认 1200×800，最小 800×560 | Calm 最小 720 太窄，Bold 900 太保守；800 时侧栏已是抽屉 |
| 阅读列宽 | [融合] 840（2026-10-19 所有者要求输入框离两边近一些，由 720 加宽），输入框与对话列同宽同轴（[Bold] 的同轴） | Calm 把输入框做得更宽 40px，破坏同轴；列宽只改 `--content-w` |
| 侧栏宽 | 264，可拖 220–360；折叠为 0（不留图标条） | 一个主导航 |
| 窄窗口 | [融合] <1000px 侧栏改覆盖式抽屉 | 抽屉不挤压正文，保证“缩放后保住阅读位置” |
| “等你确认”的呈现 | [Bold] 侧栏头下方一条提示条（计数，点击依次跳转）+ 行内菱形，**不把行搬出分组** | Calm 把等待行移到顶部聚合段，确认后再移回——列表在用户眼皮下重排，与“稳定>灵动”冲突 |
| 任务排序 | [Bold] 项目内按“用户最后一次主动操作”排序，不按 agent 活动 | 列表不跳 |
| 每项目显示数 | 6，“显示更多（N）”每次 +20 | Bold；Calm 的“更早”折叠组不做 |
| 侧栏底部 | [Bold] `设置` 按钮 + `Ctrl K` 键帽 | Calm 的头像/账号名依赖账号信息，v1 没有 |
| 侧栏搜索框 | 不放；`Ctrl K` 即搜索 | 少一个入口 |
| 空状态 | [Bold] 项目名作大标题 + 路径 + 最近 3 个任务（历史会话只在侧栏搜索里，含终端会话） | Calm 的欢迎语是填充文案；“继续”列表是回答 PLAN §9“Tern 用户为何装它”的零迁移卖点，成本只是读 `~/.omp`（只读） |
| 输入框位置 | [Bold] 空状态在内容区 38% 处，首次发送后弹簧落到底部，之后不再移动 | 一次性、仅 `transform`；reduced-motion 下瞬时 |
| 右栏 | 预留 `--aside-w: 0px` | 阶段 3/5 用 |

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
| 过程行（已结束） | [融合] `已工作 2 分 14 秒 · 12 次工具调用 · 2 个子代理`；不足 1 秒或 0 次调用不显示；有失败时追加红色 `· 1 次失败`（[Bold]）；等待时间从工作时长中扣除（[Calm]） | 对应 PLAN §2.2 原文 |
| 展开后的工具行 | [Calm] 点击单行再展开输出，最多 12 行；超出“显示全部”（[Bold]） | 两层“点开才看” |
| 思考内容 | 永不进正文；展开过程里一行 `思考 · 12 秒` | 两份一致 |
| 子代理 | v1 仅在过程行计数，展开后缩进一行 `子代理 {name} · {n} 次工具调用 · {状态}` | 泳道是阶段 5 |
| 改动卡片 | [融合] 头部 `N 个文件已更改 +42 −7`；最多 5 行文件；点文件行 = 在资源管理器中显示（[Bold]）；等本轮完全结束（`session_settled`）再计算显示 | 用系统默认应用“打开文件”可能执行 agent 刚写的脚本，风险比“显示”高；半途出现的改动会跳 |
| 改动卡片里的测试结果 | **v1 不做**（[Bold]） | omp 没有结构化测试结果帧；靠解析 bash 输出猜“通过/失败”会出错（Calm 也承认是推测）。PLAN §2.1 提到的测试结果推迟，卡片头部右侧留位 |
| 输入框正文字号 | [Bold] 15px（`--fs-prose`） | 所见即所得；Calm 的 14 是控件字号 |
| 胶囊 | [融合] 模型+思考强度合并为一颗，弹层里分段选择（[Bold]）；审批为独立一颗；⊕ 添加图片按钮 | 少一颗胶囊；Calm 的“思考”单独胶囊在不支持思考的模型上要隐藏，合并后自然消失 |
| 发送/停止 | [Bold] 运行中输入非空时并排显示“发送(↑)”和“停止(■)” | Calm 在这种状态让停止键让位，只剩 Esc，不直观 |
| 队列条 | [Bold] 虚线、`插话`/`稍后` 标签、`现在插话`、✕ | 虚线=尚未发生；文案“插话/稍后”比 Calm 的“引导/排队”自然 |
| 上下文提示 | [融合] 输入框工具行里的用量仪表默认显示；≥90% 变琥珀；点击弹出“压缩上下文” | 琥珀而非红：不是错误 |
| 门（审批/ask） | [Bold] 停靠在输入框上方；两份方案的各自细节见 §4.17 | 见 §1.1 Calm-1 |
| ask 的推荐项 | [Bold] 标“推荐”但**不预选** | 超时才会自动选推荐项；预选会让 Enter 误提交 |
| 门的按钮文案 | 按 `method` 数据驱动：`confirm` 用“确认/取消”；审批 `select` 的选项**原样显示 omp 给的文本**，仅对精确匹配的 `Approve`/`Deny`/``Approve `x` for this session`` 做本地化 | Calm 统一“允许/拒绝”会把非审批 confirm 说错；Bold 的“不靠标签判断”被保留（按键位置决定行为，标签只影响显示） |
| 审批请求正文 | 统一等宽、`pre-wrap` | 审批内容主要是命令和路径，空白敏感；不尝试猜“像不像命令” |
| 命令面板 | [融合] 宽 600；分组 任务/会话/命令/斜杠命令；无结果时“在新任务中提问”（[Bold]） | Bold 的“模型”分组由 `Alt M` 覆盖，不进面板 |
| 设置页 | [融合] 主区页面（不是弹窗），四节：通用 / 模型与账号 / omp / 用量 | Calm 的页面形态 + Bold 的卡片分组；Bold 的“关于/快捷键/对话”并入“通用/omp” |
| 用量 | [Calm] 默认折叠成一句说明，点“显示用量”才请求数据 | 遥测克制 |
| 首次启动 | [Bold] 一张居中卡片的状态流（找到/过旧/脚本/没有/下载中/连接模型/选文件夹） | 比 Calm 更完整；审批模式偏好**不在引导里问**（Bold 的建议被否决）：少一个配置型问题，默认值已安全 |
| 版本过旧提示 | [Calm] 主区顶部横幅；低于最低版本时禁用发送 | 不是引导，是持续状态 |
| 错误呈现 | [Calm] 人话一句 + 可复制详情 + 一个恢复动作；对话内用“左 2px 红线 + 浅红底”内联条 | 不用大块红色 |
| Toast | [Calm] 右下角，宽 360 | Bold 的底部居中会盖住门和输入框 |
| 通知 | [Bold] 只有“等你确认”会叫你：任务栏闪烁 + 角标 + 窗口失焦时系统通知；不播声音 | 这是对 Tern/终端的核心差异；**不做“任务完成”通知**（注意力预算），侧栏对勾足够 |
| todo 进度胶囊 | [Bold] 主区头部，仅有 todo 时出现 | omp 专属、是“进度”不是遥测；可砍，不影响布局 |
| 模型切换分隔线 | [Bold] 流中插一条细线 `切换到 {model} · {level}` | 署名不是遥测，只在切换时出现 |
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
| 会话历史 | [Calm] 休眠任务先显示只读转录，发送时才启动进程并恢复 | 切换任务即时，不为每个历史会话起进程 |
| 草稿持久化 | [Bold] 主进程持久化，经 preload 读写 | 崩溃也不丢；渲染层不碰存储 |
| `@` 文件引用 | [新增] 输入 `@` 弹出项目文件补全菜单，插入 `@相对路径`，omp 自己展开 | 终端版 omp 的 `@` 补全是日常高频操作；展开由 omp 完成，studio 只补全（见 FileMenu） |

#### 文案

| 决定 | 采用 | 理由 |
|---|---|---|
| 运行中 Enter / Ctrl+Enter 的称呼 | 插话 / 稍后（Bold） | “引导/排队”不是人话 |
| 允许类措辞 | 审批 `select` 原样显示；`confirm` 用“确认/取消” | 见组件表 |
| 中英混排 | 汉字与英文/数字之间加空格（Calm） | 不依赖 `text-autospace`（Electron 44 支持情况未知，Bold 列为待实测） |
| 句末标点 | 句子保留句号；标签/按钮不加；不用感叹号；用“你”不用“您” | — |
| 复数 | 英文用 ICU `{n, plural, …}`，中文单一形式 | 见附录 A 说明 |
| 审批模式标签 | `每次询问` / `写入自动，执行询问` / `全部自动`（Bold）对应 `always-ask` / `write` / `yolo` | 与 omp 的三种模式一一对应（`omp://approval-mode.md`）；omp 设置页里 `tools.approvalMode` 的取值显示同一套文案（`approval.*`）。其余枚举设置的取值走 `ompcfg` 的 `<键>.opt.<值>` / `opt.<值>`，没有翻译的显示 omp 原值；设置键第一段的分组名走 `ompcfg` 的 `prefix.<段>` |

---

## 2. Token（实现见 `tokens.css`）

### 2.1 主题

- 默认：浅色 `:root`；`@media (prefers-color-scheme: dark)` 下，只要没有 `data-theme="light"` 就套深色。
- 显式：`<html data-theme="light|dark">`。设置页选“跟随系统”时主进程**移除**该属性。
- 深色色板在 CSS 里出现两次（系统深色、显式深色），必须逐行一致——**加一条 Vitest 测试**，解析 `tokens.css`，比较两个深色块与两个 reduced-motion 块的声明集合，防止改一处漏一处。
- 主进程同步：`BrowserWindow.backgroundColor`（避免首帧闪白）与 `titleBarOverlay`（主题切换时 `win.setTitleBarOverlay`）：

| 主题 | `backgroundColor` / `color`（= `--bg-sidebar`，顶栏和侧栏的底色） | `symbolColor`（= `--text`） |
|---|---|---|
| 浅色 | `#EDF0EF` | `#111816` |
| 深色 | `#0B0E0D` | `#E6ECEA` |

有遮罩（`--bg-scrim`）的弹窗打开期间（模型选择、命令面板、会话树、确认框、关于、git 对话框、接管 omp 询问），系统三键也跟着变暗：渲染进程用 `useTitleBarDim` 计数，第一个打开时调 `setTitleBarDimmed(true)`，最后一个关掉时恢复；颜色是顶栏色上叠一层遮罩后的实色（三键不是网页画的，遮罩盖不到）：

| 主题 | 变暗后 `color` | 变暗后 `symbolColor` |
|---|---|---|
| 浅色 | `#A7ABAA` | `#111816` |
| 深色 | `#070A09` | `#676B6A` |

### 2.2 字体

- `--font-sans`（正文/UI）、`--font-display`（仅 ≥20px：空状态标题、设置页标题）、`--font-mono`（代码、命令、路径）。
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
| `--fs-xs` | 12/16 | 项目分组名、过程行、元信息、tooltip |
| `--fs-sm` | 13/20（zh 22） | 侧栏、胶囊、按钮、菜单、改动卡片 |
| `--fs-base` | 14/20（zh 22） | 对话框正文、设置页正文、门的标题 |
| `--fs-prose` | 15/24（zh 27） | **对话正文、用户消息、输入框** |
| `--fs-lg` | 17/26 | 对话里的 h1、对话框标题、设置分组标题 |
| `--fs-xl` | 20/28 | 设置页大标题 |
| `--fs-2xl` | 28/34 | 空状态项目名 |
| `--fs-code` / `--fs-code-sm` | 13/20 · 12/18 | 代码块 · 工具输出、行内代码 0.92em |

### 2.4 间距、尺寸、层级

见 `tokens.css`。规则：**组件里不出现表外的数**（除了 1px 描边、2px 焦点环/竖条、组件私有的固定像素如 8px 状态点，这些在 §4 里逐个写明）。窄窗断点（媒体查询不能用变量）：`<1000px` 侧栏抽屉并 `--gutter` 改 16px；`<900px` 命令面板宽 `calc(100vw − 32px)`。

### 2.5 颜色语义与对比度

| 用途 | token | 规则 |
|---|---|---|
| 表面 | `--bg-sidebar` < `--bg-app` < `--bg-raised` < `--bg-overlay`；`--bg-sunken` 是凹进去的代码/展开区 | 用层级而不是颜色分区 |
| 交互态 | `--bg-hover`、`--bg-active`、`--bg-scrim` | `:active` 无位移、无缩放 |
| 线 | `--border-subtle`（分隔）/ `--border`（外框）/ `--border-strong`（hover、输入框默认描边） | — |
| 文本 | `--text` / `--text-2` / `--text-3` / `--text-disabled` / `--text-on-accent` | `--text-3` 只用于次要元信息，不用于可操作文字；在 `--bg-overlay`、`--bg-active` 等较亮的底上对比度较低，见下表与例外 |
| 强调 | `--accent` / `--accent-hover` / `--accent-soft` / `--focus-ring` / `--link` / `--selection-bg` | 松石绿；只给进行中、主输入焦点、链接、上下文圆环、开关、选中竖条 |
| 主按钮 | `--primary` / `--primary-hover` / `--text-on-primary` | 浅色近黑底白字，深色近白底深字；每个视图最多一个 |
| 状态 | `--st-running`（=强调色）、`--st-waiting`（点）+ `--st-waiting-text`（字）+ `--st-waiting-soft`、`--st-done`、`--st-error` + `--st-error-soft` | 四个语义色之外界面是灰的 |
| 代码 | `--syn-*`（7 色）；`--diff-add-fg` / `--diff-del-fg`（改动卡片的 +N/−N 文字） | 评审里的行背景 `--diff-add-bg` / `--diff-del-bg`（阶段 3 加入，深浅色各一份） |

2.6 起的色板（浅 / 深，均为带一点绿的矿物灰；数值来自 `direction-2.6.md` §3，对比度按 WCAG 公式算过）：`--bg-sidebar` `#EDF0EF` / `#0B0E0D`，`--bg-app` `#F8FAF9` / `#111514`，`--bg-raised` `#FFFFFF` / `#171C1A`，`--text` `#111816`（17.2）/ `#E6ECEA`（15.4），`--text-2` `#4B5652`（7.3）/ `#A3AFAB`（8.1），`--text-3` `#5F6A66`（5.4）/ `#7F8B87`（5.2），`--accent` `#0B7A66`（5.0）/ `#3FCBAE`（9.1），`--st-waiting` 点 `#B76E00` 字 `#8E5A00`（5.5）/ `#F0B545`，`--st-error` `#B42E2E`（5.9）/ `#F27373`。**`--st-done` = `--text-2`**：完成是中性对勾，不再用绿色（免得和强调色混淆）；`--diff-add-fg` 用强调色，`--diff-del-fg` = `--st-error`。圆角整体收小一档：`--radius-xs/sm/md/lg/xl` = 3 / 4 / 6 / 8 / 10（卡片 8、输入框 10、按钮 6）。

下表是 v1 旧色板的计算结果，仅作方法参考；新色板的组合以上面一段为准（`--accent` 在 `--bg-app` 5.0，`--text-on-accent` 在 `--accent` 5.3 / 8.4，`--text-3` 在 `--bg-sidebar` 4.9）：

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
| `--st-done` 在 `--bg-app` | 8.6 | 5.2 |
| `--st-error` 在 `--bg-app` / `--st-error-soft` 上 | 6.5 / 5.9 | 5.8 / 4.9 |

已知例外：`--text-3` 在“选中行”（`--bg-active`）上深色约 4.3:1——选中行的次要时间文字允许，不用于需要阅读的内容；`--st-waiting`（浅色，点）与 `--bg-sidebar` 是 3.1:1，靠形状（菱形）补足。

### 2.6 动效

| 事件 | 动画 | 时长/曲线 |
|---|---|---|
| 菜单、popover、tooltip 出现 | opacity 0→1 + `translateY(var(--travel-sm))→0` + `scale(var(--scale-pop))→1` | `--dur-base` `--ease-out`；消失 `--dur-fast-exit` `--ease-in` |
| 命令面板、对话框出现 | 同上，位移 `--travel-md` | `--dur-slow` `--ease-spring` |
| 门出现 | opacity + `translateY(var(--travel-lg))→0`；边框一次琥珀脉冲 | `--dur-base` `--ease-out`；脉冲 `--dur-slow`×2 |
| 过程行展开/折叠 | `grid-template-rows: 0fr↔1fr` + 内容 opacity | `--dur-base` `--ease-out` |
| 输入框首次发送“落下” | FLIP，`translateY` 到底部 | `--dur-spring` `--ease-spring` |
| 发送 ↔ 停止 | `border-radius` + 图标交叉淡入 | `--dur-fast` `--ease-spring` |
| 用户消息出现 | `translateY(var(--travel-md))→0` + opacity | `--dur-base` `--ease-out` |
| 侧栏折叠/抽屉 | `translateX`；主区宽度**立即变一次**，不逐帧 | `--dur-slow` `--ease-out` |
| 状态点切换 | 旧点缩小淡出 + 新点放大淡入 | `--dur-fast` |
| 进行中呼吸环 | opacity .35→0 + scale 1→1.6，循环 | `--dur-breathe`，`animation-play-state: var(--play-state)` |
| 加载环 | 旋转 | `--dur-spin` linear |
| 流式光标 | opacity 脉冲 | `--dur-caret` |
| Toast | `translateY(var(--travel-md))→0` + opacity | `--dur-base`，停留 5s，悬停暂停 |
| 浮层、菜单、对话框、toast **消失** | 反向：opacity→0 + 下沉 `--travel-sm` + 缩到 `--scale-pop`；遮罩只淡出 | `--dur-fast-exit` `--ease-in`；放完才卸载（`ui/presence.ts` 的 `usePresence`，`data-closing="pop"/"fade"`，规则在 `ui/motion.css`） |
| 折叠区域展开/收起（过程行、改动卡片、模型分组、侧栏项目组、设置分组、队列条、目标条、旁路提问面板等） | `grid-template-rows: 0fr↔1fr` + opacity；首次渲染就展开的不放 | 展开 `--dur-base` `--ease-out`，收起 `--dur-base-exit` `--ease-in`（`ui/Reveal.tsx`） |
| 主区换页（新任务页 / 对话 / 设置）、切任务、设置换节 | `view-in`：opacity + `translateY(var(--travel-sm))→0` | `--dur-base` `--ease-out` |
| 可交互元素的 hover / 选中 / 聚焦 | 背景、边框、文字颜色、阴影、透明度渐变 | `--dur-fast` `--ease-out`（`motion.css` 里 `:where(button, …)` 零优先级的默认值，组件自己写的优先） |

性能规则：只动 `transform` 与 `opacity`（外加折叠用的 `grid-template-rows`）；不动画 `height` / `width` / `top`。reduced-motion 下：所有位移、缩放、弹簧归零；循环动画暂停在 0% 帧（呼吸环=实心点带一圈淡环，光标常亮，加载环用静态 `…`，由 `useReducedMotion()` 切换字形）；只保留 `--dur-fade`（100ms）的透明度渐变；`scrollTo` 一律 `behavior: "auto"`；输入框“落下”瞬时。JS 里读取动效开关只走一个 `useReducedMotion()`（`matchMedia` + `data-motion`），组件不各自读。

---

## 3. 布局

### 3.1 窗口

- `BrowserWindow`：`titleBarStyle: "hidden"`，`titleBarOverlay: { color, symbolColor, height: 40 }`（取值见 §2.1），`backgroundColor` 同 `color`；默认 1200×800，最小 800×560；`Menu.setApplicationMenu(null)`，快捷键用窗口内 `keydown` 处理。
- **顶栏 = 任务条（通栏，高 40 = `--titlebar-h`；仓库所有者 2026-10-19 选定方案 B「任务条 + 工具区」）**：底色 `--bg-sidebar`（与 `titleBarOverlay.color` 相同，系统三键融进同一条）。控件统一高 28（`--control-h-sm`），上下各留 6。三段：
  - 左段（宽 = 侧栏宽，侧栏收起/抽屉时自适应）：`padding-left: --space-2`，一个**品牌按钮**就是应用菜单按钮（`data-testid="topbar-menu"`）：标志（圆环里一个 π，只用 `--accent` 描线，18px；临时版）+ 字标 `omp studio`（`omp` 600 `--text`，`studio` 400 `--text-2`）+ 12px ⌄（`--text-3`）；`--radius-md`，hover / 展开 `--bg-hover`。菜单：新任务 Ctrl N、命令面板 Ctrl K、**切换侧栏 Ctrl B**、设置 Ctrl ,、帮助与反馈、关于、退出；`Alt` 键也打开它。语言和主题不在菜单里（2026-10-19 移到侧栏底部，见 §4.5）。
  - 中段（左缘对齐主区面板）：**只有任务标题**（`--fs-sm`，`--text` 600 / 中文 700，过长省略，悬停提示完整标题；不显示项目名，项目在侧栏分组里）+ 状态胶囊：高 22、`--radius-pill`、`--fs-xs`、等宽数字，6px 形状点。运行中 = `--accent-soft` 底、`--accent` 字、圆点 + `window.runningFor`（`运行中 · 1:12`，`formatClock`，每秒更新）；等你确认 = `--st-waiting-soft` 底、琥珀菱形 + `status.waiting`；出错 = `--st-error-soft` 底、红点 + `status.error`；空闲不显示。空状态显示 `新任务`，设置页显示页面标题。
  - 右段（只在有任务的对话页出现，`data-testid="topbar-tools"`）：分支胶囊（`features/git/GitTools.tsx`；`--font-mono` `--fs-code-sm`，1px `--border-subtle`，`--radius-md`，最宽 32ch；内容 分支图标 + 分支名 + worktree 任务领先时 `↑N`（`--accent`）+ ⌄；点开是 Git 菜单；"分支 · 工作树 · 基于 main · 领先 N 个提交"在悬停提示里；窄于 1000px 只留图标和 `↑N`；任务目录不是 git 仓库时不渲染）→ 评审按钮（28×28，同 `Ctrl Shift D`；不是 git 仓库时不渲染）→ 终端按钮（28×28，按下 = `--accent-soft` 底、`--accent` 图标）→ 1px×16 `--border` 竖线，与系统三键隔开。再往右是系统三键（`titleBarOverlay` 绘制）；顶栏 `padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))` 让位。
  - **没有后退/前进/侧栏开关按钮**（仓库所有者 2026-10-18 确认）：后退/前进在 `Alt+←/→` 和鼠标侧键（button 3/4），侧栏开关在菜单和 `Ctrl B`。导航历史栈仍在渲染进程。
  - 其余空白全部 `-webkit-app-region: drag`，按钮和任务条 `no-drag`；双击空白最大化/还原（系统行为）。
- **主区面板（“纸面”）**：顶栏下方，侧栏右边。底色 `--bg-app`，1px `--border`，**四个角都是 `--radius-xl`**，右边和下边各留 `--space-2` 的窗口底色，像一张放在桌上的纸；侧栏收起或作为抽屉时左边也留 `--space-2`。面板与侧栏之间不画分隔线。
- 单实例（二次启动聚焦已有窗口）；记忆位置/尺寸/最大化/侧栏宽度/侧栏折叠/折叠的项目组。
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
│ ▸ 项目                ││ │ [门] [队列条] [输入框]                            │ │
│                      ││ └────────────────────────────────────────────────┘ │
│ ⚙ 设置               ││                         主区面板 --bg-app，左上圆角 │
└──────────────────────┴┴─────────────────────────────────────────────────────┘
```

- 侧栏底色 `--bg-sidebar`，与顶栏连成一片；主区面板 `--bg-app` 带左上圆角，两者之间不画线。侧栏拖拽条（命中区 4px）贴在面板左缘，hover 显示 `--border`；双击恢复 264。
- `.scroller` 铺满主区、滚动条贴窗口边缘；`.column` 在其中居中；底部 padding = 底部栈高度 + `--space-8`（栈高度由 `ResizeObserver` 写入组件私有变量 `--stack-h`）。
- 输入框距窗口底 `--space-4`；其上有 24px 高 `linear-gradient(transparent, var(--bg-app))` 软遮罩，内容从输入框后面淡出而不是被切。
- 对话列 840px：15px 正文下英文约 99 字符/行、中文约 54 字/行。

### 3.3 响应式

| 窗口宽度 | 行为 |
|---|---|
| ≥1000 | 侧栏常驻固定列；列宽 `min(100% − 2×--gutter, --content-w)` |
| <1000 | 侧栏默认隐藏，`Ctrl B` 或左上按钮以**覆盖式抽屉**滑出（宽 264，`--bg-scrim`；点击空白、Esc、选择任务后关闭）；正文不被挤压 |
| 高度 <560 | 输入框最大高度降为 120px |
| 侧栏折叠（任一宽度） | 侧栏宽 0（不留图标条）；主区头左侧出现同一个 `[≡]` 按钮；任务状态靠任务栏角标补偿 |

---

## 4. 组件清单（v1）

通则：所有可点击元素有 `:hover`（`--bg-hover`）、`:active`（`--bg-active`，无位移）、`:focus-visible`（`outline: 2px solid var(--focus-ring); outline-offset: 2px`，仅键盘）、`:disabled`（`--text-disabled`，`cursor: default`）；下表不再重复。输入类容器用 `:focus-within` 画 `border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-soft)`（侧栏搜索框例外：聚焦只把边框加深到 `--border-strong`，同悬停，不出彩色边框）。选中文字 `::selection { background: var(--selection-bg) }`。侧栏、按钮、标题栏 `user-select: none`；对话区全部可选。

### 4.1 StatusDot（状态槽 16×16，居中）

| 状态（主进程为准，渲染层只收 `taskStatusChanged`） | 视觉 | token | aria-label |
|---|---|---|---|
| `running` | 8px 实心圆 + 16px 呼吸环 | `--st-running` | `status.running`（有子代理：`status.runningAgents`） |
| `await` | 7px 实心**菱形**（旋转 45° 的方块），静止；出现时外圈闪一次 | `--st-waiting` | `status.waiting` |
| `done-unread` | 12px 对勾（描边 1.5），**中性色**，不用绿 | `--st-done`（= `--text-2`） | `status.done` |
| `error` | 12px 圆内感叹号 | `--st-error` | `status.error` |
| `idle` / `aborted` / `dormant` | 不画（槽位保留，标题对齐）；`aborted` 在尾部显示 `task.stopped` | — | — |

打开 `done-unread` 的任务后对勾消失；`error` 保持到用户在该任务开始新一轮。

### 4.2 TaskRow

- 高 `--row-task`(32)，`padding: 0 --space-2`，`--radius-md`，间距 `--space-2`；结构 `[状态槽][标题 flex:1][尾部]`。
- 标题 `--fs-sm`，单行省略；默认 `--text-2`，选中、等待、有未读结果时 `--text`（只换颜色，不换字重）。
- 尾部（一次只放一个）：等待中不放；运行中满一分钟才放 `task.runningFor`（不满不放，状态点已在转）；否则相对时间 `--fs-2xs` `--text-3`，取 `updatedAt` 与最近一轮 `lastTurn.endedAt` 中较晚的（一轮刚跑完要显示“刚刚”）；所有行共用 15 秒一跳的时钟；`aborted` 放 `task.stopped`。hover/键盘聚焦时尾部换成 20×20 的 `…` 按钮。
- 选中：`--bg-active` + 左缘 2×16 `--accent` 竖条（`--radius-pill`）。
- 重命名：行内 input（`F2` 或菜单），Enter 确认、Esc 取消；存应用元数据（不写 omp）。
- 菜单（右键与 `…`）：重命名 `F2`、在资源管理器中显示、复制会话 ID、复制会话文件路径、导出为 HTML…（`task.exportHtml`，主进程弹保存对话框，见 `conversation.md`「导出 HTML」；命令面板 `cmd.exportHtml` 和输入框 `/export` 同一动作）、归档 `Del`。归档立即从侧栏移除并 toast `task.archived` + `task.undo`（8 秒）。
- 标题来源：用户重命名 > 第一条用户消息的首行（折叠空白，最多 60 字符）。（RPC 模式下 omp 不自动生成标题，`PI_NO_TITLE=1`，见 `omp://rpc.md`。）

### 4.3 ProjectGroup

- 头高 28，`padding: 0 --space-2`，`--fs-xs` `--text-3`；左 12px 箭头（折叠时旋转，`--dur-fast`），文件夹名（重名时 `上级/名称`，tooltip 完整路径）；hover/聚焦时右侧显示 `＋`（在该项目新建任务）与 `⋯`（在资源管理器中显示、从列表移除——只移出列表）。
- 折叠时右侧显示任务计数；组内有等待任务则再显示 7px 琥珀菱形。折叠状态持久化。
- 组间距 `--space-5`；默认显示 6 条，`common.showMore`（每次 +20）。
- 键盘：列表整体一个 Tab 停靠点（roving tabindex），`↑↓` 移动，`←/→` 折叠/展开，`Enter` 打开，`Home/End`。
- 空项目：一行 `--text-3` `sidebar.empty`。

### 4.4 WaitingStrip

仅当存在 `await` 任务时出现；高 32，`margin: 0 --space-2 --space-1`，`--st-waiting-soft` 底，`--radius-md`，`--fs-sm` `--st-waiting-text`，左 7px 菱形。1 个：`sidebar.waitingOne`；多个：`sidebar.waitingMany`。点击或 `Ctrl J` 跳到最早等待的任务，再点下一个。**不移动任务行。**

### 4.5 Sidebar 外壳

顶部依次是搜索框和 `[新任务][添加项目]` 两个并排按钮：两个按钮同一种次级样式（透明底、`1px --border-strong`、`--text-2`，hover `--bg-hover`）；当前所在的那个突出——草稿页时 `新任务` 带 `aria-current="page"`，`--bg-active` 底、`--text` 600。顶栏已承载应用菜单，侧栏自己没有头；列表区自绘覆盖式滚动条；底部 44：左边 `设置` 文本按钮（齿轮 + 文案），右边两个 28×28 图标按钮：语言（地球，`menu.language`）和主题（半圆，`menu.theme`），点开从按钮上方弹出单选菜单（右缘对齐按钮，`menu.languageSystem`/简体中文/English，`menu.themeSystem`/`menu.themeLight`/`menu.themeDark`），选了立即生效，打开时焦点在当前项，Esc/Tab 关闭并还焦点给按钮；打开时按钮 `--bg-active`。命令面板只走 `Ctrl K` 和应用菜单，底部没有放大镜。底部不放键帽、不放小字。

### 4.6 MainHeader 与 ProgressPill

头 40；左：任务标题（`--fs-sm` `--text`，点击=重命名）+ ` · 项目名`（`--text-3`），省略；右：`ProgressPill`、`⋯` 菜单（重命名、在资源管理器中显示、复制会话路径、归档）。无任务时标题区空白。
- `TodoBoard`（有 `todoPhases` 时才出现；`features/composer/TodoBoard.tsx`，2026-10-19 起取代对话流顶部的 `TodoStrip`）：输入框正上方状态行的右端一个按钮：进度环（`--accent` 弧 = 完成比例，任务在跑且有进行中的项时叠一段慢转的弧；全部完成时换成 `--st-done` 对勾）+ 当前项文字（省略）+ `{done}/{total}`（tabular）；点击向上弹 popover 列出阶段（罗马数字编号 + 每阶段 `完成/总数`）与条目：`pending` 空圈、`in_progress` 呼吸点、`completed` 对勾、`blocked` 红点 + 原因、`abandoned` 删除线。数据 `get_state.todoPhases` ✔（字段在 `src/shared/omp-wire/rpc-wire.generated.ts`）。
- `GoalStrip`（目标模式，`/goal`；`features/goal/GoalStrip.tsx`，样式 `goal.css`）：有 `TaskState.goal` 时出现在对话流顶部，一行：`goal.title`（`--text` medium）+ 目标文字（`--text` 省略，完整文字在悬停提示）+ 状态词（进行中 `--st-running`、已暂停 `--st-waiting-text`、预算用尽 `--st-error`）+ 用量（`已用 / 预算`，tabular，悬停是完整 token 数）+ 文字按钮：进行中 `暂停 / 放弃`、已暂停 `继续 / 放弃`、预算用尽 `放弃`。高 ≥28，`--radius-pill`，`--bg-hover`，`--fs-xs`。数据 `get_state.goal` / `goal_updated` ✔；完成或放弃后目标条消失。创建和语义见 `docs/architecture/conversation.md` 的“目标模式”。

### 4.7 EmptyState

- **输入框贴主区底部**（2026-10-18 返工，空状态和对话中同一位置）；上方区域（垂直居中）是居中的像素标志（`ui/PixelLogo.tsx`，照 omp 终端版启动画面：块字符 π 逐格粉→紫→蓝渐变、左腿末格 ▒，右边半块像素字 `omp`（`--text`）接 `studio`（`--text-2`），字下暗色 `v<版本>`（`--text-3` 等宽））。有项目时标志下面是项目胶囊（项目名 + ⌄，`--fs-sm`，`--radius-pill`，tooltip 完整路径；点击 = 换项目菜单：最近 8 个 + `empty.openFolder`），再下面是该项目最近的 ≤3 个任务。
- 最近任务：三列卡片（`--bg-raised` + `--border`，`--radius-lg`，最小高 76）：状态点 + 标题（≤2 行），底部等宽字体相对时间（左缘与标题文字对齐，空闲任务的状态点槽位留空），卡片上方小标题 `empty.recent`；可点（`selectTask`）；归档的不算。**不再有历史会话列表**：历史只在侧栏，侧栏搜索框能搜到任务和历史会话（含终端里的）。**没有欢迎语、插画、示例提示卡**（标志不算）。
- 无任何项目时只有标志和输入框（不写“还没有项目”，不放“打开文件夹”；加项目走侧栏 `添加项目` 或拖入文件夹），可以直接发送（同 Codex / Claude Code 打开就能聊）；输入框没有 `@` 补全和工作树胶囊。第一次发送时主进程 `ensureChatsProject` 建 `AppInfo.chatsDir`（`~/omp-studio/chats`）并加入项目（名为 `chats`），之后它就是普通项目。不用用户主目录作 cwd：omp 默认会把主目录换成临时目录（`--allow-home`），搜索也会扫整个主目录。
- 最近更新（照 omp 的 What's New，`startup.changelogMode = summary`）：升级后第一次启动时，标志下面居中一行：`empty.whatsNew`（600 `--text-2`）· `empty.whatsNewUpdated(Many)`（"已更新到 v<版本> · N 项改动"，跨多个版本时加"M 个版本共"）· `新增 · 变更 · 修复` 各几项（为 0 的省略）；整行 `--fs-sm --text-3`，不换行，窄了省略号截断，tooltip 全文。只写统计，不列条目。数据来自打进主进程包的 `CHANGELOG.md`（`src/main/whats-new.ts`，解析在 `src/shared/changelog.ts`）：合计 `userData/last-changelog-version` 记的版本之后、当前版本为止的各节（没有记录 = 第一次装，只算当前版本；不含"未发布"），启动时算一次并立即写入当前版本，所以重载窗口仍显示、重启后消失；当前版本没有条目时不显示。
- 侧栏 `新任务` 按钮在草稿页带 `aria-current="page"`，用选中底色突出（§4.5）。

### 4.8 UserMessage

**运行脊线**（2.6，整条对话流的结构，方向 A 的主要识别元素）：对话列左侧一条 `--spine-line`（2px）`--border` 竖线，线在列左缘 `--spine-node`（16）宽的槽里居中；每个 `.turn` 的内容缩进 `--spine-indent`（34），节点画在缩进里（节点用块自己的伪元素，避免 `content-visibility` 的裁剪）：用户消息 = 12px 空心圆（`--text-3` 描边、`--bg-app` 填充）；折叠的过程行 = 8px `--text-3` 实心点；结论 = 14px `--accent` 实心圆。**任务进行中整条线和所有节点都不画**（2026-10-19 起，`.conversation[data-running]`，只是 `visibility: hidden`，缩进保留，结束后再出现，内容不左右跳）。改动卡片、门、泳道、错误条不画节点，线从旁边穿过。节点与块的垂直位置对齐该块第一行文字的中线，所有尺寸固定，流式追加内容不会推动已有节点（不跳动）。线不画在输入框区域。

左对齐，宽 ≤ 缩进后的列宽；`--bg-raised` + 1px `--border-subtle`，`--radius-lg`，`padding: --space-2-5 --space-3-5`；`--fs-prose`；`white-space: pre-wrap; overflow-wrap: anywhere`。>12 行折叠成前 8 行 + 渐隐 + `common.expand`（展开状态不记忆）。附件：文字上方一排 64×64 缩略图（`--radius-md`，点击用系统默认查看器打开）。hover 右下外侧出现 `复制`。出现动画见 §2.6。
- 状态：默认 / 发送失败（下方一行 `--fs-xs` `--st-error`：`msg.sendFailed` · `msg.retry`）。运行中发出的消息**不在流里**，只在队列条里；进入会话后才作为气泡出现。

### 4.9 AssistantMessage 与 Markdown

- 无气泡、无头像、无名字，`--fs-prose` `--text`，占满列宽。hover 底部左侧出现 28px 高操作行，仅 `复制`（复制 Markdown 原文）。
- **叙述 vs 结论**：一轮（`agent_start`…终止的 `agent_end`）里，**以工具调用结尾的消息中的文本 = 叙述**，进入过程行（展开后可读）；**最后一条不带工具调用的消息 = 结论**。兜底：整轮没有这样的消息时，把最后一条助手文本当结论；整轮没有任何助手文本才显示 `turn.noResult`。非终止的 `agent_end`（`isTerminal === false`，✔ 字段存在）后紧跟新一轮：过程行合并计时，不显示中间结论。
- 流式中，当前正在流的文本以 `--text-2` 显示在过程行下方；它所在消息结束时：带工具调用 → 淡出（`--dur-fade`，无位移）并进入过程行；是最后一条 → `--dur-base` 渐变为 `--text`。
- 思考内容永不显示在正文。
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

- 不用 `dangerouslySetInnerHTML`；Markdown 库由架构方案选（要求：能拿到块边界、可关闭原始 HTML）。

### 4.10 CodeBlock

容器 `--radius-md`，`1px --border-subtle`，`overflow: hidden`，上下外边距 `--space-3`。头高 32、`--bg-raised`、`padding: 0 --space-3`：左语言名 `--fs-xs` `--text-3`（无语言显示 `text`），右 24×24 复制图标按钮（hover、聚焦代码块或键盘 Tab 到它时显示，复制后变对勾 1.2s，`aria-live` 播报 `common.copied`）。正文 `--bg-sunken`、`--font-mono` `--fs-code`，`padding: --space-3 --space-3-5`，不换行、横向滚动，`tab-size: 2`。>24 行：流式结束后折叠到 20 行 + 底部渐隐 + `code.expand`（若用户正读到该块底部，折叠推迟到其滚出视口）。流式中以最终样式创建，围栏闭合后**只改颜色**加高亮；闭合前不高亮。` ```diff ` 用 `--diff-add-fg/del-fg` 给整行着色，不加背景条。

### 4.11 ProcessRow（三个形态，同一个位置）

**运行中（照终端版 omp，2026-10-19 起）**——这一轮的步骤直接列在对话里，不折叠、不套底色卡片：思考是 `process.thought` + 一行摘要（`--text-3`），每个工具一行 `[图标 14][工具名 粗体][参数摘要 mono --text-3 省略]`，有输出时（搜索结果、diff 带行号、bash 的 `$ 命令` + 输出）就在行下展开，待办工具这类没有可读输出的行默认收起（chevron）；新步骤追加在底部（用户不在底部时不改变视口）。

“在做什么”和计时不在对话里，而在输入框正上方的状态行（`RunStatus`，`features/composer/RunStatus.tsx`）：左边 `[转圈 14][已用时间 tabular][│][当前动作 单行省略]`，右边是 `TodoBoard`（§4.6）；两边都没有内容时整行收起。

- 当前动作文字优先 `tool_execution_start.intent` 原话（✔ 主代理事件带 `intent`，可选字段）；缺失时 `tool.verb.*` 映射（`read`→`tool.verb.read` …，未知工具 `tool.verb.other`）。其它阶段：`process.starting`、`process.thinking`、`process.replying`、`process.retrying`、`process.compacting`（来自 `auto_retry_*`、`auto_compaction_*`）。有进行中的子代理时尾部追加 `· {n} 个子代理`。
- 一次只换一条：旧文字 `--dur-fast` 淡出、新文字淡入，**不位移**，高度固定（`conversation/live-status.ts`）。
- 等你确认：文字 `process.waiting`（暂停时长每秒更新）。
- 一轮结束后，同一位置折叠成下面的“已结束”一行。`Ctrl O` 展开 / 收起最近一个。

**已结束（折叠）**——同样高 28、`--text-3`，左 chevron 14px：`process.done`（≥60 s 用 `duration.ms`，≥1 h 用 `duration.hm`）`· {n} 次工具调用`（有子代理再 `· {m} 个子代理`；有失败再 `· {k} 次失败`，`--st-error`）。不足 1 秒或 0 次工具调用的轮次**不显示此行**。时长 = 主进程接收 `agent_start` 到终止 `agent_end` 的时间（帧无时间戳，`docs/architecture/subagents.md`），等待确认的时间扣除；扣除超过 5 秒时在展开区顶部写 `process.waited`。hover：文字 `--text-2`。

**展开**——`--bg-sunken`，`--radius-lg`，`padding: --space-2`，行间无分隔线，`--dur-base` 展开：
- 工具行高 28，`--fs-xs`：`[图标 14][intent 或 动词+对象][参数摘要 mono --text-3 省略][右侧：耗时(≥1s) 或 tool.failed(红) 或 tool.denied]`；点击行就地展开输出（`--font-mono` `--fs-code-sm`，最多 12 行，内部滚动，纯文本；超出 `tool.output.showAll`）；失败行默认展开错误前 4 行。
- 叙述文本以 `·` 开头、`--text-3` 单行（可展开全文）按时间穿插。思考：`process.thought`，点击展开文本。
- 子代理：这一轮有子代理时，展开区顶部是"泳道"（`features/lanes/`，阶段 5 实现，数据来源和行为见 `docs/architecture/subagents.md`）：头行 `lanes.title` + `process.subagents`（可折叠，默认展开）；其下一行主代理（工具节奏小段）+ 每个子代理一行（状态点 + 名字 + `状态 · 模型 · 思考强度`；右侧时间轴上的条 = 起止，竖线 = 工具调用结束）+ 一条 `0 … 总时长` 的轴；点子代理行就地展开详情（`--bg-raised` 卡片：统计、任务、摘要、完整记录 / 改动两个分段、运行中的 steer 输入框和二次确认的取消）。不加头像和哈希色，颜色只用 `--st-*` token。
- >200 个工具行时只渲染最后 100 条 + `process.earlier`。

### 4.12 ChangeCard

- 出现条件：主进程用工具事件 + git 汇总得出本轮有改动，并且本轮已 `session_settled`（✔ 帧存在，`omp-rpc.md`）。没有改动、非 git 仓库、git 失败：**不出现，也不报错**。加载中 ≤3 秒内不占位。
- 容器列宽，`--bg-raised` + `1px --border`，`--radius-lg`，`margin-top: --space-4`，出现动画 `--dur-base`。头高 40，`padding: 0 --space-3-5`：`change.summary`（`--fs-sm`）、`+{add}`（`--diff-add-fg`）、`−{del}`（`--diff-del-fg`，tabular），右侧 `…` 菜单（在资源管理器中显示、复制文件列表）；为阶段 3/4 的 `审查 / 提交 / 开 PR` 在 `…` 左侧预留插槽，**v1 不渲染占位或禁用按钮**。
- 文件行高 28，`--font-mono` `--fs-xs`：目录部分 `--text-3`、文件名 `--text`，中段省略；右侧 `+30 −5`；新增未跟踪文件行标 `change.new`。≤5 个文件默认展开，>5 个默认折叠只留头；超出 5 行显示 `change.more`。点击文件行 = 在资源管理器中显示（主进程校验路径在任务目录内）。
- 本轮被中断：头部追加 `change.interrupted`。
- v1 不显示测试结果（见 §1.2）；头部右侧留位。

### 4.13 ModelDivider

流中一条细线，仅在会话中途换了模型/思考强度时出现：两侧 1px `--border-subtle`，中间 `model.switched`（`--fs-xs` `--text-3`）。

### 4.14 Composer

**尺寸与结构**
- 外容器宽 = 列宽；`--bg-raised`；`1px --border`（hover `--border-strong`）；`--radius-xl`；`--shadow-composer`；容器自身无内边距，分上下两层：输入区（`padding: --space-3 --space-4 --space-2-5`）和工具行（`padding: --space-2 --space-3`，上沿 1px `--border-subtle` 分隔线）；聚焦样式见通则。
- 文本区：`--fs-prose`，placeholder `--text-3`，最小 1 行（2026-10-19 由 2 行降低；常数高度，空状态与对话中一致），自动增高到 `min(40vh, 12 行)` 后内部滚动，`resize: none`。
- 底部工具行：左起 `⊕` 附件 28×28、ModelChip、ApprovalChip、用量仪表 UsageMeter（见下，2026-10-19 起从输入框下方移进来，输入框下方不再有单独一行）；右起本会话费用（`SessionCost`，对应 omp 状态栏的 cost 段：`get_session_stats.cost`，按模型的 API 价格估算，订阅登录的模型也照样累计；等宽 `--fs-xs` `--text-2`，`$0.0001` 这种不到一美分的保留 4 位小数；一直显示，新任务草稿和还没有统计时是 `$0.00`；当前模型的 provider 有 OAuth 登录凭据时（omp 优先用 OAuth，`get_logout_accounts`，按 provider 缓存 5 分钟）后面跟 `--text-3` 的 ` (sub)`，悬停换成 `composer.usage.costTipSub`；悬停 `composer.usage.costTip` + 输入/输出/缓存读取/高级请求数；是按钮，点开 `UsageOverview` 浮层，见下）、SendStop。仪表不收缩（`flex: none`），空间不够时模型胶囊先省略名字，再按输入框宽度逐级收起：≤860px 去掉速度，≤760px 去掉本会话 token，只留上下文。
- 附件预览行（有附件时）：文本区上方，64×64，右上 ✕（`composer.attachment.remove`）；粘贴图片、拖入图片、`⊕` 三种来源。非图片文件拖入：toast `composer.attach.imageOnly`。
- 草稿按任务保留，由主进程持久化。
- 占位符：新任务 `composer.placeholderNew`；有对话 `composer.placeholder`；运行中 `composer.placeholderRunning`（设置里对调后用 `…Swapped`）；有门时 `composer.placeholderGate`。
- **输入法**：`isComposing` 或 `keyCode === 229` 时 `Enter` 一律不发送；组合结束后才发送。（测试必写。）

**发送行为**

| 状态 | `Enter` | `Ctrl+Enter` | `Shift+Enter` | 按钮 |
|---|---|---|---|---|
| 空闲 | 发送（`prompt`） | 发送 | 换行 | 发送 ↑ |
| 运行中 | **插话**（`prompt` + `streamingBehavior: "steer"` 或 `steer`） | **稍后**（`follow_up`） | 换行 | 空文本=停止 ■；有文本=并排 发送 ↑ + 停止 ■ |
| 有门停靠 | 见 §4.17：**拒绝并发送** | 门的主操作（§4.17）；输入框有草稿时无效 | 换行 | `composer.sendDeny` |

运行中发消息必须指明行为：wire 里 `prompt` 的 `streamingBehavior?: "steer" | "followUp"` ✔ 存在，`rpc.md` 说流式中缺省会失败（两份方案均引用；以 `rpc.md` 为准）。设置页可对调 `Enter` 与 `Ctrl+Enter` 在运行中的含义。

**SendStop 按钮（32×32，`--radius-pill`）**

| 状态 | 视觉 | 行为 |
|---|---|---|
| 空闲 + 空 | `--bg-active` 底、`--text-disabled` 箭头，不可点 | — |
| 空闲 + 有内容 | `--accent` 底、`--text-on-accent` ↑ 16px；hover `--accent-hover` | 发送 |
| 发送中 | 14px 细旋转环（reduced：`…`），不可点 | — |
| 运行中 + 空 | `--text` 底、`--bg-app` 色 12px 实心方块 | 停止（`abort_and_restore_queue`） |
| 运行中 + 有文本 | 左：停止（32 描边按钮）；右：发送 | 见上表 |
| 停止中 | `composer.stopping`，不可点，直到 `agent_end`/`prompt_result` | — |
| 发送失败 | 按钮上出现 `--st-error` 小红点；错误见 UserMessage | — |

**停止**：`Esc`（见 §5.2 栈）调用 `abort_and_restore_queue`，响应里的 `steering`/`followUp` 按原文**追加**回输入框草稿（空行分隔，图片作为附件恢复）；`imagesDropped` → toast `composer.imagesDropped`；toast `composer.queueRestored`（无排队消息则只显示“已停止”）。

**ModelChip**：高 28，`--radius-pill`，`--fs-sm` `--text-2`，背景 `--bg-hover`；内容 `{模型短名} · {思考强度}`（去 provider 前缀；不支持思考时省略强度；>22 字符省略）；不带下拉箭头（2026-10-19 起）。点击或 `Alt M` 打开弹层（宽 360，`--bg-overlay`，`--radius-xl`，`--shadow-2`，自胶囊上方弹出）：搜索框 → 模型列表（行高 36，右侧 provider 名 `--fs-xs` `--text-3`；按 provider 分组、组内字母序，最近用过的 3 个置顶；当前项对勾；未登录 provider 整组置灰）→ 分隔线 → 思考强度分段条（段数 = `get_available_thinking_levels` 返回 ✔，不含 `inherit`/`auto`；不支持思考的模型整条禁用并显示 `model.thinking.unsupported`）→ `composer.nextRequest` → `model.addProvider`（跳设置页）。键盘：打开聚焦搜索；`↑↓` 选，`Enter` 切换并关闭，`Tab` 进入分段条，`←→` 改档，`Esc` 关闭回输入框。`Alt T` 循环强度（`cycle_thinking_level`）。运行中可切换，提示“下一次请求生效”。数据：`get_available_models`、`set_model`、`set_thinking_level`、`get_state.model/thinkingLevel`。

**ApprovalChip**：见 §5.8。

**ModelChip / ModelPicker**：胶囊点开（Alt M、命令面板同）是模态对话框（`ModelPicker`，portal 到 body，Tab 在框内循环，Esc 关闭并还焦点）。左栏：搜索框 + 模型树：无搜索词时最近 3 个置顶，其下按 provider 分组，**组默认折叠**（2026-10-19 起）——组头一行 `▸ provider · model.groupCount`，含正在生效的模型的组头带勾，点击或 Enter 展开 / 折叠，组头上 `→/←` 展开 / 折叠；有搜索词时有匹配的组自动展开（可手动收起，换词后复原）。每个模型行右侧用 `--fs-xs` `--text-3` 显示紧凑的“上下文窗口 · 输入/输出价格”，如 `1M · $0.3/$1.2`，价格全 0 时只显示窗口；组里的行缩进一级。↑↓ 在“最近 + 组头 + 展开的模型”之间移动，Enter 或点击选用（选用后对话框保持打开，方便接着调思考强度）。右栏照终端版 omp `/models` 的详情：名称、`provider/id`、标签（`当前` `--accent-soft` / `推理` / `视觉`），然后 `上下文`、`压缩于`、`最大输出`、`价格`、`实测速度`、`智能分`、`输入类型`、`推理`；数字按完整位数加千分位（`350,000`）。`压缩于` = `触发 token · 怎么来的 · 来源`（如 `315,000 · 窗口的 90% · 全局设置`），按 omp 的 `compaction.thresholdTokens / thresholdPercent / reserveTokens / modelThresholds` 规则算（`src/shared/compaction-trigger.ts`），来源是全局 / 项目（项目目录里读到的和中性目录不同）/ 按模型设置。`价格` 一行 `输入 $4 · 输出 $20 · 缓存 $0.2（每百万 token）`，全 0 显示 `model.free`。`实测速度` 来自 omp 的 `agent.db` `model_perf`（`t/s · 首字 s · N 次采样`），没有实测但模型目录有 `tps` 时写 `model.perf.catalog`；`智能分` 来自 omp 的 `models.db` 模型目录（`int`）；两个库都只读（`getModelInsights`，`src/main/omp-config/model-insights.ts`），读不到显示 `model.perf.none` / `model.unknown`，读取中显示 `…`。底部是思考强度分段条（只对正在生效的模型可调，其余显示 `model.thinking.pending`）。分段条只列这个模型实际支持的档位：任务里取 `get_available_thinking_levels`（含 `off`），草稿里取模型的 `thinking.efforts`（不含 `off`）；分段条、方向键、`Alt T` 共用同一份列表和顺序；草稿的胶囊显示 omp 钳制后实际采用的档位。**思考强度是乐观更新**：点下 / `Alt T` 立即显示新档位，omp 往返在后台，失败退回并报错，写入成功 2 秒内新值没回到界面也退回真实值。分段条选中项下面是一块滑块，换档时以 `--ease-spring` 滑过去并轻弹一下（往高档放大回弹、往低档轻收）；滑块按档位换效果：`off` 中性浮起、`minimal` 底部一道强调色细线、`low` 浅强调底、`medium` 加深的强调底 + 描边、`high` 实心 `--accent` + 光晕、`xhigh` 再加周期扫光、`max` 是 `--accent` 与 `--st-waiting` 流动渐变 + 呼吸光晕；胶囊上的强度文字同样分级（低档 `--text-3`，`high` `--accent` 加粗，`xhigh`/`max` 渐变字，`max` 缓慢流动）。循环动画写 `animation-play-state: var(--play-state)`，减少动效时滑块不滑、不弹、不流动。数据来自 `get_available_models`（`ModelOption`：`contextWindow`、`maxTokens`、`cost`、`reasoning`、`acceptsImages`、`thinkingEfforts`）。

**UsageMeter**（输入框工具行里，审批胶囊之后，**默认显示**）：各项都点开自己的 popover（`Popover`，Esc 在焦点位于胶囊或浮层时关闭并还焦点，不触发"停止"）。①上下文圆环 + `composer.context`（`get_state.contextUsage.percent`，≥90 变 `--st-waiting-text`，不到 10% 保留一位小数）→ `ContextBreakdown`（照 Claude Code 的 `/context`）：一条按段着色的横条 + 每段一行 `[色块][名称][token][占窗口%]`：系统提示词、工具定义（按 `get_state.systemPrompt` / `dumpTools` 字符数估算，ASCII 约 4 字符一个 token、其余一字一个，标 `≈`）、消息（= 已用 − 前两段）、剩余空间、自动压缩预留（= 窗口 − 按 omp 规则算出的压缩触发点，`compaction-trigger.ts`；读不到压缩设置时不画这段），下面没有说明小字，最后是 `composer.compact`。②本会话 token 总数（`get_session_stats`，握手恢复会话时和每次刷新状态时取）→ `ModelBreakdown`：打开时读会话文件（`getSessionModelUsage`），按 provider/model 合计回复数、输入、输出、缓存读写、费用，范围同 omp（当前分支，最近一次压缩保留下来的部分）；压缩过时另起一行写整个会话的合计。没有任何数据时整组不渲染。

**UsageOverview**（点发送键左边的费用打开，`align="end"`，宽 360）：顶上一个切换框（`.segments`，`role="tablist"`，←/→ 切页、焦点跟着走），两页：`composer.quota.title`（默认）：各订阅账号的额度条，当前 provider 排最前，未使用的账号合成一行；`composer.quota.daily`：最近 22 周每日用量热力图（与设置 → 用量同一组件 `usage-views.tsx`，可切 token / 花费 / 请求数）。上次看的页在本次运行里记住。打开时重读额度，热力图还没有数据时才读。没有"去设置看全年"的入口。

新任务草稿（`DraftComposer`）的工具行同一位置放 `DraftUsageMeter`：还没有会话，①上下文是 `0%`，窗口取胶囊上默认模型的 `contextWindow`（模型没报窗口时不显示），构成里只有消息 0、剩余空间和自动压缩预留，没有"压缩上下文"；②要等发出第一条消息、会话建立后才出现。费用显示 `$0.00`，同样能点开 `UsageOverview`（额度按默认模型的 provider 排序）。

**速度开关与指示**（`get_state.fastModeEnabled/fastModeActive/slowModeSupported/slowModeEnabled/slowModeScope`；命令 `set_fast_mode` / `set_slow_mode`）：ModelPicker 右栏在思考强度上方多一节“速度”，只在**正在生效的模型**被高亮时出现（草稿里没有任务，不出现）。每个开关是 `开/关` 两段（`.segments`），方向键切换。`快速模式`始终可点（RPC 没有“是否支持”字段；不支持的模型 omp 返回错误 `Fast mode is unavailable for the current model.`，原文进 toast）。`慢速模式`只在 `slowModeSupported` 时可点，下面一行说明范围：`global` → `model.slow.scope.global`（写进 omp 配置，所有会话共用），`session` → `model.slow.scope.session`；不支持时只显示 `model.slow.unsupported`。ModelChip 在模型名后追加 `--fs-2xs` 的 `--accent-soft` 小胶囊：`fastModeActive` 为真时 `快速`，慢速开着时 `慢速`；都关时不显示。实测（Tern omp，临时 agent 目录）：fast 只对本会话有效，**不落配置**，切到不支持的模型会自动关；slow 在 Anthropic 模型上 scope 是 `global`，**落在 omp 配置里**并跨进程保留（`session` 范围对应 OpenAI/Google 的 flex 层级，未能实测）。studio 不存副本；键入的 `/fast`、`/slow` 照常走 omp，本地完成的斜杠命令（prompt 应答 `agentInvoked:false`）之后主进程会重读 `get_state`。

**UsageLimitBanner**（`get_state.usageLimit`，输入框上方，复用 `.suggest` 样式，`role="status"`，无关闭按钮，不挡发送）：`wrap_up` → `composer.limit.wrapUp`（`extraUsage` 为真时 `composer.limit.wrapUpExtra`）；`low_priority` → `composer.limit.lowPriority`，有 `allowanceLeftPercent` 时追加 `composer.limit.left`；有 `resetsAtSec` 时追加 `composer.limit.resets`（当天只写 `HH:mm`，否则 `M-D HH:mm`，本机时区）；`usageLimit` 缺省（没超限）时不渲染。

**输出速度**（`get_state.tokensPerSecond`）：UsageMeter 末尾一项，等宽 `--text-3`，`composer.usage.tps`，只在任务运行（running / needs_you）且值为有限正数时显示。实测 omp 在一条回复流式输出期间给 `null`，回复结束（message_end 之后）才有值，所以运行中显示的是上一条回复的速度；主进程在 `message_end` 等事件后按 1 秒节流重读 `get_state`，不另外轮询。

**QueueStrip**（门/输入框正上方，仅有排队消息时存在，宽 = 列宽，`margin-bottom: --space-2`）：容器 `--bg-raised`，`1px dashed --border`，`--radius-lg`，`padding: --space-1 --space-2`；条目高 32：`[标签][文本首行省略][现在插话][✕]`；标签是 `--fs-2xs` 小胶囊：`插话` 用 `--accent-soft` 底，`稍后` 用 `--bg-hover` 底。`现在插话`（`promote_queued_message`，仅稍后条目有）成功后标签原地变 `插话`（交叉缩放 `--dur-fast`），响应 `promoted:false` = 已送出，条目淡出。`✕`（`remove_queued_message`）：只有响应 `removed:true` 才移除，并把文本放回草稿；`removed:false` 静默刷新快照。数据**只渲染** `queue_update` / `get_state.queuedMessages` 快照，自己不另记。>3 条只显示前 3 条 + `composer.queue.more`。旧版 omp 没有后两个命令：命令失败时隐藏对应按钮，**不要回退成 `steer`**（会重复入队）。出现/消失 `grid-template-rows`，`--dur-base`。

**SlashMenu**：行首 `/` 打开，浮在输入框上方，行高 32，最多同时显示 8 行，更多的在菜单内滚动（`↑↓` 选中行始终可见），`[/名称][描述 --text-3]`，`↑↓` 选，`Tab/Enter` 补全，`Esc` 关闭；数据 `get_available_commands` / `available_commands_update`。无匹配 `slash.empty`。

**斜杠命令守卫**：草稿以 `/名称` 开头、命令列表已载入（非空）、而 `名称`（含别名）不在 `get_available_commands` 里时，第一次发送不发出，输入框上方出现一条提示（`.suggest` 样式）+ `slash.sendAnyway` 按钮；对同一段文字再按一次发送键或点按钮才作为普通文字发出，改动文字提示即消失。终端版独有的命令（`plan` `copy` `hotkeys` `settings`）提示 `slash.terminalOnly`，其余未知命令提示 `slash.unknown`。列表未载入时不拦；`/usr/bin` 这类带第二个 `/` 的不算命令。判定在 `slash-guard.ts`。omp-studio 自己接管的斜杠命令（`studio-slash-table.ts`：`/goal`、`/tree`、`/fork` 等）在菜单和守卫里都算已知命令，发送时由 studio 处理、不发给 omp。


**BtwPanel**（旁路提问，`/btw [问题]` 或命令面板“旁路提问（/btw）”打开，`features/btw/`）：停在输入框正上方、宽 = 列宽、`margin-bottom: --space-2` 的卡片（`--bg-raised`，`1px solid --border`，`--radius-lg`），高度不超过对话区 45%，内部滚动。头部一行：`旁路提问`（`--fs-xs` medium）+ 回答中的状态词（`--st-running`）+ 右侧“新话题”（`+`）和关闭（`✕`）图标按钮；有多个话题时下面一行话题标签（问题首行截断，选中项 `--accent` 描边 + `--accent-soft` 底，在跑的标签字用 `--st-running`）；正文是选中话题的问答：问题 `--fw-medium`，答案用 Markdown 流式渲染（`--fs-sm`），已取消/出错/中断在答案后加一行 `--fs-xs` 状态词（出错红字，悬停是 omp 给的原因）；底部一行输入框 + `提问` 按钮，提问进行中按钮换成红字的 `取消提问`。**不进主对话流**；主轮在跑时也能问；omp 同一时刻只许一条在跑，所以提问中不能再发。输入框默认对当前话题追问（`recordId`），点“新话题”后下一条开新话题；`/btw 问题` 总是开新话题。`Esc`：提问中 = 取消提问（`btw_cancel`），否则关闭面板并把焦点还给打开前的元素；输入法选词时的 `Esc` 不处理。面板打开时向主进程对齐一次历史（`get_btw_history`，随会话落盘，恢复任务后仍在）。没有进程的任务打开面板不会拉起 omp（只显示主进程已知的记录），第一次提问才拉起。语义和实测见 `docs/architecture/conversation.md`「旁路提问」。

**输入历史**：输入框为空（或光标在最开头）时 `↑` 翻看本任务发过的消息（最近的在前），`↓` 往回走，翻过最新一条恢复翻看前的草稿；翻看中 `↑` 要光标在第一行、`↓` 要光标在最后一行才接管，否则照常移光标。斜杠菜单/`@` 菜单打开时 `↑↓` 归菜单；刚翻出来的那段文本不开菜单，免得抢走后面的 `↑↓`。只存在渲染进程内存，每任务最多 100 条，第一次用到时用对话里的用户消息（非合成）做种子（`input-history.ts`）。新任务草稿没有历史。

**FileMenu**（`@` 文件引用）：光标前的词以 `@` 开头（文本开头或空白之后）时，在输入框上方打开和斜杠菜单同款的菜单，每行一个相对路径（文件名 `--font-mono`，目录部分 `--text-3`），最多同时显示 8 行（超出滚动），`↑↓` 选，`Tab/Enter` 把 `@词` 换成 `@相对路径 `，`Esc` 关闭（到这个 `@词` 变化为止），空查询列出浅层文件。数据 `listProjectFiles({ kind: "task", taskId } | { kind: "project", projectId }, query)`：主进程按任务（新任务草稿按项目目录）查出 cwd，优先 `git ls-files -co --exclude-standard`，不是仓库时退回有界遍历（广度优先，跳过 `node_modules`、`.git`、符号链接）；缓存 10 秒，最多索引 10000 条，每次最多返回 20 条（前缀 > 文件名前缀 > 文件名包含 > 路径包含 > 子序列），只返回相对路径，含空白的路径不收；`query` 含绝对路径或 `..` 时 reject。引用本身由 omp 展开成 `fileMention` 消息，studio 只做补全。

**用户消息的“从这里分叉”与 SessionTreePanel**（`features/conversation/`，语义和实测见 `docs/architecture/session-tree.md`）：①用户消息悬停时，“复制”右边出现 `tree.fork`（任务空闲时才有；`title` 是 `tree.forkTitle`），点它新建一个任务（同项目、同工作目录、同模型），会话是这条消息**之前**的历史，新任务被选中，输入框里已填好这条消息的文字，改了再发即可；原任务不动。`/fork` = 从最后一条用户消息分叉。②`/tree` 或命令面板“会话树”（`cmd.sessionTree`）打开居中浮层（样子同命令面板，`--z-dialog`，`role="dialog"`）：每行一条用户消息的首行文字，只有真的分叉处才缩进一级，当前分支上的文字用 `--text`、其余 `--text-3`，当前节点文字 `--accent` + 右侧 `tree.current`；`↑↓ Home End` 移动、`Enter` / 点击选中、`Esc` 关闭并还焦点，焦点陷阱在面板内。选中 = 任务就地回到那条消息**之前**（omp `branch`：任务改用 omp 为它新建的会话文件，对话流重载），那条消息的文字追加进输入框；任务不空闲时主进程拒绝，toast `error.sessionBusy`。

### 4.15 JumpToLatest 药丸

仅当用户脱离吸底且有新内容时出现；对话区底部居中、距底部栈顶 `--space-3`，高 32，`--radius-pill`，`--bg-overlay`，`--shadow-2`，文案 `scroll.latest`；点击或 `End`/`Ctrl+End` 回到底部并重新吸底。

### 4.16 DropOverlay

拖入文件时全窗口覆盖（`--dur-fade` 淡入）：虚线 2px `--accent` 描边、`--accent-soft` 底，居中 `dropzone.folder`（拖入文件夹）或 `dropzone.image`。非支持类型无反应、不报错。

### 4.17 Gate（“门”：审批、ask 与其它 `extension_ui_request`）

**位置与行为**
- 停靠在输入框**正上方**（队列条之上），宽 = 列宽；不是模态、不遮罩，对话照常可读可滚动；滚动区底部 padding 随门高度增加，**不改变滚动位置**（吸底时内容随之上移，是唯一允许的位移）。
- 同一任务同一时刻只有一个门；后来的请求排队（`gate.pending`），答完才出现下一个。非当前任务的请求不出现在当前界面：侧栏菱形 + 提示条 + 通知（§5.7）。
- **不抢焦点**：门出现时若用户在过去 1.5 秒内有按键，或焦点在输入框且有草稿，门不夺焦点，只做一次琥珀边框脉冲；否则焦点落到门容器（`tabindex=-1`，显示焦点环）。门里的数字键与 `Enter` 只在门聚焦时生效。
- **Enter 永不隐式允许**：初始焦点在门容器，没有预选的按钮；用户用 `Tab`/`↑↓`/数字键/点击选择。
- **`Ctrl+Enter` = 门的主操作**（第一个按钮；`confirm` 的“确认”；审批 `select` 的第一项）。从任务视图任何位置生效，但：门出现后前 500ms 忽略；输入框里有草稿时忽略（避免误批）；对 `input`/`editor`/`ask` 在其自身输入控件内为“提交”。
- `Esc`：门聚焦 → 拒绝/取消（`{cancelled:true}` 或 `{confirmed:false}`）；门没聚焦 → 走 §5.2 栈（运行中则停止任务，待答请求随之作废）。
- 数字键 `1–9` 选择并提交对应选项（门聚焦、选项 ≤9、没有文本输入时）。
- 计时：请求带 `timeout`（毫秒）时，门顶边画 2px `--st-waiting` 线，从满到空线性缩短（reduced：不动画，只更新右上角 `0:25` 读数），右上角 `0:25`（tabular）；最后 10 秒读数变 `--st-waiting-text`；`ask` 超时会替用户选推荐项（没推荐选第一项），所以 ask 门写明 `gate.timeoutAsk`；其余写 `gate.timeout`。收到 `cancel`（`targetId`）→ 门收起为 `gate.cancelled` 或 `gate.timedOut` 一行，1.2 秒后消失；之后的回答 omp 会忽略，界面不再发。
- 所有 `title`/`message`/`options` 都是**不可信文本**：纯文本渲染，保留换行，不渲染 Markdown/HTML；长文本在门内滚动。

**外观**：`--bg-overlay`，`1px solid` `--st-waiting`（50% 透明度混合），`--radius-lg`，`--shadow-2`，`padding: --space-3-5 --space-4`，最大高 `min(60vh, 520px)` 内部滚动；头部 7px 菱形 + 标题（`--fs-base` `--fw-strong`）+ 右侧计时；按钮高 `--control-h-md`，`--radius-md`，`padding: 0 --space-3-5`，右侧各带键帽（`1`、`Esc`…）；主按钮 `--primary`，次按钮透明 + `--border`，拒绝类 hover 时文字变 `--st-error`。

**按 `method` 的变体**

| method | 形态 | 响应 |
|---|---|---|
| `confirm` `title,message,timeout?` | 标题 + `message`（等宽 `--fs-code-sm`，`pre-wrap`，>8 行折叠 + `gate.detailsExpand`）+ `[取消 Esc] [确认 Ctrl+Enter]` | `{confirmed:true/false}` |
| `select` `title,options[],optionDetails?` | 选项 ≤3 且都无 `optionDetails.description` → **一排按钮**，第一个为主按钮；否则选项列表（行高 36，左侧数字键帽，描述 `--fs-xs` `--text-3` 在标签下一行；>7 项顶部出现筛选框）。审批提示（omp 给 RPC 宿主的就是这种 select，选项见 `omp://approval-mode.md`：Approve / Approve `<tool>` for this session / Deny）因此自然落成一排按钮 | `{value:<被选中的选项原文>}`；Esc=`{cancelled:true}` |
| `input` `title,placeholder?,timeout?` | 标题 + 单行输入（高 `--control-h-lg`）+ `[取消 Esc] [确定 Enter]`；IME 组合态 Enter 不提交 | `{value}` 或 `{cancelled:true}`；机密输入 omp 直接拒绝，界面不处理密码型 |
| `editor` `title,prefill?,promptStyle?` | 多行编辑器卡片（160–320 自适应）；`promptStyle:true` 用 `--font-sans`，否则 `--font-mono`；`Ctrl+Enter` 提交；无超时 | `{value}` / `{cancelled:true}` |
| `ask` `questions[]` | 见下 | `{answers[]}` |
| `cancel` `targetId` | 关闭对应的门 | 无 |
| `notify` | **不是门**：右下 toast（`info` 灰、`warning` `--st-waiting-text`、`error` `--st-error`），5 秒，同类合并 | 无 |
| `setStatus` `setWidget` `setTitle` | v1 忽略（presentation 类；✔ 每轮结束都会收到 `setWidget autoresearch`，`omp-rpc.md`） | 无 |
| `set_editor_text` | 写入输入框；若输入框已有草稿则弹内联条 `gate.suggestReplace` + `[替换] [保留]`，不静默覆盖 | 无 |
| `open_url` | 仅登录流，见 §4.20 | 无 |

**审批选项的显示规则（审批 `select`）**：按键位置决定行为，标签只影响显示——选项文本若**精确**等于 `Approve` / `Deny`，显示 `gate.allow` / `gate.deny`；若匹配 ``Approve `X` for this session``，显示 `gate.allowTool`（`{tool}`=X）；其余**原样显示**。任何不匹配都不报错、不丢选项。**[推测]**：这些字面文本来自 `approval-mode.md` 的描述，要用 `always-ask` 下录一份真实 fixture 确认（§附录 B-1）。

**`ask` 门**（需先发 `set_ask_dialog { enabled: true }`，否则 omp 退回成一串 select + editor；每个进程启动后各发一次）：一次 `ask` 调用的所有问题在同一个门里，**一次显示一题**。顶部 `gate.step`（仅多题时）+ `header` 小标签（`--fs-xs`，`--bg-hover` 胶囊）→ `question`（`--fs-base` `--fw-strong`）→ 选项（行高 40，单选圆点 / `multi` 方框；`description` 第二行；`recommended` 项右侧 `gate.recommended` 标签，**不预选**；`preview` 选中/悬停时在右侧（门宽 ≥560）或下方显示 `--bg-sunken` 等宽预览，最高 8 行）→ 固定末项 `gate.other`（选中后出现输入框并聚焦；单选下与其它选项互斥，`multi` 下并存 [推测，需回放验证]）→ `[上一题] [下一题 Enter]`（末题为 `[提交 Ctrl+Enter]`）。单选选完**不自动前进**。单选题必须选择或填写才能前进，`multi` 可空。`answers` 每题一项、顺序同 `questions`、`id` 一致，`selectedOptions` 用原样 label 去重（主进程再校验形状）。`Esc` = `{cancelled:true}`，门底部写 `gate.cancelNote`。

### 4.18 CommandPalette（`Ctrl K`）

居中浮层，宽 `--palette-w`(600)，距顶 15vh，`--bg-overlay`，`--shadow-3`，`--radius-xl`，出现 `--dur-slow` `--ease-spring`，背后 `--bg-scrim`（点击/Esc 关闭）。输入行高 52（`--fs-lg`，无边框，下边 `--border-subtle`），左搜索图标 16px、右 `Esc` 键帽。结果行高 `--row-palette`(40)，`padding: 0 --space-3`，`[图标 16][标题][右侧：项目名/快捷键键帽]`，当前行 `--bg-active` + 左 2px `--accent` 竖条。分组标题高 28，`--fs-xs` `--text-3`，**无结果的分组不渲染**。底部 28 高提示行 `palette.hint`（`--fs-2xs`）。
- 空查询：`palette.recent`（最近 5 个任务）→ `palette.commands`。有输入：任务（标题+项目名模糊匹配）→ `palette.sessions`（含终端历史会话，`>_` 标）→ 命令 → 斜杠命令（仅当前任务有进程时，`get_available_commands`）；输入以 `/` 开头时只显示斜杠命令。匹配字符 `--accent` 高亮。
- 无结果：`palette.noResults` + 一行 `palette.askNew`（把查询当成新任务的 prompt）。
- 命令清单：`cmd.*`（新任务 `Ctrl N`、在当前项目新任务 `Ctrl Shift N`、打开文件夹、设置 `Ctrl ,`、切换侧栏 `Ctrl B`、切换主题、切换语言、切换模型 `Alt M`、切换思考强度 `Alt T`、压缩上下文、停止当前任务、复制最后一条回答、跳到等你确认的任务 `Ctrl J`、查看用量（打开设置 → 用量）、检查 omp 更新、快捷键、归档当前任务、会话树（`cmd.sessionTree`）、导出对话为 HTML（`cmd.exportHtml`）、旁路提问（`cmd.btw`）；当前任务有目标时按状态再列 `暂停目标` / `继续目标` / `放弃目标`，`goal.cmd*`）。**每个快捷键动作必须在此有一条**。每条命令按 id 配自己的 16px 图标（`palette/command-icons.ts`），不再共用 `>_`（`>_` 只标终端历史会话）；会话树、导出、旁路提问各有图标（`TreeIcon` / `ExportIcon` / `BtwIcon`）；只有目标命令没登记图标，回退到通用图标。
- 键盘：`↑↓` 移动，`Enter` 执行，`Ctrl+Enter` 在新任务中执行，`Tab` 无动作（焦点陷阱）。打开前记住 `document.activeElement`，关闭后还原。

### 4.19 SettingsPage

占据主区的页面（侧栏保留，当前任务不卸载）；入口：侧栏 `设置`、`Ctrl ,`、命令面板。返回：`Esc` 或 `‹ 返回`，回到进入前的任务、滚动位置与焦点元素。左侧 168 宽分节列表，**只有一列，不分"omp-studio 的 / omp 的"**（omp 的设置和终端共用一份，就是 omp-studio 的设置；仓库所有者 2026-10-19 定）：`通用 / 模型与账号 / 工具与权限 / 上下文与记忆 / 子代理与规划 / 对话行为 / 集成 / 语音 / 其他 / 用量 / omp 版本 / 关于`，omp 的"模型与推理"并进`模型与账号`（同页，账号和模型在前，模型相关的 omp 设置在后）；读到 omp 设置前全部分组都列出，读到后去掉没有项的组。右侧内容列**最大 880、左对齐**（窗口变宽时右侧留白，不把控件拉开）；节标题 `--fs-xl`；**两栏表格式**：分组标题（`--fs-xs` `--text-3`，下一条 `--border` 线）+ 无底色的行，行高 ≥44、行间 1px `--border-subtle`；每行左列固定宽 208 放标签（`--fs-base`，说明放标签后的 `ⓘ`，不另起灰字），控件紧跟标签列左对齐，不再拉到最右。适用于所有分节，含 omp 设置分组和用量。

| 节 | 内容 |
|---|---|
| 通用 | 语言（跟随系统 / 简体中文 / English）；主题（跟随系统 / 浅色 / 深色）；减少动效（开关，系统已要求时始终生效）；运行中按 Enter（插话 / 稍后）；系统通知（有任务在等你时）；快捷键（只读列表，v1 不可自定义） |
| 模型与账号 | **自定义提供商**（在提供商列表上方，`features/settings/CustomProviders.tsx`）：`models.yml` 里 `providers.*` 的列表（ID、Base URL、模型数 · key 状态），`添加提供商` / `编辑` / `删除`（删除先 `ConfirmDialog`）；表单行内展开（`.st-login` 卡，标签列 112）：ID（编辑时只读）、Base URL、接口类型、key（分段：密钥 / 环境变量 / 无需 key，编辑时多一个“保持不变”；密钥默认遮住，`显示 / 隐藏`）、模型（`拉取模型` 后勾选，可筛选、全选，手动添加；拉取失败用一句人话写在按钮下面）；保存后 toast，新模型出现在模型选择器。直接读写 omp 的 `models.yml`，见 `docs/architecture/custom-models.md`。提供商列表（§4.20）；新任务的默认模型、默认思考强度——**就是 omp 的 `modelRoles.default` / `defaultThinkingLevel`，经 `omp config` 读写**，和草稿输入框的模型胶囊是同一份（PLAN 设计原则 7）。页面最后接 omp 设置的"模型与推理"组（标题 + 该组全部行）。审批模式不在这里：在输入框胶囊或"工具与权限"里改 |
| omp 版本 | 路径、版本、来源（`由 Tern 管理` / `由 omp-studio 管理` / `你自己安装的`）、`检查更新`；受管者管理时升级按钮禁用并写 `omp.updateInTern`；自管时显示自动更新开关 |
| 用量 | 只读，进入即读（有缓存先显示再后台刷新），组件在 `features/settings/UsageSection.tsx` + `usage-views.tsx`，样式 `usage.css`，汇总算法在 `src/shared/ui/usage-summary.ts`（有单测）。自上而下：①头一行 `更新于 N 秒前`（`useNow` 每秒走字，`--text-3`）+ `刷新` 按钮（额度和热力图一起重读）；②汇总条（一个带 `--bg-sunken` 底的圆角卡，四格竖线分隔）：`最紧的额度`（`usedFraction` 最大的窗口，大字 `剩余 76%`，小字 `窗口名 · provider`）、`过去一年`（花费 + 请求数）、`最近 30 天`（花费 + 30 根迷你柱 + 请求数）、`最忙的一天`（花费最高的一天，小字 `周二 8月25日 · 请求数`）；③`额度` 节（右侧 `N 个服务商`，下面一条细线）：每个有用量的账号一块，左列 状态点（有窗口用尽 `--st-error`、有 ≥90% 或 warning `--st-waiting`）+ provider（粗）+ 账号（`--text-3`）+ 备注，右列每个窗口一行：名称 \| 细进度条（填充 = 剩余比例）\| `剩余 N%`（tabular）\| `重置时间`（7 天内 `周二 00:09`，更远 `10月25日`，`Intl` 按应用语言）；所有窗口都没用过（比例 0 或未给）的账号不占整块，合成一行 `未使用 · provider…`；④`活动` 节（右侧日期范围 + `Token / 花费 / 请求数` 分段，`usage-metric`，驱动格子深浅）：周一起算的格子，左侧周一/三/五标签，上方月份标签，格子区自己横向滚动并默认停在最近一端；下方 `N 天有记录 · 最长连续 N 天` + `少 ■■■■■ 多`。布局全用容器查询：汇总条 <640px 变 2×2，账号块 <720px 表头移到行上方，额度行 <560px 名称在上、条在下；所有用户文字（provider、账号、窗口名）`min-width:0` + 省略 + `title`。输入框工具行的两个浮层复用同一批组件（额度浮层是账号块 + 未使用行；每日用量浮层是最近 22 周的同一热力图，格子 10px）。这是 token/费用的订阅侧入口；当前任务的 token 与费用在输入框工具行的 UsageMeter / SessionCost |

"子代理与规划"里的「目标自动推进」（也在“常用”）：开关，是 omp 的 `goal.continuationModes` 里有没有 `rpc`；读写走 `omp config`，和终端里的 omp 共用同一份，不另存副本。说明：开启后 `/goal` 的目标在 omp-studio 里由 omp 自己一轮接一轮推进；这是 omp 的设置 `goal.continuationModes`，和终端里的 omp 共用。首次启动时若用户没设置过会自动打开一次（`conversation.md`）；关着时创建/继续目标弹 info toast，按钮「打开设置」跳到这一组。

### 4.20 登录流（设置 → 模型与账号；也用于首次连接）

- 提供商行：名称 + 状态（`login.signedIn` / `login.notSignedIn` / `login.viaEnv`，来自 `logout` 响应的 `remainingSource`）+ 按钮 `登录`（`login`）/ `退出登录`（`get_logout_accounts` → 多账号时先弹小菜单 `login.chooseAccount` → `logout`）。数据 `get_login_providers`。
- 提供商列表顶部有搜索框（`login.search`，按名称和 id 过滤，无结果显示 `login.noMatch`）；已配置的（已认证或 studio 存了 key）排在前面，其余保持 omp 的顺序。按钮按登录方式给（`src/shared/provider-login.ts`，omp 的 `get_login_providers` 没有这个字段，按实测分类，见 `docs/architecture/login.md`）：OAuth 类 `登录`；只认 API key 的（Tavily、Exa、Kagi、Parallel 等）不显示 `登录`，有已知环境变量名的显示 `设置 API key`，没有的显示 `添加 API key`（走 omp 的 `login`，输入框遮住）；RPC 里只能在终端登录的，状态写 `login.terminalLogin`、不显示按钮。
- OAuth 登录：行内展开进度卡：`login.opening` → 收到 `open_url`：主进程用系统浏览器打开 `url`（用户点击登录即授权，不二次确认）；卡内显示 `login.fallback` + 可复制的 `launchUrl ?? url`（等宽，复制按钮，`rpc.md` 推荐用 `launchUrl` 避免截断 OAuth 参数）+ `instructions`（纯文本）+ `login.reopen`；随后的非机密 `input` 请求 → 卡内输入行（`login.pasteCode`）；成功 → `login.signedIn`；失败 → 红字 `login.failed` + `重试`。
- 需要机密输入（API key 类）：omp 直接拒绝，界面显示 `login.terminalOnly` + `login.copyCommand`。**v1 设置页不提供输入 API key 的框**（避免我们去写 `~/.omp`，AGENTS 禁止）。
- 引导态（首次连接 / 无可用模型）：输入框位置换成 `connect.title` 卡片（与门同位），最多 6 个提供商按钮，其余 `connect.more`；不阻塞浏览历史，没有模型时输入框胶囊区显示 `composer.noModel`。

### 4.21 OutdatedBanner

不全屏；主区顶部横幅，高 40，`--st-waiting-soft`，`--fs-sm`：`omp.outdated` + `[升级]`（对 PATH 上用户自装的 omp 执行 `omp update`，显示输出尾 3 行）；受管者管理（Tern）→ `omp.updateInTern`，无按钮。低于最低版本时**禁用发送**（输入框区显示 `composer.versionTooOld`）。运行中有任务时升级按钮提示 `omp.busy`。有新版但不强制：只在设置 → omp 里显示 `omp.newVersion`，不弹窗不横幅。

### 4.22 OmpSetupCard（首次启动与 omp 管理）

居中卡片，宽 `--dialog-w-md`(520)，侧栏隐藏（此时没有任务）；按钮不设固定宽度，用 `flex-wrap`。状态：

| 状态 | 条件 | 内容 | 动作 |
|---|---|---|---|
| A 检测中 | 启动 | `omp.finding`（超过 300ms 才显示） | — |
| B 找到 | PATH 有可用 omp | `omp.found` + `omp.found.note`（“不会修改它”是对 Tern 用户的承诺） | `omp.continue` |
| C 过旧 | 低于最低支持版本 | 同 §4.21 的文案；用户自装 → `升级`；受管 → `omp.updateInTern` | `升级` / `稍后` |
| D 脚本 | PATH 第一个是 `.cmd`/`.bat` | `omp.takeover.title/body`；正文写明会修改用户 PATH；同意后再有一个单独勾选 `omp.addPath`（默认勾选，附 `omp.addPath.note`） | `omp.takeover.yes` / `omp.takeover.no`（拒绝 → `omp.takeover.declined`）；**默认焦点在保守的一项（`no` / `keep`）**；`ask_takeover` 时背后的应用只压 `--bg-scrim`，不用不透明底 |
| E 没有 | PATH 无 omp | `omp.missing.title/body`（含大小）+ `omp.addPath` 勾选 | `omp.install` / `omp.recheck` |
| F 下载中 | — | 进度条（高 4，`--accent`，`--radius-pill`）+ `omp.progress`；阶段 `omp.downloading` → `omp.verifying`；失败红字 + 重试；校验失败 `omp.verifyFailed` | `取消` |
| G 连接模型 | omp 就绪但无可用模型 | §4.20 引导态 | 登录 |
| H 无项目 | 无项目 | §4.7 无项目的草稿页（可直接发送） | 发送 / 打开文件夹 |
| error | 检测/启动失败 | `omp.error.title` + 一行人话原因 + `omp.error.details` 折叠（等宽，可复制，≤20 行：路径、退出码、stderr 尾部） | `omp.retry` / `打开设置` |

全程右上角小字 `设置` 可随时跳走，不强制走完。下载是用户点击授权；`omp-studio` 管理 omp 的细节见 `docs/architecture/omp-install.md`。

### 4.23 通用控件

| 控件 | 规格 |
|---|---|
| Button | 高 `--control-h-md`（弹窗/首次启动用 `-lg`），`--radius-md`，`--fs-sm`，`padding: 0 --space-3-5`。主：`--primary` 底、`--text-on-primary`（近黑 / 深色近白，每个视图最多一个）；次：透明底、`1px --border-strong`；文本：无框 `--link`；危险：次按钮样式、`--st-error` 字。加载：14px 环替换文字，**宽度固定** |
| Menu / Popover | `--bg-overlay`，`--shadow-2`，`--radius-lg`，`padding: --space-1`，项高 `--row-menu`(32)、`--radius-sm`、`padding: 0 --space-2-5`，分隔线 `--border-subtle` 上下 `--space-1`，最大高 360。打开→焦点进当前/首项；`Esc` 关闭并把焦点还给触发器；`Tab` 关闭 |
| Tooltip | 延迟 500ms（已有一个显示时 0ms；键盘聚焦立即），`--bg-overlay`，`--shadow-2`，`--fs-xs`，`--radius-sm`，最大宽 280；带快捷键时尾随 Kbd |
| Toast | 右下，距边 `--space-4`，宽 `--toast-w`，叠放最多 3，`--bg-overlay`，`--shadow-2`，`--radius-lg`，`[图标][文字][可选一个文字按钮][×]`；5 秒（悬停暂停）；错误与保存失败不自动消失；`role="status"`（错误 `role="alert"`）；跨任务“等你确认”toast 点击切到该任务，不抢焦点 |
| Kbd | 高 18，`padding: 0 5px`，`--fs-2xs`，`--bg-sunken`，`1px --border`，`--radius-xs`，`--font-mono`；Windows 显示 `Ctrl`，macOS 显示 `⌘` |
| Dialog | 仅用于：首次选择“全部自动”的确认。宽 `--dialog-w-sm`，居中，`--shadow-3`，`--radius-xl`，`padding: --space-5 --space-6`；标题 `--fs-lg`，正文 `--fs-base` `--text-2`；按钮右对齐；打开时焦点在**取消**；焦点陷阱；关闭回触发器 |
| Input | 高 `--control-h-lg`，`--bg-raised`，`1px --border-strong`，`--radius-md`，聚焦样式同通则 |
| Switch | 36×20，圆；开 `--accent`，关 `--bg-active` |
| 内联错误条 `InlineNotice` | 左 2px `--st-error` + `--st-error-soft` 底，`--radius-md`，`padding: --space-2 --space-3`；人话一句 + 可选详情折叠 + 一个恢复动作；警告变体用 `--st-waiting-*` |
| OverlayScrollbar | 命中区 `--scrollbar-hit`，滑块宽 `--scrollbar-thumb-w`（hover 8px），`--scrollbar-thumb`（hover `--scrollbar-thumb-hover`）；平时隐藏，滚动时出现，停止 800ms 后淡出；**覆盖**在内容上不占布局宽度；原生滚动行为与键盘不重写；reduced-motion：常显、无淡入淡出；代码块/表格横向滚动条同样规范，高 6px。用于 `.scroller`、侧栏列表 |

### 4.24 空状态与错误汇总

| 场景 | 呈现 | 恢复动作 |
|---|---|---|
| 侧栏无任务 | `sidebar.empty`（`--text-3`） | — |
| 搜索/面板无结果 | `palette.noResults` | `palette.askNew` |
| omp 进程意外退出 | 对话流末尾内联条 + 侧栏该行变 `!`：`error.exited` | `error.reconnect`（重启进程 + `open_session`）、`error.copyDetails` |
| 协议错误 | 同上：`error.protocol` | `error.reconnect`、`error.copyDetails` |
| `prompt` 被拒 | 用户消息下方一行：`msg.sendFailed` | `msg.retry` |
| 模型不可用 | 输入框上方内联条：`error.modelUnavailable` | `error.pickModel` |
| 模型返回错误 | 该轮过程区末尾一行：`error.model`；判断为未登录再加 `error.goSignIn` | — |
| 工具失败 | 仅在过程展开里标红；折叠行尾 `· N 次失败`；若本轮因此无结论 `turn.noResult` | — |
| 项目目录不存在 | 对话区居中：`error.cwdMissing` | `error.pickFolder` / `error.removeFromList` |
| 会话无法读取 | 对话区居中：`error.sessionUnreadable` | `error.copyDetails` |
| 会话正在终端中使用 | 输入框区内联条：`session.inUse` | `session.continueAnyway`（默认不继续）[推测，需主进程给探测方法] |
| 会话没能保存（`notice` `source: "session-persistence"`） | 持久 toast：`error.persist` | 复制 |
| 渲染层崩溃（`render-process-gone`） | 主进程重载窗口，顶部 toast：`error.renderRecovered` | — |
| 渲染层未捕获错误 | 全屏居中：`error.ui` + `error.reload` | 复制错误 |

错误文案原则：说发生了什么、数据有没有丢、下一步按什么；不显示堆栈（堆栈只在“复制详情”里）。

### 4.25 ReviewView（全屏评审，阶段 3）

入口：ChangeCard 头部的 `打开评审`（`…` 左侧）、`Ctrl Shift D`、命令面板 `打开评审`。盖住顶栏以下的整个窗口（`position: fixed`，`--z-sticky`），底下的页面 `inert`；`Esc` 或 `退出评审` 关闭，焦点回到触发它的元素（已不在则回输入框）。切到别的任务或任务被删除时自动退出。实现在 `features/review/`，样式只用 token（`--diff-add-bg` / `--diff-del-bg` 是评审行背景，`--review-tree-w` / `--review-aside-w` 是两侧栏宽）。

- **头**（高 `--control-h-lg`）：`退出评审`、标题、分支名（等宽）、右侧 `统一 / 并排` 分段、`刷新`、主按钮 `发给 agent 修改（n）`（队列为空时禁用；任务在运行时悬停提示说明是插话还是排到本轮之后，取输入框同一个设置 `enterWhileRunning`）。
- **三栏**：左 `--review-tree-w` 文件树（`已暂存 / 未暂存 / 未跟踪` 三组，空组不显示；同一文件两侧都有改动时各出现一次；行 = 状态字母 + 路径，目录部分 `--text-3`）；中间 diff；右 `--review-aside-w`，两个标签 `改动说明 / 评论（n）`。<1000px 两侧栏收窄到 `--sidebar-w-min`。
- **diff**：文件头（路径、`+a −d`、`暂存 / 取消暂存`、`丢弃`）；每个 hunk 一个带 1px `--border-subtle` 的块，头部 `@@ … @@` + 区段名 + 该 hunk 的 `暂存 / 取消暂存 / 丢弃`（未跟踪文件没有 hunk 级操作）；当前 hunk 边框 `--accent`。行等宽 `--fs-code-sm`，自动换行；新增行 `--diff-add-bg`、删除行 `--diff-del-bg`；语法高亮复用 Shiki（`--syn-*`）。统一视图两列行号；并排视图左旧右新（删除块与新增块逐行配对）。二进制、过大、没有文本改动、非 git 仓库、没有 git、没有改动都有各自的一句话状态。
- **丢弃**一律先确认（`ConfirmDialog`，焦点在取消，Esc 取消），文案说明哪个文件/哪处改动、不可撤销。
- **评论**：行号就是评论按钮（悬停变 `＋`，键盘 Tab 可达）；点一下 = 对这一行评论，Shift 点击把范围扩到这一行（只能在旧或新同一侧内，跨侧则从该行重新开始）。删除行评论旧版本行号，其余评论新版本行号。评论框画在范围最后一行下面：3 行文本域 + `取消 / 添加评论`，`Ctrl Enter` 提交，`Esc` 只取消评论框。已添加的评论卡片留在行下，可编辑、删除；被评论的行左侧 2px `--accent` 竖条。
- **评论队列**（右栏 `评论` 标签）：按文件首次出现顺序、文件内按起始行排序（与发出去的消息一致）；点 `文件:行` 跳到该文件；每条可编辑、删除。队列在评审关闭后继续保留（同一任务再打开还在），只在发送成功后清空、任务删除时丢弃，不持久化。`发给 agent 修改`：成功后关闭评审、清空队列、toast `评论已发给 agent`；失败保留队列并报错。
- **改动说明**（右栏 `改动说明` 标签）：当前文件在本任务里被哪些 `edit / write / ast_edit` 调用改过（每次调用的 intent，没有则显示工具名，附 `+a −d`），以及那一轮的请求首行和结论（超过约 4 行折叠）。全部来自对话流里已有的工具事件，不让 agent 另写；对话里没有记录时显示一句 `explainNone`。
- **键盘**（焦点不在输入控件、没有对话框/命令面板盖着时生效，不带修饰键）：`J / K` 下/上一个文件，`N / P` 下/上一处改动（滚到可见并高亮），`V` 切换统一/并排，`Esc` 退出。`Tab` 序：头 → 文件树 → diff（行号按钮）→ 右栏。
- 数据：状态在 打开、窗口重新聚焦、任务状态变化、手动刷新、每次暂存/丢弃之后向主进程重取，diff 随之重取；不缓存第二份。

### 4.26 TerminalPanel（内置终端，阶段 6）

入口：任务条右端的终端图标按钮（`aria-pressed` = 面板开着）、`Ctrl \``、命令面板 `切换终端`。只在已有任务的对话页出现（草稿没有目录，设置页不显示）。实现在 `features/terminal/`，样式只用 token，细节和主进程一侧见 `docs/architecture/terminal.md`。

- **位置**：主区面板最底部（输入框下方），顶边 1px `--border`，上边缘压一条 4px 拖拽条（`row-resize`，悬停 `--border-strong`）。对话区在上方 `flex: 1`，面板打开时对话区只是变矮：吸底时继续吸底，没吸底时阅读锚点不动（面板高度变化走和窗口缩放同一套 `ResizeObserver`）。
- **高度**：默认 280px，最小 120px，最大主区面板高度的 70%（窗口变矮时渲染时重新夹取，最小值优先）；拖动中只改内存，松手写进外壳状态（`terminalHeight`，和侧栏宽度同一处持久化）；拖拽条获得焦点时 `↑ / ↓` 每次 16px，双击恢复默认。
- **头**（高 `--row-tool`）：终端图标、shell 名（等宽，如 `pwsh.exe`）、目录最后一段（`--text-3`，悬停显示完整路径）、右侧 `重启终端`、`隐藏终端`。`隐藏` 只收起面板，shell 继续在主进程里跑；`重启` 结束当前 shell 并在同一目录新起一个。
- **正文**：xterm.js（DOM 渲染器），背景 `--bg-sunken`，前景 `--text`，光标 `--accent`，选区 `--selection-bg`；字体 `--font-mono`，字号 `--fs-code`。ANSI 16 色从语义 token 推：红 `--st-error`、绿 `--syn-string`、黄 `--st-waiting-text`、蓝 `--syn-func`、品红 `--syn-keyword`、青 `--syn-type`，黑/白两端随主题翻转，亮色朝 `--text` 走一段；`minimumContrastRatio` 4.5。设置里切主题或系统深浅色变化时重新读 token。
- **打开**：每个任务一个终端；面板按任务记开关（切到别的任务再回来仍是开着的，接着原来的 shell；重启应用后默认收起）。用户主动打开时焦点进终端，切换任务时挂载的面板不抢焦点。目录（worktree 根或项目目录）已不存在时在终端区显示一句错误，按任意键重试。
- **退出**：shell 自己退出时终端里追加一行灰色（`--text-3`）提示 `[进程已退出，代码 N] 按任意键重新启动`，按任意键在同一目录重新启动（新屏幕）。
- **键盘**：终端聚焦时按键归 shell（包括 `Esc` 和 Ctrl 组合键，它们不会冒泡成全局快捷键）；例外：`Ctrl \`` 回到输入框并收起面板，`Ctrl C`（有选区时）和 `Ctrl Shift C` 复制，`Ctrl V` / `Ctrl Shift V` 粘贴。没有选区的 `Ctrl C` 照常是 `^C`。

---

## 5. 交互

### 5.1 快捷键

Windows 用 `Ctrl`，macOS 以后映射 `⌘`。输入框/文本域里**只有带 Ctrl 修饰的快捷键和 Esc 生效，单字符键绝不抢**。快捷键只在窗口聚焦时生效，不注册系统级快捷键。设置页只读展示（`shortcut.*`），菜单项/tooltip 里以 Kbd 展示。

| 动作 | 键 | 说明 |
|---|---|---|
| 命令面板 | `Ctrl K` | 再按或 `Esc` 关闭 |
| 新任务（选项目） | `Ctrl N` | 草稿任务，§5.5 |
| 在当前项目新任务 | `Ctrl Shift N` | 不弹选择器 |
| 设置 | `Ctrl ,` | |
| 切换侧栏 | `Ctrl B` | |
| 聚焦输入框 | `Ctrl L` | 并滚到底 |
| 终端 | `Ctrl \`` | 收起 → 打开并聚焦；开着但焦点不在终端 → 聚焦终端；焦点在终端 → 收起并回到输入框。命令面板的 `切换终端` 和任务条按钮是纯显隐切换 |
| 跳到等你确认的任务 | `Ctrl J` | 已在该任务时聚焦门；无待确认时无动作 |
| 第 N 个任务 | `Ctrl 1…9` | 侧栏可见顺序 |
| 上/下一个任务 | `Ctrl Alt ↑ / ↓` | |
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
| 回底部 | `End` / `Ctrl End` | 焦点在对话区 |

v1 **禁用** Chromium 默认缩放 `Ctrl +/-/0`。

### 5.2 Esc 栈（自上而下，命中即停）

1. 有菜单/弹层/面板/对话框打开 → 关闭最上层
2. 门被聚焦 → 拒绝/取消
3. 斜杠菜单打开 → 关闭
4. 任务正在运行 → 停止（`abort_and_restore_queue`）
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

### 5.5 新任务与项目

1. `Ctrl N` / `新任务` → **草稿任务**：主区显示 §4.7，主区头标题 `task.untitled`，侧栏顶部出现临时行；**此时不启动 omp 进程**。项目默认=当前任务的项目，否则最近使用，否则引导 H。
2. 草稿期间可换项目（大标题菜单、拖入文件夹）、可改模型/思考/审批；发送后项目不可换。
3. **发送第一条消息 = 创建任务**：主进程启动 `omp --mode rpc-ui`（不传 `--approval-mode`，§5.8；✔ `--mode rpc-ui`，AGENTS），协商 v2，`set_ask_dialog`，再 `prompt`。用户消息乐观上屏，过程行显示 `process.starting`（握手约 0.65s，`omp-rpc.md`）；失败走 §4.24。
4. 离开草稿时输入为空则丢弃，不留空任务；同一文件夹可并行多个任务（各一个进程）。
5. 项目分组头 `＋` 与 `Ctrl Shift N` 直接在该项目下新建。

### 5.6 会话历史

历史来自 `~/.omp` 的只读扫描（主进程）[推测：RPC 没有“列出会话”命令]，渲染层只拿到 `{id, title, projectPath, updatedAt, status}`。点击休眠任务：立即显示**只读转录**（历史轮次按“结果态”渲染：过程折叠 + 结论 + 改动卡片）；用户第一次聚焦输入框并发送时才启动 omp 并 `switch_session`/`open_session`，期间胶囊区显示 `composer.resuming`。恢复的任务和新任务一样，用启动时 omp 配置里的审批模式。

### 5.7 通知（只有“等你确认”会叫你）

任务进入 `await` 且它不是当前窗口正在看的任务，或窗口未聚焦：① 侧栏菱形 + 提示条；② 任务栏闪烁（`win.flashFrame(true)`，聚焦后停止）+ 覆盖角标数字；③ 窗口未聚焦且设置开启 → 一条系统通知，标题 `notify.title`，正文 `notify.body.gate`，点击聚焦窗口并跳到该任务；④ 窗口聚焦但在看别的任务 → 右下 toast `toast.needsYou`（不抢焦点，8 秒）。不播声音。任务完成：只有侧栏对勾，**不发通知**。

### 5.8 审批模式（完全跟随 omp 的配置）

**核实（`omp://approval-mode.md`、`omp://settings.md`）**：三种模式 `always-ask`（读自动；写、执行询问）、`write`（读写自动；执行询问）、`yolo`（全部自动）。配置项 `tools.approvalMode`，**omp 默认 `yolo`**。omp 在进程启动时读一次；文档里没有运行中切换的 RPC。

**设计**（仓库所有者 2026-10-18 定：审批模式完全按 omp 的设置来，omp-studio 不另设一层）
1. **启动时从不传 `--approval-mode` / `--yolo` / `--auto-approve`。** omp 用配置里的 `tools.approvalMode`；没设置过就是 omp 的默认 `yolo`，此时不会出现审批门。`tools.approval.*` 与 `bash.patterns` 由 omp 按文档规则叠加，我们不改。
2. **ApprovalChip 显示 omp 配置的当前值**（没设置过显示 omp 默认值），经 `omp config list` 读，和设置页的 omp 设置共用同一份快照（`config-store.ts`）。快照没读到时显示 `approval.loading`。
3. **在胶囊里选一个模式 = `omp config set tools.approvalMode <模式>`**（写入只经 omp，AGENTS）。改的是用户全局的 omp 配置，终端里的 omp 也跟着变；之后启动的任务生效，已在运行的任务要重启。弹层底部 `approval.note` 说明这一点；胶囊不再区分"有没有进程"。
4. **外观**：高 28，同其它胶囊；文案 `approval.alwaysAsk` / `approval.write` / `approval.yolo`；`yolo` 时胶囊底用 `--st-waiting-soft`、字用 `--st-waiting-text`、加盾牌图标。弹层（单选菜单）每项带一行描述（`approval.desc.*`），`yolo` 项的提示里加 `approval.subagents`。
5. 在胶囊里把模式切到 `yolo`：首次弹一次确认（`approval.yoloConfirm*`），确认后记住（`StudioSettings.yoloConfirmed`）。omp 本身默认就是 `yolo` 时不弹（没有"切换"动作）。

### 5.9 无障碍

- 对话区 `role="log"`，流式期间 `aria-busy="true"`、**不逐字播报**；轮次结束时一次性更新 live region 为 `a11y.done`（结论首句）。
- 门 `role="alertdialog"` + `aria-labelledby`/`aria-describedby`，出现时 live region 播报标题（`gate.aria`）。
- 状态点有 `aria-label`（§4.1）；侧栏列表 `role="tree"`/roving tabindex；侧栏拖拽条 `aria-label=a11y.resizeSidebar`。
- `forced-colors: active`：状态点靠形状仍可辨；选中行加左 2px 条；边框用 `CanvasText`。
- 所有颜色对比见 §2.5。

---

## 6. 第一版不做（只留位置）

| 功能（阶段） | 为它预留的位置 | v1 的做法 |
|---|---|---|
| diff 评审（3）**已落地（待设计方向确认）** | 见 §4.25；入口在 ChangeCard 头部 `…` 左侧、`Ctrl Shift D`、命令面板 | 全屏评审、逐行评论、发给 agent、改动说明面板 |
| worktree / git / PR（4）**已落地（待设计方向确认）** | 输入框胶囊区 ApprovalChip 右侧的工作树胶囊（`features/git/WorktreeChip.tsx`）；任务条右侧的分支胶囊（点开是 `Git` 菜单：查看改动、提交、推送、开 PR、合并回、丢弃）和评审按钮（§3.1）；侧栏任务行的分支图标；项目菜单“清理无主工作树”。ChangeCard 的 `提交 / 开 PR` 没做（评审入口在 ChangeCard，由评审模式负责） | 不是 git 仓库时分支胶囊和评审按钮不渲染 |
| 子代理泳道（5） | 过程行展开态头部右侧的“泳道”切换；右栏 `--aside-w`（子代理详情/改动说明）；子代理字母头像/哈希色 token 届时再加 | 只显示计数与缩进的一行 |
| 内置终端（6） | 右栏或底部面板（`--aside-w` 或新增面板高度 token）；每任务终端在其 worktree 目录 | 不做 |
| 子代理费用/token | 阶段 5 的子代理详情 | 不显示 |
| 门的“收起”（`Alt H`，omp 的 `app.ask.hide`） | 门头部右侧 | 不做；门不遮挡对话，可滚动阅读 |
| 任务删除、自定义快捷键、界面缩放、角色（default/plan）选择、测试结果显示 | — | 不做 |
| 编辑/分叉用户消息、会话树（`get_tree` / `branch`） | 用户消息悬停动作“从这里分叉”、`/fork`、`/tree`、命令面板“会话树” | 已做，见 §4.14 SessionTreePanel；原地编辑已发出的消息不做（omp 没有改写历史的命令） |
| 用量限制提示条（`get_state.usageLimit`） | 输入框上方横幅 | 已做，见 §4.14 UsageLimitBanner |
| macOS | 侧栏头左侧 inset（红绿灯）、`⌘` 映射、系统菜单 | Windows 优先；CSS 已不写死三键宽度 |
| API key 登录输入 | 设置 → 模型与账号 的提供商行 | 只显示终端登录指引 |

---

## 7. “手感”验收清单（每个阶段都按此验收）

1. 动画只用 `transform`/`opacity`（+折叠用的 `grid-template-rows`）；reduced-motion 开启后 `getAnimations()` 中无位移/缩放动画。
2. 流式时选区不丢；已冻结块的 DOM 节点引用不变（测试：分 1/5/50 字符一帧喂入，最终 DOM 与一次性渲染一致）。
3. 上滚 1 个滚轮格后不再被拉回；吸底时 `scrollTop + clientHeight == scrollHeight`（±1）。
4. 缩放窗口：锚点块的视口偏移变化 ≤2px。
5. IME 组合态 `Enter` 不发送；组合结束后才发送。
6. `Esc` 停止不丢字（排队消息放回草稿）。
7. 门：打字时不抢焦点；Enter 不隐式允许；`Ctrl+Enter` 前 500ms 与输入框有草稿时无效；关闭后焦点回原处。
8. 过程行：叙述/结论判定在 `fixtures/rpc/` 的回放上正确；整轮无“最后一条无工具调用的消息”时兜底显示最后一条文本。
9. 英文长文案不撑破胶囊/按钮/侧栏（无溢出、无意外换行）；中/英 × 浅/深 4 种组合截图。
10. Tab 顺序与 `F6` 循环可预期；侧栏列表只占一个 Tab 停靠点。
11. 冷启动到可输入 <1.5s（窗口先出骨架，omp 握手在后台）；流式时主线程每帧脚本 <8ms。
12. `tokens.css` 的两份深色块、两份 reduced-motion 块一致（单元测试）。

---

## 附录 A. i18n key 表

格式约定（前端转 JSON）：本附录每个表格的数据行都是 `` `key` | 中文 | English ``；key 为扁平的点分名，取第一列去掉反引号。值使用 ICU MessageFormat 子集：`{name}` 插值；英文复数写成 `{n, plural, one {…} other {…}}`；中文**不用 plural**（单一形式）。所选 i18n 库必须支持 ICU 复数，否则在构建时转换。文案规则：中文用“你”不用“您”；不加感叹号；动词在前；汉字与英文/数字之间加空格；错误句先说发生了什么再说怎么办；英文句首大写、按钮用动词。所有按钮/胶囊/行用 `min-width` 不用固定宽度（英文通常比中文长 1.6–2 倍）。

### A.1 通用与窗口

| key | 中文 | English |
|---|---|---|
| `common.cancel` | 取消 | Cancel |
| `common.confirm` | 确认 | Confirm |
| `common.close` | 关闭 | Close |
| `common.back` | 返回 | Back |
| `common.copy` | 复制 | Copy |
| `common.copied` | 已复制 | Copied |
| `common.retry` | 重试 | Retry |
| `common.expand` | 展开 | Expand |
| `common.collapse` | 收起 | Collapse |
| `common.showMore` | 显示更多（{n}） | Show {n} more |
| `duration.s` | {s} 秒 | {s}s |
| `duration.ms` | {m} 分 {s} 秒 | {m}m {s}s |
| `duration.hm` | {h} 小时 {m} 分 | {h}h {m}m |
| `time.now` | 刚刚 | Just now |
| `time.minutes` | {n} 分钟 | {n}m |
| `time.hours` | {n} 小时 | {n}h |
| `time.yesterday` | 昨天 | Yesterday |
| `window.more` | 更多 | More |
| `window.menu` | 菜单 | Menu |
| `window.appMenu` | omp studio 菜单 | omp studio menu |
| `window.runningFor` | 运行中 · {time}（time = `1:12`） | Running · {time} |
| `menu.toggleSidebar` | 切换侧栏 | Toggle sidebar |
| `window.whatsNew` | 新功能 | What's new |
| `window.ompUpdate` | omp 可升级 | omp update available |
| `menu.helpFeedback` | 帮助与反馈 | Help & feedback |
| `menu.about` | 关于 omp-studio | About omp-studio |
| `menu.quit` | 退出 | Quit |
| `dropzone.folder` | 松开以用这个文件夹新建任务 | Drop to start a task in this folder |
| `dropzone.image` | 松开以添加图片 | Drop to add images |

### A.2 侧栏与任务

| key | 中文 | English |
|---|---|---|
| `sidebar.newTask` | 新任务 | New task |
| `sidebar.waitingOne` | 1 个任务在等你 · {project} | 1 task waiting for you · {project} |
| `sidebar.waitingMany` | {n} 个任务在等你 | {n} tasks waiting for you |
| `sidebar.empty` | 还没有任务 | No tasks yet |
| `sidebar.settings` | 设置 | Settings |
| `sidebar.newInProject` | 在此项目新建任务 | New task in this project |
| `project.reveal` | 在资源管理器中显示 | Show in File Explorer |
| `project.remove` | 从列表移除 | Remove from list |
| `task.untitled` | 新任务 | New task |
| `task.rename` | 重命名 | Rename |
| `task.archive` | 归档 | Archive |
| `task.archived` | 已归档 | Archived |
| `task.undo` | 撤销 | Undo |
| `task.reveal` | 在资源管理器中显示 | Show in File Explorer |
| `task.copyId` | 复制会话 ID | Copy session ID |
| `task.copyPath` | 复制会话文件路径 | Copy session file path |
| `task.exportHtml` | 导出为 HTML… | Export as HTML… |
| `toast.exported` | 已导出 {name} | Exported {name} |
| `toast.revealExport` | 在文件夹中显示 | Show in folder |
| `task.stopped` | 已停止 | Stopped |
| `status.running` | 进行中 | Running |
| `status.runningAgents` | 进行中，{n} 个子代理 | Running, {n, plural, one {# subagent} other {# subagents}} |
| `status.waiting` | 等你确认 | Waiting for you |
| `status.done` | 完成 | Done |
| `status.error` | 出错 | Error |
| `todo.title` | 进度 | Progress |
| `todo.pending` | 未开始 | Pending |
| `todo.inProgress` | 进行中 | In progress |
| `todo.completed` | 已完成 | Completed |
| `todo.blocked` | 受阻 | Blocked |
| `todo.abandoned` | 已放弃 | Abandoned |

### A.3 空状态

| key | 中文 | English |
|---|---|---|
| `empty.recent` | 最近的任务 | Recent tasks |
| `empty.fromTerminal` | 来自终端 | From the terminal |
| `empty.openFolder` | 打开文件夹… | Open folder… |
| `empty.recentProjects` | 最近项目 | Recent projects |

### A.4 输入框、模型与审批模式

| key | 中文 | English |
|---|---|---|
| `composer.placeholderNew` | 让 omp 做点什么… | Ask omp to do something… |
| `composer.placeholder` | 回复… | Reply… |
| `composer.placeholderRunning` | 告诉 omp 要改什么（Enter 插话，Ctrl+Enter 稍后）… | Tell omp what to change (Enter to steer, Ctrl+Enter for later)… |
| `composer.placeholderRunningSwapped` | 告诉 omp 要改什么（Enter 稍后，Ctrl+Enter 插话）… | Tell omp what to change (Enter for later, Ctrl+Enter to steer)… |
| `composer.placeholderGate` | 拒绝并告诉 omp 该怎么做… | Deny and tell omp what to do instead… |
| `composer.send` | 发送 | Send |
| `composer.sendDeny` | 拒绝并发送 | Deny and send |
| `composer.stop` | 停止 | Stop |
| `composer.stopping` | 正在停止… | Stopping… |
| `composer.steer` | 插话 | Steer |
| `composer.later` | 稍后 | Later |
| `composer.attach` | 添加图片 | Add image |
| `composer.attach.imageOnly` | 目前只能添加图片 | Only images can be added for now |
| `composer.attachment.remove` | 移除 | Remove |
| `composer.queue.promote` | 现在插话 | Steer now |
| `composer.queue.remove` | 撤回 | Withdraw |
| `composer.queue.more` | 还有 {n} 条 | {n} more |
| `composer.queueRestored` | 已停止 · {n} 条排队消息已放回输入框 | Stopped · {n, plural, one {# queued message} other {# queued messages}} put back in the box |
| `composer.imagesDropped` | 图片太大，没能放回 | The images were too large to restore |
| `composer.nextRequest` | 下一次请求生效 | Applies from the next request |
| `composer.context` | 上下文 {p}% | Context {p}% |
| `composer.usage.tps` | {n} token/s | {n} tok/s |
| `composer.usage.tpsTip` | 最近一条回复的输出速度 | Output speed of the latest reply |
| `composer.badge.fast` / `composer.badge.slow` | 快速 / 慢速 | Fast / Slow |
| `composer.limit.aria` | 用量限额 | Usage limit |
| `composer.limit.wrapUp` | 账号已超出用量限额，当前只有一小段收尾额度，请尽快收尾。 | Your account is past its usage limit and only has a short wrap-up allowance. Finish up soon. |
| `composer.limit.wrapUpExtra` | 账号已超出用量限额，当前只有一小段收尾额度，用完后按额外用量计费。 | Your account is past its usage limit and only has a short wrap-up allowance; extra usage is billed after it runs out. |
| `composer.limit.lowPriority` | 账号已超出用量限额，请求走低优先级通道，会比平时慢。 | Your account is past its usage limit. Requests run on the low-priority lane and will be slower. |
| `composer.limit.resets` | {time} 重置 | Resets at {time} |
| `composer.limit.left` | 低优先级额度还剩 {p}% | {p}% of the low-priority allowance left |
| `composer.context.tip` | 接近上限时 omp 会自动压缩 | omp compacts automatically near the limit |
| `composer.compact` | 压缩上下文 | Compact context |
| `composer.noModel` | 未连接模型 | No model connected |
| `composer.versionTooOld` | omp 版本过旧 | omp is too old |
| `composer.resuming` | 正在恢复… | Resuming… |
| `model.search` | 搜索模型… | Search models… |
| `model.empty` | 没有可用模型 | No models available |
| `model.recent` | 最近使用 | Recent |
| `model.thinking` | 思考强度 | Thinking |
| `model.thinking.unsupported` | 这个模型不支持思考 | This model doesn't support thinking |
| `model.groupCount` | {count} 个模型 | {count} model(s) |
| `model.context` / `model.compactsAt` / `model.maxOutput` | 上下文 / 压缩于 / 最大输出 | Context / Compacts at / Max output |
| `model.compact.percent` / `.percentOfBase` | 窗口的 {percent}% / 基数 {base} 的 {percent}% | {percent}% of window / {percent}% of {base} base |
| `model.compact.fixed` / `.capped` | 固定值 / 到达窗口，改为窗口减预留 | fixed / capped by window |
| `model.compact.reserve` / `.reserveOfBase` | 窗口减预留 {reserve} / 基数 {base} 减预留 {reserve} | window − {reserve} reserve / {base} base − {reserve} reserve |
| `model.compact.source.global` / `.project` / `.model` | 全局设置 / 项目设置 / 按模型设置 | global / project / per-model |
| `model.price` · `model.price.input` / `.output` / `.cache` / `.line` | 价格 · 输入 {value} / 输出 {value} / 缓存 {value} / {parts}（每百万 token） | Price · {value} in / {value} out / {value} cache / {parts} per M |
| `model.perf` · `model.perf.tps` / `.ttft` / `.samples` | 实测速度 · {value} t/s / 首字 {value} s / {count} 次采样 | Speed · {value} t/s / {value} s TTFT / {count} sample(s) |
| `model.perf.catalog` / `model.perf.none` | 模型目录给出 / 还没有实测 | from the model catalog / Not measured yet |
| `model.intelligence` / `model.input` · `.text` / `.image` | 智能分 / 输入类型 · 文本 / 图片 | Intelligence / Input · text / image |
| `model.tag.reasoning` / `model.tag.vision` | 推理 / 视觉 | reasoning / vision |
| `model.speed` | 速度 | Speed |
| `model.fast` | 快速模式 | Fast mode |
| `model.fast.hint` | 更快的服务层级，只对本会话生效；模型不支持时 omp 会拒绝。 | A faster service tier for this session only; omp rejects it on models that don't support it. |
| `model.slow` | 慢速模式 | Slow mode |
| `model.slow.scope.global` | 写入 omp 配置，所有会话共用 | Saved in the omp config, shared by every session |
| `model.slow.scope.session` | 只对本会话生效 | This session only |
| `model.slow.unsupported` | 这个模型没有慢速模式 | This model has no slow mode |
| `model.on` / `model.off` | 开 / 关 | On / Off |
| `model.addProvider` | 添加提供商… | Add a provider… |
| `model.switched` | 切换到 {model} · {level} | Switched to {model} · {level} |
| `thinking.off` | 关 | Off |
| `thinking.minimal` | 极低 | Minimal |
| `thinking.low` | 低 | Low |
| `thinking.medium` | 中 | Medium |
| `thinking.high` | 高 | High |
| `thinking.xhigh` | 超高 | X-High |
| `thinking.max` | 最大 | Max |
| `approval.title` | 审批模式 | Approval mode |
| `approval.alwaysAsk` | 每次询问 | Ask every time |
| `approval.write` | 写入自动，执行询问 | Edits auto, ask before running |
| `approval.yolo` | 全部自动 | Full auto |
| `approval.desc.alwaysAsk` | 读取自动；写入和执行前询问 | Reads run automatically; asks before edits and commands |
| `approval.desc.write` | 读取和写入自动；执行命令前询问 | Reads and edits run automatically; asks before commands |
| `approval.desc.yolo` | 不询问 | Never asks |
| `approval.subagents` | 子代理在后台以全部自动运行，不会单独询问。 | Subagents run in the background in full auto and don't ask separately. |
| `approval.note` | 改的是 omp 的配置（tools.approvalMode），终端里的 omp 也会跟着变。已经在运行的任务要重启后才生效。 | This changes omp's config (tools.approvalMode), so omp in the terminal follows too. Running tasks pick it up after a restart. |
| `approval.loading` | 审批… | Approval… |
| `approval.yoloConfirmTitle` | 使用全部自动？ | Use full auto? |
| `approval.yoloConfirmBody` | 全部自动模式下，omp 不会在执行命令前询问你。 | In full auto, omp won't ask before running commands. |
| `approval.yoloConfirmYes` | 使用全部自动 | Use full auto |
| `slash.empty` | 没有匹配的命令 | No matching commands |

### A.5 对话流（过程、消息、改动卡片）

| key | 中文 | English |
|---|---|---|
| `process.starting` | 正在启动… | Starting… |
| `process.thinking` | 正在思考… | Thinking… |
| `process.replying` | 正在回复… | Replying… |
| `process.retrying` | 模型出错，正在重试（{i}/{n}）… | Model error, retrying ({i}/{n})… |
| `process.compacting` | 正在压缩上下文… | Compacting context… |
| `process.waiting` | 等你确认 · 已暂停 {duration} | Waiting for you · paused {duration} |
| `process.subagentsRunning` | {n} 个子代理 | {n, plural, one {# subagent} other {# subagents}} |
| `process.done` | 已工作 {duration} | Worked for {duration} |
| `process.toolCalls` | {n} 次工具调用 | {n, plural, one {# tool call} other {# tool calls}} |
| `process.subagents` | {n} 个子代理 | {n, plural, one {# subagent} other {# subagents}} |
| `process.failures` | {n} 次失败 | {n, plural, one {# failure} other {# failures}} |
| `process.waited` | 含等待 {duration} | Includes {duration} waiting |
| `process.thought` | 思考 · {duration} | Thought · {duration} |
| `process.earlier` | 更早的 {n} 条 | {n} earlier |
| `tool.verb.read` | 读取 {target} | Reading {target} |
| `tool.verb.edit` | 修改 {target} | Editing {target} |
| `tool.verb.write` | 写入 {target} | Writing {target} |
| `tool.verb.bash` | 运行 {target} | Running {target} |
| `tool.verb.search` | 搜索 {target} | Searching {target} |
| `tool.verb.other` | 调用 {tool} | Calling {tool} |
| `tool.failed` | 失败 | Failed |
| `tool.denied` | 已拒绝 | Denied |
| `tool.cancelled` | 已取消 | Cancelled |
| `tool.output.showAll` | 显示全部 | Show all |
| `tool.output.empty` | 无输出 | No output |
| `subagent.row` | 子代理 {name} · {n} 次工具调用 · {status} | Subagent {name} · {n, plural, one {# tool call} other {# tool calls}} · {status} |
| `subagent.status.running` | 进行中 | running |
| `subagent.status.completed` | 已完成 | completed |
| `subagent.status.failed` | 已失败 | failed |
| `subagent.status.aborted` | 已中断 | aborted |
| `msg.sendFailed` | 没有发出 | Not sent |
| `msg.retry` | 重试 | Retry |
| `code.expand` | 展开全部（{n} 行） | Show all ({n} lines) |
| `scroll.latest` | 回到最新 | Jump to latest |
| `turn.noResult` | 没有得到结果。展开过程查看原因。 | No result. Expand the work to see why. |
| `change.summary` | {n} 个文件已更改 | {n, plural, one {# file changed} other {# files changed}} |
| `change.more` | 还有 {n} 个文件 | {n} more files |
| `change.new` | 新 | New |
| `change.interrupted` | 已中断 | Interrupted |
| `change.copyList` | 复制文件列表 | Copy file list |

### A.6 门（审批、ask、其它请求）与通知

| key | 中文 | English |
|---|---|---|
| `gate.title.waiting` | 等你确认 | Waiting for you |
| `gate.allow` | 允许 | Allow |
| `gate.allowTool` | 本任务内允许 {tool} | Allow {tool} for this task |
| `gate.deny` | 拒绝 | Deny |
| `gate.confirm` | 确认 | Confirm |
| `gate.cancel` | 取消 | Cancel |
| `gate.submit` | 提交 | Submit |
| `gate.ok` | 确定 | OK |
| `gate.next` | 下一题 | Next |
| `gate.back` | 上一题 | Back |
| `gate.step` | {i} / {n} | {i} of {n} |
| `gate.other` | 其他… | Other… |
| `gate.otherPlaceholder` | 输入你自己的答案 | Type your own answer |
| `gate.recommended` | 推荐 | Recommended |
| `gate.required` | 请选择一项或填写内容 | Choose an option or type an answer |
| `gate.filter` | 筛选… | Filter… |
| `gate.timeout` | 将在 {s} 秒后自动取消 | Cancels automatically in {s}s |
| `gate.timeoutAsk` | {s} 秒后将自动选择推荐项 | Picks the recommended option in {s}s |
| `gate.timedOut` | 已超时 | Timed out |
| `gate.cancelled` | 已取消 | Cancelled |
| `gate.cancelNote` | 取消后 omp 会自行决定 | If you cancel, omp will decide on its own |
| `gate.detailsExpand` | 显示全部 | Show all |
| `gate.pending` | 还有 {n} 个请求在等待 | {n} more waiting |
| `gate.aria` | omp 需要你的回应 | omp needs your response |
| `gate.suggestReplace` | 用建议的文本替换当前输入？ | Replace your draft with the suggested text? |
| `gate.suggestReplaceYes` | 替换 | Replace |
| `gate.suggestKeep` | 保留 | Keep mine |
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
| `cmd.compact` | 压缩上下文 | Compact context |
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
| `goal.autoContinueOff` | 目标不会自动推进，可在 设置 → 子代理与规划 打开「目标自动推进」（和终端里的 omp 共用） | The goal won't keep going on its own. Turn on “Let goals keep going” in Settings → Subagents & planning (shared with the omp in your terminal) |
| `goal.openSettings` | 打开设置 | Open settings |
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
| `shortcut.send` | 发送 | Send |
| `shortcut.newline` | 换行 | New line |
| `shortcut.steer` | 运行中：插话 | While running: steer |
| `shortcut.later` | 运行中：稍后 | While running: later |
| `shortcut.stop` | 停止并取回排队消息 | Stop and take back queued messages |
| `shortcut.gatePrimary` | 门：主操作 | Prompt: primary action |
| `shortcut.gateDeny` | 门：拒绝或取消 | Prompt: deny or cancel |
| `shortcut.toggleProcess` | 展开或收起最近一个过程行 | Expand or collapse the latest work row |
| `shortcut.focusComposer` | 聚焦输入框 | Focus the message box |
| `shortcut.nthTask` | 切到第 N 个任务 | Go to task N |
| `shortcut.prevNext` | 上一个或下一个任务 | Previous or next task |
| `shortcut.regions` | 在区域间切换 | Move between areas |

### A.8 设置与登录

| key | 中文 | English |
|---|---|---|
| `settings.title` | 设置 | Settings |
| `settings.back` | 返回 | Back |
| `settings.general` | 通用 | General |
| `settings.models` | 模型与账号 | Models & accounts |
| `settings.omp` | omp 版本 | omp version |
| `settings.usage` | 用量 | Usage |
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
| `settings.notifyWaiting` | 有任务在等你时通知我 | Notify me when a task is waiting for me |
| `settings.shortcuts` | 快捷键 | Keyboard shortcuts |
| `settings.defaultModel` | 新任务的默认模型 | Default model for new tasks |
| `settings.defaultThinking` | 默认思考强度 | Default thinking level |
| `settings.ompPicksModel` | 由 omp 自动选择 | Let omp choose |
| `settings.usage.hidden` | 用量统计默认不在界面中显示。 | Usage isn't shown by default. |
| `settings.usage.show` | 显示用量 | Show usage |
| `settings.usage.noTask` | 先打开一个任务 | Open a task first |
| `settings.usage.tokens` | Token | Tokens |
| `settings.usage.cost` | 费用 | Cost |
| `connect.title` | 连接一个模型提供商 | Connect a model provider |
| `connect.body` | 登录后就可以开始。账号信息由 omp 保存，和终端版共用。 | Sign in to get started. omp stores your credentials and shares them with the terminal version. |
| `connect.more` | 更多… | More… |
| `login.providers` | 提供商 | Providers |
| `login.signIn` | 登录 | Sign in |
| `login.signOut` | 退出登录 | Sign out |
| `login.signedIn` | 已登录 · {account} | Signed in · {account} |
| `login.notSignedIn` | 未登录 | Not signed in |
| `login.viaEnv` | 通过环境变量或配置使用 | Using an environment variable or config key |
| `login.opening` | 正在打开浏览器… | Opening your browser… |
| `login.fallback` | 如果浏览器没有打开，复制这个链接： | If your browser didn't open, copy this link: |
| `login.reopen` | 重新打开浏览器 | Open the browser again |
| `login.pasteCode` | 粘贴授权码 | Paste the authorization code |
| `login.terminalOnly` | 这个提供商需要在终端里登录：运行 omp，再输入 /login。 | This provider has to be set up in the terminal: run omp, then type /login. |
| `login.copyCommand` | 复制命令 | Copy command |
| `login.chooseAccount` | 选择要退出的账号 | Choose an account to sign out |
| `login.failed` | 登录没有完成。 | Sign-in didn't complete. |

### A.9 omp 管理与首次启动

| key | 中文 | English |
|---|---|---|
| `omp.finding` | 正在查找 omp… | Looking for omp… |
| `omp.found` | 检测到 omp {version}（{source}） | Found omp {version} ({source}) |
| `omp.found.note` | omp-studio 会直接使用它，不会修改它。 | omp-studio will use it as is and won't modify it. |
| `omp.source.tern` | 由 Tern 管理 | managed by Tern |
| `omp.source.studio` | 由 omp-studio 管理 | managed by omp-studio |
| `omp.source.user` | 你自己安装的 | installed by you |
| `omp.continue` | 继续 | Continue |
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
| `omp.later` | 稍后再说 | Later |
| `omp.updateInTern` | 请在 Tern 中更新 omp。 | Update omp from Tern. |
| `omp.busy` | 有 {n} 个任务正在运行，完成后再升级。 | {n, plural, one {# task is running.} other {# tasks are running.}} Upgrade when {n, plural, one {it finishes.} other {they finish.}} |
| `omp.newVersion` | 有新版本 {version} | {version} is available |
| `omp.checkUpdate` | 检查更新 | Check for updates |
| `omp.upToDate` | 已是最新版本 | You're up to date |
| `omp.autoUpdate` | 自动更新 | Automatic updates |
| `omp.path` | 路径 | Path |
| `omp.version` | 版本 | Version |
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
| `error.reconnect` | 重新连接 | Reconnect |
| `error.copyDetails` | 复制详情 | Copy details |
| `error.model` | 模型返回错误：{message} | The model returned an error: {message} |
| `error.goSignIn` | 去登录 | Go to sign-in |
| `error.modelUnavailable` | 这个会话用的模型现在不可用。 | The model used by this session isn't available. |
| `error.pickModel` | 选择模型 | Choose a model |
| `error.cwdMissing` | 找不到项目文件夹 {path} | Can't find the project folder {path} |
| `error.pickFolder` | 重新选择文件夹 | Choose another folder |
| `error.removeFromList` | 从列表移除 | Remove from list |
| `error.sessionUnreadable` | 这个会话无法打开。 | This session can't be opened. |
| `error.persist` | 会话没能保存到磁盘：{message} | The session couldn't be saved to disk: {message} |
| `error.renderRecovered` | 界面已恢复。任务没有受影响。 | The window recovered. Your tasks weren't affected. |
| `error.ui` | 界面出错了 | Something went wrong in the window |
| `error.reload` | 重新加载 | Reload |
| `session.inUse` | 这个会话正在终端里被使用。 | This session is in use in a terminal. |
| `session.continueAnyway` | 仍然继续 | Continue anyway |
| `a11y.chat` | 对话 | Conversation |
| `a11y.taskList` | 任务列表 | Task list |
| `a11y.done` | 已完成：{summary} | Finished: {summary} |
| `a11y.resizeSidebar` | 调整侧栏宽度 | Resize sidebar |

---

## 附录 B. 对主进程/协议的依赖、待核实与需要仓库所有者拍板的事

**需要仓库所有者拍板**

| # | 事项 | 本规范的选择 |
|---|---|---|
| 1 | 审批模式默认值 | **已定（2026-10-18）：完全跟随 omp 的配置**（`tools.approvalMode`，omp 默认 `yolo`），启动时从不传 `--approval-mode`；胶囊改的就是 omp 配置（§5.8）。原方案"Studio 默认 `write`"和"Studio 自己存一份默认值"都作废 |
| 2 | 审批模式切换语义 | omp 在进程启动时读配置；胶囊改配置后，之后启动的任务生效，运行中的任务要重启（见 §5.8）。备选"重启进程并恢复会话"需先实测 `open_session` 无损恢复 |
| 3 | 改动卡片的测试结果 | v1 不显示（PLAN §2.1 提到）；若要做，需先决定识别规则 |
| 4 | API key 类提供商登录 | 只给终端指引。若要在设置页输入 key（Electron `safeStorage` 保存、以环境变量传给 omp），与 AGENTS“不写 `~/.omp`”需要一次明确的规则变更 |
| 5 | 新增运行时依赖 / 未定技术选型 | 语法高亮库（要求：同步、按需加载语言、只输出 `<span class>`）、Markdown 库（要求：块边界、可关闭原始 HTML）、i18n 库（要求：ICU 复数、运行时切换语言）、自绘覆盖式滚动条的实现 |
| 6 | 字体是否打包 Inter / JetBrains Mono | v1 不打包；做完第一版中英深浅 4 象限截图后由所有者按肉眼决定，只改 `--font-*` |
| 7 | 阅读列宽 / 正文 15px 是否偏大 | 已定 840（2026-10-19）；正文仍可凭肉眼调，只改 `--fs-prose` |
| 8 | 任务完成不发系统通知 | 取“只有等你会叫你”的立场；若内测反馈需要，再加一个默认关闭的设置项 |
| 9 | 产品名/Logo | 暂定名 omp-studio，侧栏头不放 Logo/应用名 |

**需要实测 / 录制 fixture（[推测] 项）**

1. 在 `--approval-mode always-ask` 下让 agent 跑一条 bash，用 `npm run rpc:record` 录下审批提示的真实帧：`method`（`select`？）、选项原文、是否带 `timeout`，以及“发送消息会拒绝待批准调用并改道”（`approval-mode.md` 描述）在 RPC 下是否同样成立。结果决定门按钮的本地化映射与 `composer.sendDeny` 的行为。
2. 主进程需要提供：每轮 `{turnId, startedAt, endedAt, waitedMs, toolCalls, subagents}`（时间戳用主进程接收时间）；`taskStatusChanged`；`taskTurnSummary`（文件、状态、+/−，由工具事件 + `git diff --numstat` 汇总，仅 git 仓库）；`onQueue`/`removeQueued`/`promoteQueued`/`abortAndRestore`；`respondUi`（校验 `ask` 的 `answers` 形状）；`listSessions`/`openTranscript`/`resumeTask`；`pickFolder`/`openExternal`（校验 http/https）/`revealInFolder`（路径校验在任务目录内）；`ompStatus`；草稿、侧栏状态、归档、重命名的持久化。
3. 叙述/结论启发式（§4.9）在 `fixtures/rpc/` 的多轮带工具回放上验证；误判率高时的退路：只折叠纯工具行，叙述保留为灰色单行。
4. `titleBarOverlay` 在 Win11 上是否保留 Snap Layouts；无应用菜单时编辑快捷键是否正常；Electron 44 的 `linear()` 弹簧、`text-wrap: pretty` 支持。
5. `session_settled` 后再计算改动卡片的时序；终端正在使用同一会话文件的探测方法；`multi` 型 ask 是否允许“选项 + 其他”并存；运行中 `set_model` 的生效时机（决定 `composer.nextRequest` 文案是否保留）。

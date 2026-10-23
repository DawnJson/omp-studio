import type { MessageEntry } from "../index.ts";

// 设置页里 MCP 服务器、SSH 主机、可用工具、记忆、omp 更新日志这几张卡片，以及对应的斜杠命令说明（spec §4.19）。
export const integrations = {
  "scope.user": "用户（全局）",
  "scope.project": "项目",
  "field.scope": "范围",
  add: "添加",
  remove: "删除",
  refresh: "刷新",
  loading: "正在读取…",
  more: "更多操作",
  loadFailed: "读取失败：{message}",

  "mcp.title": "MCP 服务器",
  "mcp.empty": "还没有配置 MCP 服务器。",
  "mcp.form.title": "添加 MCP 服务器",
  "mcp.add": "添加服务器…",
  "mcp.test": "测试连接",
  "mcp.connected": "已连接，{count} 个工具",
  "mcp.unmanageable": "名字里有空格或特殊字符：omp 的 /mcp 命令管不了这种名字，只能在配置文件里改。",
  "mcp.note":
    "改动写进 omp 的配置，新任务会用到；已经打开的任务点顶栏标题右边的“重开会话”（Ctrl Shift R）才会重新连接。需要 OAuth 登录或取消授权（/mcp reauth、/mcp unauth）的服务器，omp 只在终端界面里支持，这里做不了。",
  "mcp.remove.title": "删除 MCP 服务器“{name}”？",
  "mcp.remove.body": "会从 omp 的{scope}配置里删掉这一项，不会影响别的范围里的同名服务器。",
  "mcp.name": "名称",
  "mcp.name.tip": "字母、数字、点、下划线、横线，最长 100 个字符，不能有空格。",
  "mcp.kind": "类型",
  "mcp.kind.stdio": "本地命令",
  "mcp.command": "命令",
  "mcp.args": "参数",
  "mcp.args.tip": "一行一个参数；参数里有空格也没关系，每行就是一个整体。参数里不能有双引号。",
  "mcp.token": "Token",
  "mcp.token.tip": "可选。omp 会把它存成 Authorization: Bearer 请求头，写在配置文件里。",

  "ssh.title": "SSH 主机",
  "ssh.empty": "还没有配置 SSH 主机。",
  "ssh.form.title": "添加 SSH 主机",
  "ssh.add": "添加主机…",
  "ssh.remove.title": "删除 SSH 主机“{name}”？",
  "ssh.remove.body": "只是从 omp 的配置里删掉这一项，不会连接那台机器。",
  "ssh.name": "名称",
  "ssh.host": "主机地址",
  "ssh.user": "用户名",
  "ssh.port": "端口",
  "ssh.key": "密钥路径",
  "ssh.key.tip": "私钥文件的路径，可选。",
  "ssh.desc": "说明",
  "ssh.compat": "兼容模式",
  "ssh.compat.tip": "omp 的 --compat：给不完全兼容的远端（如某些路由器、精简系统）用。",

  "skills.title": "Skills",
  "skills.empty":
    "没有可用的 skill。把带 SKILL.md 的 skill 文件夹放进 ~/.omp/agent/skills（用户级）或项目里的 .omp/skills，或在终端里运行 omp skill install。",
  "skills.note":
    "这是 omp 报告的当前可用 skill，只读；选了项目时会加上该项目目录里的 skill。omp 没有在这里启用或停用 skill 的命令。",

  "tools.title": "可用工具",
  "tools.enabled": "已启用",
  "tools.device": "xd 设备",
  "tools.device.tip":
    "xd:// 设备是同一个工具的入口，模型通过它按需调用，不是单独的工具，所以没有开关。要整体收起所有设备，关掉设置项 tools.xdev（关掉后工具直接放进模型的工具列表）。",
  "tools.mounted": "按需调用",
  "tools.mounted.tip":
    "这个工具不在默认工具集里，挂在 xd:// 设备下，模型需要时才调用，并不是关着。它没有单独的 <工具>.enabled 设置项，所以没有开关。",
  "tools.mounted.mcpTip":
    "MCP 服务器提供的工具，omp 没有按单个工具开关的设置项。要停用就在上面“集成与插件”里整个关掉这台 MCP 服务器；挂在 xd:// 设备下按需调用，并不是关着。",
  "tools.inactive.tip":
    "当前会话没有启用这个工具：它由 omp 的某个模式或命令按需启用（如 /autoresearch 的实验工具、/goal），没有单独的 <工具>.enabled 设置项，所以没有开关。",
  "tools.note":
    "这是 omp 在不带项目时看到的全局列表：项目里的插件和 MCP 服务器提供的工具不在里面。有 <工具>.enabled 设置项的工具带开关（就是下面设置里的同一项）；关掉后它会从 omp 的列表里消失，这里的行先保留着，点“刷新”才重读。没有开关的行不是坏了：把鼠标放到徽标上看原因和去哪里改。",

  "memory.title": "记忆",
  "memory.noProject": "记忆是按项目分的，先打开一个项目才能查看和整理。",
  "memory.project": "项目",
  "memory.project.desc": "记忆按项目目录分开存放，这里的所有操作都在所选项目的目录里执行。",
  "memory.view": "查看",
  "memory.op.stats": "统计",
  "memory.op.diagnose": "诊断",
  "memory.op.queue": "待整理",
  "memory.op.view": "注入内容",
  "memory.emptyOutput": "（omp 没有输出）",
  "memory.clear": "清空",
  "memory.clear.title": "清空这个项目的记忆？",
  "memory.clear.body":
    "会删除当前记忆后端为这个项目保存的数据，无法撤销。本地记忆会在下一次会话启动时由 omp 根据过去的会话重新生成。Hindsight 后端只清本地的会话状态和缓存，不会删服务器上的库。",
  "memory.cleared": "记忆已清空",
  "memory.note":
    "本地记忆由 omp 在会话启动时自己生成（读过去的会话、要调模型，可能产生费用），没有手动触发的按钮：/memory sync 和 /memory rebuild 在这个启动流程之外没有可观察的效果，所以这里不提供。",

  "changelog.title": "更新日志",
  "changelog.hint": "来自 omp 自带的 /changelog，只有英文。",

  "slash.mcp": "管理 MCP 服务器（打开设置 → 集成）",
  "slash.ssh": "管理 SSH 主机（打开设置 → 集成）",
  "slash.tools": "查看可用工具（打开设置 → 工具与权限）",
  "slash.memory": "查看和整理记忆（打开设置 → Context 与记忆）",
  "slash.changelog": "查看 omp 更新日志（打开设置 → 关于）",
  "slash.args": "这条命令的参数写法没有执行：不带参数输入它会打开设置页，增删改在页面里的卡片上做。",

  "cmd.mcp": "MCP 服务器",
  "cmd.ssh": "SSH 主机",
  "cmd.tools": "可用工具",
  "cmd.memory": "记忆",
  "cmd.changelog": "omp 更新日志",
} satisfies Record<string, MessageEntry>;

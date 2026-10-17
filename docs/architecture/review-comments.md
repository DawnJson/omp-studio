# 把评审评论发给 agent

diff 评审里攒下的逐行评论，怎么一次发给 agent。验证过程见 `problem.md` 第 1 题。

实测版本：omp 18.12.0，模型 `deepseek/deepseek-v4-flash`。日期 2026-10-17。

## 两种做法

| | 宿主自己格式化消息（**已采用**） | omp 插件调 `ctx.annotations.submit` |
|---|---|---|
| 行范围 | 宿主完全控制，如 `calc.js:12-16` | note 只有单个 `line`，范围只能写进 note 文本 |
| 消息大小 | 只有评论本身（实测约 0.2 KB） | `source: { kind: "file" }` 会嵌入整个文件（31 行约 1.1 KB） |
| 运行中投递 | RPC 自带的 `steer`、`follow_up`，或 `prompt` 加 `streamingBehavior` | `deliver: auto/send` 只会排进 followUp；要 steer 得在插件里另调 `pi.sendUserMessage(text, { deliverAs: "steer" })` |
| 失败信号 | 命令的 response | `prompt` 仍返回 `success: true`，错误只在 `extension_error` 帧里 |
| 依赖 | 无 | 要随 omp-studio 分发插件，并跟着 omp 的 annotations 格式变化 |
| 改动结果 | agent 改对了位置 | agent 改对了位置，和左边一样 |

两种做法 agent 都先 `read` 文件再 `edit`，annotations 嵌入的文件内容并没有让它少读一次。

## 插件做法的实测细节

留着备用，比如以后想用 `deliver: "paste"` 把评论填进输入框。

- 加载：`omp --mode rpc-ui --extension <插件绝对路径>`。插件是单文件 ES 模块，`export default function (pi) { … }`，不需要 import。
- 调用：RPC `prompt`，`message` 是 `/studio-review <json>`。agent 运行中也会立即执行，不需要 `streamingBehavior`。命令出现在 `get_available_commands` 和 `available_commands_update` 里，`source: "extension"`，`input.hint` 是默认的 `"arguments"`。
- agent 收到的用户消息格式：

  ````text
  # Feedback on calc.js

  ## Source

  ```text
  （整个文件）
  ```
  ## 1. Feedback on:
  "function mul(a, b) {"
  [lines 12-16] Rename function mul to …
  ````

  `line: 12` 被渲染成第 12 行的源码引用，`[lines 12-16]` 是插件写进 note 文本的。
- 越界行号或文件不存在时，收到 `{"type":"extension_error","extensionPath":"command:studio-review","event":"command","error":"Annotation 1: line 99 is outside calc.js (lines 1-32)."}`，`prompt_result` 是 `agentInvoked: false, status: "completed"`。
- `deliver` 取值：`auto` 在 rpc-ui 下等同 `send`，直接作为用户消息发送；`paste` 只发 `extension_ui_request` 的 `set_editor_text`，不触发 agent；`none` 只把文本返回给插件。
- 运行中提交（agent 在跑 `sleep 25`）：`queue_update.followUp` 里出现整段反馈，约 25 秒后当前一轮结束，才作为新一轮的用户消息开始。
- `deliver: "none"` 加 `pi.sendUserMessage(text, { deliverAs: "steer" })`：约 20 ms 后在当前一轮生效，正在跑的 bash 被转入后台，命令结束后又唤醒 agent 一次。
- `file` 源按会话 cwd 解析相对路径，`../` 没有被拦截。宿主必须自己把路径限制在任务的 worktree 内。

## 没测到的

- 同一文件多条 note 时的渲染格式。
- `source: { kind: "diff" }` 和 `review: true`。
- 宿主格式化消息的做法在 agent 运行中、不带 `streamingBehavior` 时的行为（按 `rpc.md`，会被拒绝）。

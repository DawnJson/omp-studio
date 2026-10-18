# RPC 录制和回放

不调真实模型也能复现主进程和界面的各种状态：把一次真实 omp 会话录成 NDJSON，再由假 omp 按顺序回放。

|文件|作用|
|---|---|
|`scripts/record-rpc.ts`|启动真实 omp，调 `initializeSession`（和应用共用的初始化序列），按场景发 prompt，录下双向的逻辑帧|
|`test/fake-omp/fake-omp.ts`|假 omp：读一份录制，按顺序回放|
|`fixtures/rpc/*.ndjson`|录制，都是 omp 18.12.1、`deepseek/deepseek-v4-flash`，2026-10-18，增量模式（`message_update` 没有 `partial`）。见下表|

## 录制格式

每行一个 JSON 对象，按发生顺序：

|`kind`|字段|回放时|
|---|---|---|
|`meta`|`ompVersion`、`model`、`recordedAt`、`prompt`|忽略。只在第一行|
|`out`|`frame`：omp 写出的一个逻辑帧（已经过 `rpc_chunk` 重组）|写到 stdout|
|`in`|`frame`：主进程写给 omp 的帧|从 stdin 读一行，`type` 必须相同，否则以退出码 3 退出|
|`raw`|`text`|原样写一行到 stdout，用来造协议错误|
|`exit`|`code`|以这个退出码退出|
|`hang`|无|放在末尾：回放完后 stdin 关闭也不退出，用来测强制结束|
|`delay`|`ms`|回放到这里先等 `ms` 毫秒再继续（慢速回放，界面的计时、"已工作 N 秒"要靠它复现）|

没有 `exit` 或 `hang` 时，回放完等 stdin 关闭再以 0 退出，和真实 omp 一样。

## 回放时的 id

主进程每次运行生成的命令 id 不一定和录制时相同。假 omp 在 `in` 这一步记下"录制里的 id → 这次收到的 id"，之后回放的 `response` 和 `prompt_result` 把 `id` 换成这次的。所以手写的 fixture 里 id 可以随便取，只要 `in` 和对应的 `out` 一致。

## 注意

- 录制的是逻辑帧，回放时不会再切成 `rpc_chunk`。分块重组由 `test/frame-decoder.test.ts` 覆盖；真实 omp 的分块在 Electron 里实测过，见 `omp-rpc.md`"读帧"。
- 录制时 omp 用临时的 `PI_CODING_AGENT_DIR` 和临时工作目录（目录名带空格和中文）。脚本把临时目录换成 `<scratch>`，用户目录换成 `<home>`，用户名换成 `<user>`。
- 流式工具参数是一段段增长的，模型把工作目录写进参数时，路径会被拆在几帧的 `delta` 里，整段替换不到。所以脚本把所有 `delta` 按顺序拼起来，连同整份录制一起检查用户名、`.env` 里除 `STUDIO_TEST_MODEL` 以外的所有值、以及环境变量里名字带 KEY/TOKEN/SECRET/PASSWORD 的值，命中就不写文件。
- Windows 的系统临时目录在用户目录里。录制被用户名拦下时，用 `$env:STUDIO_SCRATCH_DIR` 指到用户目录以外、且不在任何 git 仓库里的目录（在仓库里 omp 会把仓库当项目，读进它的 `AGENTS.md`）。这样录制里会留下这个目录的路径碎片，比如 `bash-tool.ndjson` 里有 `E:/work/code` 的片段。
- `fake-omp` 还支持一个测试专用的 `kind: "grandchild"`：起一个 detached、不会自己退出的子进程（模拟 omp 的 bash 孙进程，见 `task-model.md` 进程树兜底），并输出 `{ "type": "test_grandchild", "pid" }`，用来测按进程树结束。
- 现在的录制用增量模式（`set_event_filter messageUpdates:"delta"`），`message_update` 不带 `partial`，一轮 bash 对话约 120 条；旧的完整快照格式主进程翻译时同样处理（去掉 `partial`）。

## 场景和现有录制

用法：`npm run rpc:record -- <名字> "<prompt>" --scenario <场景>`。除 `approval` 外都用 `--approval-mode yolo`（每次显式传，不依赖本机配置，也不会出现审批框）。

|fixture|场景|内容|
|---|---|---|
|`simple-reply`|prompt|无工具的一问一答|
|`bash-tool`|prompt|一次 bash 工具调用|
|`approval-select`|approval（`always-ask`，自动批准第一项）|bash 触发审批 select，`in extension_ui_response`；帧形状见 `dialogs.md`|
|`ask-dialog`|ask（每题取推荐项）|`method:"ask"` 单选一题|
|`turn-error`|turn-error（key 换成无效值）|`prompt_result {status:"error", error:{httpStatus:401,…}}`|
|`queue-steer`|queue-steer|第一次工具开始后连发 steer 和 followUp；`queue_update` 四次。**两个 `in prompt` 相邻**，回放时必须连续发出（`Promise.all`），否则假 omp 一直等第三条|
|`resume-history`|resume-history|只录第二个进程：`switch_session` + `get_messages_page`（先聊一轮让会话落盘，再开新进程恢复）|

## 幂等查询的宽松应答

主进程会在不固定的时刻查 `get_state`（上下文使用率，节流后）、`get_available_thinking_levels`、`get_available_models`。假 omp 对这三条：只要它不是"下一条期望的 `in`"，就按录制里**最近一次**的应答立即回（回放前先用文件里第一次出现的值垫底），不消耗录制条目。初始化序列里它们仍按顺序匹配。

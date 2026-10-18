# 对话框（extension_ui_request）

主进程侧实现：`src/main/tasks/dialogs.ts`（转换和校验）、`task-runner.ts`（pending 表）。帧的真实形状来自 omp 18.12.1 的录制：`fixtures/rpc/approval-select.ndjson`、`ask-dialog.ndjson`。

## 流程

1. omp 发 `extension_ui_request`。`select/confirm/input/editor/ask` 转成 `DialogRequest` 进任务的 `dialogs[]`（pending 表），状态变 `needs_you`，立即推 `taskState`。
2. `notify` → `TaskNotice{kind:"toast"}`；`set_editor_text` → `{kind:"editor_text"}`；`setStatus/setWidget/setTitle` 忽略（内置扩展每轮都发 `setWidget autoresearch`）。
3. `cancel {targetId}`（omp 超时或中止）→ 从 pending 表移除。之后渲染进程再答，因为已不在表里而被拒（omp 本来也会忽略未知 id）。
4. `respondDialog(taskId, dialogId, response)`：dialogId 必须在 pending 表里；`toUiResponse` 对照原始请求校验，通过才发 `extension_ui_response` 并移出表；校验失败抛 `DialogResponseError`，请求仍留在表里（用户可以重答）。

## 应答校验

| 请求 | 允许的应答 | 额外校验 |
|---|---|---|
| select | `{kind:"value"}` | 值必须是某个 `option.label` 原文 |
| confirm | `{kind:"confirm"}` | — |
| input / editor | `{kind:"value"}` | — |
| ask | `{kind:"answers"}` | 条数 = 题数，`id` 与题目按顺序对应；选项必须在题目里、不重复；单选最多一个且不能同时有自由文本；多选可空；`customInput` trim，空串忽略 |
| 任意 | `{kind:"cancel"}` | 发 `{cancelled:true}` |

## 审批

**omp 没有结构化字段区分审批和普通 select。** `--approval-mode always-ask` 下 bash 触发的实录（18.12.1）：

```json
{"type":"extension_ui_request","id":"…","method":"select","title":"Allow tool: bash\nCommand: echo omp-studio","options":["Approve","Approve bash for this session","Deny"]}
```

没有 `optionDetails`、没有 `timeout`。识别规则（`isApprovalSelect`）：`title` 以 `Allow tool: ` 开头，且 `options[0] === "Approve"`、最后一项 `=== "Deny"`；满足则 `DialogRequest.approval = true`，否则按普通 select，功能不受影响。`title` 原样给渲染进程（首行 `Allow tool: <tool>`，其余各行是 `Command:`/`Path:` 等细节，可能还有 `Reason:`/`Origin:`）。`omp` 的 `approval-mode.md` 说明三个选项是 Approve / Approve `<tool>` for this session / Deny。omp 升级后这条规则可能失效：`test/task-dialogs.test.ts` 用 fixture 里的真实帧固定它。

审批模式：studio 启动时从不传 `--approval-mode`，只看 omp 配置的 `tools.approvalMode`（omp 默认 `yolo`，不会出现审批对话框）；输入框胶囊改的就是这个配置项（`write` 时只有 exec 类工具如 bash 才会问）。

## ask

`set_ask_dialog {enabled:true}` 之后 ask 工具发 `method:"ask"`（实录：`questions:[{id,question,header,options:[{label,description}],multi,recommended}]`，无 timeout）。永远提供自由文本。超时由 omp 自己取推荐项并发 `cancel`。`set_ask_dialog` 失败（旧版）时 ask 回退成 `select` + `editor{promptStyle:true}`，两者都已支持。

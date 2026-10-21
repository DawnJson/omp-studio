# 提问、审批和一次性提示

所有任务都是 TSP（交互式 omp 跑在伪终端里，见 [tsp-migration.md](tsp-migration.md)）：omp 的提问（`ask` 工具）和工具审批都由 omp 画成节点，studio 渲染节点、把点击和按键变成 TSP 事件写回去。主进程不再有自己的"门"请求表，也没有应答校验：能不能答、答什么由 omp 判断。

## 门在哪里

- **节点**：提问是 dock 里的 `col role=omp.editor.ask`；审批是 `col role=omp.editor.ask.approval`（插在输入框卡片前面，不换掉它）。实测依据和逐帧结构见 [tsp-migration.md](tsp-migration.md) §10.1、§10.6（提问）、§10.7（审批），录制 `fixtures/tsp/{ask,ask-multi,approval}.jsonl`。
- **渲染**：`features/tsp/interactive/AskGate.tsx`（提问，含多题 / 多选 / Review 页）和审批卡（`omp.btn` 画成真 `<button>`，点 = 节点自己的 `actions.click`）；键盘由对话框根节点接，按键编码后写进伪终端（`keys.ts`）。纯函数在 `src/shared/tsp/ask-gate.ts`、`gate.ts`。
- **输入框的行为**（`shared/tsp/gate.ts` 的 `findMessageTarget`）：提问在等时输入框不能发送（placeholder 提示先回答）；审批在等时输入框里写的字 = 拒绝并说明理由，omp 把这条消息当插话交给模型（omp 18.12.5 实测，[tsp-real-omp-probes.md](tsp-real-omp-probes.md) §14）；Ctrl+Enter 批准，Ctrl+O 看详情，Esc 拒绝。

## 任务状态里的"门"

主进程从文档推导任务状态（`shared/tsp/task-status.ts`）：dock 里有 role 以 `omp.editor.ask` 开头的节点 = `needs_you`。`TspRunner` 据此给 `TaskState.dialogs` 放一个**合成**的 `DialogRequest`（`kind: "confirm"`，id 固定为 `tsp-ask` 或 `tsp-approval`，`title` 取问题 / 审批标题，`receivedAt` 是收到的时间），门消失时移除。它不显示成对话框，只为让 `needs_you` 的任务有内容可写：

- 侧栏的"等你确认"点、托盘提示；
- `GateNotifier`（`src/main/tasks/gate-notifier.ts`）的系统通知：任务进入 `needs_you`、窗口没有焦点、设置里开着时发一条，正文是 `dialogSummary`（标题第一行，如 `Allow tool: bash`）；同一次等待只通知一次；窗口隐藏在托盘或最小化时，任务跑完 / 出错也发一条；点击通知聚焦窗口并选中任务。

状态机见 [task-model.md](task-model.md)：有 `dialogs` 一定是 `needs_you`，`dialog_close` 清空后按 `working` 回到 `running` / `idle`。

## 一次性提示（`NoticeLayer`）

`src/renderer/src/features/dialogs/`：

- **toast**：主区面板上沿正中的气泡，5 秒，同类合并；`pushToast` 是各功能共用的入口。
- **`TaskNotice`**（主进程 → 渲染进程，不进对话）现在只有一种 `goal_complete`：目标完成（目标条消失且会话文件里最后一条目标记录是 complete）时弹一条 info toast。
- **别的任务进入"等你确认"**：渲染进程比较任务状态，当前任务之外的任务从别的状态进入 `needs_you` 时弹一条 warning toast（8 秒，带"查看"按钮选中该任务）。

omp 自己的 toast（`omp.toast.status`，如 "Session-only model: …"）不弹层，而是作为对话里的一行暗字留下（[tsp-migration.md](tsp-migration.md) §10.1 "状态行"）。

## 审批模式

omp 的 `tools.approvalMode`（`always-ask` / `always-ask-cached` / `write` / `yolo`，默认 `yolo` 不出现审批）由输入框的审批胶囊读写，写的是 omp 的全局配置；项目 `.omp/config.yml` 盖过全局时胶囊只读。详见 [omp-settings.md](omp-settings.md)「审批模式」。studio 启动 omp 时从不传 `--approval-mode`。

审批的识别靠节点 role `omp.editor.ask.approval`（`deriveTaskStatus().ask.approval`）。role 是 omp 自己的命名，不在 TSP 规范里：omp 改名这条规则就失效，所以判断集中在 `shared/tsp/`，由 `test/tsp-task-status.test.ts`、`test/tsp-gate.test.ts` 用录制的帧固定。

## 测试

`test/tsp-task-status.test.ts`、`test/tsp-gate.test.ts`、`test/tsp-ask-gate.test.ts`（纯函数，逐帧重放录制）、`test/task-gate-notifier.test.ts`（通知规则）、`test/task-machine.test.ts`、`test/task-tsp.test.ts`（合成的 `dialogs`）；e2e `test/e2e/tsp.e2e.ts` 的"审批"、"提问"、"多题提问"。

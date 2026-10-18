# 会话历史：只读索引与恢复

范围：侧栏/命令面板里的"历史会话"（含终端里建的会话）和"恢复会话"。代码：`src/main/history/`、`src/main/ipc/history-handlers.ts`。
omp 版本：文档依据 omp 18.12.0 随附的 `session.md`、`session-switching-and-recent-listing.md`；本机用真实 `~/.omp` 目录只读核对过文件头形状（标题槽 + 会话头 + 条目）。**没有跑过恢复会话的真实 omp 进程**（恢复由任务运行时 `TaskPool.resume()` 完成，见 task-model.md）。

## 为什么读文件

omp 没有"列出会话"的 RPC（wire 命令表里只有针对当前会话的 `get_messages*`）。omp 自己的文档给出存储格式，我们**只读**它：从不写 `~/.omp`（AGENTS.md "omp 的边界"）。格式不是协议契约，升级后可能变，所以：

- 只解析文件前缀（标题槽、会话头、第一条用户消息），不解析正文；
- 解析不了的文件计数跳过（`SessionScan.skipped`），不报错，其余会话照常列出；
- 恢复本身走 RPC（`switch_session`），不受格式变化影响。

## 目录和格式

```
<agentDir>/sessions/<编码后的 cwd>/<时间戳>_<sessionId>.jsonl
```

- `agentDir`：`PI_CODING_AGENT_DIR`（非空时）；否则 `<home>/<PI_CONFIG_DIR 或 .omp>/agent`（`resolveAgentDir`）。测试和 e2e 用前者指向临时目录。
- **不自己算 `<编码后的 cwd>`**：只枚举每个桶目录里的顶层 `*.jsonl`（桶里同名的目录是 omp 的附属数据，忽略），项目归属一律读会话头里的 `cwd`。
- 文件开头是 256 字节定宽的 `{"type":"title",...,"pad":"   "}` 标题槽（含 `title`），随后一行 `{"type":"session","id","cwd","timestamp",...,"title"?}`；旧版文件没有标题槽。
- 用户消息条目：`{"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`，`content` 也可能是字符串。

## 索引（`SessionIndex`）

| 项 | 规则 |
|---|---|
| 读多少 | 前 32 KiB；没有标题、前缀里也没有用户消息（首条消息很长，比如带图片）时放宽到 512 KiB。截断的最后一行丢弃，不当成损坏 |
| 标题 | 标题槽的 `title` > 头里的 `title` > 无。取第一个非空行、去控制字符、折叠空白、最长 200 字符（加 `…`）。显示名回退到第一条用户消息首行，再回退到 `history.untitled` |
| 缓存 | 按 `(路径, mtime, size)`；没变的文件不重读；消失的文件从缓存清除 |
| 并发 | 最多 16 个文件同时读 |
| 排序 | 按 mtime 从新到旧 |
| 跳过 | 头缺 `id`/`cwd`、头之前有垃圾行、空文件、不是 JSON：计入 `skipped`。读取时被占用/无权限（`EBUSY/EPERM/EACCES`）本次计入 skipped 但不缓存，下次重试；文件扫描中被删（`ENOENT`）静默忽略 |
| 空壳 | 既没标题也没有用户消息的会话不出现在 `listSessions` 里（和 omp 自己的会话选择器一致） |
| 路径比较 | `pathKey`：`path.resolve`，Windows 上再转小写（盘符/大小写/斜杠方向不影响匹配） |

## IPC

| 函数 | 行为 |
|---|---|
| `listSessions(projectId \| null)` | 扫描 → `buildSessionSummaries`：`projectId` 由 cwd 对上任务池的项目（对不上为 null）；`taskId` 由会话文件对上任务池的 `listSessionLinks()`。传了项目 id 就只留 cwd 相同的；项目不存在返回空 |
| `resumeSession(sessionId)` | 按头里的 `id` 重新扫描找文件 → 检查 `cwd` 目录仍存在（不在就报错，不替用户迁移会话）→ `ensureProject(cwd)` 自动加入项目 → `TaskPool.resume({sessionFile, cwd, projectId, title})`。已有任务挂着这个文件时返回那个任务 |
| `revealProject / revealTaskSession` | `shell.showItemInFolder`，路径由主进程按 id 查表，渲染进程不传路径 |
| `getTaskSessionRef` | 任务的会话 id 和文件路径（复制用）；还没有会话文件返回 null |

后三个是对 `ipc.ts` 的追加（切片 D）。

## 已知限制 / 风险

- 终端正在使用同一个会话时恢复，omp 会分叉成兄弟文件并发 `notice`（arch 1.6）；索引无法提前判断。
- 同一 `id` 出现在多个文件时（例如整理中的备份），`findById` 取最新的。
- 列表依赖 mtime：omp 写会话文件时才更新，所以"最近"排序近似为"最近有写入"。
- 大目录（数千个会话）首次扫描要 stat + 读前缀每个文件；之后走缓存。没有做增量监听（打开命令面板时重新扫一次）。
- 标题槽之外的标题变更条目（`title_change`）不解析，标题以槽里的当前值为准。

## 测试

`test/session-index.test.ts`：路径含空格和中文的临时目录；标题槽/旧格式/字符串内容；截断前缀；损坏、空、非会话文件计数；超长首条消息；缓存失效和删除；Windows 路径大小写；`resolveAgentDir`。`test/sidebar-model.test.ts`：分组排序、重名项目标签、等你确认跳转、状态点形状、模糊匹配、面板分组。
`test/e2e/sidebar.e2e.ts`：侧栏键盘（方向键、F2、Delete、←/→）、归档撤销、命令面板，截图写到 `screenshots/sidebar-*.png`、`palette-*.png`。

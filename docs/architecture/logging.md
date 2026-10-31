# 主进程日志和诊断信息

代码：`src/main/log/`。规则来源：[security.md](security.md)「日志和脱敏」。

## 日志

- **位置**：`<userData>\logs\main-<本地日期>.log`，一天一个文件，保留 14 天（`RETAIN_DAYS`）。每天第一次写时删掉更早的文件。测试和 e2e 用 `STUDIO_USER_DATA` 换掉 userData，日志跟着进临时目录。
- **写法**：`import { log } from "../log/log.ts"`，`log.info / warn / error(message, ...details)`，参数按 `util.format` 拼成一行（`Error` 带堆栈）。同步追加写（量很小，崩溃前的最后几行不会丢）。写失败只打到控制台，不影响应用。
- **没接上文件时**（单元测试、`initLog()` 之前）`log` 只打到控制台，所以 `log.ts` 不 import electron，被测模块可以直接用。开发时（未打包）同时打到控制台。
- **记什么**：启动（版本、Electron、系统）；IPC 调用失败（`register.ts` 统一记，错误照常传回界面）；任务启动失败和 omp 意外退出（带 stderr 末几行）；omp 后台更新失败、补丁退回全量；渲染进程和子进程意外退出；未处理的 Promise 拒绝；应用自身更新的进度。
- **不记什么**：模型请求和响应正文、对话内容。

## 脱敏（`createRedactor`）

每一行写入前处理：

|内容|换成|
|---|---|
|家目录（不分大小写；`\`、`/`、JSON 转义的 `\\` 三种写法）|`~`|
|其余地方的用户名（3 个字符以上，前后不是字母数字）|`<user>`|
|URL 的查询参数（构建服务的下载直链带签名）|`?<redacted>`|
|`Bearer` / `Basic` 后面的凭据、`sk-…`|`<redacted>`|
|名字里有 `api_key`、`token`、`secret`、`password`、`authorization` 的键值|值换成 `<redacted>`|

## 诊断信息

设置 → 关于 → 问题排查 → "导出…"：保存对话框（默认桌面 `omp-studio-diagnostics-<日期>.txt`），写一个文本文件后在资源管理器里选中它。内容：版本、运行时、系统、omp 状态（`OmpStatus`）、omp-studio 设置、最近 3 天日志（每个最多末尾 1 MB）。整份内容再过一遍脱敏。不压缩，免得新增依赖，用户也能直接看到里面有什么。

## 坑

- **Node 24.13 的 `fs.rmSync` 在 Windows 上遇到非 ASCII 路径时静默不删**（不报错，文件还在；`fs.promises.rm` 和 `unlinkSync` 正常）。2026-10-18 在开发机实测。清理旧日志用 `unlinkSync`；仓库里别的地方用的是异步 `rm`，不受影响。

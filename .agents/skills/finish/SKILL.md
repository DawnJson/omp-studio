---
name: finish
description: 一轮改动做完、检查通过之后的收尾：写 CHANGELOG「未发布」、核对提交身份、提交到 main、推送、清理临时文件和进程、写完成说明。用户说"收尾""提交""做完了""finish"，或改动已经验证完、准备交付时用。
---

# 收尾

前提：`npm run check` 通过，相关单测、e2e 跑过（见 `docs/architecture/testing.md`）。按顺序做完再报告。

## 1. CHANGELOG

- 用户能看到的改动记进 `CHANGELOG.md` 的 `## [未发布]` 下，按 `### 新增` / `### 修复` / `### 变更` 分组；每条一句话，说用户能看到的变化，不写内部实现。写法以文件开头的说明为准。
- 只改了测试、文档、开发脚本、agent 配置（安装包内容不变）时不记。
- 不写第三方客户端或插件的名字，只说用户得到的能力（名单在 `.githooks/no-mention.local.txt`）。
- 换行跟文件现有的一致（现在是 LF）；发版脚本 CRLF 也认，但混用会让 diff 整片变化。

## 2. 提交

1. 确认 hook 已启用：`git config core.hooksPath` 应该是 `.githooks`（`npm install` 时 `scripts/postinstall.ts` 设好；不是就 `git config core.hooksPath .githooks`）。`git config user.email` 必须是仓库级的 noreply 地址 `165480087+DawnJson@users.noreply.github.com`，不是全局配置里的私人邮箱（pre-commit 也会拦）。
2. 提交到 `main`：在分支上做的先合并回 `main`，合并后删掉分支。不用 `git worktree`，不丢掉没提交的改动；多个代理共用工作区时不跑 `checkout` / `restore` / `stash` / `reset` / `clean`。
3. 只 `git add` 这次改的文件，不用 `git add -A` 把别人的改动带进来。
4. 提交信息 `类型: 中文说明`，类型是 `feat` / `fix` / `test` / `chore`；说明写用户能理解的结果。不写私人信息和第三方客户端名（commit-msg hook 查）。
5. `git show --stat HEAD` 确认只有这次改的文件。hook 失败就修好问题再提交，不用 `--no-verify`。

## 3. 推送

- `git push origin main`。不 `--force`，不改写已推送的历史（要做先问仓库所有者）。
- 推送后看一眼这次 push 触发的 CI（`.github/workflows/`，三个平台都跑 `npm run check`、单测和打包冒烟）：`env -u GITHUB_TOKEN gh run list --limit 3`。
- 不发版。只有仓库所有者说"发版"时才用 skill `release`。

## 4. 清理

- 临时脚本、临时目录、临时截图、探针用完就删（截图放系统临时目录，不放仓库）。
- 测试残留：父进程已不在的 `electron.exe`（命令行带 `playwright-core\lib\server\electron\loader.js`）及其下的 `omp.exe`，临时目录里的 `omp-studio-e2e-*`、`omp-studio-agent-*`、`omp-studio 代理 agent-*`；探针在 `~/.omp/agent/sessions/` 里新建的 `-tmp-` 会话目录。有残留先查原因再清理。
- 只结束自己起的进程。装好的 omp-studio、所有者在用的 Tern 不碰。
- 常驻 shell 里如果改过 `HOME` / `PI_CODING_AGENT_DIR`，`echo` 确认回到了真实值。

## 5. 犯错的记录

这一轮里返工过、或者查了半天才找到原因的问题：先想能不能变成 lint 规则、测试、`scripts/check.ts` 的扫描或 hook；做不到时，omp 的实测行为写进对应的 `docs/architecture/<功能>.md`，通用的做法在 `AGENTS.md` 对应小节加一行（正确做法 + 来由）。

## 6. 完成说明

写清楚：

- 改了什么（文件和用户能看到的变化）；
- 跑过哪些命令和操作、结果是什么（贴关键输出），哪些没试、为什么；
- 回归测试有没有撤掉修复确认会失败；
- 提交号和是否已推送；CI 结果（还在跑就说还在跑）；
- 留下的问题、需要仓库所有者决定的事。

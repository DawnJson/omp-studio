# 评审、worktree 与 git（主进程）

阶段 3（评审）和阶段 4（worktree 与 git 操作）的主进程部分，代码在 `src/main/git/`，IPC 在 `src/main/ipc/git-handlers.ts`，类型和纯函数在 `src/shared/git.ts`。没有界面代码。

实测版本：git 2.52.0.windows.1，gh 2.102.0（只测了 PATH 上没有 gh 的分支）。日期 2026-10-18。

## 总体决定

- **不经 shell**：`spawn("git", [...])`，参数数组；全局加 `-c core.quotepath=off --literal-pathspecs`。路径里的 `[ ]`、中文、空格都按字面处理（测试覆盖）。环境变量加 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=never`、`GIT_EDITOR=true`、`LC_ALL=C`（stderr 恒为英文，识别 push 被拒不受界面语言影响）。
- **提交信息、PR 正文走 stdin**（`commit -F -`、`gh --body-file -`），不放命令行。
- **不是仓库、没有 git、没有 gh 是类型化结果**，不抛错：`GitStatus.kind = "git_missing" | "not_git"`，`GitPullRequestResult.kind = "gh_unavailable"`。
- 评审操作的"仓库根"是任务 cwd 所在的仓库根（`rev-parse --show-toplevel`），路径都是相对它的；有 worktree 的任务 cwd 就是 worktree。子目录项目的评审路径因此相对仓库根而不是 cwd。
- 渲染进程只传相对路径：`checkRepoPath` 做词法校验（不能绝对、不能越界、不能进 `.git`）。丢弃/读取未跟踪文件还要求路径真的在 `git status` 的未跟踪列表里；没有改动的路径不能被 discard。
- 日志走 `log`（自带脱敏），只记结果类型，不记路径和提交信息。

## 评审（阶段 3）

- 状态：`git status --porcelain=v2 -z --branch --untracked-files=all`。每个路径一条 `GitFileChange`，暂存区和工作区各一个 `GitChangeKind`。未跟踪目录展开成文件。冲突文件两侧都是 `conflicted`。
- diff：`git diff [--cached] -U3 --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/`（后两项让用户的 `diff.noprefix` 之类设置不会破坏补丁头）。解析成 `GitDiffHunk[]`，每行带 `oldNo/newNo`；`\ No newline` 记成 `noEol`。`toSideBySide(hunk)` 把删除块和新增块逐行配对给并排视图。
- **diff 的上下文范围**（2026-10-21）：`getGitFileDiff(taskId, path, area, context)` 的 `context` 是 `"hunks"`（`-U3`，每处改动一个 hunk，评审默认）或 `"file"`（`-U1000000`，所有改动连成一个覆盖整个文件的 hunk，评审的“文件”视图）。hunk 级暂存 / 取消暂存 / 丢弃只认 `-U3`：`loadHunkPatch` 重新取 diff 时不传 context，header 对不上 `file` 视图里的 hunk，所以界面在文件视图里不给 hunk 级操作。输出超过 `GIT_DIFF_MAX_BYTES` 照旧是 `too_large`（整文件上下文更容易超）。未跟踪文件的 diff 本来就是整文件，不受 context 影响。
- **每个文件的 `+a −d`**（2026-10-21，`src/main/git/numstat.ts`，IPC `getGitChangeStats(taskId)` → `GitChangeStat[] = {area, path, added, removed}`）：评审文件树每行要显示行数，逐个取 diff 要起 N 个 git 进程，所以一次取全部：`git diff --cached -M --numstat -z`（已暂存，重命名取新路径）和 `git diff --no-renames --numstat -z`（未暂存），未跟踪文件在主进程里直接数行（`countLines`，和 `diffOfNewFile` 同一个分法：末尾换行不多算一行；符号链接数链接指向的文字；二进制、超过 `GIT_DIFF_MAX_BYTES`、读之前被删了的文件没有这一项；每 32 个并发读一批）。二进制（numstat 的 `-\t-`）和冲突文件同样没有这一项。每次评审状态重取时一起重取。数字和同一文件同一侧的 `getFileDiff` 的 `added / removed` 一致（`test/git-numstat.test.ts` 对照）。
- 二进制（git 输出 "Binary files … differ"，或未跟踪文件前 8000 字节有 NUL）→ `binary`；diff 输出或未跟踪文件超过 2 MiB（`GIT_DIFF_MAX_BYTES`）→ `too_large`，不解析。未跟踪文件的 diff 由主进程自己合成（整个文件一个新增 hunk）；符号链接不跟随，显示链接指向的文字。
- 内容不一定是 UTF-8：diff 先按 latin1 切（字节与字符一一对应），拼补丁时还原成字节，只有给界面的 `text` 才按 UTF-8 解码。
- hunk 级操作：重新取一次 diff，核对第 `index` 个 hunk 的 `@@` 行与界面传来的 `header` 一致（不一致 = 文件已变，拒绝），再用原 header + 该 hunk 做补丁：暂存 `apply --cached`，取消暂存 `apply --cached -R`，丢弃 `apply -R`（工作区）。丢弃 hunk 只针对"未暂存"侧，已暂存的先取消暂存。未跟踪文件没有 hunk，只能整文件暂存。
- 文件级：暂存 `add --`；取消暂存 `restore --staged`（无 HEAD 时 `rm --cached`）；丢弃 = 退回 HEAD（暂存的和没暂存的一起）：未跟踪删除、暂存的新文件 `rm -f`、重命名同时恢复原路径。**丢弃不问确认**，确认由界面做。
- 评论：`formatReviewComments(comments, locale)` 是纯函数，输出一条用户消息（`文件:行范围`，单行评论不写范围，旧版本侧加注）。IPC `sendReviewComments` 校验路径落在仓库内（review-comments.md：`../` 不会被 omp 拦截），再按用户语言格式化并作为 prompt 发出。

## Worktree（阶段 4）

- **继承 omp**：worktree 由 `omp worktree add -C <仓库> -b studio/<slug> -q <目录> HEAD` 创建（omp 路径用 omp-manager 当前就绪的那份；e2e 里任务进程是假 omp，用未打包时才认的 `STUDIO_TEST_WORKTREE_OMP` 指向真 omp）。
  - **目录**：`add` 必须给 PATH，omp 自己不选目录；但 `omp worktree list/clear` 只认 omp 的 worktree 目录下的东西，所以我们把目录放进去：解析顺序和 omp 的 `getWorktreesDir` 一致——环境变量 `OMP_WORKTREE_DIR`（绝对或 `~` 开头）→ 设置 `worktree.base`（`omp config get worktree.base --json`）→ `~/.omp/wt`。目录名 `<slug>-<仓库路径哈希前 7 位>`（和 omp 给 PR worktree 起名 `<编号>-<仓库哈希>` 同一风格，不同仓库不会撞名）。
  - **分支**：仍是 `studio/<slug>`（omp 的 `add` 不替你起名；`studio/` 前缀让合并、丢弃、清理能认出哪些是我们建的）。
  - **旧数据**：已有 `.omp-studio-worktrees` 下的 worktree 不迁移，tasks.json 里存的是绝对路径，照常可用；合并、丢弃、清理都不依赖位置。
  - **clone-first**：`worktree.clone` 默认 true，omp 会先尝试写时复制克隆（带上 node_modules 等被忽略的构建产物），文件系统不支持时退回普通检出并在 stderr 警告、退出码 0。实测在 Windows NTFS 上总是退回（`Windows block clone unsupported … os error 1`）；我们不改这个设置，omp 的行为就是 omp 的行为。
  - **哪些走 omp、哪些走 git（omp 没有接口）**：创建走 omp。单个删除没有接口（`omp worktree clear` 按目录整体清，不带 `--all` 只清"不活跃的"，`--all` 清目录下全部，跨仓库、不会删分支），所以删除、合并回基分支（omp 没有 merge）、无主清理、状态/diff、提交/推送都走 git；PR 走 gh。
  - 实测（omp 18.12.1，临时 `PI_CODING_AGENT_DIR` 且 `USERPROFILE`/`HOME` 指向临时目录）：不给 PATH 报 `Missing required argument: path`；`-b` 新建分支；`add` 的 `--json` 没有输出；`list --json` 输出 `[{path, kind: "pr-checkout", parentRepo, branch}]`，只含 omp 目录下的；默认目录取决于 `~`，不受 `PI_CODING_AGENT_DIR` 影响。
- **前提**：项目目录必须正好是仓库根（任务 cwd = worktree 根，子目录项目对应不上）、已有提交、不在 detached HEAD；否则创建被拒绝，不留任务记录。创建时所在分支存为 `worktreeBase`，之后合并回它。
- **TaskRecord**：`worktreePath`（早就预留）+ 新增 `worktreeBranch`、`worktreeBase`。读老的 tasks.json 时缺字段补 `null`，已有任务不受影响。`CreateTaskInput.worktree?: boolean`；`TaskRunner.cwd` 和 omp 启动的 cwd 都取 `worktreePath ?? project.path`。
- **setup 脚本**：主仓库 `.omp-studio/setup.ps1`（Windows，优先）、`.omp-studio/setup.cmd`（Windows）、`.omp-studio/setup.sh`（其他系统），取第一个存在的，在新 worktree 里运行，环境变量 `OMP_STUDIO_PROJECT_DIR`、`OMP_STUDIO_WORKTREE_DIR`，超时 10 分钟。读的是主仓库里的那份（可以没提交）。**失败则整个创建回滚**（移除 worktree 和分支，错误里带输出末尾 2000 字符）：在没装好依赖的目录里让 agent 干活只会产生误导性的失败。脚本是仓库里的可执行内容，所以只在用户明确选了 worktree 时运行；`getWorktreeSetupScript(projectId)` 让界面事先提示"会运行 xxx"。
- **合并**：在主仓库里 `git merge --no-edit <分支>`（能快进就快进）。拒绝（`blocked`）的情况：主仓库不在基分支、worktree 有任何未提交内容、主仓库有未提交的已跟踪改动。没有新提交 → `nothing_to_merge`。**冲突不自动解决**：`merge --abort` 退回合并前，返回冲突文件列表。合并不删除 worktree。
- **丢弃**（`TaskPool.discardWorktree`）：先关任务进程（Windows 上进程占着目录删不掉），`worktree remove --force` + `rm`（EBUSY 等重试）+ `prune` + `branch -D`，清空记录里的 worktree 字段，再归档任务（侧栏移除）。斜杠菜单在这个 worktree（或它的子目录）里起过的项目 rpc-ui（`ProjectOmpPool`，cwd 就在 worktree 里）也在删之前关掉（`tasks/runtime.ts` 的 `worktreeOps.remove` 调 `projectOmp.closeUnder`）。移除前必须是 git 登记在这个仓库名下、检出的正是任务分支的 worktree，分支必须是 `studio/` 前缀（位置不再固定，所以按登记认，不按路径认）。含未提交和未合并的内容，界面必须先确认。归档任务本身不删 worktree。
- **清理无主 worktree**：先 `worktree prune`；再看 git 登记的、分支是 `studio/` 前缀、没有任何任务记录（含已归档）引用的 worktree（不管在 omp 的目录还是旧位置）：干净且分支已合入 HEAD 的删除；有未提交改动（`dirty`）、有未合并提交（`unmerged`）的保留并报告。不是 `studio/` 分支的 worktree 不是我们的，不碰。不用 `omp worktree clear`：它按目录整体清，`--all` 会清掉别的仓库、别的工具建的。
- **worktree 被删除的任务**：启动前检查 `worktreePath` 是否还在，不在就拒绝启动，状态是 `error`、`TaskError.kind = "worktree_missing"`（不占进程名额，也不退回项目目录）。和 omp 一致：只能查看记录（对话流照常显示），不能继续聊；界面显示一行说明、隐藏"重新连接"、输入框禁用。
- 已知局限：归档的 worktree 任务被恢复时（`resume`）会按 `worktreePath` 启动；丢弃后再恢复同一任务则回到项目目录，而它的会话文件里记的 cwd 是已删除的 worktree。恢复的 UI 需要决定怎么处理，这里没有改 `resume`。

## 提交、推送、PR

- `commitGit(taskId, message, stageAll, amend)`：stageAll 时先 `add -A`；没有已暂存内容 → `nothing_to_commit`（amend 时不要求，见下）；有未解决冲突或 git 拒绝（钩子失败、没配 user.name/email）→ `failed` + git 原话。
- `pushGit`：当前分支；已有 upstream 就照它的 remote，否则只有一个 remote 用它、有 `origin` 用 `origin`，再没有 → `no_remote`（选择规则在 `repo.ts` 的 `pushRemote`，`push` 和状态共用）。首次推送带 `--set-upstream`。显式写 `push <remote> <branch>`，**没有任何 force 参数**。远端领先 → `rejected`；detached → `detached_head`。凭据不弹交互（`GIT_TERMINAL_PROMPT=0`），拿不到凭据时是 `failed`。`getGitStatus` 的 ok 结果带 `canPush`（非 detached 且 `pushRemote` 选得出 remote），界面据此禁用推送项，所以正常情况下点不到 `no_remote` / `detached_head`。
- `createPullRequest(taskId, {title, body})`：`gh pr create --title … --body-file - --head <当前分支> [--base <worktreeBase>]`。gh 不在 PATH → `gh_unavailable`；未登录 → `gh_unauthenticated`；其他 → `failed`。**不会替用户先 push**，调用方先 `pushGit`。

## 生成提交信息、Amend、按行操作、忽略空白（2026-10-23）

实测 omp 18.12.6（`omp commit`，真实 DeepSeek V4 Flash，隔离的 `PI_CODING_AGENT_DIR`、临时仓库）。

### omp `git` 应用和 `omp commit`，为什么 studio 保留自己的界面

- `omp git [REVISION] [-C <dir>]`：全屏的终端界面（并排 diff、暂存侧栏、提交输入），没有机器可读的输出或协议，只能在终端里交互。studio 的评审要嵌进窗口、和任务里的评论队列 / 发给 agent 连着、行号和评论位置要自己掌握，没法把它当后端用；所以评审、暂存、提交仍是 studio 自己的界面，下面几项只补它缺的功能。
- `omp commit [--push] [--dry-run] [--no-changelog] [--legacy] [-c <ctx>] [-m <model>]`：非交互的命令行，会让 omp 的 commit 智能体（`git_overview` / `git_file_diff` / `propose_commit` 等工具）读已暂存的 diff，生成 conventional commit 信息。**生成提交信息**用它；提交、推送、PR 仍走 studio 自己的 `git` / `gh`（见上面），不用 `omp commit` 的提交能力（它的拆分提交要在终端里确认，`--push` 也不是 studio 的推送规则）。

### 生成提交信息（`src/main/git/commit-message.ts`，IPC `generateCommitMessage` / `cancelCommitMessage`）

实测结论（决定了实现）：

- `omp commit --dry-run --no-changelog` 的 stdout 是进度行（`● Resolving model...`、工具调用、带 ANSI 色的 `Proposed commit:` 预览），最后一段是 `\nGenerated commit message:\n<标题>\n\n- 说明…\n`。**可以解析**：取最后一个 `Generated commit message:` 之后的内容，`splitCommitMessage` 拆成标题和正文（omp 的正文是 `- ` 开头的要点）。智能体建议拆成多个提交时是 `Split commit plan (dry run):` + `Commit N:` / `Changes: …` 块，取第一个提交的信息并把个数告诉界面（toast 提示，不会真去拆）。解析在 `parseOmpCommitOutput`，单测里有一份真实输出样本。
- **模型**：不传 `-m`。omp 自己按 `commit` 角色选，没有就退到 `smol`（源码 `commit/model-selection.ts`：`jA(["commit", "smol", ...])`）；没有可用模型 / key 时 stderr `error: No model available for commit generation`、退出码 1 → 界面提示去设置里给 commit 角色选模型。内置账号插件的模型（`qoder-cn/…`、`workbuddy/…`）也能用：插件在 omp 的扩展目录里，`omp commit` 自己会加载（`client-accounts.md`，0.4.28 起；之前靠 `-e`，`omp commit` 不认）。
- **只看已暂存的改动，不提交、不改文件**：`--dry-run` 只打印。`--no-changelog` 让它不去找 / 写 CHANGELOG。验证：运行前后 `git status --porcelain`、HEAD 一致。
- **坑 1：一个都没暂存时它会自己 `git add` 全部（含未跟踪文件），dry-run 也一样**（实测：`M a.txt` + `?? "b c.txt"` → 运行后变成 `M  a.txt` + `A  "b c.txt"`，输出第一行 `No staged changes detected, staging all changes...`）。所以主进程在没有已暂存内容时**根本不运行它**（`nothing_staged`），界面上按钮也在 `stagedCount === 0` 时灰掉。
- **坑 2：它会在 omp 的会话目录里留一个会话文件**（实测 18.12.6：`<agentDir>/sessions/<cwd 编码>/<时间戳>_<id>.jsonl`，第一条消息以 `Propose conventional commit for staged changes.` 开头，头里的 `cwd` 是仓库；源码 `sdk.ts` 没传 sessionManager 时就持久化创建会话，终端里跑 `omp commit` 也一样）。**studio 不删它**：`~/.omp` 和终端版共用，修改只经 omp 自己的命令，删 omp 的会话文件属于修改（AGENTS.md）。所以每次"生成"会在该任务 cwd 的会话目录里多一个会话，历史里可能看到它，和终端版一致。
- 智能体出错时 omp 回退到确定性的信息（只看 numstat，如 `chore: update a.txt`），**退出码 1** 但 stdout 里仍有 `Generated commit message:`。我们把非 0 退出一律当失败（toast 带 stderr 里的 `Agent error: …`），不把一个"没经过模型"的占位信息填给用户。
- 实现：`spawn` 参数数组（`commit --dry-run --no-changelog`），不经 shell，cwd = 仓库根，环境 = 进程环境 + 存的 API key（和任务进程同一份）+ 自管 omp 的 PATH 前置；超时 3 分钟；`AbortSignal`（`runCommand` 新增 `signal`，结束整个进程树）。每个任务同时只有一次（`generating` 表按 taskId 存 `AbortController`），`cancelCommitMessage` 取消它。耗时：真实模型约 8–10 秒。
- 未打包时 `STUDIO_TEST_COMMIT_OMP`（JSON `{command, args}`）顶替真实 omp，e2e 用它指向假 `omp commit`。

### Amend（`commitGit(taskId, message, stageAll, amend)`，`getLastCommit`）

- `commit(cwd, message, stageAll, amend)`：`amend` 时 `git commit --amend -F -`（信息走 stdin）。**不要求有暂存内容**（只改信息也行），暂存的改动并入 HEAD；没有任何提交时返回 `failed`。有冲突仍然 `failed`。
- `lastCommit(cwd)` → `{ commit, message（%B 去掉末尾空白）, pushed }`；`pushed` = `git rev-list -n1 HEAD --not --remotes` 没有输出（HEAD 已在某个远端分支里）。没有提交为 null。
- **已推送的提交**：主进程不拦（用户有权改自己的历史），界面在提交框里警告并在提交前要求确认（`ConfirmDialog` danger）；studio 仍然**没有任何 force 参数**，所以改写后再推送会被远端拒绝（`rejected`），用户得自己处理。这和"不改写已推送历史"的原则一致：改写必须是用户明确确认的动作，不是默认行为。

### 忽略空白（`getGitFileDiff(taskId, path, area, context, ignoreWhitespace)`）

- 开关打开时 diff 多一个 `-w`（`readTrackedDiff` 的 `ignoreWhitespace`），只影响显示。hunk 级和行级操作（`loadRawHunk`）**永远用不带 `-w` 的 diff** 对账，所以界面上忽略空白看到的块，和能 `git apply` 的块不是一回事：界面在这个模式下**禁用**按块 / 按行的暂存、取消暂存、丢弃并说明原因；整文件操作不受影响（暂存的是完整改动，含空白）。没有试图把 `-w` 的 hunk 翻译成可应用的补丁：被忽略的空白行恰好夹在选中行之间时补丁对不上，宁可明确禁用。
- 未跟踪文件的 diff 是主进程合成的整文件新增，没有"空白改动"，不受影响。

### 按行暂存 / 取消暂存 / 丢弃（`stageGitLines` / `unstageGitLines` / `discardGitLines`，`GitLinesRef = GitHunkRef + lines[]`）

- `lines` 是 `GitDiffHunk.lines`（不含 `\ No newline` 行）里的下标，只能是新增 / 删除行。主进程重新取 `-U3` diff、核对 header（和 hunk 级一样，不一致就拒绝），再用 `diff.ts` 的 `buildLinePatch` 生成只含选中行的补丁，走和 hunk 级同样的 `git apply` 命令：暂存 `apply --cached`（工作区 diff，`forward`）、取消暂存 `apply --cached -R`（暂存区 diff，`reverse`）、丢弃 `apply -R`（工作区 diff，`reverse`）。
- 构造规则（同 `git add -p` 的 e 编辑）：`forward` 时没选中的**删除行**变成上下文（索引里还有它）、没选中的**新增行**丢掉；`reverse` 时没选中的**新增行**变成上下文（现状里有它）、没选中的**删除行**丢掉。hunk 头重算两侧行数：没动的那一侧（forward 是旧侧、reverse 是新侧）起始行不变，另一侧从同一行起，行数为 0 的一侧起始行写成前一行（git 的约定）；`@@` 后的区段名保留。
- **成对交错**：git 把一处改动写成"一串删除、再一串新增"。原样按上面的规则丢 / 转上下文，只挑"第 4 行的删除 + 第 4 行的新增"时，新行会落在这串里没选中的旧行（变成上下文）后面，索引里的行顺序被打乱（e2e 实测：连着改 3、4、5 行只暂存第 4 行，索引变成 3、5、4(新)）。所以一处改动里第 i 个删除和第 i 个新增交错写出（`- D_i` 或上下文，然后 `+ A_i`），补丁仍合法（删除 / 上下文行的顺序就是旧文件的顺序），新行留在旧行的位置；丢弃同理，旧行回到原位置。测试：`test/git-lines.test.ts`"连着改 3 行只挑中间那对"。
- 行内容原样保留：整个补丁按 latin1 切 / 拼，所以 CRLF 的 `\r`、非 UTF-8 字节都不变（测试：CRLF 文件暂存后 blob 里仍是 `\r\n`）。
- **末尾无换行**：`\ No newline at end of file` 跟着它说的那一行走（行被丢掉，标记也丢掉）。如果选中的子集会让某一侧"没有换行的那一行"后面还有同侧的行（例如只暂存 `-two⏎\ No newline` 对应的 `+two changed` 而旧行变成上下文），拼不出合法的文件，`buildLinePatch` 抛错（"cannot be applied on their own because of the missing newline"），界面 toast 报错，什么都不改。选中整处改动（删除 + 新增一起）没问题。
- 不适用：未跟踪文件（没有 hunk）、`文件` 视图（hunk 对账只认 `-U3`）、忽略空白（见上）、冲突文件。界面在 diff 重取后丢掉选择（行下标不再可信）。


## 界面（阶段 4，`src/renderer/src/features/git/`）

- **草稿的分支胶囊**（`DraftGitTools`，2026-10-22 起；原来是输入框工具行里的 `WorktreeChip`）：新任务草稿的顶栏，位置和外观同任务的分支胶囊。`getDraftGit(projectId)` 在项目目录正好是仓库根时返回当前分支（detached 为 null），否则 null、胶囊不画（默认文件夹就是这样）。菜单只有勾选项"在独立 worktree 里开始"；勾上后 `createTask({ worktree: true })`，发送成功后复位。项目里有 setup 脚本（`getWorktreeSetupScript`）时，胶囊的悬停提示写"创建时会运行 .omp-studio/setup.ps1"（不写进菜单项：英文太长）。没提交、detached HEAD 这类前提不预先查：创建被主进程拒绝时，按错误原文（`shared/ui/errors.ts` 的 `worktreeBlockerKey`）映射成不是仓库 / 不在仓库根 / 没有提交 / detached HEAD / 没有 git，勾选项随之取消并禁用，悬停提示写明原因，草稿保留。setup 脚本失败不禁用（下次可能就好了），只弹错误。禁用状态只存在于本次运行。
- **setup 脚本确认**：脚本是仓库里的可执行内容（ps1 以 Bypass 运行），不能只靠胶囊小字提示。`getWorktreeSetupScript` 返回 `{ name, sha256, approved }`；发送时若开了工作树且脚本没确认过，`ensureSetupApproved` 弹对话框（脚本名 + "会在新工作树里运行"），同意则 `approveWorktreeSetup(projectId, sha256)` 记下，取消（含 Esc、点遮罩）= 不建 worktree、草稿保留。记录在 `userData/setup-consent.json`（`src/main/git/setup-consent.ts`），按项目路径 + 脚本内容 sha256；脚本改了哈希就变，要再问。**主进程强制**：`createWorktree(path, { approveSetup })` 在 `worktree add` 之前调回调，没给或返回 false 抛 `setup script not approved`，运行前再按哈希核对一次；`runtime.ts` 的回调查确认记录，所以渲染端绕过对话框直接 `createTask({ worktree: true })` 也会被拒绝。`approveWorktreeSetup` 只接受用户看到的那个哈希（脚本已变则 reject）。
- **任务条的 git 工具**（`GitTools`，spec §3.1）：顶栏右侧，任务目录是 git 仓库时才渲染。分支胶囊显示当前分支（worktree 任务显示 worktree 分支），后面照 omp 状态栏跟改动数：`*N` = 有改动的已跟踪文件数（`status.files` 里非 untracked 的条目），`?N` = 未跟踪文件数，worktree 领先时再加 `↑N`；完整说法都在悬停提示里。点开是 Git 菜单（2026-10-21 起不含"查看改动"，顶栏已有评审按钮）：提交、推送、创建 PR（`status.canPush` 为 true 才列；gh 缺失 / 未登录仍由结果 toast 说明）；再点胶囊或点窗口任意处收回（菜单开着时 `.git-menu-scrim` 盖住整窗，顶栏拖动区收不到点击）；worktree 任务另有"合并回 <基分支>"和"丢弃 worktree"。**推送项在 `status.canPush` 为 false 时灰显（`MenuItem.disabledReason`，`aria-disabled`，不执行），悬停提示是 `git.push.noRemote`（没有可用远端）或 `git.push.detached`（detached HEAD）。** 旁边一个评审按钮直接打开评审。状态在任务 `updatedAt` 变化和每次 git 操作后重读（`refreshGit`）。
- **侧栏任务行**：worktree 任务带分支图标，悬停提示是分支名。分支名随任务状态推来（`TaskState.worktreeBranch`，取自任务记录），行上不再调 `getTaskWorktree`（以前每个挂着的行一次 IPC，worktree 任务还要跑一次 `git rev-list`）；领先提交数只有顶栏 git 工具要，仍由 `useTaskWorktree` 读。
- **结果提示**（`git-actions.ts`）：主进程的类型化结果都翻译成当前语言：合并 merged / nothing_to_merge / blocked（三种原因）用 toast，conflict 用对话框列出文件；推送 pushed / no_remote / detached_head / rejected / failed；PR 的 gh_unavailable / gh_unauthenticated / failed；提交的 nothing_to_commit / failed。git 的原话放在 toast 的悬停提示里。抛出的错误走 `reportError`，不吞。
- **评审里的提交框**（2026-10-21，`features/review/CommitBox.tsx`；2026-10-23 加了生成和 Amend）：和提交对话框走同一条路径 `git-actions.ts` 的 `commitChanges(t, taskId, message, stageAll, amend)`（提示结果、之后 `refreshGit`），不另开提交通道；摘要 + 空行 + 说明合成提交信息（`shared/ui/review-model.ts` 的 `composeCommitMessage`，逆运算 `shared/git.ts` 的 `splitCommitMessage`，Amend 预填用它）。默认 `stageAll = false`（评审里暂存是显式动作，只提交已暂存的），勾上才 `add -A`。"生成"和 Amend 的细节见上面"生成提交信息、Amend、按行操作、忽略空白"。
- **对话框**（`GitDialogs.tsx`，状态在 `git-dialog-store.ts`；3.2 起外壳是 `ui/Dialog`，输入框 / 勾选框 / 按钮都是 `ui/` 通用控件）：提交（信息 + 页脚左侧"先暂存全部改动"勾选框，Ctrl Enter 提交；页脚左侧的"评审改动"关掉对话框并 `openReview`，提交对话框本身不列文件，想先看改了什么从这里进评审，Esc 退出评审后再从菜单打开提交；"提交"是主按钮）、开 PR（标题 + 说明，先 `pushGit` 再 `createPullRequest`，推送没成功就停在推送的提示上；"推送并创建"是主按钮）、丢弃确认（`ui/ConfirmDialog danger`：danger-solid 确认键、焦点在"取消"；确认后才执行，成功后任务归档并回到空状态，失败由 toast 说明、对话框关闭）、合并冲突、清理报告。git 菜单（`GitTools` / `DraftGitTools`）用 `ui/Menu`：动作项带图标，"丢弃 worktree…"红字放最后、前面一条分隔线，不可用项第二行写原因；草稿菜单是选择菜单（✓ 表示当前值）。
- **评审的界面**（3.2，`features/review/`）：只有两栏（文件树 | diff），没有右侧评论栏。评论只以行内卡片的形式出现在 diff 里，卡片右上角 ⋯ 菜单是"编辑 / 删除"。工具条从左到右：退出评审、标题和分支、统一 / 并排与改动块 / 文件两组分段（`ui/Segmented` sm）、折行（`IconButton` pressed，快捷键 W）、刷新（↻ 图标按钮）、"评论 N"（点开是列表浮层，按文件和行排序，点一条跳到那个文件并把评论卡滚进视野）、"发给 agent 修改"（主按钮，条数不再写在按钮里）。窗口窄于 1100 时两组分段和折行收成一个"视图"菜单，工具条不会被裁掉。左栏底部的提交框用 32 高的输入框，"提交"是右下的主按钮，不再通栏。
- **项目菜单"清理无主 worktree"**：调 `cleanupOrphanWorktrees`，对话框分"已移除 / 保留（原因）"两组。
- **待仓库所有者决定**：丢弃 worktree 的任务被归档，之后"恢复"该任务会回到项目目录（见上面的已知局限）。界面没有为此做任何特殊处理。

## 测试

`test/git-*.test.ts`，全部在真实临时仓库里跑，目录名带空格和中文：`git-review`（状态、diff 解析、hunk 暂存/取消/丢弃、过期 hunk、二进制/过大、路径校验）、`git-lines`（选中行 → 补丁：新增 / 删除 / 混合 / reverse / 末尾无换行 / CRLF；真实 `git apply` 暂存、取消暂存、丢弃选中的行，过期 hunk、未跟踪文件、`-w` 只影响显示）、`git-commit-message`（`omp commit` 输出解析——含真实输出样本、拆分建议；用假 omp 测参数 / cwd / 没暂存不运行 / 取消）、`git-worktree`（真实 omp 创建、omp 目录解析、setup 脚本、回滚、合并、冲突、丢弃、清理、旧位置兼容）、`git-remote`（提交、amend、`lastCommit`、push 含被拒、gh 不可用）、`git-pure`（评论格式化、status 解析）、`git-numstat`（numstat 解析、行数、两侧 / 重命名 / 未跟踪的 `+a −d`、`file` 与 `hunks` 上下文）、`git-task-worktree`（任务池接线、worktree 被删后拒绝启动）；`line-selection`（点击 / Shift 点击 / Shift+↑↓ 的选择纯函数）。创建 worktree 的用例需要 PATH 上有真实 omp，没有就 skip；测试把 `OMP_WORKTREE_DIR`、`PI_CODING_AGENT_DIR`、`USERPROFILE`/`HOME` 都指到临时目录，不碰开发机的 `~/.omp`。`gh pr create` 的成功路径没有测（没有可用的 GitHub 仓库）。

界面的端到端是 `test/e2e/git-worktree.e2e.ts`（真实临时仓库 + 本地裸仓库 + 假 omp；`FAKE_OMP_CWD_FILE` 让假 omp 记下启动目录，据此断言任务在 worktree 里运行）：胶囊 → 创建 → 提交 → 合并 → 推送 → 丢弃 → 清理；冲突和被拒绝的合并；非 git 项目的胶囊禁用。

评审里的生成 / Amend / 忽略空白 / 按行暂存是 `test/e2e/review.e2e.ts` 的后五个用例（2026-10-23 写的）。"生成"用假 `omp commit` 顶替：`STUDIO_TEST_COMMIT_OMP`（未打包时才认，JSON `{command, args}`，同 `STUDIO_TEST_OMP`）指向 `test/fake-omp/fake-omp-commit.ts`，输出格式照真实 omp 18.12.6 的录制；`FAKE_COMMIT_MODE`（ok / split / nomodel / fail / hang）、`FAKE_COMMIT_DELAY`（让"生成中"停一会儿）、`FAKE_COMMIT_LOG`（记每次调用的 cwd 和参数）控制行为和断言。

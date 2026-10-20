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
- **丢弃**（`TaskPool.discardWorktree`）：先关任务进程（Windows 上进程占着目录删不掉），`worktree remove --force` + `rm`（EBUSY 等重试）+ `prune` + `branch -D`，清空记录里的 worktree 字段，再归档任务（侧栏移除）。移除前必须是 git 登记在这个仓库名下、检出的正是任务分支的 worktree，分支必须是 `studio/` 前缀（位置不再固定，所以按登记认，不按路径认）。含未提交和未合并的内容，界面必须先确认。归档任务本身不删 worktree。
- **清理无主 worktree**：先 `worktree prune`；再看 git 登记的、分支是 `studio/` 前缀、没有任何任务记录（含已归档）引用的 worktree（不管在 omp 的目录还是旧位置）：干净且分支已合入 HEAD 的删除；有未提交改动（`dirty`）、有未合并提交（`unmerged`）的保留并报告。不是 `studio/` 分支的 worktree 不是我们的，不碰。不用 `omp worktree clear`：它按目录整体清，`--all` 会清掉别的仓库、别的工具建的。
- **worktree 被删除的任务**：启动前检查 `worktreePath` 是否还在，不在就拒绝启动，状态是 `error`、`TaskError.kind = "worktree_missing"`（不占进程名额，也不退回项目目录）。和 omp 一致：只能查看记录（对话流照常显示），不能继续聊；界面显示一行说明、隐藏"重新连接"、输入框禁用。
- 已知局限：归档的 worktree 任务被恢复时（`resume`）会按 `worktreePath` 启动；丢弃后再恢复同一任务则回到项目目录，而它的会话文件里记的 cwd 是已删除的 worktree。恢复的 UI 需要决定怎么处理，这里没有改 `resume`。

## 提交、推送、PR

- `commitGit(taskId, message, stageAll)`：stageAll 时先 `add -A`；没有已暂存内容 → `nothing_to_commit`；有未解决冲突或 git 拒绝（钩子失败、没配 user.name/email）→ `failed` + git 原话。
- `pushGit`：当前分支；已有 upstream 就照它的 remote，否则只有一个 remote 用它、有 `origin` 用 `origin`，再没有 → `no_remote`（选择规则在 `repo.ts` 的 `pushRemote`，`push` 和状态共用）。首次推送带 `--set-upstream`。显式写 `push <remote> <branch>`，**没有任何 force 参数**。远端领先 → `rejected`；detached → `detached_head`。凭据不弹交互（`GIT_TERMINAL_PROMPT=0`），拿不到凭据时是 `failed`。`getGitStatus` 的 ok 结果带 `canPush`（非 detached 且 `pushRemote` 选得出 remote），界面据此禁用推送项，所以正常情况下点不到 `no_remote` / `detached_head`。
- `createPullRequest(taskId, {title, body})`：`gh pr create --title … --body-file - --head <当前分支> [--base <worktreeBase>]`。gh 不在 PATH → `gh_unavailable`；未登录 → `gh_unauthenticated`；其他 → `failed`。**不会替用户先 push**，调用方先 `pushGit`。

## 界面（阶段 4，`src/renderer/src/features/git/`）

- **工作树胶囊**（`WorktreeChip`）：草稿输入框，ApprovalChip 右侧；打开后 `createTask({ worktree: true })`，发送成功后复位。项目里有 setup 脚本（`getWorktreeSetupScript`）时，开启状态下胶囊内写"创建时会运行 setup.ps1"，悬停提示给出完整文件名。**没有"能不能用工作树"的查询接口**（`getGitStatus` 要 taskId）：创建被主进程拒绝时，按错误原文（`shared/ui/errors.ts` 的 `worktreeBlockerKey`）映射成不是仓库 / 不在仓库根 / 没有提交 / detached HEAD / 没有 git，胶囊随之关掉并禁用，悬停提示写明原因，草稿保留。setup 脚本失败不禁用（下次可能就好了），只弹错误。禁用状态只存在于本次运行。
- **setup 脚本确认**：脚本是仓库里的可执行内容（ps1 以 Bypass 运行），不能只靠胶囊小字提示。`getWorktreeSetupScript` 返回 `{ name, sha256, approved }`；发送时若开了工作树且脚本没确认过，`ensureSetupApproved` 弹对话框（脚本名 + "会在新工作树里运行"），同意则 `approveWorktreeSetup(projectId, sha256)` 记下，取消（含 Esc、点遮罩）= 不建 worktree、草稿保留。记录在 `userData/setup-consent.json`（`src/main/git/setup-consent.ts`），按项目路径 + 脚本内容 sha256；脚本改了哈希就变，要再问。**主进程强制**：`createWorktree(path, { approveSetup })` 在 `worktree add` 之前调回调，没给或返回 false 抛 `setup script not approved`，运行前再按哈希核对一次；`runtime.ts` 的回调查确认记录，所以渲染端绕过对话框直接 `createTask({ worktree: true })` 也会被拒绝。`approveWorktreeSetup` 只接受用户看到的那个哈希（脚本已变则 reject）。
- **任务条的 git 工具**（`GitTools`，spec §3.1）：顶栏右侧，任务目录是 git 仓库时才渲染。分支胶囊显示当前分支（worktree 任务显示 worktree 分支），后面照 omp 状态栏跟改动数：`*N` = 有改动的已跟踪文件数（`status.files` 里非 untracked 的条目），`?N` = 未跟踪文件数，worktree 领先时再加 `↑N`；完整说法都在悬停提示里。点开是 Git 菜单：查看改动（评审模式）、提交、推送、创建 PR；worktree 任务另有"合并回 <基分支>"和"丢弃工作树"。**推送项在 `status.canPush` 为 false 时灰显（`MenuItem.disabledReason`，`aria-disabled`，不执行），悬停提示是 `git.push.noRemote`（没有可用远端）或 `git.push.detached`（detached HEAD）。** 旁边一个评审按钮直接打开评审。状态在任务 `updatedAt` 变化和每次 git 操作后重读（`refreshGit`）。
- **侧栏任务行**：worktree 任务带分支图标，悬停提示是分支名。
- **结果提示**（`git-actions.ts`）：主进程的类型化结果都翻译成当前语言：合并 merged / nothing_to_merge / blocked（三种原因）用 toast，conflict 用对话框列出文件；推送 pushed / no_remote / detached_head / rejected / failed；PR 的 gh_unavailable / gh_unauthenticated / failed；提交的 nothing_to_commit / failed。git 的原话放在 toast 的悬停提示里。抛出的错误走 `reportError`，不吞。
- **对话框**（`GitDialogs.tsx`，状态在 `git-dialog-store.ts`）：提交（信息 + "先暂存全部改动"，Ctrl Enter 提交）、开 PR（标题 + 说明，先 `pushGit` 再 `createPullRequest`，推送没成功就停在推送的提示上）、丢弃确认（默认焦点在"取消"；成功后任务归档并回到空状态）、合并冲突、清理报告。
- **项目菜单"清理无主工作树"**：调 `cleanupOrphanWorktrees`，对话框分"已移除 / 保留（原因）"两组。
- **待仓库所有者决定**：丢弃 worktree 的任务被归档，之后"恢复"该任务会回到项目目录（见上面的已知局限）。界面没有为此做任何特殊处理。

## 测试

`test/git-*.test.ts`，全部在真实临时仓库里跑，目录名带空格和中文：`git-review`（状态、diff 解析、hunk 暂存/取消/丢弃、过期 hunk、二进制/过大、路径校验）、`git-worktree`（真实 omp 创建、omp 目录解析、setup 脚本、回滚、合并、冲突、丢弃、清理、旧位置兼容）、`git-remote`（提交、push 含被拒、gh 不可用）、`git-pure`（评论格式化、status 解析）、`git-task-worktree`（任务池接线、worktree 被删后拒绝启动）。创建 worktree 的用例需要 PATH 上有真实 omp，没有就 skip；测试把 `OMP_WORKTREE_DIR`、`PI_CODING_AGENT_DIR`、`USERPROFILE`/`HOME` 都指到临时目录，不碰开发机的 `~/.omp`。`gh pr create` 的成功路径没有测（没有可用的 GitHub 仓库）。

界面的端到端是 `test/e2e/git-worktree.e2e.ts`（真实临时仓库 + 本地裸仓库 + 假 omp；`FAKE_OMP_CWD_FILE` 让假 omp 记下启动目录，据此断言任务在 worktree 里运行）：胶囊 → 创建 → 提交 → 合并 → 推送 → 丢弃 → 清理；冲突和被拒绝的合并；非 git 项目的胶囊禁用。

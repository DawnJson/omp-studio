import type { MessageEntry } from "../index.ts";

export const git = {
  // 新任务草稿的顶栏分支胶囊（项目是 git 仓库时）
  "draft.worktree": "在独立 worktree 里开始",
  "draft.title": "在独立 worktree（新分支 studio/…）里做这个任务，不动主目录",
  "draft.on": "新 worktree",
  "draft.setup": "创建时会运行 {script}",
  "draft.blocked": "不能用 worktree：{reason}",
  "setup.title": "运行这个项目的 setup 脚本？",
  "setup.body": "{script} 来自项目仓库，会以你的权限在新 worktree 里运行。只运行你信任的脚本。",
  "setup.confirm": "运行并创建",
  "setup.declined": "没有创建 worktree。",

  // 创建 worktree 被拒绝的原因（主进程的错误原文映射，shared/ui/errors.ts）
  "err.notGit": "这个项目目录不是 git 仓库。",
  "err.notRoot": "项目目录必须正好是仓库根目录。",
  "err.noCommits": "仓库还没有任何提交，先提交一次。",
  "err.detached": "仓库处于 detached HEAD，先切到一个分支。",
  "err.gitMissing": "找不到 git，请先安装并加入 PATH。",
  "err.setupFailed": "worktree 的 setup 脚本运行失败，worktree 已撤销。",

  // 任务条的 git 工具
  "bar.menu": "Git 操作",
  "bar.branch": "分支 {branch}",
  "bar.worktree": "Worktree · 基于 {base}",
  "bar.changed": { one: "{count} 个文件有改动", other: "{count} 个文件有改动" },
  "bar.untracked": { one: "{count} 个未跟踪文件", other: "{count} 个未跟踪文件" },
  "bar.ahead": { one: "领先 {count} 个提交", other: "领先 {count} 个提交" },
  "row.worktree": "Worktree 分支 {branch}",

  // 菜单
  "menu.commit": "提交",
  "menu.push": "推送",
  "menu.pr": "创建 PR",
  "menu.merge": "合并回 {base}",
  "menu.discard": "丢弃 worktree",
  "menu.cleanup": "清理无主 worktree",

  // 提交
  "commit.title": "提交改动",
  "commit.message": "提交信息",
  "commit.stageAll": "先暂存全部改动",
  "commit.confirm": "提交",
  "commit.review": "评审改动",
  "commit.done": "已提交 {commit}",
  "commit.nothing": "没有可提交的内容。勾选“先暂存全部改动”或在评审里暂存文件。",
  "commit.failed": "提交被 git 拒绝",
  "commit.amended": "已修改上一次提交，现在是 {commit}",
  "commit.noPrevious": "还没有提交，没有可修改的。",
  "generate.nothing": "没有已暂存的改动，先暂存要提交的文件。",
  "generate.noModel": "omp 没有可用的 commit 模型。在设置里给 commit（或 smol）角色选一个模型并配好 key。",
  "generate.split": "omp 建议把这些改动拆成 {count} 个提交，这里只填了第一个的信息。",
  "generate.failed": "生成提交信息失败",

  // 推送
  "push.done": "已推送到 {remote}/{branch}",
  "push.noRemote": "没有配置远端，无法推送。",
  "push.detached": "处于 detached HEAD，没有分支可推送。",
  "push.rejected": "远端有本地没有的提交，没有推送（不会强推）。先把远端的改动合进来。",
  "push.failed": "推送失败",

  // PR
  "pr.title": "创建 Pull Request",
  "pr.titleField": "标题",
  "pr.body": "说明",
  "pr.confirm": "推送并创建",
  "pr.done": "已创建 Pull Request",
  "pr.open": "打开",
  "pr.ghUnavailable": "找不到 gh 命令。安装 GitHub CLI 并加入 PATH 后才能创建 PR。",
  "pr.ghUnauthenticated": "gh 还没有登录。在终端运行 gh auth login 后重试。",
  "pr.failed": "创建 PR 失败",
  "pr.badge": "在浏览器中打开 Pull Request #{number}",

  // 合并
  "merge.done": "已合并到 {base}",
  "merge.nothing": "没有新的提交可合并。",
  "merge.conflictTitle": "合并有冲突",
  "merge.conflictBody": "合并已撤销，两边都没有改动。",
  "merge.blocked.worktree_dirty": "worktree 里有没提交的改动，先提交或丢弃它们。",
  "merge.blocked.base_dirty": "主目录里有没提交的改动，合并可能覆盖它们，先处理掉。",
  "merge.blocked.base_not_checked_out": "主目录当前不在 {base} 分支上（现在是 {current}），先切回去。",
  "merge.detached": "detached HEAD",

  // 丢弃
  "discard.title": "丢弃这个 worktree？",
  "discard.body": "会删除分支 {branch} 和 worktree 目录，未提交、未合并的改动都会丢失，任务归档。无法撤销。",
  "discard.confirm": "丢弃",
  "discard.done": "已丢弃 worktree",

  // 清理无主 worktree
  "cleanup.title": "清理无主 worktree",
  "cleanup.none": "没有无主的 worktree。",
  "cleanup.removed": "已移除",
  "cleanup.kept": "保留",
  "cleanup.dirty": "有没提交的改动",
  "cleanup.unmerged": "有没合并的提交",
} satisfies Record<string, MessageEntry>;

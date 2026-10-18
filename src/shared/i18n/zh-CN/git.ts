import type { MessageEntry } from "../index.ts";

export const git = {
  // 输入框的工作树胶囊
  "chip.label": "工作树",
  "chip.title": "在独立的 git 工作树里做这个任务：新分支 studio/…，不动主目录里的文件",
  "chip.setup": "创建时会运行 {script}",
  "chip.blocked": "不能用工作树：{reason}",

  // 创建工作树被拒绝的原因（主进程的错误原文映射，shared/ui/errors.ts）
  "err.notGit": "这个项目目录不是 git 仓库。",
  "err.notRoot": "项目目录必须正好是仓库根目录。",
  "err.noCommits": "仓库还没有任何提交，先提交一次。",
  "err.detached": "仓库处于 detached HEAD，先切到一个分支。",
  "err.gitMissing": "找不到 git，请先安装并加入 PATH。",
  "err.setupFailed": "工作树的 setup 脚本运行失败，工作树已撤销。",

  // 主区的 git 条
  "bar.label": "Git",
  "bar.menu": "Git 操作",
  "bar.branch": "分支 {branch}",
  "bar.worktree": "工作树 · 基于 {base}",
  "bar.ahead": { one: "领先 {count} 个提交", other: "领先 {count} 个提交" },
  "row.worktree": "工作树分支 {branch}",

  // 菜单
  "menu.review": "查看改动",
  "menu.commit": "提交…",
  "menu.push": "推送",
  "menu.pr": "创建 Pull Request…",
  "menu.merge": "合并回 {base}",
  "menu.discard": "丢弃工作树…",
  "menu.cleanup": "清理无主工作树",

  // 提交
  "commit.title": "提交改动",
  "commit.message": "提交信息",
  "commit.stageAll": "先暂存全部改动",
  "commit.confirm": "提交",
  "commit.done": "已提交 {commit}",
  "commit.nothing": "没有可提交的内容。勾选“先暂存全部改动”或在评审里暂存文件。",
  "commit.failed": "提交被 git 拒绝",

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

  // 合并
  "merge.done": "已合并到 {base}",
  "merge.nothing": "没有新的提交可合并。",
  "merge.conflictTitle": "合并有冲突",
  "merge.conflictBody":
    "已撤销这次合并，主目录和工作树都没有被改动。把下面的文件冲突处理好（可以让 agent 处理）后再合并。",
  "merge.blocked.worktree_dirty": "工作树里有没提交的改动，先提交或丢弃它们。",
  "merge.blocked.base_dirty": "主目录里有没提交的改动，合并可能覆盖它们，先处理掉。",
  "merge.blocked.base_not_checked_out": "主目录当前不在 {base} 分支上（现在是 {current}），先切回去。",
  "merge.detached": "detached HEAD",

  // 丢弃
  "discard.title": "丢弃这个工作树？",
  "discard.body": "会删除分支 {branch} 和工作树目录，里面没提交和没合并的改动都会丢失，任务会被归档。不能撤销。",
  "discard.confirm": "丢弃",
  "discard.done": "已丢弃工作树",

  // 清理无主工作树
  "cleanup.title": "清理无主工作树",
  "cleanup.none": "没有无主的工作树。",
  "cleanup.removed": "已移除",
  "cleanup.kept": "保留",
  "cleanup.dirty": "有没提交的改动",
  "cleanup.unmerged": "有没合并的提交",
  "cleanup.unregistered": "git 不认识或不是 studio/ 分支",
} satisfies Record<string, MessageEntry>;

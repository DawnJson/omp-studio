// 阶段 3（评审）和阶段 4（worktree 与 git）的共用类型，以及渲染进程也要用的纯函数。
// 路径一律是相对仓库根的正斜杠路径；主进程不会把绝对路径交给渲染进程。

// ───────── 状态 ─────────

export type GitChangeKind =
  "added" | "modified" | "deleted" | "renamed" | "copied" | "typechange" | "untracked" | "conflicted";

/** 一个路径一条：暂存区（相对 HEAD）和工作区（相对暂存区）各自的变化，没有变化为 null。 */
export interface GitFileChange {
  path: string;
  /** 重命名/复制时的原路径（只在 staged 为 renamed/copied 时有值）。 */
  oldPath: string | null;
  staged: GitChangeKind | null;
  /** 未跟踪的文件是 "untracked"；冲突的文件 staged 和 unstaged 都是 "conflicted"。 */
  unstaged: GitChangeKind | null;
}

export interface GitBranchInfo {
  /** 当前分支名；detached HEAD 为 null。 */
  head: string | null;
  /** 还没有任何提交（unborn）时为 null。 */
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export type GitStatus =
  /** PATH 上找不到 git。 */
  | { kind: "git_missing" }
  /** 任务目录不在 git 仓库里。 */
  | { kind: "not_git" }
  | { kind: "ok"; branch: GitBranchInfo; files: GitFileChange[] };

// ───────── diff ─────────

/** 看哪一侧的 diff：staged = 暂存区 vs HEAD；unstaged = 工作区 vs 暂存区；untracked = 整个文件都是新增。 */
export type GitDiffArea = "staged" | "unstaged" | "untracked";

export interface GitDiffLine {
  kind: "context" | "add" | "del";
  /** 旧文件行号（1 起）；新增行为 null。 */
  oldNo: number | null;
  /** 新文件行号（1 起）；删除行为 null。 */
  newNo: number | null;
  /** 不含行尾换行；CRLF 文件里行尾的 \r 原样保留。 */
  text: string;
  /** 这一行后面是 "\ No newline at end of file"。 */
  noEol?: true;
}

export interface GitDiffHunk {
  /** 原样的 `@@ -a,b +c,d @@ section` 行；stage/discard 单个 hunk 时用它确认 diff 没有变过。 */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitDiffLine[];
}

export type GitFileDiff =
  | { kind: "text"; hunks: GitDiffHunk[]; added: number; removed: number }
  | { kind: "binary" }
  /** 文件或 diff 太大（超过 GIT_DIFF_MAX_BYTES），不解析。 */
  | { kind: "too_large" };

export const GIT_DIFF_MAX_BYTES = 2 * 1024 * 1024;

/** 定位一个 hunk：index 是它在文件 diff 里的序号，header 用来确认文件没有在两次调用之间变过。 */
export interface GitHunkRef {
  index: number;
  header: string;
}

/** 并排视图的一行：左旧右新；只有一侧有内容时另一侧为 null。 */
export interface GitSideBySideRow {
  left: GitDiffLine | null;
  right: GitDiffLine | null;
}

/** 把一个 hunk 排成并排行：上下文左右同一行；连续的删除块和新增块逐行配对，多出来的一侧留空。 */
export function toSideBySide(hunk: GitDiffHunk): GitSideBySideRow[] {
  const rows: GitSideBySideRow[] = [];
  let removed: GitDiffLine[] = [];
  let added: GitDiffLine[] = [];
  const flush = () => {
    const count = Math.max(removed.length, added.length);
    for (let i = 0; i < count; i++) rows.push({ left: removed[i] ?? null, right: added[i] ?? null });
    removed = [];
    added = [];
  };
  for (const line of hunk.lines) {
    if (line.kind === "del") removed.push(line);
    else if (line.kind === "add") added.push(line);
    else {
      flush();
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

// ───────── 评审评论 ─────────

export interface ReviewComment {
  /** 相对仓库根的路径。 */
  file: string;
  /** 1 起，含两端；单行评论 startLine === endLine。 */
  startLine: number;
  endLine: number;
  /** old = 行号是旧版本（被删除/改动前）的行；new = 新版本的行。 */
  side: "old" | "new";
  body: string;
}

export const REVIEW_COMMENTS_MAX = 200;

/**
 * 把攒下的评论格式化成发给 agent 的一条用户消息（docs/architecture/review-comments.md：宿主自己格式化，`文件:行范围`）。
 * 按文件第一次出现的顺序分组，同一文件内按起始行排序；多行评论正文的续行缩进，保持编号清晰。
 */
export function formatReviewComments(comments: readonly ReviewComment[], locale: "zh-CN" | "en"): string {
  if (comments.length === 0) throw new Error("no review comments to format");
  const fileOrder = new Map<string, number>();
  for (const comment of comments) if (!fileOrder.has(comment.file)) fileOrder.set(comment.file, fileOrder.size);
  const sorted = comments
    .map((comment, position) => ({ comment, position }))
    .sort(
      (a, b) =>
        (fileOrder.get(a.comment.file) ?? 0) - (fileOrder.get(b.comment.file) ?? 0) ||
        a.comment.startLine - b.comment.startLine ||
        a.position - b.position,
    );
  const zh = locale === "zh-CN";
  const lines = [zh ? "请按下面的评审意见修改代码：" : "Please address these review comments:", ""];
  sorted.forEach(({ comment }, i) => {
    const range =
      comment.startLine === comment.endLine ? `${comment.startLine}` : `${comment.startLine}-${comment.endLine}`;
    const side = comment.side === "old" ? (zh ? "（旧版本的行）" : " (old version lines)") : "";
    const [first = "", ...rest] = comment.body.trim().split(/\r?\n/);
    lines.push(`${i + 1}. ${comment.file}:${range}${side}`, `   ${first}`);
    for (const line of rest) lines.push(line === "" ? "" : `   ${line}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

// ───────── worktree 与 git 操作 ─────────

export interface TaskWorktreeInfo {
  branch: string;
  baseBranch: string;
  /** worktree 分支比基分支多出的提交数（merge 按钮是否可用）。 */
  commitsAhead: number;
}

export type GitMergeResult =
  | { kind: "merged"; commit: string }
  | { kind: "nothing_to_merge" }
  /** 合并有冲突：已 `merge --abort`，两边的工作区都没有被改动；agent 或用户处理后再合。 */
  | { kind: "conflict"; files: string[] }
  | {
      kind: "blocked";
      reason: "worktree_dirty" | "base_dirty" | "base_not_checked_out";
      /** base_not_checked_out 时主仓库当前所在的分支（detached 为 null）。 */
      currentBranch?: string | null;
    };

export interface WorktreeCleanupResult {
  /** 已移除的无主 worktree（目录名，不含上级路径）。 */
  removed: string[];
  /** 没有动的：有未提交修改、有未合并的提交，或 git 不认识的目录。 */
  kept: { name: string; reason: "dirty" | "unmerged" | "unregistered" }[];
}

export type GitCommitResult =
  | { kind: "committed"; commit: string }
  | { kind: "nothing_to_commit" }
  /** git 拒绝了（pre-commit 钩子失败、没配 user.name/email 等）；message 是 git 的原话。 */
  | { kind: "failed"; message: string };

export type GitPushResult =
  | { kind: "pushed"; remote: string; branch: string }
  | { kind: "no_remote" }
  | { kind: "detached_head" }
  /** 远端有本地没有的提交；不会强推。 */
  | { kind: "rejected"; message: string }
  | { kind: "failed"; message: string };

export interface GitPullRequestInput {
  title: string;
  body: string;
}

export type GitPullRequestResult =
  | { kind: "created"; url: string }
  | { kind: "gh_unavailable" }
  | { kind: "gh_unauthenticated" }
  | { kind: "failed"; message: string };

export interface GitTools {
  /** `git --version` 的版本号；没有 git 为 null。 */
  git: string | null;
  gh: boolean;
}

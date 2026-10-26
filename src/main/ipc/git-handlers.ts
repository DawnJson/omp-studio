// 评审（阶段 3）和 worktree / git（阶段 4）的 IPC handler：校验参数，委托 src/main/git。
// 路径只接受相对仓库根的（review.ts 的 checkRepoPath 做词法校验）；渲染进程拿不到任何绝对路径，也不能指定仓库。
import {
  formatReviewComments,
  REVIEW_COMMENTS_MAX,
  type GitDiffArea,
  type GitDiffContext,
  type GitHunkRef,
  type GitLinesRef,
  type ReviewComment,
} from "../../shared/git.ts";
import { app, shell } from "electron";
import type { HandlerGroup, TaskId } from "../../shared/ipc.ts";
import { generateCommitMessage, type OmpCommand } from "../git/commit-message.ts";
import { getChangeStats } from "../git/numstat.ts";
import { commit, createPullRequest, lastCommit, push } from "../git/remote.ts";
import { taskPullRequestUrl } from "../git/pull-request-url.ts";
import { currentBranch, requireRepoRoot } from "../git/repo.ts";
import {
  checkRepoPath,
  discardFile,
  discardHunk,
  discardLines,
  getFileDiff,
  stageFile,
  stageHunk,
  stageLines,
  unstageFile,
  unstageHunk,
  unstageLines,
} from "../git/review.ts";
import { getGitStatus } from "../git/status.ts";
import {
  cleanupOrphanWorktrees,
  findSetupScript,
  isRepoRootProject,
  mergeWorktree,
  worktreeInfo,
} from "../git/worktree.ts";
import { log } from "../log/log.ts";
import { getOmpExecutable } from "../omp-manager/index.ts";
import { parseTestOmpOverride, prependToPath } from "../omp/launch-args.ts";
import { resolveLocale } from "../settings/settings-store.ts";
import { getSetupConsent, getTaskPool } from "../tasks/runtime.ts";
import {
  IpcValidationError,
  parseBoolean,
  parseExternalUrl,
  parseInteger,
  parseOneOf,
  parseProjectId,
  parseRecord,
  parseString,
  parseTaskId,
} from "./validate.ts";

const MAX_LINE = 10_000_000;
const MAX_LINES_PER_OP = 100_000;

function parseHunkRef(value: unknown): GitHunkRef {
  const record = parseRecord(value, "hunk");
  return {
    index: parseInteger(record["index"], "hunk.index", 0, 100_000),
    header: parseString(record["header"], "hunk.header", 1000),
  };
}

function parseReviewComments(value: unknown): ReviewComment[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > REVIEW_COMMENTS_MAX)
    throw new IpcValidationError(`comments 必须是 1–${REVIEW_COMMENTS_MAX} 条的数组`);
  return value.map((item: unknown): ReviewComment => {
    const record = parseRecord(item, "comment");
    const startLine = parseInteger(record["startLine"], "comment.startLine", 1, MAX_LINE);
    const endLine = parseInteger(record["endLine"], "comment.endLine", 1, MAX_LINE);
    if (endLine < startLine) throw new IpcValidationError("comment.endLine 不能小于 startLine");
    return {
      file: parseString(record["file"], "comment.file", 1024),
      startLine,
      endLine,
      side: parseOneOf(record["side"], "comment.side", ["old", "new"]),
      body: parseString(record["body"], "comment.body", 20_000),
    };
  });
}

const parseArea = (value: unknown): GitDiffArea => parseOneOf(value, "area", ["staged", "unstaged", "untracked"]);

function parseLinesRef(value: unknown): GitLinesRef {
  const record = parseRecord(value, "ref");
  const lines = record["lines"];
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES_PER_OP)
    throw new IpcValidationError(`ref.lines 必须是 1–${MAX_LINES_PER_OP} 个行下标的数组`);
  return {
    ...parseHunkRef(value),
    lines: lines.map((line: unknown) => parseInteger(line, "ref.lines[]", 0, MAX_LINES_PER_OP)),
  };
}

/** 同一时刻每个任务只有一次"生成提交信息"；取消按任务找到它。 */
const generating = new Map<TaskId, AbortController>();

/**
 * `omp commit` 用的 omp：和任务进程同一个可执行文件；e2e 里任务进程是假 omp，
 * 未打包时 `STUDIO_TEST_COMMIT_OMP`（JSON `{command, args}`，同 STUDIO_TEST_OMP）指向另一个假 omp 来扮演 `omp commit`。
 */
async function commitOmp(): Promise<OmpCommand> {
  const override = app.isPackaged ? undefined : process.env["STUDIO_TEST_COMMIT_OMP"];
  if (override) {
    const parsed = parseTestOmpOverride(override);
    return { command: parsed.command, args: parsed.args, env: { ...process.env } };
  }
  const executable = await getOmpExecutable();
  return {
    command: executable.path,
    // 不带账号型 provider 扩展：omp 18.12.6 的 `omp commit` 不认 `-e`（报 Unknown option 退出 1），commit 角色用账号型 provider 的模型时生成不了。
    args: [],
    env: prependToPath({ ...process.env }, executable.managedBin),
  };
}

export const gitHandlers: HandlerGroup<
  | "getGitStatus"
  | "getGitFileDiff"
  | "getGitChangeStats"
  | "stageGitFile"
  | "unstageGitFile"
  | "discardGitFile"
  | "stageGitHunk"
  | "unstageGitHunk"
  | "discardGitHunk"
  | "stageGitLines"
  | "unstageGitLines"
  | "discardGitLines"
  | "sendReviewComments"
  | "getDraftGit"
  | "getWorktreeSetupScript"
  | "approveWorktreeSetup"
  | "getTaskWorktree"
  | "mergeTaskWorktree"
  | "discardTaskWorktree"
  | "cleanupOrphanWorktrees"
  | "commitGit"
  | "getLastCommit"
  | "generateCommitMessage"
  | "cancelCommitMessage"
  | "pushGit"
  | "createPullRequest"
  | "openTaskPullRequest"
> = {
  getGitStatus: async (taskId) => {
    const pool = await getTaskPool();
    return getGitStatus(pool.taskGitContext(parseTaskId(taskId)).cwd);
  },

  getGitFileDiff: async (taskId, path, area, context, ignoreWhitespace) => {
    const pool = await getTaskPool();
    return getFileDiff(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(path, "path", 1024),
      parseArea(area),
      parseOneOf<GitDiffContext>(context, "context", ["hunks", "file"]),
      parseBoolean(ignoreWhitespace, "ignoreWhitespace"),
    );
  },

  getGitChangeStats: async (taskId) => {
    const pool = await getTaskPool();
    return getChangeStats(pool.taskGitContext(parseTaskId(taskId)).cwd);
  },

  stageGitFile: async (taskId, path) => {
    const pool = await getTaskPool();
    return stageFile(pool.taskGitContext(parseTaskId(taskId)).cwd, parseString(path, "path", 1024));
  },

  unstageGitFile: async (taskId, path) => {
    const pool = await getTaskPool();
    return unstageFile(pool.taskGitContext(parseTaskId(taskId)).cwd, parseString(path, "path", 1024));
  },

  discardGitFile: async (taskId, path) => {
    const pool = await getTaskPool();
    return discardFile(pool.taskGitContext(parseTaskId(taskId)).cwd, parseString(path, "path", 1024));
  },

  stageGitHunk: async (taskId, path, hunk) => {
    const pool = await getTaskPool();
    return stageHunk(pool.taskGitContext(parseTaskId(taskId)).cwd, parseString(path, "path", 1024), parseHunkRef(hunk));
  },

  unstageGitHunk: async (taskId, path, hunk) => {
    const pool = await getTaskPool();
    return unstageHunk(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(path, "path", 1024),
      parseHunkRef(hunk),
    );
  },

  discardGitHunk: async (taskId, path, hunk) => {
    const pool = await getTaskPool();
    return discardHunk(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(path, "path", 1024),
      parseHunkRef(hunk),
    );
  },

  stageGitLines: async (taskId, path, ref) => {
    const pool = await getTaskPool();
    return stageLines(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(path, "path", 1024),
      parseLinesRef(ref),
    );
  },

  unstageGitLines: async (taskId, path, ref) => {
    const pool = await getTaskPool();
    return unstageLines(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(path, "path", 1024),
      parseLinesRef(ref),
    );
  },

  discardGitLines: async (taskId, path, ref) => {
    const pool = await getTaskPool();
    return discardLines(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(path, "path", 1024),
      parseLinesRef(ref),
    );
  },

  sendReviewComments: async (taskId, comments, whenBusy) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const parsed = parseReviewComments(comments);
    // 评论里的文件路径最终会出现在发给 agent 的消息里，agent 会据此读文件：必须落在任务的仓库内（review-comments.md）。
    const root = await requireRepoRoot(pool.taskGitContext(id).cwd);
    for (const comment of parsed) comment.file = checkRepoPath(root, comment.file);
    await pool.sendPrompt(id, {
      text: formatReviewComments(parsed, resolveLocale()),
      whenBusy: parseOneOf(whenBusy, "whenBusy", ["steer", "followUp"]),
    });
  },

  getDraftGit: async (projectId) => {
    const pool = await getTaskPool();
    const id = parseProjectId(projectId);
    const projectPath = pool.projectPath(id);
    if (!(await isRepoRootProject(projectPath))) return null;
    return { branch: await currentBranch(projectPath) };
  },

  getWorktreeSetupScript: async (projectId) => {
    const pool = await getTaskPool();
    const id = parseProjectId(projectId);
    const projectPath = pool.projectPath(id);
    const script = await findSetupScript(projectPath);
    if (!script) return null;
    return {
      name: script.name,
      sha256: script.sha256,
      approved: await getSetupConsent().isApproved(projectPath, script.sha256),
    };
  },

  approveWorktreeSetup: async (projectId, sha256) => {
    const pool = await getTaskPool();
    const id = parseProjectId(projectId);
    const projectPath = pool.projectPath(id);
    const script = await findSetupScript(projectPath);
    // 只确认用户看到的那份：脚本已经变了（或没了）就拒绝，界面重新取、重新问。
    if (!script || script.sha256 !== parseString(sha256, "sha256", 64))
      throw new Error("the setup script changed; review it again");
    await getSetupConsent().approve(projectPath, script.sha256);
    log.info("worktree setup script approved");
  },

  getTaskWorktree: async (taskId) => {
    const pool = await getTaskPool();
    const { projectPath, worktree } = pool.taskGitContext(parseTaskId(taskId));
    return worktree ? worktreeInfo(projectPath, worktree.branch, worktree.base) : null;
  },

  mergeTaskWorktree: async (taskId) => {
    const pool = await getTaskPool();
    const { projectPath, worktree } = pool.taskGitContext(parseTaskId(taskId));
    if (!worktree) throw new Error("the task has no worktree");
    const result = await mergeWorktree(projectPath, worktree.path, worktree.branch, worktree.base);
    log.info("worktree merge", { result: result.kind });
    return result;
  },

  discardTaskWorktree: async (taskId) => (await getTaskPool()).discardWorktree(parseTaskId(taskId)),

  cleanupOrphanWorktrees: async (projectId) => {
    const pool = await getTaskPool();
    const id = parseProjectId(projectId);
    const result = await cleanupOrphanWorktrees(
      await requireRepoRoot(pool.projectPath(id)),
      pool.referencedWorktreePaths(id),
    );
    log.info("orphan worktrees cleaned", { removed: result.removed.length, kept: result.kept.length });
    return result;
  },

  commitGit: async (taskId, message, stageAll, amend) => {
    const pool = await getTaskPool();
    const result = await commit(
      pool.taskGitContext(parseTaskId(taskId)).cwd,
      parseString(message, "message", 20_000),
      parseBoolean(stageAll, "stageAll"),
      parseBoolean(amend, "amend"),
    );
    log.info("git commit", { result: result.kind });
    return result;
  },

  getLastCommit: async (taskId) => {
    const pool = await getTaskPool();
    return lastCommit(pool.taskGitContext(parseTaskId(taskId)).cwd);
  },

  generateCommitMessage: async (taskId) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    const { cwd } = pool.taskGitContext(id);
    if (generating.has(id)) throw new Error("a commit message is already being generated for this task");
    const controller = new AbortController();
    generating.set(id, controller);
    try {
      const result = await generateCommitMessage(cwd, await commitOmp(), controller.signal);
      log.info("git commit message generated", { result: result.kind });
      return result;
    } finally {
      generating.delete(id);
    }
  },

  cancelCommitMessage: async (taskId) => {
    generating.get(parseTaskId(taskId))?.abort();
  },

  pushGit: async (taskId) => {
    const pool = await getTaskPool();
    const result = await push(pool.taskGitContext(parseTaskId(taskId)).cwd);
    log.info("git push", { result: result.kind });
    return result;
  },

  createPullRequest: async (taskId, input) => {
    const pool = await getTaskPool();
    const record = parseRecord(input, "input");
    const { cwd, worktree } = pool.taskGitContext(parseTaskId(taskId));
    const result = await createPullRequest(
      cwd,
      {
        title: parseString(record["title"], "input.title", 300),
        body: parseString(record["body"], "input.body", 60_000, { allowEmpty: true }),
      },
      worktree?.base ?? null,
    );
    log.info("gh pr create", { result: result.kind });
    return result;
  },

  openTaskPullRequest: async (taskId) => {
    const pool = await getTaskPool();
    const id = parseTaskId(taskId);
    // PR 号取主进程记的（omp 的标题），不信渲染进程。
    const number = pool.taskPullRequest(id);
    if (number === null) throw new Error("this task has no pull request");
    const url = await taskPullRequestUrl(pool.taskGitContext(id).cwd, number);
    await shell.openExternal(parseExternalUrl(url));
  },
};

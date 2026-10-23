// git 菜单里各个动作的执行与结果提示：主进程返回的类型化结果在这里翻译成当前语言，错误一律弹 toast。
import type {
  GitCommitResult,
  GitMergeResult,
  GitPullRequestResult,
  GitPushResult,
  TaskWorktreeInfo,
} from "../../../../shared/git.ts";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { clearSelection } from "../../store/index.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { openGitDialog } from "./git-dialog-store.ts";
import { refreshGit } from "./git-store.ts";

/** 新建 worktree 任务前：项目的 setup 脚本没确认过（或内容变了）就弹对话框问；false = 用户拒绝，不建 worktree。 */
export async function ensureSetupApproved(projectId: ProjectId): Promise<boolean> {
  const script = await window.studio.getWorktreeSetupScript(projectId);
  if (script === null || script.approved) return true;
  const { promise, resolve } = Promise.withResolvers<boolean>();
  openGitDialog({ kind: "setup", projectId, script, settle: resolve });
  return promise;
}

/** 提交结果 → 提示；true = 已提交。 */
function announceCommit(t: TFunction, result: GitCommitResult, amend: boolean): boolean {
  if (result.kind === "committed") {
    const commit = result.commit.slice(0, 8);
    pushToast({ message: t(amend ? "git.commit.amended" : "git.commit.done", { commit }) });
    return true;
  }
  if (result.kind === "nothing_to_commit") pushToast({ level: "warning", message: t("git.commit.nothing") });
  else pushToast({ level: "error", message: t("git.commit.failed"), title: result.message });
  return false;
}

/** 提交（提交对话框和评审里的提交框共用这一条路径）：提示结果、之后重读 git 状态；true = 已提交。amend = 改写上一次提交。 */
export async function commitChanges(
  t: TFunction,
  taskId: TaskId,
  message: string,
  stageAll: boolean,
  amend = false,
): Promise<boolean> {
  try {
    return announceCommit(t, await window.studio.commitGit(taskId, message, stageAll, amend), amend);
  } catch (error) {
    reportError(t, error, t("git.commit.failed"));
    return false;
  } finally {
    refreshGit(taskId);
  }
}

/** "生成提交信息"（omp commit）：结果翻译成提示；返回要填进提交框的标题和正文，没有可填的（取消、失败）为 null。 */
export async function generateCommitMessage(
  t: TFunction,
  taskId: TaskId,
): Promise<{ title: string; body: string } | null> {
  try {
    const result = await window.studio.generateCommitMessage(taskId);
    switch (result.kind) {
      case "generated":
        if (result.split !== null)
          pushToast({ level: "warning", message: t("git.generate.split", { count: result.split }) });
        return { title: result.title, body: result.body };
      case "nothing_staged":
        pushToast({ level: "warning", message: t("git.generate.nothing") });
        return null;
      case "no_model":
        pushToast({ level: "error", message: t("git.generate.noModel") });
        return null;
      case "failed":
        pushToast({ level: "error", message: t("git.generate.failed"), title: result.message });
        return null;
      case "cancelled":
        return null;
    }
  } catch (error) {
    reportError(t, error, t("git.generate.failed"));
    return null;
  }
}

/** 推送结果 → 提示；true = 已推送。quiet 时成功不弹（开 PR 流程里随后还有自己的提示）。 */
function announcePush(t: TFunction, result: GitPushResult, quiet = false): boolean {
  switch (result.kind) {
    case "pushed":
      if (!quiet) pushToast({ message: t("git.push.done", { remote: result.remote, branch: result.branch }) });
      return true;
    case "no_remote":
      pushToast({ level: "warning", message: t("git.push.noRemote") });
      return false;
    case "detached_head":
      pushToast({ level: "warning", message: t("git.push.detached") });
      return false;
    case "rejected":
      pushToast({ level: "error", message: t("git.push.rejected"), title: result.message });
      return false;
    case "failed":
      pushToast({ level: "error", message: t("git.push.failed"), title: result.message });
      return false;
  }
}

/** PR 结果 → 提示；true = 已创建。 */
function announcePullRequest(t: TFunction, result: GitPullRequestResult): boolean {
  switch (result.kind) {
    case "created":
      pushToast({
        level: "info",
        message: t("git.pr.done"),
        title: result.url,
        durationMs: 12_000,
        action: { label: t("git.pr.open"), run: () => void window.studio.openExternal(result.url) },
      });
      return true;
    case "gh_unavailable":
      pushToast({ level: "warning", message: t("git.pr.ghUnavailable") });
      return false;
    case "gh_unauthenticated":
      pushToast({ level: "warning", message: t("git.pr.ghUnauthenticated") });
      return false;
    case "failed":
      pushToast({ level: "error", message: t("git.pr.failed"), title: result.message });
      return false;
  }
}

export async function pushBranch(t: TFunction, taskId: TaskId): Promise<void> {
  try {
    announcePush(t, await window.studio.pushGit(taskId));
  } catch (error) {
    reportError(t, error, t("git.push.failed"));
  }
  refreshGit(taskId);
}

/** 先推送再 gh pr create：推送没成功就停在推送的提示上。 */
export async function pushAndCreatePullRequest(
  t: TFunction,
  taskId: TaskId,
  input: { title: string; body: string },
): Promise<boolean> {
  try {
    if (!announcePush(t, await window.studio.pushGit(taskId), true)) return false;
    return announcePullRequest(t, await window.studio.createPullRequest(taskId, input));
  } catch (error) {
    reportError(t, error, t("git.pr.failed"));
    return false;
  } finally {
    refreshGit(taskId);
  }
}

function announceMerge(t: TFunction, result: GitMergeResult, base: string): void {
  switch (result.kind) {
    case "merged":
      pushToast({ message: t("git.merge.done", { base }) });
      return;
    case "nothing_to_merge":
      pushToast({ level: "info", message: t("git.merge.nothing") });
      return;
    case "conflict":
      openGitDialog({ kind: "conflict", files: result.files });
      return;
    case "blocked": {
      const current = result.currentBranch ?? t("git.merge.detached");
      const params = { base, current };
      const message =
        result.reason === "worktree_dirty"
          ? t("git.merge.blocked.worktree_dirty", params)
          : result.reason === "base_dirty"
            ? t("git.merge.blocked.base_dirty", params)
            : t("git.merge.blocked.base_not_checked_out", params);
      pushToast({ level: "warning", message });
      return;
    }
  }
}

export async function mergeBack(t: TFunction, taskId: TaskId, info: TaskWorktreeInfo): Promise<void> {
  try {
    announceMerge(t, await window.studio.mergeTaskWorktree(taskId), info.baseBranch);
  } catch (error) {
    reportError(t, error);
  }
  refreshGit(taskId);
}

/** 丢弃 worktree：任务随之归档，当前选中的话回到空状态。 */
export async function discardWorktree(t: TFunction, taskId: TaskId, selectedTaskId: TaskId | null): Promise<boolean> {
  try {
    await window.studio.discardTaskWorktree(taskId);
  } catch (error) {
    reportError(t, error);
    return false;
  }
  if (selectedTaskId === taskId) clearSelection();
  pushToast({ message: t("git.discard.done") });
  return true;
}

export async function cleanupOrphans(t: TFunction, projectId: ProjectId): Promise<void> {
  try {
    openGitDialog({ kind: "cleanup", result: await window.studio.cleanupOrphanWorktrees(projectId) });
  } catch (error) {
    reportError(t, error);
  }
}

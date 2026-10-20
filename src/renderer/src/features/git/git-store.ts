// worktree 和 git 的界面状态：主进程是权威，这里只缓存读到的值，并在操作之后让它们重读。
// - 任务的 worktree 信息（侧栏任务行和主区 git 条共用）；
// - 草稿输入框的"工作树"胶囊：按项目记开关，以及创建被拒绝后的原因（本次运行内有效）。
import { useEffect } from "react";
import type { TaskWorktreeInfo } from "../../../../shared/git.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import type { ProjectId, TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import { reportErrorNow } from "../../ui/errors.ts";

// ───── 任务的 worktree 信息 ─────

const worktrees = createStore<Readonly<Record<string, TaskWorktreeInfo | null>>>({});
/** 每次操作（提交、合并…）后递增，git 条据此重读状态。 */
const versions = createStore<Readonly<Record<string, number>>>({});

export function useGitVersion(taskId: TaskId): number {
  return useStoreValue(versions, (state) => state[taskId] ?? 0);
}

async function loadWorktree(taskId: TaskId): Promise<void> {
  try {
    const info = await window.studio.getTaskWorktree(taskId);
    worktrees.set({ ...worktrees.get(), [taskId]: info });
  } catch (error) {
    worktrees.set({ ...worktrees.get(), [taskId]: null });
    // 任务已被归档或移除（主进程报 unknown task）：没有 worktree 可显示，不打扰用户；其余错误要让用户看见。
    if (!(error instanceof Error && /unknown task/.test(error.message))) reportErrorNow(error);
  }
}

/** 任务的 worktree 信息；没有 worktree 或还没读到是 null。updatedAt 变了（一轮结束等）就重读领先提交数。 */
export function useTaskWorktree(taskId: TaskId, updatedAt: number): TaskWorktreeInfo | null {
  const version = useGitVersion(taskId);
  useEffect(() => {
    void loadWorktree(taskId);
  }, [taskId, updatedAt, version]);
  return useStoreValue(worktrees, (state) => state[taskId] ?? null);
}

/** 一次 git 操作之后调用：git 条重读状态，worktree 信息重读。 */
export function refreshGit(taskId: TaskId): void {
  versions.set({ ...versions.get(), [taskId]: (versions.get()[taskId] ?? 0) + 1 });
}

// ───── 草稿的工作树胶囊 ─────

interface WorktreeDraft {
  on: boolean;
  /** 创建被主进程拒绝的原因（不是仓库、没有提交…）；有值时胶囊禁用。 */
  blocked: MessageKey | null;
}

const drafts = createStore<Readonly<Record<string, WorktreeDraft>>>({});
const offDraft: WorktreeDraft = { on: false, blocked: null };

export function useWorktreeDraft(projectId: ProjectId): WorktreeDraft {
  return useStoreValue(drafts, (state) => state[projectId] ?? offDraft);
}

export function getWorktreeDraft(projectId: ProjectId): WorktreeDraft {
  return drafts.get()[projectId] ?? offDraft;
}

export function setWorktreeOn(projectId: ProjectId, on: boolean): void {
  drafts.set({ ...drafts.get(), [projectId]: { ...getWorktreeDraft(projectId), on } });
}

export function blockWorktree(projectId: ProjectId, reason: MessageKey): void {
  drafts.set({ ...drafts.get(), [projectId]: { on: false, blocked: reason } });
}

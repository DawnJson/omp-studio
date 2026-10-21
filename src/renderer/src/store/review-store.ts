// 评审模式的界面状态：哪个任务正在评审、每个任务攒下的待发评论。
// 评论队列在评审关闭后继续保留（同一任务再打开还在），发送成功后才清空；任务被删除时一并丢弃。只在内存里，重启应用即清空。
import { REVIEW_COMMENTS_MAX, type GitDiffContext } from "../../../shared/git.ts";
import type { TaskId } from "../../../shared/ipc.ts";
import type { CommentDraft, QueuedComment } from "../../../shared/ui/review-model.ts";
import { createStore, useStoreValue } from "./create-store.ts";

interface ReviewState {
  openTaskId: TaskId | null;
  /** 统一 / 并排、改动块 / 整个文件、是否折行：整个会话里记住，下次打开评审沿用。 */
  mode: "unified" | "split";
  scope: GitDiffContext;
  wrap: boolean;
  comments: Readonly<Record<string, readonly QueuedComment[]>>;
}

const reviewStore = createStore<ReviewState>({
  openTaskId: null,
  mode: "unified",
  scope: "hunks",
  wrap: true,
  comments: {},
});
const NONE: readonly QueuedComment[] = [];
let nextId = 1;

export function openReview(taskId: TaskId): void {
  reviewStore.set({ ...reviewStore.get(), openTaskId: taskId });
}

export function setReviewMode(mode: "unified" | "split"): void {
  reviewStore.set({ ...reviewStore.get(), mode });
}

export function setReviewScope(scope: GitDiffContext): void {
  reviewStore.set({ ...reviewStore.get(), scope });
}

export function setReviewWrap(wrap: boolean): void {
  reviewStore.set({ ...reviewStore.get(), wrap });
}

export function closeReview(): void {
  reviewStore.set({ ...reviewStore.get(), openTaskId: null });
}

function setComments(taskId: TaskId, next: readonly QueuedComment[]): void {
  const { [taskId]: _old, ...rest } = reviewStore.get().comments;
  reviewStore.set({ ...reviewStore.get(), comments: next.length === 0 ? rest : { ...rest, [taskId]: next } });
}

/** 加一条评论；队列已满（REVIEW_COMMENTS_MAX，主进程的上限）时返回 false。 */
export function addComment(taskId: TaskId, draft: CommentDraft): boolean {
  const current = reviewStore.get().comments[taskId] ?? NONE;
  if (current.length >= REVIEW_COMMENTS_MAX) return false;
  setComments(taskId, [...current, { ...draft, id: `rc-${nextId++}` }]);
  return true;
}

export function updateComment(taskId: TaskId, id: string, body: string): void {
  const current = reviewStore.get().comments[taskId] ?? NONE;
  setComments(
    taskId,
    current.map((comment) => (comment.id === id ? { ...comment, body } : comment)),
  );
}

export function removeComment(taskId: TaskId, id: string): void {
  const current = reviewStore.get().comments[taskId] ?? NONE;
  setComments(
    taskId,
    current.filter((comment) => comment.id !== id),
  );
}

export function clearComments(taskId: TaskId): void {
  setComments(taskId, NONE);
}

export function startReviewStore(): void {
  window.studio.onTaskRemoved((taskId) => {
    const state = reviewStore.get();
    if (state.openTaskId === taskId) closeReview();
    clearComments(taskId);
  });
}

export function useReviewTaskId(): TaskId | null {
  return useStoreValue(reviewStore, (state) => state.openTaskId);
}

export function useReviewComments(taskId: TaskId | null): readonly QueuedComment[] {
  return useStoreValue(reviewStore, (state) => (taskId === null ? NONE : (state.comments[taskId] ?? NONE)));
}

export function useReviewMode(): "unified" | "split" {
  return useStoreValue(reviewStore, (state) => state.mode);
}

export function useReviewScope(): GitDiffContext {
  return useStoreValue(reviewStore, (state) => state.scope);
}

export function useReviewWrap(): boolean {
  return useStoreValue(reviewStore, (state) => state.wrap);
}

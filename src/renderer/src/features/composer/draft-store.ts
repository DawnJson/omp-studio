// 输入框草稿（按任务）：内存里一份，文字经主进程防抖存盘（下面的持久化段），图片和大段粘贴原文不存。
import { reportErrorNow } from "../../ui/errors.ts";
import type { PromptImage, TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";
import {
  appendDraft,
  draftFromRestored,
  EMPTY_DRAFT,
  persistedText,
  reconcileDraft,
  type Draft,
} from "./composer-tokens.ts";

export type { Draft } from "./composer-tokens.ts";

/** 和主进程 draft-handlers.ts 的 maxChars 一致。 */
const maxPersistedChars = 200_000;

const drafts = createStore<Readonly<Record<string, Draft>>>({});

export function useDraft(taskId: TaskId): Draft {
  return useStoreValue(drafts, (state) => state[taskId] ?? EMPTY_DRAFT);
}

export function getDraft(taskId: TaskId): Draft {
  return drafts.get()[taskId] ?? EMPTY_DRAFT;
}

export function setDraft(taskId: TaskId, draft: Draft): void {
  drafts.set({ ...drafts.get(), [taskId]: draft });
  scheduleSave(taskId, persistedText(draft, maxPersistedChars));
}

/** 换掉文字；文字里不再引用的附件（图片、大段粘贴）跟着删。 */
export function setDraftText(taskId: TaskId, text: string): void {
  setDraft(taskId, reconcileDraft({ ...getDraft(taskId), text }));
}

/** 清空草稿（发送后）。 */
export function clearDraft(taskId: TaskId): void {
  setDraft(taskId, EMPTY_DRAFT);
}

// ───── 持久化：文字经主进程存盘（防抖），图片不存 ─────
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingText = new Map<string, string>();
const touched = new Set<string>();
const lastSaved = new Map<string, string>();

function scheduleSave(key: string, text: string): void {
  touched.add(key);
  if (lastSaved.get(key) === text) return;
  clearTimeout(saveTimers.get(key));
  pendingText.set(key, text);
  saveTimers.set(
    key,
    setTimeout(() => flushKey(key), 400),
  );
}

function flushKey(key: string): void {
  clearTimeout(saveTimers.get(key));
  saveTimers.delete(key);
  const text = pendingText.get(key);
  pendingText.delete(key);
  if (text === undefined) return;
  lastSaved.set(key, text);
  window.studio.saveDraft(key, text).catch(reportErrorNow);
}

/** 立刻把还在防抖里的草稿发给主进程：关窗、刷新、切后台时调用，否则最后几个字会丢。 */
function flushDrafts(): void {
  // 先拷一份 key：flushKey 会从 pendingText 里删。
  for (const key of Array.from(pendingText.keys())) flushKey(key);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushDrafts);
  window.addEventListener("beforeunload", flushDrafts);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushDrafts());
}

// 任务删除：内存里的草稿、待存的定时器和记录一并丢（主进程那边的 drafts.json 条目由主进程删）。草稿页的键是按项目的，不会等于任务 id。
if (typeof window !== "undefined" && "studio" in window) {
  window.studio.onTaskRemoved((taskId) => {
    clearTimeout(saveTimers.get(taskId));
    saveTimers.delete(taskId);
    pendingText.delete(taskId);
    touched.delete(taskId);
    lastSaved.delete(taskId);
    const { [taskId]: _removed, ...rest } = drafts.get();
    drafts.set(rest);
  });
}

/** 启动时把已存的草稿读回来；用户在读回来之前已经打过字的 key 不覆盖。 */
if (typeof window !== "undefined" && "studio" in window) {
  window.studio.getDrafts().then((saved) => {
    const restored: Record<string, Draft> = {};
    for (const [key, text] of Object.entries(saved)) {
      lastSaved.set(key, text);
      if (!touched.has(key)) restored[key] = { ...EMPTY_DRAFT, text };
    }
    drafts.set({ ...restored, ...drafts.get() });
  }, reportErrorNow);
}

/** 把撤回的排队消息放回草稿末尾（空行分隔，图片作为附件）。 */
export function appendToDraft(taskId: TaskId, texts: readonly string[], images: readonly PromptImage[] = []): void {
  setDraft(taskId, appendDraft(getDraft(taskId), draftFromRestored(texts, images)));
}

/** 发送失败：把整份草稿（文字、图片、大段粘贴）接回现在的草稿后面。 */
export function restoreDraft(taskId: TaskId, draft: Draft): void {
  setDraft(taskId, appendDraft(getDraft(taskId), draft));
}

/** omp 往它自己（studio 不画）的输入框里写了文字（Ctrl+R 选中的历史、⌥↑ 取回的排队消息、`/annotate`、`/plan` 预填）：主进程已清空那边，接进这个任务的草稿。 */
if (typeof window !== "undefined" && "studio" in window) {
  window.studio.onComposerPrefill(({ taskId, text }) => appendToDraft(taskId, [text]));
}

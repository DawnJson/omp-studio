// 输入框草稿（按任务）。spec 要求由主进程持久化，契约里还没有对应接口，先放在渲染进程内存里：切任务不丢，重启丢。
import { reportErrorNow } from "../../ui/errors.ts";
import type { PromptImage, TaskId } from "../../../../shared/ipc.ts";
import { createStore, useStoreValue } from "../../store/create-store.ts";

export interface Draft {
  text: string;
  images: readonly PromptImage[];
}

const emptyDraft: Draft = { text: "", images: [] };

const drafts = createStore<Readonly<Record<string, Draft>>>({});
/** set_editor_text 建议的文本；输入框已有草稿时先问"替换/保留"。 */
const suggestions = createStore<Readonly<Record<string, string>>>({});

export function useDraft(taskId: TaskId): Draft {
  return useStoreValue(drafts, (state) => state[taskId] ?? emptyDraft);
}

export function getDraft(taskId: TaskId): Draft {
  return drafts.get()[taskId] ?? emptyDraft;
}

export function setDraft(taskId: TaskId, draft: Draft): void {
  drafts.set({ ...drafts.get(), [taskId]: draft });
}

export function setDraftText(taskId: TaskId, text: string): void {
  setDraft(taskId, { ...getDraft(taskId), text });
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

drafts.subscribe(() => {
  for (const [key, draft] of Object.entries(drafts.get())) scheduleSave(key, draft.text);
});

/** 启动时把已存的草稿读回来；用户在读回来之前已经打过字的 key 不覆盖。 */
if (typeof window !== "undefined" && "studio" in window) {
  window.studio.getDrafts().then((saved) => {
    const restored: Record<string, Draft> = {};
    for (const [key, text] of Object.entries(saved)) {
      lastSaved.set(key, text);
      if (!touched.has(key)) restored[key] = { text, images: [] };
    }
    drafts.set({ ...restored, ...drafts.get() });
  }, reportErrorNow);
}

/** 把撤回的排队消息放回草稿末尾（空行分隔，图片作为附件）。 */
export function appendToDraft(taskId: TaskId, texts: readonly string[], images: readonly PromptImage[] = []): void {
  const current = getDraft(taskId);
  const added = texts.filter((text) => text !== "");
  const text = [current.text, ...added].filter((part) => part !== "").join("\n\n");
  setDraft(taskId, { text, images: [...current.images, ...images] });
}

export function suggestEditorText(taskId: TaskId, text: string): void {
  if (getDraft(taskId).text === "" && getDraft(taskId).images.length === 0) setDraftText(taskId, text);
  else suggestions.set({ ...suggestions.get(), [taskId]: text });
}

export function useEditorSuggestion(taskId: TaskId): string | null {
  return useStoreValue(suggestions, (state) => state[taskId] ?? null);
}

export function resolveSuggestion(taskId: TaskId, replace: boolean): void {
  const text = suggestions.get()[taskId];
  const { [taskId]: _removed, ...rest } = suggestions.get();
  suggestions.set(rest);
  if (replace && text !== undefined) setDraftText(taskId, text);
}

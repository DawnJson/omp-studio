// 从对话里往当前任务的输入框放东西（代码块的"引用"、用户消息的"编辑"）：草稿末尾接上，光标放到末尾，焦点给输入框。
import type { TaskId } from "../../../../shared/ipc.ts";
import { requestCaret } from "./caret-request.ts";
import { appendToDraft, getDraft } from "./draft-store.ts";

/** 光标落到草稿末尾，焦点给输入框（当前任务的输入框；光标在输入框下一次布局时由 ComposerInput 取走）。 */
export function focusDraftEnd(taskId: TaskId): void {
  requestCaret(taskId, getDraft(taskId).text.length);
  document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus({ preventScroll: true });
}

/** 代码里最长的一串反引号再多一个（至少三个）：代码本身含 ``` 时围栏不会被提前闭合。 */
function fenceFor(code: string): string {
  const longest = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/** 代码块引用进草稿：带语言的围栏代码块，后面空一行接着写。 */
export function quoteCodeIntoDraft(taskId: TaskId, code: string, lang: string): void {
  const fence = fenceFor(code);
  appendToDraft(taskId, [{ text: `${fence}${lang}\n${code}\n${fence}\n` }]);
  focusDraftEnd(taskId);
}

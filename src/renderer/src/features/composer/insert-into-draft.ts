// 从对话或文件树往当前任务的输入框放东西：代码块的"引用"、用户消息的"编辑"接在草稿末尾；文件树的 @ 插在光标处。
import type { TaskId } from "../../../../shared/ipc.ts";
import { requestCaret } from "./caret-request.ts";
import { appendToDraft, getDraft, setDraftText } from "./draft-store.ts";

/** 光标落到草稿末尾，焦点给输入框（当前任务的输入框；光标在输入框下一次布局时由 ComposerInput 取走）。 */
export function focusDraftEnd(taskId: TaskId): void {
  requestCaret(taskId, getDraft(taskId).text.length);
  document.querySelector<HTMLTextAreaElement>("[data-composer-input]")?.focus({ preventScroll: true });
}

/**
 * 在输入框光标处插入一段文字（选中的文字被替换），前后不是空白就补一个空格，焦点给输入框。
 * 走输入框自己的编辑（execCommand insertText，同提示词增强）：原生 Ctrl+Z 能撤回，草稿由输入框的 onChange 写回。
 * 输入框不在页面上时接在草稿末尾。
 */
export function insertAtCaret(draftKey: TaskId, text: string): void {
  const field = document.querySelector<HTMLTextAreaElement>("[data-composer-input]");
  if (field !== null) {
    field.focus({ preventScroll: true });
    const before = field.value.slice(0, field.selectionStart);
    const after = field.value.slice(field.selectionEnd);
    const lead = before === "" || /\s$/.test(before) ? "" : " ";
    const trail = /^\s/.test(after) ? "" : " ";
    if (document.execCommand("insertText", false, `${lead}${text}${trail}`)) return;
  }
  const current = getDraft(draftKey).text;
  setDraftText(draftKey, `${current}${current === "" || /\s$/.test(current) ? "" : " "}${text} `);
  focusDraftEnd(draftKey);
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

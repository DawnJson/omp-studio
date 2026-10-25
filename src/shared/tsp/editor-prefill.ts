// omp 往它自己（studio 不画）的输入框里写的文字：studio 的 `send` 事件直接提交、从不往那里填字（只有带图片的消息会填，期间 `#editorClaims` 让开，见 image-paste.ts），所以其余时候输入框里出现的任何文字都不是 studio 发的，
// 是 omp 自己放进去的——要么是用户在 omp 里的操作（Ctrl+R 历史搜索选中的条目、⌥↑ 取回最后一条排队消息）、要么是命令的预填
// （`/annotate` 的批注、`/plan` 的预填、回溯到某条用户消息时填回它的文字）、要么是 Esc 中断时退回的排队消息。
// 通用规则（tsp-runner 的 `#syncEditorText`）：看到非空文字，就读出来交给 studio 的输入框，再发 `edit` 清空 omp 那边（否则下一次
// 预填会被"只在输入框为空时才填"挡住，文字也会一直留在 omp 那边）。依据：omp 18.12.5 / 18.12.6 实录，见 docs/architecture/composer-attachments.md「omp 输入框回填」。
import type { TspDocument } from "./document.ts";
import { findComposerEditor, type TspComposerEditor } from "./session-tree.ts";
import type { TspEvent } from "./tsp.generated.ts";

/** omp 输入框里现在的文字（非空才算）；输入框没有（被提问 / 审批换掉、还没出现）或是空的为 null。 */
export function foreignEditorText(doc: TspDocument): TspComposerEditor | null {
  const editor = findComposerEditor(doc);
  return editor !== null && editor.text !== "" ? editor : null;
}

/** 清空 omp 输入框的 `edit` 事件（整段替换成空）。 */
export function clearEditorEvent(editor: TspComposerEditor): TspEvent {
  return {
    ev: "edit",
    sf: editor.sf,
    id: editor.id,
    from: 0,
    to: editor.text.length,
    text: "",
    cursor: 0,
    len: editor.text.length,
  };
}

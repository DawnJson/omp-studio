// omp 的"取回排队消息"（⌥↑ 键、队列条上的 `Edit Alt+↑` 按钮，action `queue.edit`）：omp 把最后一条排队消息写进**它自己的**输入框
// （实测 18.12.5：toast "Restored last queued message to editor" + `["text","3.line/input","append",…]`），studio 不画那个输入框。
// 这里等那段文字出现，交给调用方放进 studio 输入框的草稿，再清空 omp 的输入框。依赖都从参数传，测试不碰 DOM。
import type { TspEvent } from "./tsp.generated.ts";
import type { TspDocument } from "./document.ts";
import { restoredQueueEditor } from "./queue-restore.ts";

export const DEQUEUE_WAIT_MS = 3000;

export interface DequeueDeps {
  document(): TspDocument | null;
  /** 订阅"文档又应用了一批消息"，返回取消函数。 */
  subscribe(listener: () => void): () => void;
  /** 把取回的文字放进 studio 输入框的草稿。 */
  appendToDraft(text: string): void;
  /** 清空 omp 输入框的 `edit` 事件。 */
  sendEvent(event: TspEvent): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** 开始等；文字出现（或 `DEQUEUE_WAIT_MS` 到时）后自己收尾。必须在把键 / 动作发给 omp 之前调用，免得帧先到。 */
export function restoreDequeuedQueue(deps: DequeueDeps): void {
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  const finish = (): void => {
    if (timer !== null) deps.clearTimeout(timer);
    unsubscribe?.();
  };
  const check = (): void => {
    const doc = deps.document();
    const editor = doc === null ? null : restoredQueueEditor(doc);
    if (editor === null) return;
    finish();
    deps.appendToDraft(editor.text);
    deps.sendEvent({
      ev: "edit",
      sf: editor.sf,
      id: editor.id,
      from: 0,
      to: editor.text.length,
      text: "",
      cursor: 0,
      len: editor.text.length,
    });
  };
  unsubscribe = deps.subscribe(check);
  timer = deps.setTimeout(finish, DEQUEUE_WAIT_MS);
}

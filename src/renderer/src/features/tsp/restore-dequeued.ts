// 取回排队消息（⌥↑ 键和队列条的 `Edit` 按钮共用）：把 omp 写回它自己输入框的文字搬进 studio 的草稿，逻辑见 shared/tsp/dequeue-restore.ts。
import type { TaskId } from "../../../../shared/ipc.ts";
import { restoreDequeuedQueue } from "../../../../shared/tsp/dequeue-restore.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { appendToDraft } from "../composer/draft-store.ts";
import { peekTspDocument, subscribeTspBatches } from "./tsp-store.ts";

/** 在把键 / 动作发给 omp 之前调用。 */
export function restoreDequeued(taskId: TaskId): void {
  restoreDequeuedQueue({
    document: () => peekTspDocument(taskId),
    subscribe: (listener) => subscribeTspBatches(taskId, listener),
    appendToDraft: (text) => appendToDraft(taskId, [text]),
    sendEvent: (event) => {
      window.studio.sendTspEvent(taskId, event).catch((error: unknown) => reportErrorNow(error));
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
}

// omp 自己的快捷键（⇧Tab、⌃T、⌃P、⌥P、⌥⇧P、⌃R、F5、键帽提示上的键）：焦点在 studio 输入框 / tsp-view 里、studio 没有占用这个键时，
// 编码后写给这个任务的 omp（和 list、提问对话框同一条 encodeKey → sendTspKeys 路径）。判定见 src/shared/tsp/forward-keys.ts。
import { useEffect } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { chordOf, kbdChordsIn, shouldForwardChord } from "../../../../shared/tsp/forward-keys.ts";
import type { EscTarget } from "../../../../shared/tsp/overlay-esc.ts";
import { hasQueuedMessages } from "../../../../shared/tsp/queue-restore.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { likeOf } from "./interactive/key-event.ts";
import { encodeKey } from "./keys.ts";
import { restoreDequeued } from "./restore-dequeued.ts";
import { peekTspDocument } from "./tsp-store.ts";

const EMPTY: ReadonlySet<string> = new Set();

function targetOf(target: EventTarget | null, view: Element): EscTarget {
  if (!(target instanceof Element) || target === document.body) return "body";
  if (target.closest('[data-testid="composer-input"]') !== null) return "composer";
  if (view.contains(target))
    return target.closest("textarea, input, [data-tspi-keys]") === null ? "view" : "self-routing";
  return "other";
}

export function useForwardOmpKeys(taskId: TaskId): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const view = document.querySelector(`[data-testid="tsp-view"][data-task-id="${taskId}"]`);
      if (view === null) return;
      const like = likeOf(event);
      if (
        !shouldForwardChord(
          { ...like, defaultPrevented: event.defaultPrevented, target: targetOf(event.target, view) },
          () => {
            const doc = peekTspDocument(taskId);
            return doc === null ? EMPTY : kbdChordsIn(doc);
          },
        )
      )
        return;
      const data = encodeKey(like);
      if (data === null) return;
      event.preventDefault();
      const doc = peekTspDocument(taskId);
      const dequeue = chordOf(like) === "alt+up" && doc !== null && hasQueuedMessages(doc);
      if (dequeue) restoreDequeued(taskId);
      window.studio.sendTspKeys(taskId, data).catch((error: unknown) => reportErrorNow(error));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskId]);
}

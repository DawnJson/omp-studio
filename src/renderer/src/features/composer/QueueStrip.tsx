// 队列条（spec 4.14）：只渲染 queue_update 快照，自己不另记。移除只有 removed:true 才算数，并把文字放回草稿。
import { reportError } from "../../ui/errors.ts";
import type { TaskId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { appendToDraft } from "./draft-store.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { useHeld } from "./use-held.ts";

const MAX_VISIBLE = 3;

interface Entry {
  text: string;
  queue: "steering" | "followUp";
}

export function QueueStrip({ taskId, queue }: { taskId: TaskId; queue: TaskState["queue"] }) {
  const t = useT();
  const entries: Entry[] = [
    ...queue.steering.map((text): Entry => ({ text, queue: "steering" })),
    ...queue.followUp.map((text): Entry => ({ text, queue: "followUp" })),
  ];
  // 队列清空后收起动画期间沿用清空前的行。
  const shown = useHeld(entries.length > 0 ? entries : null) ?? entries;
  const report = (error: unknown) => reportError(t, error);

  const remove = (entry: Entry) => {
    window.studio.removeQueuedMessage(taskId, entry.text, entry.queue).then((draft) => {
      if (draft) appendToDraft(taskId, [draft.text], draft.images ?? []);
    }, report);
  };
  const promote = (entry: Entry) => {
    window.studio.promoteQueuedMessage(taskId, entry.text).catch(report);
  };

  return (
    <Reveal open={entries.length > 0}>
      <div className="queue" role="list" aria-label={t("composer.queue.aria")} data-testid="queue-strip">
        {shown.slice(0, MAX_VISIBLE).map((entry, index) => (
          <div key={`${entry.queue}:${index}:${entry.text}`} className="queue-item" role="listitem">
            <span className="queue-tag" data-kind={entry.queue}>
              {entry.queue === "steering" ? t("composer.steer") : t("composer.later")}
            </span>
            <span className="queue-text">{entry.text.split("\n")[0]}</span>
            {entry.queue === "followUp" && (
              <button type="button" className="queue-btn" onClick={() => promote(entry)}>
                {t("composer.queue.promote")}
              </button>
            )}
            <button
              type="button"
              className="queue-icon"
              aria-label={t("composer.queue.remove")}
              title={t("composer.queue.remove")}
              onClick={() => remove(entry)}
            >
              <Close size={14} />
            </button>
          </div>
        ))}
        {shown.length > MAX_VISIBLE && (
          <div className="queue-more">{t("composer.queue.more", { n: shown.length - MAX_VISIBLE })}</div>
        )}
      </div>
    </Reveal>
  );
}

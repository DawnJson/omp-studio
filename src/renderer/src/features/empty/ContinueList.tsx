// "继续"列表（spec §4.7）：最近的会话，含终端里的；点击在 Studio 中恢复。加载失败就地提示并可重试。
import { useState } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { selectTask } from "../../store/index.ts";
import { describeError, errorDetail, reportError } from "../../ui/errors.ts";
import { formatTaskTime, useNow } from "../sidebar/task-time.ts";
import type { SessionsState } from "./use-sessions.ts";

export function ContinueList({ sessions, error, retry }: SessionsState) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const [resuming, setResuming] = useState<string | null>(null);

  const resume = (session: SessionSummary) => {
    if (resuming !== null) return;
    setResuming(session.id);
    window.studio
      .resumeSession(session.id)
      .then((task) => selectTask(task.id))
      .catch((cause: unknown) => reportError(t, cause, (message) => t("history.resumeFailed", { message })))
      .finally(() => setResuming(null));
  };

  if (error !== null) {
    return (
      <div className="empty-continue empty-continue-error" role="alert" title={errorDetail(error)}>
        <span className="empty-error">{t("history.listFailed", { message: describeError(t, error) })}</span>
        <button type="button" className="empty-link" onClick={retry}>
          {t("common.retry")}
        </button>
      </div>
    );
  }
  if (sessions.length === 0) return null;

  return (
    <section className="empty-continue" aria-labelledby="empty-continue-title">
      <h2 id="empty-continue-title" className="empty-section-title">
        {t("empty.continue")}
      </h2>
      <ul className="empty-list">
        {sessions.map((session) => (
          <li key={session.id}>
            <button
              type="button"
              className="empty-session"
              data-testid="empty-session"
              aria-busy={resuming === session.id}
              disabled={resuming !== null}
              onClick={() => resume(session)}
            >
              {session.taskId === null && (
                <span
                  className="empty-terminal-mark"
                  title={t("empty.fromTerminal")}
                  aria-label={t("empty.fromTerminal")}
                >
                  &gt;_
                </span>
              )}
              <span className="empty-session-title">
                {session.title ?? session.firstPrompt ?? t("history.untitled")}
              </span>
              <span className="empty-session-time">{formatTaskTime(t, locale, session.modifiedAt, now)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

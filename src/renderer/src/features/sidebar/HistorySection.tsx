// 侧栏的"历史会话"（spec §4.5）：omp 里还没挂在任务上的会话，常驻在项目分组下面。
// 两种排列，标题右边切换，选择记在外壳状态里（historyOrder）：
// - 按文件夹：按会话的 cwd 分组，组默认折叠成一行（文件夹名 + 条数），点开看这组的会话；
// - 按时间：全部会话从新到旧一列。
// 搜索时只列匹配的会话；按文件夹时有匹配的组全部展开。点开一条 = 恢复成任务。
import { useMemo, useState } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { Locale, SessionSummary } from "../../../../shared/ipc.ts";
import { groupSessionsByFolder } from "../../../../shared/ui/sidebar-model.ts";
import { formatTaskTime } from "../../../../shared/ui/task-time.ts";
import { setHistoryOrder, useShellUi } from "../../app/shell-store.ts";
import { selectTask } from "../../store/index.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { reportError } from "../../ui/errors.ts";
import { isDefaultFolder } from "../empty/default-folder.ts";
import { ChevronIcon, SessionIcon } from "./icons.tsx";
import { showMoreStep } from "./ProjectGroup.tsx";
import { sessionLabel } from "./use-history-sessions.ts";

/** 按时间时先显示几条。 */
const initialByTime = 8;
/** 按文件夹时，一个展开的组先显示几条。 */
const initialPerFolder = 5;

interface HistorySectionProps {
  /** 已按修改时间从新到旧；搜索时已经过滤好。 */
  sessions: readonly SessionSummary[];
  searching: boolean;
  chatsDir: string | null;
  t: TFunction;
  locale: Locale;
  now: number;
}

function SessionRow({
  session,
  t,
  locale,
  now,
}: {
  session: SessionSummary;
  t: TFunction;
  locale: Locale;
  now: number;
}) {
  const label = sessionLabel(session) ?? t("history.untitled");
  return (
    <button
      type="button"
      className="sb-row sb-row-main sb-session"
      data-nav={`session:${session.id}`}
      data-testid="sidebar-session"
      tabIndex={-1}
      title={`${label}\n${session.cwd}`}
      onClick={() =>
        void window.studio
          .resumeSession(session.id)
          .then((task) => selectTask(task.id))
          .catch((error: unknown) => reportError(t, error, (message) => t("history.resumeFailed", { message })))
      }
    >
      <SessionIcon />
      <span className="sb-row-title">{label}</span>
      <span className="sb-row-tail">{formatTaskTime(t, locale, session.modifiedAt, now)}</span>
    </button>
  );
}

function ShowMore({ remaining, onClick, t, nav }: { remaining: number; onClick(): void; t: TFunction; nav: string }) {
  return (
    <button
      type="button"
      className="sb-show-more"
      data-nav={nav}
      data-testid="sidebar-history-more"
      tabIndex={-1}
      onClick={onClick}
    >
      {t("sidebar.showMore", { n: Math.min(remaining, showMoreStep) })}
    </button>
  );
}

export function HistorySection({ sessions, searching, chatsDir, t, locale, now }: HistorySectionProps) {
  const order = useShellUi().historyOrder;
  const [timeLimit, setTimeLimit] = useState(initialByTime);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [folderLimits, setFolderLimits] = useState<Record<string, number>>({});
  const folders = useMemo(() => (order === "folder" ? groupSessionsByFolder(sessions) : []), [order, sessions]);
  if (sessions.length === 0) return null;

  const toggleFolder = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const shownByTime = searching ? sessions : sessions.slice(0, timeLimit);
  return (
    <section className="sb-group sb-history" aria-label={t("sidebar.searchHistory")} data-testid="sidebar-history">
      <div className="sb-history-head">
        <p className="sb-group-title">{t("sidebar.searchHistory")}</p>
        <div className="sb-history-order" role="group" aria-label={t("sidebar.historyOrder")}>
          {(["folder", "time"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="sb-history-order-btn"
              data-testid={`sidebar-history-by-${value}`}
              aria-pressed={order === value}
              onClick={() => setHistoryOrder(value)}
            >
              {t(value === "folder" ? "sidebar.historyByFolder" : "sidebar.historyByTime")}
            </button>
          ))}
        </div>
      </div>
      {order === "time" ? (
        <>
          {shownByTime.map((session) => (
            <SessionRow key={session.id} session={session} t={t} locale={locale} now={now} />
          ))}
          {!searching && sessions.length > timeLimit && (
            <ShowMore
              remaining={sessions.length - timeLimit}
              onClick={() => setTimeLimit((limit) => limit + showMoreStep)}
              t={t}
              nav="more:history"
            />
          )}
        </>
      ) : (
        folders.map((folder) => {
          const open = searching || expanded.has(folder.key);
          const limit = searching ? Infinity : (folderLimits[folder.key] ?? initialPerFolder);
          const label = isDefaultFolder(folder.cwd, chatsDir) ? t("empty.defaultFolder") : folder.label;
          return (
            <div key={folder.key} className="sb-history-folder" data-testid="sidebar-history-folder">
              <button
                type="button"
                className="sb-row sb-row-main sb-history-folder-head"
                data-nav={`history-folder:${folder.key}`}
                tabIndex={-1}
                aria-expanded={open}
                title={folder.cwd}
                onClick={() => toggleFolder(folder.key)}
              >
                <span className="sb-chevron" data-open={open || undefined}>
                  <ChevronIcon />
                </span>
                <span className="sb-row-title">{label}</span>
                <span className="sb-row-tail">{folder.sessions.length}</span>
              </button>
              <Reveal open={open}>
                <div className="sb-history-folder-body">
                  {folder.sessions.slice(0, limit).map((session) => (
                    <SessionRow key={session.id} session={session} t={t} locale={locale} now={now} />
                  ))}
                  {folder.sessions.length > limit && (
                    <ShowMore
                      remaining={folder.sessions.length - limit}
                      onClick={() =>
                        setFolderLimits((current) => ({
                          ...current,
                          [folder.key]: (current[folder.key] ?? initialPerFolder) + showMoreStep,
                        }))
                      }
                      t={t}
                      nav={`more:history:${folder.key}`}
                    />
                  )}
                </div>
              </Reveal>
            </div>
          );
        })
      )}
    </section>
  );
}

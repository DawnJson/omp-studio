// 命令面板（Ctrl K，spec §4.18）：居中浮层，键盘完整可用。开关在 ui-store（Ctrl K 由外壳监听）。
// 焦点：打开时记住 activeElement，关闭后还原；Tab 不动作（焦点只在输入框里）。
import { reportError } from "../../ui/errors.ts";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import { selectTask, setPaletteOpen, usePaletteOpen, useSelectedTaskId, useSettings, useTasks } from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { pushToast } from "../dialogs/index.ts";
import { useHiddenTasks } from "../sidebar/archive-store.ts";
import { CommandIcon, SearchIcon, SessionIcon, SlashIcon, TaskIcon } from "../sidebar/icons.tsx";
import { useProjects } from "../sidebar/projects-store.ts";
import { startDraft } from "../empty/index.ts";
import { projectLabels } from "../../../../shared/ui/sidebar-model.ts";
import { buildCommands } from "./palette-commands.ts";
import { useSlashCommands } from "./slash-commands.ts";
import { emitComposerText, setPendingDraftText } from "./studio-command.ts";
import { buildSections, type PaletteRow } from "../../../../shared/ui/palette-model.ts";
import "../sidebar/sidebar.css";
import "./palette.css";

function Highlight({ text, indices }: { text: string; indices: number[] }): ReactNode {
  if (indices.length === 0) return text;
  const hit = new Set(indices);
  return [...text].map((char, index) => (hit.has(index) ? <mark key={index}>{char}</mark> : <Fragment key={index}>{char}</Fragment>));
}

const rowIcon = { task: TaskIcon, session: SessionIcon, command: CommandIcon, slash: SlashIcon } as const;

function PaletteDialog() {
  const t = useT();
  const locale = useLocale();
  const listId = useId();
  const tasks = useTasks();
  const hidden = useHiddenTasks();
  const projects = useProjects();
  const settings = useSettings();
  const selectedTaskId = useSelectedTaskId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const restoreRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const activeRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visibleTasks = useMemo(() => tasks.filter((task) => !hidden.has(task.id)), [tasks, hidden]);
  const current = visibleTasks.find((task) => task.id === selectedTaskId) ?? null;
  const labels = useMemo(() => projectLabels(projects), [projects]);
  const slashCommands = useSlashCommands(current?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    window.studio.listSessions(null).then(
      (list) => {
        if (!cancelled) setSessions(list.filter((session) => session.taskId === null));
      },
      (error: unknown) => reportError(t, error),
    );
    return () => {
      cancelled = true;
    };
  }, [t]);

  const sections = useMemo(
    () =>
      buildSections({
        query,
        tasks: visibleTasks,
        sessions,
        commands: buildCommands({
          t,
          locale,
          theme: settings?.theme ?? "system",
          current,
          hasWaiting: visibleTasks.some((task) => task.status === "needs_you"),
        }),
        projectLabel: (projectId) => labels.get(projectId) ?? "",
        taskTitle: (task) => (task.title.trim() === "" ? t("task.untitled") : task.title),
        sessionTitle: (session) => session.title ?? session.firstPrompt ?? t("history.untitled"),
        hasCurrentTask: current !== null,
        slashCommands,
      }),
    [query, visibleTasks, sessions, t, locale, settings?.theme, current, labels, slashCommands],
  );
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const trimmed = query.trim();
  const noResults = rows.length === 0 && trimmed !== "" && !trimmed.startsWith("/");

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const close = () => {
    setPaletteOpen(false);
    // 记住的元素已被移除（比如刚归档的任务行）时不抢焦点，由接手的功能决定。
    if (restoreRef.current?.isConnected) restoreRef.current.focus();
  };

  const askInNewTask = () => {
    close();
    setPendingDraftText(trimmed);
    startDraft(current?.projectId ?? null);
  };

  const run = (row: PaletteRow) => {
    close();
    if (row.kind === "command") row.command.run();
    else if (row.kind === "task") void selectTask(row.task.id).catch((error: unknown) => reportError(t, error));
    else if (row.kind === "slash" && current) {
      if (row.send) void window.studio.sendPrompt(current.id, { text: row.text, whenBusy: "followUp" }).catch((error: unknown) => reportError(t, error));
      else emitComposerText(`${row.text} `);
    } else if (row.kind === "session") {
      window.studio
        .resumeSession(row.session.id)
        .then((task) => selectTask(task.id))
        .catch((error: unknown) => reportError(t, error, (message) => t("history.resumeFailed", { message })));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length > 0) setActive((active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if ((event.ctrlKey && trimmed !== "") || noResults) askInNewTask();
      else if (rows[active]) run(rows[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  };

  let flat = -1;
  return (
    <div className="pl-root" data-testid="command-palette" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="pl-panel" role="dialog" aria-modal="true" aria-label={t("palette.label")}>
        <div className="pl-input-row">
          <SearchIcon />
          <input
            className="pl-input"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={t("palette.placeholder")}
            value={query}
            autoFocus
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="kbd" title={t("palette.hint")}>Esc</kbd>
        </div>
        <div className="pl-list-host">
        <div className="pl-list" ref={listRef} id={listId} role="listbox">
          {sections.map((section) => (
            <div key={section.id} role="group" aria-label={t(`palette.${section.id}`)}>
              <div className="pl-group">{t(`palette.${section.id}`)}</div>
              {section.rows.map((row) => {
                flat += 1;
                const index = flat;
                const Icon = rowIcon[row.kind];
                return (
                  <div
                    key={row.key}
                    id={`${listId}-${index}`}
                    ref={index === active ? activeRef : undefined}
                    className="pl-row"
                    role="option"
                    aria-selected={index === active}
                    data-active={index === active}
                    onMouseMove={() => active !== index && setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(row)}
                  >
                    <Icon />
                    <span className="pl-row-title">
                      <Highlight text={row.title} indices={row.indices} />
                    </span>
                    {row.kind === "session" && (
                      <kbd className="kbd" title={t("empty.fromTerminal")}>
                        {">_"}
                      </kbd>
                    )}
                    {(row.kind === "task" || row.kind === "session" || row.kind === "slash") && row.subtitle !== "" && <span className="pl-row-meta">{row.subtitle}</span>}
                    {row.kind === "command" && row.command.shortcut !== undefined && <kbd className="kbd">{row.command.shortcut}</kbd>}
                  </div>
                );
              })}
            </div>
          ))}
          {noResults && (
            <div className="pl-empty">
              <p>{t("palette.noResults", { q: trimmed })}</p>
              <div className="pl-row" role="option" aria-selected="true" data-active="true" onMouseDown={(event) => event.preventDefault()} onClick={askInNewTask}>
                <SlashIcon />
                <span className="pl-row-title">{t("palette.askNew")}</span>
                <kbd className="kbd">↵</kbd>
              </div>
            </div>
          )}
        </div>
        <OverlayScrollbar target={listRef} />
        </div>
      </div>
    </div>
  );
}

export function CommandPalette() {
  // 每次打开都重新挂载：查询、高亮行、历史会话列表都从头来。
  return usePaletteOpen() ? <PaletteDialog /> : null;
}

// 命令面板（Ctrl K，spec §4.18）：居中浮层，键盘完整可用。开关在 ui-store（Ctrl K 由外壳监听）。
// 焦点：打开时记住 activeElement，关闭后还原；Tab 不动作（焦点只在输入框里）。
import { reportError } from "../../ui/errors.ts";
import { useTitleBarDim } from "../../ui/title-bar-dim.ts";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { SessionSummary } from "../../../../shared/ipc.ts";
import { useLocale, useT } from "../../i18n/use-t.ts";
import {
  selectTask,
  setPaletteOpen,
  useMainView,
  usePaletteOpen,
  useSelectedTaskId,
  useSettings,
  useTasks,
} from "../../store/index.ts";
import { OverlayScrollbar } from "../../ui/OverlayScrollbar.tsx";
import { useHiddenTasks } from "../sidebar/archive-store.ts";
import { CommandIcon, SearchIcon, SessionIcon, SlashIcon, TaskIcon } from "../sidebar/icons.tsx";
import { useProjects } from "../sidebar/projects-store.ts";
import { startDraft } from "../empty/index.ts";
import { useDraftTerminalKey } from "../terminal/index.ts";
import { projectLabels, sessionTitle, taskTitle } from "../../../../shared/ui/sidebar-model.ts";
import { commandIcon } from "./command-icons.ts";
import { buildCommands } from "./palette-commands.ts";
import { useSlashCommands } from "./slash-commands.ts";
import { findStudioSlash, handledCommands, withStudioSlash } from "../composer/studio-slash.ts";
import { studioSlashCommands } from "../composer/studio-slash-table.ts";
import { emitComposerText, setPendingDraftText } from "./studio-command.ts";
import { buildSections, type PaletteRow } from "../../../../shared/ui/palette-model.ts";
import "../sidebar/sidebar.css";
import "./palette.css";
import { usePresence, type ExitProps } from "../../ui/presence.ts";

function Highlight({ text, indices }: { text: string; indices: number[] }): ReactNode {
  if (indices.length === 0) return text;
  const hit = new Set(indices);
  return [...text].map((char, index) =>
    hit.has(index) ? <mark key={index}>{char}</mark> : <Fragment key={index}>{char}</Fragment>,
  );
}

const rowIcon = { task: TaskIcon, session: SessionIcon, command: CommandIcon, slash: SlashIcon } as const;

function PaletteDialog({ open, closing, exitProps }: { open: boolean; closing: boolean; exitProps: ExitProps }) {
  const t = useT();
  useTitleBarDim(open);
  const locale = useLocale();
  const listId = useId();
  const tasks = useTasks();
  const hidden = useHiddenTasks();
  const projects = useProjects();
  const settings = useSettings();
  const selectedTaskId = useSelectedTaskId();
  const view = useMainView();
  const draftTerminalKey = useDraftTerminalKey();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const restoreRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const activeRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visibleTasks = useMemo(() => tasks.filter((task) => !hidden.has(task.id)), [tasks, hidden]);
  const current = visibleTasks.find((task) => task.id === selectedTaskId) ?? null;
  // 终端命令：当前任务，或对话页上的新任务草稿。
  const terminalKey = current?.id ?? (selectedTaskId === null && view === "conversation" ? draftTerminalKey : null);
  const labels = useMemo(() => projectLabels(projects), [projects]);
  const ompCommands = useSlashCommands(current?.id ?? null);
  const host = current?.engine === "tsp" ? "tsp" : "rpc";
  // 和输入框同一份列表：studio 接管的命令在前，omp 里被它盖住的去掉。
  const slashCommands = useMemo(
    () => (ompCommands.length === 0 ? ompCommands : withStudioSlash(ompCommands, studioSlashCommands, host, t)),
    [ompCommands, host, t],
  );

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
          terminalKey,
          hasWaiting: visibleTasks.some((task) => task.status === "needs_you"),
        }),
        projectLabel: (projectId) => labels.get(projectId) ?? "",
        taskTitle: (task) => taskTitle(task) || t("task.untitled"),
        sessionTitle: (session) => sessionTitle(session) ?? t("history.untitled"),
        hasCurrentTask: current !== null,
        slashCommands,
      }),
    [query, visibleTasks, sessions, t, locale, settings?.theme, current, terminalKey, labels, slashCommands],
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
      // studio 接管的命令不发给 omp（和输入框的 sendDraft 一致）；它自己报错。
      const studio = findStudioSlash(row.text, handledCommands(studioSlashCommands, host));
      if (studio !== null && row.send)
        void Promise.resolve()
          .then(() => studio.command.run(current.id, studio.args, t))
          .catch((error: unknown) => reportError(t, error));
      else if (row.send)
        void window.studio
          .sendPrompt(current.id, { text: row.text, whenBusy: "followUp" })
          .catch((error: unknown) => reportError(t, error));
      else emitComposerText(`${row.text} `);
    } else if (row.kind === "session") {
      window.studio
        .resumeSession(row.session.id)
        .then((task) => selectTask(task.id))
        .catch((error: unknown) => reportError(t, error, (message) => t("history.resumeFailed", { message })));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || closing) return;
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
    <div
      className="pl-root"
      data-testid="command-palette"
      data-closing={closing ? "fade" : undefined}
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div className="pl-panel" role="dialog" aria-modal="true" aria-label={t("palette.label")} {...exitProps}>
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
          <kbd className="kbd" title={t("palette.hint")}>
            Esc
          </kbd>
        </div>
        <div className="pl-list-host">
          <div className="pl-list" ref={listRef} id={listId} role="listbox">
            {sections.map((section) => (
              <div key={section.id} role="group" aria-label={t(`palette.${section.id}`)}>
                <div className="pl-group">{t(`palette.${section.id}`)}</div>
                {section.rows.map((row) => {
                  flat += 1;
                  const index = flat;
                  const Icon = row.kind === "command" ? commandIcon(row.command.id) : rowIcon[row.kind];
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
                      {(row.kind === "task" || row.kind === "session" || row.kind === "slash") &&
                        row.subtitle !== "" && <span className="pl-row-meta">{row.subtitle}</span>}
                      {row.kind === "command" && row.command.shortcut !== undefined && (
                        <kbd className="kbd">{row.command.shortcut}</kbd>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {noResults && (
              <div className="pl-empty">
                <p>{t("palette.noResults", { q: trimmed })}</p>
                <div
                  className="pl-row"
                  role="option"
                  aria-selected="true"
                  data-active="true"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={askInNewTask}
                >
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
  // 每次打开都重新挂载：查询、高亮行、历史会话列表都从头来；关闭时留着放完退出动画。
  const open = usePaletteOpen();
  const presence = usePresence(open);
  return presence.mounted ? (
    <PaletteDialog open={open} closing={presence.closing} exitProps={presence.exitProps} />
  ) : null;
}

// 侧栏下半的文件区（spec §4.5「文件区」、§4.27）：当前任务（或新任务草稿）所在项目的文件树。
// 标题行（展开箭头 + 项目名、刷新）、任务有额外工作区目录时的根切换行、树；和上面的任务列表之间一条可拖的分隔线。
// 点文件在右侧预览面板开一个标签；文件行的 @ 把 `@路径` 插进输入框。展开状态和高度占比存在外壳状态里（window-state.json）。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { limits, parseDraftKey, type TaskId, type TerminalKey } from "../../../../shared/ipc.ts";
import {
  commitSidebarFilesShare,
  defaultSidebarFilesShare,
  setDrawerOpen,
  setSidebarFilesOpen,
  useShellValue,
} from "../../app/shell-store.ts";
import { useT } from "../../i18n/use-t.ts";
import { ChevronRight, Restart } from "../../icons.tsx";
import { showView, useAppInfo, useMainView, useSelectedTaskId, useTask } from "../../store/index.ts";
import { IconButton } from "../../ui/controls.tsx";
import { fileMention } from "../composer/file-complete.ts";
import { insertAtCaret } from "../composer/insert-into-draft.ts";
import { isDefaultFolder } from "../empty/default-folder.ts";
import { useProjectsState } from "../sidebar/projects-store.ts";
import { useDraftTerminalKey } from "../terminal/index.ts";
import { FileTree } from "./FileTree.tsx";
import { WorkspaceRoots } from "./WorkspaceRoots.tsx";
import { filesTarget } from "./files-target.ts";
import { closeFilePreview, openTreeFile, usePreviewPanel } from "./preview-store.ts";
import { clearPendingRoot, selectRoot, usePendingRoot, useSelectedRoot } from "./roots-store.ts";
import "./file-preview.css";

const [minShare, maxShare] = limits.sidebarFilesShareRange;

const noDirs: readonly string[] = [];
const keyboardStep = 5;
const clamp = (value: number) => Math.min(maxShare, Math.max(minShare, value));

/** Ctrl Shift E、命令面板：等侧栏展开、文件区挂上之后把焦点放进树（侧栏收起时容器是 inert）。 */
export function focusSidebarFiles(): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("[data-testid=sidebar-files] [data-testid=file-tree]")?.focus(),
    ),
  );
}

export function SidebarFiles() {
  const t = useT();
  const view = useMainView();
  const taskId = useSelectedTaskId();
  const draftKey = useDraftTerminalKey();
  const key: TerminalKey = taskId ?? draftKey;
  const task = useTask(taskId);
  const projects = useProjectsState().list;
  const chatsDir = useAppInfo()?.chatsDir ?? null;
  const open = useShellValue("sidebarFilesOpen");
  const share = useShellValue("sidebarFilesShare") ?? defaultSidebarFilesShare;
  const section = useRef<HTMLElement>(null);
  const drag = useRef<{ top: number; height: number } | null>(null);
  const [reload, setReload] = useState(0);

  const projectId = taskId !== null ? (task?.projectId ?? null) : (parseDraftKey(key)?.projectId ?? null);
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const label = project === null || isDefaultFolder(project.path, chatsDir) ? t("empty.defaultFolder") : project.name;

  // 树当前看的根；列表缩短（目录被移除、任务重启）后落回任务目录。
  const dirs = task?.workspaceDirs ?? noDirs;
  const selected = useSelectedRoot(key);
  const treeRoot = selected <= dirs.length ? selected : 0;
  useEffect(() => {
    if (selected !== treeRoot) selectRoot(key, treeRoot);
  }, [key, selected, treeRoot]);
  const pendingRoot = usePendingRoot(key);
  useEffect(() => {
    if (pendingRoot === undefined || dirs.length < pendingRoot) return;
    selectRoot(key, pendingRoot);
    clearPendingRoot(key);
  }, [key, pendingRoot, dirs.length]);

  const target = useMemo(() => {
    const base = filesTarget(key);
    return base.kind === "task" && treeRoot > 0 ? { ...base, root: treeRoot } : base;
  }, [key, treeRoot]);

  // 预览面板正看着这棵树里的文件：对应的行高亮。
  const panel = usePreviewPanel();
  const shown = panel?.key === key ? panel.tabs.find((tab) => tab.id === panel.active) : undefined;
  const selectedPath = shown?.kind === "file" && !shown.fromLink && (shown.root ?? 0) === treeRoot ? shown.path : null;

  // 文件的 @：任务目录（草稿是项目目录或默认文件夹）就是 omp 的 cwd，用相对路径；额外工作区目录里的用绝对路径（正斜杠，同文件附件）。
  const mentionRoot = treeRoot > 0 ? dirs[treeRoot - 1]?.replaceAll("\\", "/").replace(/\/$/, "") : undefined;
  // 树根的目录：任务是它的 cwd（开了 worktree 就是 worktree），草稿是项目目录或默认文件夹，额外根是那个目录。
  // 树按它挂、按它记展开状态：同一个文件夹里的任务切来切去，树不重挂，不会先空一下再画出来。
  const treePath =
    (treeRoot > 0 ? dirs[treeRoot - 1] : taskId !== null ? task?.cwd : (project?.path ?? chatsDir)) ?? key;
  const onMention = mentionRoot?.includes('"')
    ? undefined
    : (rel: string) =>
        insertAtCaret(key as string as TaskId, fileMention(mentionRoot === undefined ? rel : `${mentionRoot}/${rel}`));

  const onOpenFile = (path: string) => {
    openTreeFile(key, path, treeRoot);
    // 预览面板只在对话页出现；窄窗口的抽屉盖着主区，收起来才看得见预览。
    if (view !== "conversation") showView("conversation");
    setDrawerOpen(false);
  };

  // Esc：预览面板开着就关上它（焦点回到树），否则交给外层（抽屉的 Esc 等）。
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || panel === null) return;
    event.preventDefault();
    event.stopPropagation();
    closeFilePreview();
  };

  // 分隔线：拖动时直接改两块的 flex-grow（不重渲染），松手时存一次占比。
  const listHost = () => section.current?.previousElementSibling as HTMLElement | null | undefined;
  const applyShare = (value: number) => {
    const host = listHost();
    if (!section.current || !host) return;
    section.current.style.flexGrow = String(value);
    host.style.flexGrow = String(100 - value);
  };
  const shareAt = (clientY: number) => {
    const region = drag.current;
    if (region === null || region.height <= 0) return share;
    return ((region.top + region.height - clientY) / region.height) * 100;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const host = listHost();
    if (!section.current || !host) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const top = host.getBoundingClientRect().top;
    drag.current = { top, height: section.current.getBoundingClientRect().bottom - top };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) applyShare(clamp(shareAt(event.clientY)));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const value = clamp(shareAt(event.clientY));
    drag.current = null;
    commitSidebarFilesShare(value);
  };
  const onResizerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    commitSidebarFilesShare(clamp(share + (event.key === "ArrowUp" ? keyboardStep : -keyboardStep)));
  };

  return (
    <section
      ref={section}
      className="sb-files"
      data-testid="sidebar-files"
      data-open={open || undefined}
      aria-label={t("preview.filesSection")}
      style={open ? { flexGrow: share } : undefined}
      onKeyDown={onKeyDown}
    >
      {open && (
        <div
          className="sb-files-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("preview.filesResize")}
          aria-valuenow={Math.round(share)}
          aria-valuemin={minShare}
          aria-valuemax={maxShare}
          tabIndex={0}
          data-testid="sidebar-files-resizer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onResizerKey}
          onDoubleClick={() => commitSidebarFilesShare(null)}
        />
      )}
      <div className="sb-files-head">
        <button
          type="button"
          className="sb-files-toggle"
          aria-expanded={open}
          data-testid="sidebar-files-toggle"
          title={project?.path}
          onClick={() => setSidebarFilesOpen(!open)}
        >
          <span className="sb-files-chevron" data-open={open || undefined} aria-hidden="true">
            <ChevronRight size={12} />
          </span>
          <span className="sb-files-label">{label}</span>
        </button>
        {open && (
          <IconButton label={t("preview.refresh")} testId="file-tree-refresh" onClick={() => setReload((n) => n + 1)}>
            <Restart size={14} />
          </IconButton>
        )}
      </div>
      {open && taskId !== null && (
        <WorkspaceRoots
          taskId={taskId}
          cwd={task?.cwd ?? ""}
          dirs={dirs}
          root={treeRoot}
          onSelect={(next) => selectRoot(key, next)}
        />
      )}
      {open && (
        <FileTree
          key={treePath}
          target={target}
          memoryKey={treePath}
          reload={reload}
          selected={selectedPath}
          onOpenFile={onOpenFile}
          onMention={onMention}
        />
      )}
    </section>
  );
}

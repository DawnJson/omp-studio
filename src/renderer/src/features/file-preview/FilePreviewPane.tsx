// 右侧文件面板（spec §4.27）：两页——文件（树）/ 预览；头部是页签 + 刷新 + 关闭，宽度可拖。
// 树和预览都经主进程 IPC 取数据（校验落在根目录内）；两页同时挂载、切页只是显隐，所以树的滚动位置和已加载的目录不丢。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { parseDraftKey, type ProjectFilesTarget, type TaskId, type TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Restart } from "../../icons.tsx";
import { IconButton, Tabs } from "../../ui/controls.tsx";
import { useTask } from "../../store/index.ts";
import type { ExitProps } from "../../ui/presence.ts";
import { useHeld } from "../composer/use-held.ts";
import { FileTree } from "./FileTree.tsx";
import { PreviewPage } from "./PreviewPage.tsx";
import { WorkspaceRoots } from "./WorkspaceRoots.tsx";
import { filesTarget } from "./files-target.ts";
import { clearPendingRoot, rootMemoryKey, selectRoot, useSelectedRoot, usePendingRoot } from "./roots-store.ts";
import {
  closeFilePreview,
  previewFileInPanel,
  setPanelPage,
  setPreviewWidth,
  usePreviewPanel,
  usePreviewWidth,
  type PanelState,
} from "./preview-store.ts";
import "./file-preview.css";

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;

const noDirs: readonly string[] = [];

/** 任务目标选额外根（下标）；别的目标（草稿的项目、默认文件夹）没有额外根。 */
function withRoot(target: ProjectFilesTarget, root: number): ProjectFilesTarget {
  return target.kind === "task" && root > 0 ? { ...target, root } : target;
}

/** `exitProps`：App 的右栏 usePresence 给的，关闭时原路滑回（motion.css 的 panel-out）。 */
export function FilePreviewPane({
  panelKey,
  page,
  path,
  exitProps,
}: { panelKey: TerminalKey; exitProps: ExitProps } & Omit<PanelState, "key" | "root" | "snippet">) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = usePreviewWidth();
  const taskId = parseDraftKey(panelKey) === undefined ? (panelKey as TaskId) : null;
  const task = useTask(taskId);
  const dirs = task?.workspaceDirs ?? noDirs;
  // 树当前看的根；列表缩短（目录被移除、任务重启）后落回任务目录。预览页看的是打开文件时的那个根（PanelState.root）。
  const selected = useSelectedRoot(panelKey);
  const treeRoot = selected <= dirs.length ? selected : 0;
  // 关闭后放退出动画的那一下 store 里已经是 null：沿用关闭前的，预览页不在滑走时换成别的内容。
  const panel = useHeld(usePreviewPanel());
  const previewRoot = panel?.root ?? 0;
  // 回答里代码块的"在侧栏预览"：预览页显示这段代码，不读文件（preview-store.ts 的 openSnippetPreview）。
  const snippet = panel?.snippet ?? null;
  const fromLink = panel?.fromLink === true;
  const target = useMemo(() => filesTarget(panelKey), [panelKey]);
  const treeTarget = useMemo(() => withRoot(target, treeRoot), [target, treeRoot]);
  const previewTarget = useMemo(() => withRoot(target, previewRoot), [target, previewRoot]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (selected !== treeRoot) selectRoot(panelKey, treeRoot);
  }, [panelKey, selected, treeRoot]);

  const pendingRoot = usePendingRoot(panelKey);
  useEffect(() => {
    if (pendingRoot === undefined || dirs.length < pendingRoot) return;
    selectRoot(panelKey, pendingRoot);
    clearPendingRoot(panelKey);
  }, [panelKey, pendingRoot, dirs.length]);

  // 打开、切到预览页时把焦点放进面板：Esc 才能关掉它（树隐藏后焦点会丢）；关闭后由 store 还焦点。文件页的树随后自己拿焦点。
  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [page]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeFilePreview();
  };

  const clampWidth = (value: number) => {
    const parent = root.current?.parentElement;
    const max = parent ? parent.clientWidth * maxShare : value;
    return Math.max(minWidth, Math.min(max, value));
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: root.current?.offsetWidth ?? minWidth };
  };
  // 向左拖 = 变宽。
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setPreviewWidth(clampWidth(drag.current.startWidth + drag.current.startX - event.clientX));
  };
  const onResizerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = root.current?.offsetWidth ?? minWidth;
    setPreviewWidth(clampWidth(current + (event.key === "ArrowLeft" ? keyboardStep : -keyboardStep)));
  };

  return (
    <section
      ref={root}
      className="file-preview"
      data-testid="file-preview"
      data-page={page}
      aria-label={t("preview.title")}
      tabIndex={-1}
      style={width === null ? undefined : { flexBasis: width }}
      onKeyDown={onKeyDown}
      {...exitProps}
    >
      <div
        className="file-preview-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("preview.resize")}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={onResizerKey}
      />
      <header className="file-preview-head">
        <Tabs
          tabs={[
            { id: "files", label: t("preview.pageFiles") },
            { id: "preview", label: t("preview.pagePreview"), disabled: path === null && snippet === null },
          ]}
          value={page}
          onChange={setPanelPage}
          label={t("preview.pages")}
          idBase="file-preview"
          testId="file-preview-page"
        />
        <span className="file-preview-spacer" />
        {page === "files" && (
          <IconButton
            label={t("preview.refresh")}
            testId="file-tree-refresh"
            onClick={() => setReload((count) => count + 1)}
          >
            <Restart size={14} />
          </IconButton>
        )}
        <IconButton
          label={t("preview.close")}
          tip={`${t("preview.close")} (Esc)`}
          testId="file-preview-close"
          onClick={closeFilePreview}
        >
          <Close size={14} />
        </IconButton>
      </header>
      {taskId !== null && page === "files" && (
        <WorkspaceRoots
          taskId={taskId}
          cwd={task?.cwd ?? ""}
          dirs={dirs}
          root={treeRoot}
          onSelect={(next) => selectRoot(panelKey, next)}
        />
      )}
      <FileTree
        key={treeRoot}
        target={treeTarget}
        memoryKey={rootMemoryKey(panelKey, treeRoot)}
        active={page === "files"}
        reload={reload}
        selected={previewRoot === treeRoot ? path : null}
        onOpenFile={previewFileInPanel}
      />
      {(path !== null || snippet !== null) && (
        <PreviewPage
          target={previewTarget}
          path={path}
          snippet={snippet}
          fromLink={fromLink}
          hidden={page !== "preview"}
        />
      )}
    </section>
  );
}

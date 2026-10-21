// 右侧文件面板（spec §4.27）：两页——文件（树）/ 预览；头部是页签 + 刷新 + 关闭，宽度可拖。
// 树和预览都经主进程 IPC 取数据（校验落在根目录内）；两页同时挂载、切页只是显隐，所以树的滚动位置和已加载的目录不丢。
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, Restart } from "../../icons.tsx";
import { FileTree } from "./FileTree.tsx";
import { PreviewPage } from "./PreviewPage.tsx";
import {
  closeFilePreview,
  filesTarget,
  previewFileInPanel,
  setPanelPage,
  setPreviewWidth,
  usePreviewWidth,
  type PanelState,
} from "./preview-store.ts";
import "./file-preview.css";

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;

export function FilePreviewPane({ panelKey, page, path }: { panelKey: TerminalKey } & Omit<PanelState, "key">) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = usePreviewWidth();
  const target = useMemo(() => filesTarget(panelKey), [panelKey]);
  const [reload, setReload] = useState(0);

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
        <div className="file-preview-seg" role="group" aria-label={t("preview.pages")}>
          <button
            type="button"
            aria-pressed={page === "files"}
            data-testid="file-preview-page-files"
            onClick={() => setPanelPage("files")}
          >
            {t("preview.pageFiles")}
          </button>
          <button
            type="button"
            aria-pressed={page === "preview"}
            disabled={path === null}
            data-testid="file-preview-page-preview"
            onClick={() => setPanelPage("preview")}
          >
            {t("preview.pagePreview")}
          </button>
        </div>
        <span className="file-preview-spacer" />
        {page === "files" && (
          <button
            type="button"
            className="icon-button file-preview-action"
            data-testid="file-tree-refresh"
            aria-label={t("preview.refresh")}
            title={t("preview.refresh")}
            onClick={() => setReload((count) => count + 1)}
          >
            <Restart size={14} />
          </button>
        )}
        <button
          type="button"
          className="icon-button file-preview-action"
          data-testid="file-preview-close"
          aria-label={t("preview.close")}
          title={`${t("preview.close")} (Esc)`}
          onClick={closeFilePreview}
        >
          <Close size={14} />
        </button>
      </header>
      <FileTree
        panelKey={panelKey}
        active={page === "files"}
        reload={reload}
        selected={path}
        onOpenFile={previewFileInPanel}
      />
      {path !== null && <PreviewPage target={target} path={path} hidden={page !== "preview"} />}
    </section>
  );
}

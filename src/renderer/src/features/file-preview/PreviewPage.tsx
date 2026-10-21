// 文件面板的"预览"页：一条工具栏（文件名、路径、预览/源码、缩放、打开、在文件夹中显示）+ 正文。
// 内容由主进程 readPreviewFile 读（校验落在根目录内）；这里不拼任何文件路径去加载，避免绕过主进程校验。
import { useEffect, useState } from "react";
import type { PreviewFile, ProjectFilesTarget } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { FileIcon, Folder } from "../../icons.tsx";
import { reportError } from "../../ui/errors.ts";
import { baseName, extension, PreviewContent } from "./PreviewContent.tsx";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "done"; file: PreviewFile };

const zoomStep = 1.25;
const zoomRange = [0.1, 8] as const;

export function PreviewPage({ target, path, hidden }: { target: ProjectFilesTarget; path: string; hidden: boolean }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [source, setSource] = useState(false);
  const [scripts, setScripts] = useState(false);
  const [zoom, setZoom] = useState<number | "fit">("fit");

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    setSource(false);
    setScripts(false);
    setZoom("fit");
    window.studio.readPreviewFile(target, path).then(
      (file) => {
        if (!cancelled) setLoad({ state: "done", file });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, path]);

  const file = load.state === "done" ? load.file : null;
  const name = baseName(file?.path ?? path);
  const ext = extension(file?.path ?? path);
  const isMarkdown = file?.kind === "text" && (ext === "md" || ext === "markdown");
  const isSvg = file?.kind === "image" && ext === "svg";
  const toggleable = isMarkdown || isSvg || file?.kind === "html";

  // 系统打开 / 在文件夹中显示按任务 id 走（只有任务有）；草稿的项目目录里只能预览。
  const taskId = target.kind === "task" ? target.taskId : null;
  const run = (action: "openTaskFile" | "revealTaskFile") => {
    if (!file || taskId === null) return;
    window.studio[action](taskId, file.path).catch((error: unknown) => reportError(t, error));
  };

  return (
    <div className="file-preview-page" hidden={hidden}>
      <div className="file-preview-bar">
        <FileIcon size={14} />
        <span className="file-preview-name" data-testid="file-preview-name">
          {name}
        </span>
        {/* 路径和文件名一样（根目录下的文件）时不重复显示。 */}
        {(file?.path ?? path) !== name && (
          <span className="file-preview-path" title={file?.path ?? path}>
            {file?.path ?? path}
          </span>
        )}
        <span className="file-preview-spacer" />
        {toggleable && (
          <div className="file-preview-seg" role="group" aria-label={t("preview.mode")}>
            <button
              type="button"
              aria-pressed={!source}
              data-testid="file-preview-mode-preview"
              onClick={() => setSource(false)}
            >
              {t("preview.modePreview")}
            </button>
            <button
              type="button"
              aria-pressed={source}
              data-testid="file-preview-mode-source"
              onClick={() => setSource(true)}
            >
              {t("preview.modeSource")}
            </button>
          </div>
        )}
        {file?.kind === "html" && !source && (
          <label className="file-preview-scripts">
            <input type="checkbox" checked={scripts} onChange={(event) => setScripts(event.target.checked)} />
            {t("preview.runScripts")}
          </label>
        )}
        {file?.kind === "image" && !source && (
          <div className="file-preview-seg" role="group">
            <button
              type="button"
              aria-label={t("preview.zoomOut")}
              title={t("preview.zoomOut")}
              onClick={() => setZoom(Math.max(zoomRange[0], (zoom === "fit" ? 1 : zoom) / zoomStep))}
            >
              −
            </button>
            <button
              type="button"
              aria-label={t("preview.zoomFit")}
              title={t("preview.zoomFit")}
              onClick={() => setZoom("fit")}
            >
              {zoom === "fit" ? t("preview.zoomFit") : `${Math.round(zoom * 100)}%`}
            </button>
            <button
              type="button"
              aria-label={t("preview.zoomIn")}
              title={t("preview.zoomIn")}
              onClick={() => setZoom(Math.min(zoomRange[1], (zoom === "fit" ? 1 : zoom) * zoomStep))}
            >
              +
            </button>
          </div>
        )}
        {taskId !== null && file?.canOpen && (
          <button
            type="button"
            className="icon-button file-preview-action"
            data-testid="file-preview-open"
            aria-label={t("preview.open")}
            title={t("preview.open")}
            onClick={() => run("openTaskFile")}
          >
            <FileIcon size={14} />
          </button>
        )}
        {taskId !== null && file !== null && file.kind !== "missing" && (
          <button
            type="button"
            className="icon-button file-preview-action"
            data-testid="file-preview-reveal"
            aria-label={t("preview.reveal")}
            title={t("preview.reveal")}
            onClick={() => run("revealTaskFile")}
          >
            <Folder size={14} />
          </button>
        )}
      </div>
      <div className="file-preview-body" data-testid="file-preview-body">
        {load.state === "loading" && <p className="file-preview-note">{t("preview.loading")}</p>}
        {load.state === "error" && (
          <p className="file-preview-note" role="alert">
            {t("preview.readFailed", { message: load.message })}
          </p>
        )}
        {file && (
          <PreviewContent
            file={file}
            ext={ext}
            name={name}
            source={source}
            scripts={scripts}
            zoom={zoom}
            isMarkdown={isMarkdown}
            onExternal={taskId === null ? null : () => run(file.canOpen ? "openTaskFile" : "revealTaskFile")}
          />
        )}
      </div>
    </div>
  );
}

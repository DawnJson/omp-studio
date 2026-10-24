// 文件面板的"预览"页：一条工具栏（文件名、路径、预览/源码、缩放、打开、在文件夹中显示）+ 正文。
// 内容由主进程 readPreviewFile 读（校验落在根目录内）；这里不拼任何文件路径去加载，避免绕过主进程校验。
import { useEffect, useRef, useState } from "react";
import type { PreviewFile, ProjectFilesTarget } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { External, FileIcon, Folder } from "../../icons.tsx";
import { Button, Checkbox, IconButton, Segmented } from "../../ui/controls.tsx";
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
  const imageRef = useRef<HTMLImageElement | null>(null);
  // 从"适应窗口"开始缩放时以眼前的实际比例为起点：大图适应窗口时可能只有 25%，按 100% 算的话"缩小"反而变大。
  const stepZoom = (factor: number) => {
    const img = imageRef.current;
    const current = zoom !== "fit" ? zoom : img && img.naturalWidth > 0 ? img.clientWidth / img.naturalWidth : 1;
    setZoom(Math.min(zoomRange[1], Math.max(zoomRange[0], current * factor)));
  };

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
    window.studio[action](taskId, file.path, target.kind === "task" ? target.root : undefined).catch((error: unknown) =>
      reportError(t, error),
    );
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
          <Segmented
            size="sm"
            value={source ? "source" : "preview"}
            options={[
              { value: "preview", label: t("preview.modePreview") },
              { value: "source", label: t("preview.modeSource") },
            ]}
            onChange={(next) => setSource(next === "source")}
            label={t("preview.mode")}
            testId="file-preview-mode"
          />
        )}
        {file?.kind === "html" && !source && (
          <Checkbox checked={scripts} onChange={setScripts}>
            {t("preview.runScripts")}
          </Checkbox>
        )}
        {file?.kind === "image" && !source && (
          <span className="file-preview-zoom" role="group" aria-label={t("preview.zoom")}>
            <IconButton label={t("preview.zoomOut")} onClick={() => stepZoom(1 / zoomStep)}>
              −
            </IconButton>
            <Button variant="quiet" size="sm" onClick={() => setZoom("fit")}>
              {zoom === "fit" ? t("preview.zoomFit") : `${Math.round(zoom * 100)}%`}
            </Button>
            <IconButton label={t("preview.zoomIn")} onClick={() => stepZoom(zoomStep)}>
              +
            </IconButton>
          </span>
        )}
        {taskId !== null && file?.canOpen && (
          <IconButton label={t("preview.open")} testId="file-preview-open" onClick={() => run("openTaskFile")}>
            <External size={14} />
          </IconButton>
        )}
        {taskId !== null && file !== null && file.kind !== "missing" && (
          <IconButton label={t("preview.reveal")} testId="file-preview-reveal" onClick={() => run("revealTaskFile")}>
            <Folder size={14} />
          </IconButton>
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
            imageRef={imageRef}
            isMarkdown={isMarkdown}
            onExternal={taskId === null ? null : () => run(file.canOpen ? "openTaskFile" : "revealTaskFile")}
          />
        )}
      </div>
    </div>
  );
}

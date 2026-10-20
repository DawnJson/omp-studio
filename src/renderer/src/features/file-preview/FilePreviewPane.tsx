// 右侧文件预览面板：md 渲染 / 图片（svg 也只当图片）/ html 沙箱 iframe / 其余文本高亮源码；二进制和过大文件只给提示。
// 内容由主进程 readPreviewFile 读（校验落在任务 cwd 内）；这里不拼任何文件路径去加载，避免绕过主进程校验。
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PreviewFile, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close, FileIcon, Folder } from "../../icons.tsx";
import { Markdown } from "../../markdown/index.ts";
import { CodeBlock } from "../../markdown/CodeBlock.tsx";
import { reportError } from "../../ui/errors.ts";
import { closeFilePreview, setPreviewWidth, usePreviewWidth } from "./preview-store.ts";
import "./file-preview.css";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "done"; file: PreviewFile };

const minWidth = 280;
const maxShare = 0.7;
const keyboardStep = 16;
const zoomStep = 1.25;
const zoomRange = [0.1, 8] as const;

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

function extension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** svg 的 data URL → 源码文本（主进程只给 dataUrl，源码视图在这里还原）。 */
function decodeDataUrl(dataUrl: string): string {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function FilePreviewPane({ taskId, path }: { taskId: TaskId; path: string }) {
  const t = useT();
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const width = usePreviewWidth();
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
    window.studio.readPreviewFile(taskId, path).then(
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
  }, [taskId, path]);

  // 打开时把焦点放进面板：Esc 才能关掉它；关闭后由 store 还焦点。
  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);

  const file = load.state === "done" ? load.file : null;
  const name = baseName(file?.path ?? path);
  const ext = extension(file?.path ?? path);
  const isMarkdown = file?.kind === "text" && (ext === "md" || ext === "markdown");
  const isSvg = file?.kind === "image" && ext === "svg";
  const toggleable = isMarkdown || isSvg || file?.kind === "html";

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

  const run = (action: "openTaskFile" | "revealTaskFile") => {
    if (!file) return;
    window.studio[action](taskId, file.path).catch((error: unknown) => reportError(t, error));
  };

  return (
    <section
      ref={root}
      className="file-preview"
      data-testid="file-preview"
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
        {file?.canOpen && (
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
        {file !== null && file.kind !== "missing" && (
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
      <div className="file-preview-body" data-testid="file-preview-body">
        {load.state === "loading" && <p className="file-preview-note">{t("preview.loading")}</p>}
        {load.state === "error" && (
          <p className="file-preview-note" role="alert">
            {t("preview.readFailed", { message: load.message })}
          </p>
        )}
        {file && (
          <Content
            file={file}
            ext={ext}
            name={name}
            source={source}
            scripts={scripts}
            zoom={zoom}
            isMarkdown={isMarkdown}
            onExternal={() => run(file.canOpen ? "openTaskFile" : "revealTaskFile")}
          />
        )}
      </div>
    </section>
  );
}

interface ContentProps {
  file: PreviewFile;
  ext: string;
  name: string;
  source: boolean;
  scripts: boolean;
  zoom: number | "fit";
  isMarkdown: boolean;
  onExternal(): void;
}

function Content({ file, ext, name, source, scripts, zoom, isMarkdown, onExternal }: ContentProps) {
  const t = useT();
  const [natural, setNatural] = useState(0);
  switch (file.kind) {
    case "missing":
      return <p className="file-preview-note">{t("preview.missing", { path: file.path })}</p>;
    case "binary":
    case "too_large":
      return (
        <div className="file-preview-note">
          <p>{file.kind === "binary" ? t("preview.binary") : t("preview.tooLarge", { size: formatSize(file.size) })}</p>
          <button type="button" className="file-preview-external" onClick={onExternal}>
            {file.canOpen ? t("preview.open") : t("preview.reveal")}
          </button>
        </div>
      );
    case "image": {
      const dataUrl = file.dataUrl ?? "";
      if (source) return <CodeBlock code={decodeDataUrl(dataUrl)} lang="xml" closed streaming />;
      return (
        <div className="file-preview-image" data-fit={zoom === "fit" || undefined}>
          <img
            src={dataUrl}
            alt={t("preview.imageAlt", { name })}
            data-testid="file-preview-image"
            style={zoom === "fit" || natural === 0 ? undefined : { width: natural * zoom }}
            onLoad={(event) => setNatural(event.currentTarget.naturalWidth)}
          />
        </div>
      );
    }
    case "html":
      if (source) return <CodeBlock code={file.text ?? ""} lang="html" closed streaming />;
      // 没有 allow-same-origin：页面拿不到应用的任何权限；脚本默认关，用户勾选后才放行。
      return (
        <iframe
          className="file-preview-frame"
          data-testid="file-preview-frame"
          title={t("preview.htmlTitle", { name })}
          sandbox={scripts ? "allow-scripts" : ""}
          srcDoc={file.text ?? ""}
        />
      );
    case "text":
      if (isMarkdown && !source) {
        return (
          <div className="file-preview-md" data-testid="file-preview-md">
            <Markdown source={file.text ?? ""} />
          </div>
        );
      }
      // streaming 在这里只用来关掉代码块的"超过 24 行折叠"：文件源码要整段可读。
      return <CodeBlock code={file.text ?? ""} lang={ext} closed streaming />;
  }
}

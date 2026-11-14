// 文件面板的"预览"页：一条工具栏（文件名、路径、预览/源码、缩放、打开、在文件夹中显示）+ 正文。
// 文件链接直接只读预览本机文件，文件树按选定根读取；路径、类型和大小仍由主进程校验。
// 回答里代码块的片段（snippet.ts）不读盘：直接换成同样的 PreviewFile，走同一条渲染路径。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PreviewFile, ProjectFilesTarget } from "../../../../shared/ipc.ts";
import { errorDetail } from "../../../../shared/ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { External, Folder } from "../../icons.tsx";
import { useFigurePalette } from "../../markdown/figure-palette.ts";
import { Button, Checkbox, IconButton, Segmented } from "../../ui/controls.tsx";
import { reportError } from "../../ui/errors.ts";
import { FileTypeIcon } from "../../ui/FileTypeIcon.tsx";
import { baseName, extension, PreviewContent } from "./PreviewContent.tsx";
import { snippetExtension, snippetFile, snippetLabel, type Snippet } from "./snippet.ts";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "done"; file: PreviewFile };

const zoomStep = 1.25;
const zoomRange = [0.1, 8] as const;

/** Ctrl+滚轮缩放时指针下的那一点：记下它在被缩放元素里的相对位置，排版后滚动外框，让它回到指针下。 */
interface ZoomAnchor {
  element: Element;
  scroller: Element;
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/** 显示 `path` 指的文件，或 `snippet`（有片段时 path 为 null）。 */
export function PreviewPage({
  target,
  path,
  snippet,
  fromLink,
  hidden,
}: {
  target: ProjectFilesTarget;
  path: string | null;
  snippet: Snippet | null;
  fromLink: boolean;
  hidden: boolean;
}) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [source, setSource] = useState(false);
  const [scripts, setScripts] = useState(false);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  // 图片以外的内容（文本、Markdown、源码、网页）整体缩放；换文件不复位，面板开着时一直沿用。
  const [textZoom, setTextZoom] = useState(1);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const anchor = useRef<ZoomAnchor | null>(null);
  // 上一次画出来的缩放值（下面的 useLayoutEffect 更新）：Ctrl+滚轮判断还能不能再缩。
  const shown = useRef({ zoom, textZoom });
  // 从"适应窗口"开始缩放时以眼前的实际比例为起点：大图适应窗口时可能只有 25%，按 100% 算的话"缩小"反而变大。
  const stepZoom = (factor: number) =>
    setZoom((current) => {
      const img = imageRef.current;
      const from = current !== "fit" ? current : img && img.naturalWidth > 0 ? img.clientWidth / img.naturalWidth : 1;
      return Math.min(zoomRange[1], Math.max(zoomRange[0], from * factor));
    });
  const stepTextZoom = (factor: number) =>
    setTextZoom((current) => Math.min(zoomRange[1], Math.max(zoomRange[0], current * factor)));

  // 片段里的 svg 和回答里画的图一样用主题色（prepareSvg）：切换主题时重算。
  const palette = useFigurePalette();
  const shownSnippet = useMemo(() => (snippet === null ? null : snippetFile(snippet, palette)), [snippet, palette]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ state: "loading" });
    setSource(false);
    setScripts(false);
    setZoom("fit");
    if (path === null) return;
    const read =
      fromLink && target.kind === "task"
        ? window.studio.readLinkedPreviewFile(target.taskId, path)
        : window.studio.readPreviewFile(target, path);
    read.then(
      (file) => {
        if (!cancelled) setLoad({ state: "done", file });
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ state: "error", message: errorDetail(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, path, snippet, fromLink]);

  const file = shownSnippet ?? (load.state === "done" ? load.file : null);
  const filePath = snippet === null ? (file?.path ?? path ?? "") : "";
  const name = snippet === null ? baseName(filePath) : t("preview.snippet", { lang: snippetLabel(snippet.kind) });
  const ext = snippet === null ? extension(filePath) : snippetExtension(snippet.kind);
  const isMarkdown = file?.kind === "text" && (ext === "md" || ext === "markdown");
  const isMermaid = snippet?.kind === "mermaid";
  const isSvg = file?.kind === "image" && ext === "svg";
  const toggleable = isMarkdown || isMermaid || isSvg || file?.kind === "html";
  const imageView = file?.kind === "image" && !source;
  const textView = file?.kind === "text" || file?.kind === "html" || (file?.kind === "image" && source);

  // Ctrl+滚轮缩放（整页缩放锁在字号档位上，见主进程 main-window.ts）。React 的 onWheel 是 passive，拦不住，只能自己挂。
  useEffect(() => {
    const box = body.current;
    if (box === null || !(imageView || textView)) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // 鼠标滚一格 = 一步（×1.25，同图片的 − / +）；触控板捏合的增量小，按比例缩。字号调大后一格的 deltaY 会变小
      // （约 100 / 页面缩放），所以按 50 算满一步；一次最多一步，免得"一次滚动多行"的系统设置一格跳好几档。
      const steps = Math.max(-1, Math.min(1, -event.deltaY / 50));
      // 已经到上下限（或没有竖向滚动）时缩放不变、不会重排：不记锚点，否则它留到下一次缩放才用，把那时的位置拉偏。
      const current = imageView ? shown.current.zoom : shown.current.textZoom;
      if (steps === 0 || (current !== "fit" && (steps > 0 ? current >= zoomRange[1] : current <= zoomRange[0]))) return;
      const element = imageView ? imageRef.current : box.firstElementChild;
      const rect = element?.getBoundingClientRect();
      if (element && rect && rect.width > 0 && rect.height > 0) {
        anchor.current = {
          element,
          scroller: imageView ? (element.parentElement ?? box) : box,
          x: event.clientX,
          y: event.clientY,
          fx: (event.clientX - rect.left) / rect.width,
          fy: (event.clientY - rect.top) / rect.height,
        };
      }
      if (imageView) stepZoom(zoomStep ** steps);
      else stepTextZoom(zoomStep ** steps);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [imageView, textView]);

  // 网页预览是沙箱 iframe，滚轮事件到不了上面的监听：页面没处理的 Ctrl+滚轮由主进程连同光标位置转来，光标在网页预览上才缩放。
  useEffect(
    () =>
      window.studio.onZoomGesture(({ direction, x, y }) => {
        const frame = body.current?.querySelector(".file-preview-frame");
        if (frame && document.elementFromPoint(x, y) === frame)
          stepTextZoom(direction === "in" ? zoomStep : 1 / zoomStep);
      }),
    [],
  );

  useLayoutEffect(() => {
    shown.current = { zoom, textZoom };
    const pending = anchor.current;
    if (pending === null) return;
    anchor.current = null;
    const rect = pending.element.getBoundingClientRect();
    pending.scroller.scrollLeft += rect.left + pending.fx * rect.width - pending.x;
    pending.scroller.scrollTop += rect.top + pending.fy * rect.height - pending.y;
  }, [zoom, textZoom]);

  // 系统打开 / 在文件夹中显示按任务 id 走（只有任务有）；草稿的项目目录里只能预览，片段没有文件，也只能预览。
  const taskId = snippet === null && !file?.external && target.kind === "task" ? target.taskId : null;
  const run = (action: "openTaskFile" | "revealTaskFile") => {
    if (!file || taskId === null) return;
    const root = file.root ?? (target.kind === "task" ? target.root : undefined);
    window.studio[action](taskId, file.path, root).catch((error: unknown) => reportError(t, error));
  };

  return (
    <div className="file-preview-page" hidden={hidden}>
      <div className="file-preview-bar">
        {/* 片段没有文件名，按它的语言（扩展名）取图标 */}
        <FileTypeIcon name={snippet === null ? name : `snippet.${ext}`} size={14} />
        <span className="file-preview-name" data-testid="file-preview-name">
          {name}
        </span>
        {/* 路径和文件名一样（根目录下的文件）时不重复显示；片段没有路径。 */}
        {snippet === null && filePath !== name && (
          <span className="file-preview-path" title={filePath}>
            {filePath}
          </span>
        )}
        {/* 右边的控件是一组：面板窄得放不下时整组换到第二行（file-preview.css）。 */}
        <span className="file-preview-actions">
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
          {imageView && (
            <span className="file-preview-zoom" role="group" aria-label={t("preview.zoom")}>
              <IconButton label={t("preview.zoomOut")} onClick={() => stepZoom(1 / zoomStep)}>
                −
              </IconButton>
              <Button variant="quiet" size="sm" testId="file-preview-zoom-reset" onClick={() => setZoom("fit")}>
                {zoom === "fit" ? t("preview.zoomFit") : `${Math.round(zoom * 100)}%`}
              </Button>
              <IconButton label={t("preview.zoomIn")} onClick={() => stepZoom(zoomStep)}>
                +
              </IconButton>
            </span>
          )}
          {/* 文字只用 Ctrl+滚轮缩放：缩放过（不是 100%）才显示百分比，点它回到 100%。 */}
          {textView && textZoom !== 1 && (
            <span className="file-preview-zoom" role="group" aria-label={t("preview.zoom")}>
              <Button variant="quiet" size="sm" testId="file-preview-zoom-reset" onClick={() => setTextZoom(1)}>
                {`${Math.round(textZoom * 100)}%`}
              </Button>
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
        </span>
      </div>
      <div
        ref={body}
        className="file-preview-body"
        data-testid="file-preview-body"
        style={{ "--preview-zoom": textZoom } as CSSProperties}
      >
        {snippet === null && load.state === "loading" && <p className="file-preview-note">{t("preview.loading")}</p>}
        {snippet === null && load.state === "error" && (
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
            isMermaid={isMermaid}
            onExternal={taskId === null ? null : () => run(file.canOpen ? "openTaskFile" : "revealTaskFile")}
          />
        )}
      </div>
    </div>
  );
}

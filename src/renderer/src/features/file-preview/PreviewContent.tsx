// 预览页的正文：md 渲染 / 图片（svg 也只当图片）/ html 沙箱 iframe / mermaid 片段交给代码块画图 / 其余文本高亮源码；
// 二进制和过大文件只给提示。
import { useEffect, useRef, useState, type RefObject } from "react";
import { htmlPreviewUrl, type PreviewFile } from "../../../../shared/ipc.ts";
import { reportErrorNow } from "../../ui/errors.ts";
import { useT } from "../../i18n/use-t.ts";
import { Markdown } from "../../markdown/index.ts";
import { CodeBlock } from "../../markdown/CodeBlock.tsx";

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  return parts[parts.length - 1] ?? path;
}

export function extension(path: string): string {
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

interface ContentProps {
  file: PreviewFile;
  ext: string;
  name: string;
  source: boolean;
  scripts: boolean;
  zoom: number | "fit";
  /** 图片元素：缩放按钮要从"适应窗口"时的实际比例开始算。 */
  imageRef: RefObject<HTMLImageElement | null>;
  isMarkdown: boolean;
  /** 回答里的 mermaid 片段（snippet.ts）：渲染时和回答里一样由代码块画成图。 */
  isMermaid: boolean;
  onExternal: (() => void) | null;
}

/**
 * 图片：放大后按住左键拖动平移（滚动外框）。原生拖动关掉：拖的是整张 data URL 图片，又慢又会被当成拖进来的文件；
 * 适应窗口时整张图都在眼前，不平移。
 */
function ImageView({
  src,
  alt,
  zoom,
  imageRef,
}: {
  src: string;
  alt: string;
  zoom: number | "fit";
  imageRef: RefObject<HTMLImageElement | null>;
}) {
  const [natural, setNatural] = useState(0);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const end = () => {
    pan.current = null;
  };
  return (
    <div
      className="file-preview-image"
      data-fit={zoom === "fit" || undefined}
      onPointerDown={(event) => {
        if (zoom === "fit" || event.button !== 0) return;
        const box = event.currentTarget;
        pan.current = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
        box.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const start = pan.current;
        if (start === null) return;
        event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
        event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        draggable={false}
        data-testid="file-preview-image"
        style={zoom === "fit" || natural === 0 ? undefined : { width: natural * zoom }}
        onLoad={(event) => setNatural(event.currentTarget.naturalWidth)}
      />
    </div>
  );
}

/**
 * 网页：交给主进程登记，iframe 加载独立源 studio-preview://<token>/（CSP 在响应头里：能跑内联脚本，不能联网；
 * 见 src/main/window/preview-protocol.ts）。不用 srcdoc：它继承应用页面的 CSP，内联脚本永远不跑。
 * 没有 allow-same-origin：页面的源不透明，拿不到应用的任何东西；脚本默认关，用户勾选后才放行。
 * sandbox 只在加载时生效，开关脚本靠 key 换一个 iframe 重新加载。内容换了、组件卸载时放手，主进程删掉那页。
 */
function HtmlFrame({ html, scripts, title }: { html: string; scripts: boolean; title: string }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let unmounted = false;
    setToken(null);
    const registered = window.studio.registerHtmlPreview(html);
    void registered.then((value) => {
      if (!unmounted) setToken(value);
    }, reportErrorNow);
    return () => {
      unmounted = true;
      // 登记失败已经报过，这里只放手登记成功的那页（卸载早于登记完成时也等它完成再放）。
      void registered
        .then(
          (value) => window.studio.releaseHtmlPreview(value),
          () => undefined,
        )
        .catch(reportErrorNow);
    };
  }, [html]);
  return (
    <iframe
      key={`${token}:${scripts}`}
      className="file-preview-frame"
      data-testid="file-preview-frame"
      title={title}
      sandbox={scripts ? "allow-scripts" : ""}
      src={token === null ? undefined : htmlPreviewUrl(token)}
    />
  );
}

export function PreviewContent({
  file,
  ext,
  name,
  source,
  scripts,
  zoom,
  imageRef,
  isMarkdown,
  isMermaid,
  onExternal,
}: ContentProps) {
  const t = useT();
  switch (file.kind) {
    case "missing":
      return <p className="file-preview-note">{t("preview.missing")}</p>;
    case "binary":
    case "too_large":
      return (
        <div className="file-preview-note">
          <p>{file.kind === "binary" ? t("preview.binary") : t("preview.tooLarge", { size: formatSize(file.size) })}</p>
          {onExternal !== null && (
            <button type="button" className="file-preview-external" onClick={onExternal}>
              {file.canOpen ? t("preview.open") : t("preview.reveal")}
            </button>
          )}
        </div>
      );
    case "image": {
      const dataUrl = file.dataUrl ?? "";
      // 片段的 svg 带着原文（text）；文件只有 data URL，源码从它还原。
      if (source) return <CodeBlock code={file.text ?? decodeDataUrl(dataUrl)} lang="xml" closed />;
      return <ImageView src={dataUrl} alt={t("preview.imageAlt", { name })} zoom={zoom} imageRef={imageRef} />;
    }
    case "html":
      if (source) return <CodeBlock code={file.text ?? ""} lang="html" closed />;
      return <HtmlFrame html={file.text ?? ""} scripts={scripts} title={t("preview.htmlTitle", { name })} />;
    case "text":
      if (isMermaid)
        return <CodeBlock code={file.text ?? ""} lang="mermaid" closed view={source ? "source" : "figure"} />;
      if (isMarkdown && !source) {
        return (
          <div className="file-preview-md" data-testid="file-preview-md">
            <Markdown source={file.text ?? ""} />
          </div>
        );
      }
      return <CodeBlock code={file.text ?? ""} lang={ext} closed />;
  }
}

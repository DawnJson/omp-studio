// 预览页的正文：md 渲染 / 图片（svg 也只当图片）/ html 沙箱 iframe / Office 文档（主进程转好的 HTML）沙箱 iframe /
// 其余文本高亮源码；二进制和过大文件只给提示。
import { useState } from "react";
import type { PreviewFile } from "../../../../shared/ipc.ts";
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
  isMarkdown: boolean;
  onExternal: (() => void) | null;
}

export function PreviewContent({ file, ext, name, source, scripts, zoom, isMarkdown, onExternal }: ContentProps) {
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
          {onExternal !== null && (
            <button type="button" className="file-preview-external" onClick={onExternal}>
              {file.canOpen ? t("preview.open") : t("preview.reveal")}
            </button>
          )}
        </div>
      );
    case "image": {
      const dataUrl = file.dataUrl ?? "";
      if (source) return <CodeBlock code={decodeDataUrl(dataUrl)} lang="xml" closed />;
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
      if (source) return <CodeBlock code={file.text ?? ""} lang="html" closed />;
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
    case "document":
      // 主进程从 Word / Excel / PowerPoint 转出来的 HTML：同样不给 allow-same-origin，也从不放行脚本。
      return (
        <>
          {file.truncated === true && <p className="file-preview-note">{t("preview.documentTruncated")}</p>}
          <iframe
            className="file-preview-frame"
            data-testid="file-preview-document"
            title={t("preview.documentTitle", { name })}
            sandbox=""
            srcDoc={file.text ?? ""}
          />
        </>
      );
    case "text":
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

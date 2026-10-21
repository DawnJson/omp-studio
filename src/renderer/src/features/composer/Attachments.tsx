// 输入框顶部的附件卡片：图片 = 缩略图 + `#N` + 像素尺寸；文件 = 文件图标 + `#N` + 名字 + 大小；右上移除。
// `#N` 是所有附件共用的显示编号（displayNumber，图片在前、文件接着），和文字里的芯片对应；删掉卡片 = 删掉文字里的占位符。
import { useT } from "../../i18n/use-t.ts";
import { Close, FileIcon } from "../../icons.tsx";
import { displayNumber, formatFileSize, type DraftFile, type DraftImage, type TokenKind } from "./composer-tokens.ts";
import { imageSrc } from "./image-resize.ts";

interface AttachmentsProps {
  images: readonly DraftImage[];
  files: readonly DraftFile[];
  onRemove(kind: TokenKind, n: number): void;
}

export function Attachments({ images, files, onRemove }: AttachmentsProps) {
  const t = useT();
  if (images.length === 0 && files.length === 0) return null;
  const remove = (kind: TokenKind, n: number) => (
    <button
      type="button"
      className="attachment-remove"
      data-testid="attachment-remove"
      aria-label={t("composer.attachment.remove")}
      title={t("composer.attachment.remove")}
      onClick={() => onRemove(kind, n)}
    >
      <Close size={12} />
    </button>
  );
  return (
    <ul className="attachments" data-testid="attachments">
      {images.map((image, index) => {
        const n = index + 1;
        const size = image.width !== undefined && image.height !== undefined ? `${image.width}×${image.height}` : null;
        return (
          <li key={`image:${n}`} className="attachment" data-testid="attachment" data-kind="image" data-n={n}>
            <img className="attachment-thumb" src={imageSrc(image)} alt={t("conversation.imageAlt")} />
            <span className="attachment-text">
              <span className="attachment-n">#{n}</span>
              {size !== null && <span className="attachment-size">{size}</span>}
            </span>
            {remove("image", n)}
          </li>
        );
      })}
      {files.map((file, index) => {
        const n = index + 1;
        const shown = displayNumber({ images, files, pastes: {} }, "file", n);
        return (
          <li key={`file:${n}`} className="attachment" data-testid="attachment" data-kind="file" data-n={n}>
            <span className="attachment-thumb attachment-file-icon" aria-hidden="true">
              <FileIcon size={16} />
            </span>
            <span className="attachment-text">
              <span className="attachment-n">
                #{shown} <span className="attachment-name">{file.name}</span>
              </span>
              <span className="attachment-size">{formatFileSize(file.size)}</span>
            </span>
            {remove("file", n)}
          </li>
        );
      })}
    </ul>
  );
}

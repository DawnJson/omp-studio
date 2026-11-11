// 输入框顶部的附件卡片：图片 = 缩略图 + `#N` + 像素尺寸；文件 = 文件图标 + `#N` + 名字 + 大小；
// 大段粘贴 = 文字图标 + `#N` + 行数 / 字符数 + 第一行非空文字，点开是只读预览（ui/Popover），底下"展开成文字"把占位符换回原文。右上移除。
// `#N` 是所有附件共用的显示编号（displayNumber：图片、文件、粘贴依次），和文字里的芯片对应；删掉卡片 = 删掉文字里的占位符。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { Close, TextLines } from "../../icons.tsx";
import { FileTypeIcon } from "../../ui/FileTypeIcon.tsx";
import { Button } from "../../ui/controls.tsx";
import { Popover } from "../../ui/Popover.tsx";
import {
  displayNumber,
  formatFileSize,
  pasteSize,
  type Draft,
  type DraftFile,
  type DraftImage,
  type TokenKind,
} from "./composer-tokens.ts";
import { imageSrc } from "./image-resize.ts";

interface AttachmentsProps {
  images: readonly DraftImage[];
  files: readonly DraftFile[];
  pastes: Draft["pastes"];
  onRemove(kind: TokenKind, n: number): void;
  /** 把这段粘贴的占位符换回原文（放回文字里）。 */
  onExpand(n: number): void;
}

/** 预览浮层宽度：一行大约 60 个等宽字符。 */
const PREVIEW_WIDTH = 480;

export function Attachments({ images, files, pastes, onRemove, onExpand }: AttachmentsProps) {
  const t = useT();
  // 正在预览的粘贴编号；同一时刻只开一个（Popover 自己也只留最后开的那个）。
  const [previewing, setPreviewing] = useState<number | null>(null);
  const pasteNumbers = Object.keys(pastes)
    .map(Number)
    .sort((a, b) => a - b);
  if (images.length === 0 && files.length === 0 && pasteNumbers.length === 0) return null;
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
        const shown = displayNumber({ images, files, pastes }, "file", n);
        return (
          <li key={`file:${n}`} className="attachment" data-testid="attachment" data-kind="file" data-n={n}>
            <span className="attachment-thumb attachment-file-icon" aria-hidden="true">
              <FileTypeIcon name={file.name} />
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
      {pasteNumbers.map((n) => {
        const content = pastes[n]!;
        const shown = displayNumber({ images, files, pastes }, "paste", n);
        const firstLine = content.split("\n").find((line) => line.trim() !== "") ?? "";
        const open = previewing === n;
        const label = t("composer.attachment.paste", { n: shown });
        return (
          <li key={`paste:${n}`} className="attachment" data-testid="attachment" data-kind="paste" data-n={n}>
            <button
              type="button"
              className="attachment-open"
              data-testid="attachment-open"
              aria-label={label}
              aria-expanded={open}
              onClick={() => setPreviewing(open ? null : n)}
            >
              <span className="attachment-thumb attachment-file-icon" aria-hidden="true">
                <TextLines size={16} />
              </span>
              <span className="attachment-text">
                <span className="attachment-n">
                  #{shown}{" "}
                  <span className="attachment-size">
                    {pasteSize(content, t("composer.chip.lines"), t("composer.chip.chars"))}
                  </span>
                </span>
                <span className="attachment-line">{firstLine.trim()}</span>
              </span>
            </button>
            {remove("paste", n)}
            <Popover open={open} onClose={() => setPreviewing(null)} label={label} width={PREVIEW_WIDTH}>
              <pre className="paste-preview" data-testid="paste-preview" tabIndex={0}>
                {content}
              </pre>
              <div className="paste-preview-foot">
                <Button
                  size="sm"
                  testId="paste-inline"
                  onClick={() => {
                    setPreviewing(null);
                    onExpand(n);
                  }}
                >
                  {t("composer.attachment.inline")}
                </Button>
              </div>
            </Popover>
          </li>
        );
      })}
    </ul>
  );
}

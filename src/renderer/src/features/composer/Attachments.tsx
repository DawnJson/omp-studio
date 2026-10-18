// 附件预览行：64×64，右上 ✕。
import type { PromptImage } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Close } from "../../icons.tsx";
import { imageSrc } from "./image-resize.ts";

export function Attachments({ images, onRemove }: { images: readonly PromptImage[]; onRemove(index: number): void }) {
  const t = useT();
  if (images.length === 0) return null;
  return (
    <div className="attachments" data-testid="attachments">
      {images.map((image, index) => (
        <div key={index} className="attachment">
          <img src={imageSrc(image)} alt={t("conversation.imageAlt")} />
          <button type="button" className="attachment-remove" aria-label={t("composer.attachment.remove")} title={t("composer.attachment.remove")} onClick={() => onRemove(index)}>
            <Close size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// 往输入框加附件：图片（粘贴 / 拖入，转成 WebP）和文件（拖入 / 粘贴；路径只在主进程，这里只有 id）。
// 都在光标处插入占位符（输入框里显示成 `#N` 芯片）。Composer 和 DraftComposer 共用。
import { useCallback, useEffect, type DragEvent, type RefObject } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import type { ComposerFile, TaskId } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { pushToast } from "../dialogs/index.ts";
import { requestCaret } from "./caret-request.ts";
import {
  buildView,
  insertFiles,
  insertImages,
  offsetOutsideTokens,
  viewToTextOffset,
  type DraftImage,
} from "./composer-tokens.ts";
import { getDraft, setDraft } from "./draft-store.ts";
import { fileToPromptImage } from "./image-resize.ts";
import { useChipLabels } from "./use-draft-view.ts";

/** 把粘贴 / 拖入的文件里的图片转成可发送的图片（非图片忽略：它们走主进程的文件附件）；转换失败的 toast 并跳过。 */
export async function convertImageFiles(files: Iterable<File>, t: TFunction): Promise<DraftImage[]> {
  const converted: DraftImage[] = [];
  for (const file of [...files].filter((entry) => entry.type.startsWith("image/"))) {
    try {
      converted.push(await fileToPromptImage(file));
    } catch {
      pushToast({ level: "error", message: t("composer.attach.failed") });
    }
  }
  return converted;
}

export interface Attach {
  addFiles(files: Iterable<File>): Promise<void>;
  onDragOver(event: DragEvent): void;
  onDrop(event: DragEvent): void;
}

/** acceptsImages 为 false（当前模型不收图片）时拒绝图片并 toast；undefined = 不知道（草稿页），照收。 */
export function useAttach(
  key: TaskId,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  acceptsImages: boolean | undefined,
): Attach {
  const t = useT();
  const labels = useChipLabels();

  /** 现在的光标（文字里的偏移）；输入框没有焦点（拖入）时没有可靠的光标：null = 插在末尾。 */
  const caretNow = useCallback((): number | null => {
    const field = fieldRef.current;
    return field !== null && document.activeElement === field
      ? viewToTextOffset(buildView(getDraft(key), labels), field.selectionStart)
      : null;
  }, [fieldRef, key, labels]);

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      const list = [...files];
      if (!list.some((file) => file.type.startsWith("image/"))) return;
      if (acceptsImages === false) {
        pushToast({ level: "warning", message: t("composer.attach.unsupported") });
        return;
      }
      // 插在粘贴那一刻的光标处（转换图片是异步的，期间光标可能动了）。
      const caret = caretNow();
      const converted = await convertImageFiles(list, t);
      if (converted.length === 0) return;
      const draft = getDraft(key);
      const inserted = insertImages(draft, converted, offsetOutsideTokens(draft, caret ?? draft.text.length));
      setDraft(key, inserted.draft);
      requestCaret(key, inserted.caret);
      fieldRef.current?.focus();
    },
    [acceptsImages, caretNow, key, fieldRef, t],
  );

  // 文件附件：主进程登记好的文件（拖入 / 粘贴时 preload 取路径、主进程校验；选择器的结果也走这里）。
  const addComposerFiles = useCallback(
    (files: readonly ComposerFile[]) => {
      if (files.length === 0) return;
      const draft = getDraft(key);
      const inserted = insertFiles(draft, files, offsetOutsideTokens(draft, caretNow() ?? draft.text.length));
      setDraft(key, inserted.draft);
      requestCaret(key, inserted.caret);
      fieldRef.current?.focus();
    },
    [caretNow, key, fieldRef],
  );
  useEffect(() => window.studio.onComposerFilesAdded(addComposerFiles), [addComposerFiles]);

  return {
    addFiles,
    onDragOver: (event) => {
      if ([...event.dataTransfer.items].some((item) => item.kind === "file")) event.preventDefault();
    },
    onDrop: (event) => {
      if (event.dataTransfer.files.length === 0) return;
      event.preventDefault();
      void addFiles(event.dataTransfer.files);
    },
  };
}

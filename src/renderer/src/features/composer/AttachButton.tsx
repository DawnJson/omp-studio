// 输入框工具行最左的附件按钮：打开主进程的系统文件对话框（文件、图片都行），选中的加成附件卡片和 `#N` 芯片。
import { useT } from "../../i18n/use-t.ts";
import { Plus } from "../../icons.tsx";

export function AttachButton({ onPick, disabled }: { onPick(): void; disabled?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      className="tool-btn"
      data-testid="composer-attach"
      aria-label={t("composer.attach.pick")}
      title={t("composer.attach.pick")}
      disabled={disabled}
      onClick={onPick}
    >
      <Plus size={16} />
    </button>
  );
}

// 顶栏右侧工具区的文件面板按钮（任务和有项目的新任务草稿都有）。按钮状态 = 这个任务的面板是否开着。
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Folder } from "../../icons.tsx";
import { toggleFilesPanel, usePreviewPanel } from "./preview-store.ts";

export function FilesToggle({ panelKey }: { panelKey: TerminalKey }) {
  const t = useT();
  const open = usePreviewPanel()?.key === panelKey;
  return (
    <button
      type="button"
      className="topbar-tool"
      data-testid="topbar-files"
      aria-label={t("preview.filesToggle")}
      aria-pressed={open}
      aria-expanded={open}
      title={`${t("preview.filesToggle")} (Ctrl Shift E)`}
      onClick={() => toggleFilesPanel(panelKey)}
    >
      <Folder size={16} />
    </button>
  );
}

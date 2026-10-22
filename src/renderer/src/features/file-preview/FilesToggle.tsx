// 顶栏右侧工具区的文件面板按钮（任务和有项目的新任务草稿都有）。按钮状态 = 这个任务的面板是否开着。
import type { TerminalKey } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Folder } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { toggleFilesPanel, usePreviewPanel } from "./preview-store.ts";

export function FilesToggle({ panelKey }: { panelKey: TerminalKey }) {
  const t = useT();
  const open = usePreviewPanel()?.key === panelKey;
  return (
    <IconButton
      label={t("preview.filesToggle")}
      tip={`${t("preview.filesToggle")} (Ctrl Shift E)`}
      pressed={open}
      expanded={open}
      testId="topbar-files"
      onClick={() => toggleFilesPanel(panelKey)}
    >
      <Folder size={16} />
    </IconButton>
  );
}

// 顶栏右侧工具区的浏览器面板按钮（只有任务有：页面属于任务，也是这个任务的 omp 用的浏览器）。按钮状态 = 这个任务的面板是否开着。
import type { TaskId } from "../../../../shared/ipc.ts";
import { withShortcut } from "../../app/platform-keys.ts";
import { useT } from "../../i18n/use-t.ts";
import { Globe } from "../../icons.tsx";
import { IconButton } from "../../ui/controls.tsx";
import { toggleBrowserPanel, useBrowserPanel } from "./browser-store.ts";

export function BrowserToggle({ taskId }: { taskId: TaskId }) {
  const t = useT();
  const open = useBrowserPanel() === taskId;
  return (
    <IconButton
      label={t("browser.toggle")}
      tip={withShortcut(t("browser.toggle"), "Ctrl Shift B")}
      pressed={open}
      expanded={open}
      testId="topbar-browser"
      onClick={() => toggleBrowserPanel(taskId)}
    >
      <Globe size={16} />
    </IconButton>
  );
}

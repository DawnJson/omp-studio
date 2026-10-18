// 应用布局。各功能入口的导出名和 props 是约定（props 只有 id，数据从 store hook 取）。
// 外壳切片负责这个文件：布局、主题和动效偏好、焦点管理、空状态。
import { Composer } from "../features/composer/index.ts";
import { ConversationView } from "../features/conversation/index.ts";
import { DialogLayer } from "../features/dialogs/index.ts";
import { OmpSetupView } from "../features/omp-setup/index.ts";
import { CommandPalette } from "../features/palette/index.ts";
import { SettingsView } from "../features/settings/index.ts";
import { Sidebar } from "../features/sidebar/index.ts";
import { useAppInfo, useMainView, useSelectedTaskId } from "../store/index.ts";

export function App() {
  const taskId = useSelectedTaskId();
  const view = useMainView();
  const appInfo = useAppInfo();

  return (
    <div id="app" data-testid="app-root" data-locale={appInfo?.locale}>
      <Sidebar />
      <main>
        <div>omp-studio {appInfo?.version}</div>
        {view === "settings" ? (
          <SettingsView />
        ) : (
          taskId !== null && (
            <>
              <ConversationView taskId={taskId} />
              <Composer taskId={taskId} />
            </>
          )
        )}
      </main>
      <DialogLayer taskId={taskId} />
      <CommandPalette />
      <OmpSetupView />
    </div>
  );
}

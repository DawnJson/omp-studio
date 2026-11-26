// `/mcp`、`/ssh`、`/tools`、`/memory`、`/changelog`（studio 接管，不弹 omp 的 TSP 报告弹窗）：不带参数打开设置里对应的卡片。
// 任务里带参数（`/mcp reauth github`）时原样交给 omp，由它执行；草稿页没有 omp，报错、草稿放回输入框。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { showView, type SettingsSection } from "../../store/index.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";

function row(name: string, descKey: MessageKey, section: SettingsSection): StudioSlashCommand {
  return {
    name,
    descKey,
    run: (_taskId, args) => {
      if (args !== "") return "omp";
      showView("settings", { section });
    },
    draft: (args, t) => {
      if (args !== "") throw new Error(t("integrations.slash.args"));
      showView("settings", { section });
    },
  };
}

export const integrationsSlashCommands: readonly StudioSlashCommand[] = [
  row("mcp", "integrations.slash.mcp", "extensions"),
  row("ssh", "integrations.slash.ssh", "extensions"),
  row("tools", "integrations.slash.tools", "tools"),
  row("memory", "integrations.slash.memory", "context"),
  row("changelog", "integrations.slash.changelog", "about"),
];

// `/mcp`、`/ssh`、`/tools`、`/memory`、`/changelog`（studio 接管，不弹 omp 的 TSP 报告弹窗）：打开设置里对应的卡片。
// 带参数（`/mcp add …`）时不悄悄丢掉用户写的话：报错、草稿放回输入框，和 /compact、/plugins 一样；增删改在卡片的表单里做。
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { showView } from "../../store/index.ts";
import type { SettingsSection } from "../../store/ui-store.ts";
import type { StudioSlashCommand } from "../composer/studio-slash.ts";

type T = Parameters<StudioSlashCommand["run"]>[2];

function row(name: string, descKey: MessageKey, section: SettingsSection): StudioSlashCommand {
  const open = (args: string, t: T) => {
    if (args !== "") throw new Error(t("integrations.slash.args"));
    showView("settings", { section });
  };
  return {
    name,
    descKey,
    tsp: "studio",
    run: (_taskId, args, t) => open(args, t),
    draft: (args, t) => open(args, t),
  };
}

export const integrationsSlashCommands: readonly StudioSlashCommand[] = [
  row("mcp", "integrations.slash.mcp", "cfg:integrations"),
  row("ssh", "integrations.slash.ssh", "cfg:integrations"),
  row("tools", "integrations.slash.tools", "cfg:tools"),
  row("memory", "integrations.slash.memory", "cfg:context"),
  row("changelog", "integrations.slash.changelog", "omp"),
];

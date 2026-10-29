// 设置 → 关于 → 问题排查：打开日志文件夹、导出诊断信息（内容和脱敏规则见 src/main/log/）。
// 和别的设置一样是"标签 | 控件"两行（2026-10-29 审计 SET-17：原来两个按钮当标签，格子里没有控件，左对齐，和其他行不一样）。
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { Button, Row } from "../../ui/controls.tsx";
import { useAsyncAction } from "./use-async-action.ts";

export function TroubleshootCard() {
  const t = useT();
  const { busy: exporting, run } = useAsyncAction((error) => reportError(t, error));
  return (
    <div className="st-cells" data-testid="about-troubleshoot">
      <Row label={t("settings.about.logs")}>
        {(labelId) => (
          <Button
            size="sm"
            aria-describedby={labelId}
            onClick={() => void window.studio.openLogsFolder().catch((error: unknown) => reportError(t, error))}
            testId="open-logs"
          >
            {t("settings.about.openFolder")}
          </Button>
        )}
      </Row>
      <Row label={t("settings.about.diagnostics")} info={t("settings.about.diagnostics.desc")}>
        {(labelId) => (
          <Button
            size="sm"
            aria-describedby={labelId}
            loading={exporting}
            onClick={() => void run(() => window.studio.exportDiagnostics())}
            testId="export-diagnostics"
          >
            {t("settings.about.export")}
          </Button>
        )}
      </Row>
    </div>
  );
}

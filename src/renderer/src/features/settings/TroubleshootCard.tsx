// 设置 → 关于 → 问题排查：打开日志文件夹、导出诊断信息（内容和脱敏规则见 src/main/log/）。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { pushToast } from "../dialogs/index.ts";
import { Button, Row } from "../../ui/controls.tsx";

export function TroubleshootCard() {
  const t = useT();
  const [exporting, setExporting] = useState(false);

  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      if (await window.studio.exportDiagnostics()) pushToast({ message: t("settings.about.exported") });
    } catch (error) {
      reportError(t, error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="st-cells" data-cols="2" data-testid="about-troubleshoot">
      <Row label={t("settings.about.logs")} info={t("settings.about.logs.desc")}>
        {() => (
          <Button
            size="sm"
            onClick={() => void window.studio.openLogsFolder().catch((error: unknown) => reportError(t, error))}
            testId="open-logs"
          >
            {t("settings.about.openLogs")}
          </Button>
        )}
      </Row>
      <Row label={t("settings.about.diagnostics")} info={t("settings.about.diagnostics.desc")}>
        {() => (
          <Button size="sm" loading={exporting} onClick={() => void exportDiagnostics()} testId="export-diagnostics">
            {t("settings.about.exportDiagnostics")}
          </Button>
        )}
      </Row>
    </div>
  );
}

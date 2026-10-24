// 设置 → 关于 → 问题排查：打开日志文件夹、导出诊断信息（内容和脱敏规则见 src/main/log/）。
import { useState } from "react";
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { Button, Row } from "../../ui/controls.tsx";

export function TroubleshootCard() {
  const t = useT();
  const [exporting, setExporting] = useState(false);

  const exportDiagnostics = async () => {
    setExporting(true);
    try {
      await window.studio.exportDiagnostics();
    } catch (error) {
      reportError(t, error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="st-cells" data-testid="about-troubleshoot">
      <Row
        label={
          <Button
            size="sm"
            onClick={() => void window.studio.openLogsFolder().catch((error: unknown) => reportError(t, error))}
            testId="open-logs"
          >
            {t("settings.about.openLogs")}
          </Button>
        }
        info={t("settings.about.logs.desc")}
      >
        {() => null}
      </Row>
      <Row
        label={
          <Button size="sm" loading={exporting} onClick={() => void exportDiagnostics()} testId="export-diagnostics">
            {t("settings.about.exportDiagnostics")}
          </Button>
        }
        info={t("settings.about.diagnostics.desc")}
      >
        {() => null}
      </Row>
    </div>
  );
}

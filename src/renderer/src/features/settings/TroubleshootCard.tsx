// 设置 → 关于 → 问题排查：打开日志文件夹、导出诊断信息（内容和脱敏规则见 src/main/log/）。
import { useT } from "../../i18n/use-t.ts";
import { reportError } from "../../ui/errors.ts";
import { Button, Row } from "../../ui/controls.tsx";
import { useAsyncAction } from "./use-async-action.ts";

export function TroubleshootCard() {
  const t = useT();
  const { busy: exporting, run } = useAsyncAction((error) => reportError(t, error));
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
          <Button
            size="sm"
            loading={exporting}
            onClick={() => void run(() => window.studio.exportDiagnostics())}
            testId="export-diagnostics"
          >
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

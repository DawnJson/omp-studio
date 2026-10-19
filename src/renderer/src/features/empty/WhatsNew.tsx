// 新任务页标志下面的"最近更新"（照 omp 的 What's New）：升级后第一次启动才有，只写统计，不列条目，一行显示完。
import type { WhatsNew as Summary } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";

export function WhatsNew({ summary }: { summary: Summary }) {
  const t = useT();
  const { version, releases, total } = summary;
  const parts = [
    releases > 1
      ? t("empty.whatsNewUpdatedMany", { version, releases, count: total })
      : t("empty.whatsNewUpdated", { version, count: total }),
    summary.added > 0 && t("empty.whatsNewAdded", { n: summary.added }),
    summary.changed > 0 && t("empty.whatsNewChanged", { n: summary.changed }),
    summary.fixed > 0 && t("empty.whatsNewFixed", { n: summary.fixed }),
  ].filter((part) => part !== false);
  const line = parts.join(" · ");
  return (
    <p className="whats-new" data-testid="whats-new" title={`${t("empty.whatsNew")} · ${line}`}>
      <strong className="whats-new-h">{t("empty.whatsNew")}</strong>
      {` · ${line}`}
    </p>
  );
}

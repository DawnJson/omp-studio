// 新任务页标志下面的"最近更新"（照 omp 的 What's New）：升级后第一次启动才有，只写一句"已更新到 vX · N 项改动"（版本跨多个时带上个数）。
// 新增 / 变更 / 修复的分项只放在悬停提示里，不在这一行重复。
import { useEffect, useState } from "react";
import type { WhatsNew as Summary } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";

const VISIBLE_MS = 5_000;
let dismissed = false;

export function WhatsNew({ summary }: { summary: Summary }) {
  const t = useT();
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (dismissed) return;
    const timer = setTimeout(() => {
      dismissed = true;
      setFading(true);
    }, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (dismissed && !fading) return null;

  const { version, releases, total } = summary;
  const line =
    releases > 1
      ? t("empty.whatsNewUpdatedMany", { version, releases, count: total })
      : t("empty.whatsNewUpdated", { version, count: total });
  const breakdown = [
    summary.added > 0 && t("empty.whatsNewAdded", { n: summary.added }),
    summary.changed > 0 && t("empty.whatsNewChanged", { n: summary.changed }),
    summary.fixed > 0 && t("empty.whatsNewFixed", { n: summary.fixed }),
  ].filter((part) => part !== false);
  return (
    <p
      className="whats-new"
      data-testid="whats-new"
      data-fading={fading || undefined}
      aria-hidden={fading || undefined}
      title={[t("empty.whatsNew"), ...breakdown].join(" · ")}
    >
      {line}
    </p>
  );
}

// 输入框上方的超限提示（get_state.usageLimit）：只说明阶段和重置时间，不挡发送，没有关闭按钮——状态没了它自己消失。
import { useEffect, useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { usageLimitBanner } from "./speed-limit-format.ts";

export function UsageLimitBanner({ limit }: { limit: TaskState["usageLimit"] }) {
  const t = useT();
  // 每分钟重算一次：应用开着跨过午夜时，重置时间要从“HH:mm”变成带日期的写法。
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (limit === null) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [limit]);
  const banner = usageLimitBanner(limit, now);
  if (banner === null) return null;
  return (
    <div
      className="suggest usage-limit"
      role="status"
      aria-label={t("composer.limit.aria")}
      data-testid="usage-limit-banner"
      data-stage={banner.stage}
    >
      <span>
        {t(banner.message)}
        {banner.details.map((detail) => ` ${t(detail.key, detail.params)}`).join(" ·")}
      </span>
    </div>
  );
}

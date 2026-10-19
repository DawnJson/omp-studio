// 输入框上方的超限提示（get_state.usageLimit）：只说明阶段和重置时间，不挡发送，没有关闭按钮——状态没了它自己消失。
import { useEffect, useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { usageLimitBanner } from "./speed-limit-format.ts";
import { Reveal } from "../../ui/Reveal.tsx";
import { useHeld } from "./use-held.ts";

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
  // 状态没了之后收起动画期间沿用上一条内容。
  const shown = useHeld(banner);
  return (
    <Reveal open={banner !== null}>
      {shown && (
        <div
          className="suggest usage-limit"
          role="status"
          aria-label={t("composer.limit.aria")}
          data-testid="usage-limit-banner"
          data-stage={shown.stage}
        >
          <span>
            {t(shown.message)}
            {shown.details.map((detail) => ` ${t(detail.key, detail.params)}`).join(" ·")}
          </span>
        </div>
      )}
    </Reveal>
  );
}

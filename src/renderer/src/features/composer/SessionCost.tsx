// 工具行里发送键左边的本会话费用（omp 状态栏的 cost 段）：get_session_stats 的 cost，按模型目录价格估算，
// 订阅登录的模型也照样累计（等价 API 价格），并像 omp 一样在后面标 "(sub)"。一直显示：新任务草稿、还没有统计时是 $0.00；
// 悬停给 token 明细，点开是每日用量热力图和订阅额度（UsageOverview）。
import { useState } from "react";
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { Popover } from "./Popover.tsx";
import { formatCount, formatMoney } from "./usage-format.ts";
import { UsageOverview } from "./UsageOverview.tsx";
import { useSubscription } from "./use-subscription.ts";

export function SessionCost({ usage, provider }: { usage: TaskState["sessionUsage"]; provider: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const subscription = useSubscription(provider);
  const detail = [
    t(subscription ? "composer.usage.costTipSub" : "composer.usage.costTip"),
    ...(usage === null
      ? []
      : [
          [
            `${t("composer.usage.input")} ${formatCount(usage.tokens.input)}`,
            `${t("composer.usage.output")} ${formatCount(usage.tokens.output)}`,
            `${t("composer.usage.cache")} ${formatCount(usage.tokens.cacheRead)}`,
            ...(usage.premiumRequests > 0 ? [t("composer.usage.premium", { n: usage.premiumRequests })] : []),
          ].join(" · "),
        ]),
  ].join("\n");
  return (
    <div className="pop-anchor session-cost-anchor">
      <button
        type="button"
        className="session-cost"
        data-testid="usage-cost"
        title={detail}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {formatMoney(usage?.cost ?? 0)}
        {subscription && (
          <span className="session-cost-sub" data-testid="usage-sub">
            {" "}
            (sub)
          </span>
        )}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={520} align="end" label={t("composer.usage.overview")}>
        <UsageOverview provider={provider} />
      </Popover>
    </div>
  );
}

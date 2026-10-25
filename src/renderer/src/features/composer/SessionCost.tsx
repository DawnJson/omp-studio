// 工具行里发送键左边的本会话费用（omp 状态栏的 cost 段）：get_session_stats 的 cost，按模型目录价格估算，
// 订阅登录的模型也照样累计（等价 API 价格），并像 omp 一样在后面标 "(sub)"。子代理的花费照 omp 写在括号里 "(+0.12)"
// （omp 的第一个数不含子代理）。一直显示：新任务草稿、还没有统计时是 $0.00；
// 悬停给 token 明细，点开是居中的用量对话框（汇总 + 订阅额度 + 每日用量，UsageDialog）；`/usage`、命令面板"用量"打开的也是它（usage-store）。
import type { TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { formatCount, formatMoney } from "./usage-format.ts";
import { UsageDialog } from "./UsageDialog.tsx";
import { setUsageDialogOpen, useUsageDialogOpen } from "./usage-store.ts";
import { useSubscription } from "./use-subscription.ts";

export function SessionCost({ usage, provider }: { usage: TaskState["sessionUsage"]; provider: string | null }) {
  const t = useT();
  const open = useUsageDialogOpen();
  const subscription = useSubscription(provider);
  const subagents = usage?.subagentCost ?? 0;
  const detail = [
    t(subscription ? "composer.usage.costTipSub" : "composer.usage.costTip"),
    ...(subagents > 0 ? [t("composer.usage.subagents", { cost: formatMoney(subagents) })] : []),
    ...(usage === null
      ? []
      : [
          [
            `${t("composer.usage.input")} ${formatCount(usage.tokens.input)}`,
            `${t("composer.usage.output")} ${formatCount(usage.tokens.output)}`,
            `${t("composer.usage.cache")} ${formatCount(usage.tokens.cacheRead)}`,
            ...(usage.premiumRequests > 0 ? [t("composer.usage.premium", { n: usage.premiumRequests })] : []),
            // TSP 任务：omp 的输入框卡片不给请求数，主进程从会话文件数出来（tsp-runner #sessionUsageFor）。
            ...(usage.requests !== undefined && usage.requests > 0
              ? [t("sessionInfo.usage.requestsTip", { count: usage.requests })]
              : []),
          ].join(" · "),
        ]),
  ].join("\n");
  return (
    <div className="session-cost-anchor">
      <button
        type="button"
        className="session-cost"
        data-testid="usage-cost"
        title={detail}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setUsageDialogOpen(!open)}
      >
        {formatMoney(usage?.cost ?? 0)}
        {subagents > 0 && (
          <span className="session-cost-sub" data-testid="usage-subagents">
            {" "}
            (+{subagents.toFixed(2)})
          </span>
        )}
        {subscription && (
          <span className="session-cost-sub" data-testid="usage-sub">
            {" "}
            (sub)
          </span>
        )}
      </button>
      <UsageDialog provider={provider} open={open} onClose={() => setUsageDialogOpen(false)} />
    </div>
  );
}

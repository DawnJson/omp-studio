// 点发送键左边的费用弹出的用量对话框（ui/Dialog lg，居中，盖一层遮罩；高度跟内容走，没有额度账号时下面不留空）：标题"用量与额度"，标题行只有 ↻ 图标按钮（悬停提示里写额度的取得时间）和 ×，下面一页滚动内容，没有页签：
// 先是汇总条（最紧的额度、过去一年、最近 30 天、最忙的一天），再是各订阅账号的额度（当前 provider 排最前，每个账号一张卡，每个窗口一格；
// 套餐、Daybreak、重置券徽章；取不到用量的账号一行说明），额度上方一行小字写 omp 取得额度的时间（omp 有约 5 分钟缓存，可能比打开对话框早），
// 最后是最近一年的每日用量热力图（不带小标题），格子按花费着色，悬停给金额和请求数。
// 数据在 usage-store（omp usage --json / stats.db）：打开时额度读 omp 的缓存，热力图还没有数据时才读；点 ↻ 先让 omp 清掉额度缓存（omp usage invalidate）再重读，热力图也重读。
import { useEffect } from "react";
import type { TFunction } from "../../../../shared/i18n/index.ts";
import { isUntouched, quotaFetchedAt } from "../../../../shared/ui/usage-summary.ts";
import { Restart } from "../../icons.tsx";
import { useT } from "../../i18n/use-t.ts";
import { IconButton } from "../../ui/controls.tsx";
import { Dialog } from "../../ui/Dialog.tsx";
import { describeError } from "../../ui/errors.ts";
import { usePresence } from "../../ui/presence.ts";
import { useNow } from "../conversation/use-now.ts";
import { loadHeatmap, loadQuota, useUsageHeatmap, useUsageQuota } from "./usage-store.ts";
import { HeatmapView, QuotaBlock, SummaryStrip, UnavailableRow, UntouchedRow } from "./usage-views.tsx";

/** "7 秒前更新"：额度最近一次读成功距今多久；还没读到时为空。 */
function updatedText(t: TFunction, at: number | null, now: number): string {
  if (at === null) return "";
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 5) return t("usage.updated.now");
  if (seconds < 60) return t("usage.updated.seconds", { n: seconds });
  if (seconds < 3600) return t("usage.updated.minutes", { n: Math.floor(seconds / 60) });
  return t("usage.updated.hours", { n: Math.floor(seconds / 3600) });
}

function Summary() {
  const quota = useUsageQuota();
  const heatmap = useUsageHeatmap();
  const database = heatmap.data?.hasDatabase ? heatmap.data : null;
  if (quota.data === null && database === null) return null;
  return (
    <section className="qm-panel">
      <SummaryStrip quota={quota.data} heatmap={database} />
    </section>
  );
}

function DailyUsage() {
  const t = useT();
  const heatmap = useUsageHeatmap();
  return (
    <>
      {heatmap.error !== null && (
        <p className="ctx-note" role="alert">
          {t("usage.heatmap.failed", { message: describeError(t, heatmap.error) })}
        </p>
      )}
      {heatmap.data?.hasDatabase && <HeatmapView heatmap={heatmap.data} />}
      {heatmap.data && !heatmap.data.hasDatabase && !heatmap.busy && (
        <p className="ctx-note">{t("usage.heatmap.noDatabase")}</p>
      )}
      {heatmap.busy && (
        <p className="ctx-note" data-testid="usage-syncing">
          {t("usage.heatmap.syncing")}
        </p>
      )}
    </>
  );
}

function Quota({ provider }: { provider: string | null }) {
  const t = useT();
  const quota = useUsageQuota();
  const accounts = [...(quota.data?.accounts ?? [])].sort(
    (a, b) => Number(b.provider === provider) - Number(a.provider === provider),
  );
  return (
    <>
      {quota.error !== null && (
        <p className="ctx-note" role="alert">
          {t("usage.quota.failed", { message: describeError(t, quota.error) })}
        </p>
      )}
      {quota.data === null && quota.busy && <p className="ctx-note">{t("usage.loading")}</p>}
      {quota.data !== null && accounts.length === 0 && (
        <p className="ctx-note" data-testid="usage-quota-empty">
          {t("usage.quota.empty")}
        </p>
      )}
      {accounts
        .filter((account) => !isUntouched(account))
        .map((account) => (
          <QuotaBlock key={`${account.provider}/${account.account ?? ""}`} account={account} />
        ))}
      {accounts.some(isUntouched) && <UntouchedRow accounts={accounts.filter(isUntouched)} />}
      {(quota.data?.unavailable ?? []).map((item) => (
        <UnavailableRow key={`${item.provider}/${item.label}`} item={item} />
      ))}
    </>
  );
}

/** 对话框本体：打开（挂载）时读一次数据；退出动画由 Dialog 放，放完由外层卸载。 */
function UsageDialogBody({ provider, open, onClose }: { provider: string | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const heatmap = useUsageHeatmap();
  const quota = useUsageQuota();
  const now = useNow(quota.at !== null);
  useEffect(() => {
    void loadQuota();
    if (heatmap.data === null && !heatmap.busy) void loadHeatmap();
    // 只在打开（挂载）时读一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fetchedAt = quotaFetchedAt(quota.data?.accounts ?? []) ?? quota.at;
  const updated = updatedText(t, fetchedAt, now);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      className="usage-dialog"
      testId="usage-dialog"
      title={t("composer.usage.overview")}
      headAction={
        <>
          {updated !== "" && (
            <span className="usage-updated" data-testid="usage-checked">
              {updated}
            </span>
          )}
          <IconButton
            label={t("usage.refresh")}
            tip={t("usage.refresh")}
            disabled={quota.busy || heatmap.busy}
            testId="usage-refresh"
            onClick={() => {
              void loadQuota(true);
              void loadHeatmap();
            }}
          >
            <Restart size={14} />
          </IconButton>
        </>
      }
    >
      <div className="qm">
        <Summary />
        <section className="qm-panel" data-testid="quota-section">
          <Quota provider={provider} />
        </section>
        <section className="qm-panel" data-testid="heatmap-section">
          <DailyUsage />
        </section>
      </div>
    </Dialog>
  );
}

/** provider：当前模型的 provider（草稿里是默认模型的），它的账号排在最前。 */
export function UsageDialog(props: { provider: string | null; open: boolean; onClose: () => void }) {
  const presence = usePresence(props.open);
  if (!presence.mounted) return null;
  return <UsageDialogBody {...props} />;
}

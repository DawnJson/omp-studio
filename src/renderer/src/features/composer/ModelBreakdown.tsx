// 上下文浮层左栏的按模型明细（照 Claude Code 的 Usage → Breakdown）：头一行本会话 token 总数，下面一行输出速度，每个模型的输入 / 输出 / 缓存读取 / 缓存写入、
// 缓存命中率（没有缓存数据时不显示）和费用。
// 数据由主进程读会话文件得到（getSessionModelUsage），范围和 omp 的会话统计一致；压缩过时底部另给整个会话（含压缩前）的合计。
// 浮层打开时读一次；打开期间一轮结束（updatedAt 变了）再读。还没有回复（会话文件里没有模型记录）时没有左栏，浮层保持单栏。
import { useEffect, useState } from "react";
import type { SessionModelUsage, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { deriveComposerFacts, sameComposerFacts } from "../../../../shared/tsp/composer-facts.ts";
import { useSessionExtras } from "../tsp/session-extras-store.ts";
import { useTspDerived } from "../tsp/tsp-store.ts";
import { formatTokensPerSecond } from "./speed-limit-format.ts";
import { cacheHitRate, formatCount, formatMoney, formatPercent } from "./usage-format.ts";

export type ModelUsageLoad =
  { kind: "idle" } | { kind: "ready"; data: SessionModelUsage } | { kind: "error"; error: unknown };

/** enabled（浮层打开）时读这个任务的按模型用量；task 为 undefined（草稿）时不读。 */
export function useModelUsage(task: TaskState | undefined, enabled: boolean): ModelUsageLoad {
  const [load, setLoad] = useState<ModelUsageLoad>({ kind: "idle" });
  const taskId = task?.id;
  const updatedAt = task?.updatedAt;
  useEffect(() => {
    if (!enabled || taskId === undefined) return;
    let current = true;
    window.studio.getSessionModelUsage(taskId).then(
      (data) => current && setLoad({ kind: "ready", data }),
      (error: unknown) => current && setLoad({ kind: "error", error }),
    );
    return () => {
      current = false;
    };
  }, [taskId, updatedAt, enabled]);
  return load;
}

/** 有数据可展开：读到了且有模型记录，或者读失败（让用户看到原因）。 */
export function hasModelUsage(load: ModelUsageLoad): boolean {
  return load.kind === "error" || (load.kind === "ready" && load.data.models.length > 0);
}

/** 输出速度：text 是给 `composer.usage.tps` 的数字，live 表示是 omp 的实时速度。 */
export interface Speed {
  text: string;
  live: boolean;
}

/**
 * 输出速度（2026-11-07 起从工具行挪进本会话用量）：运行中有 omp 的实时速度（输入框卡片里的 `omp.composer.rate`，omp 设置 `composer.tokenRate`
 * 开着时才有，shared/tsp/composer-facts.ts）就用它（取整）；否则是会话文件里最近一条回复的（`useSessionExtras().tokensPerSecond`，
 * output ÷ (duration − ttft)，一轮结束时刷新）。都没有时 null。
 */
export function useSpeed(task: TaskState): Speed | null {
  const lastRate = useSessionExtras(task.id, (extras) => extras.tokensPerSecond);
  const liveRate = useTspDerived(task.id, deriveComposerFacts, sameComposerFacts)?.rate ?? null;
  const busy = task.status === "running" || task.status === "needs_you";
  if (busy && liveRate !== null) return { text: String(Math.max(1, Math.round(liveRate))), live: true };
  const text = formatTokensPerSecond(lastRate);
  return text === null ? null : { text, live: false };
}

export function ModelBreakdown({ task, load, speed }: { task: TaskState; load: ModelUsageLoad; speed: Speed | null }) {
  const t = useT();
  const nameOf = (provider: string, modelId: string) =>
    task.model?.key.provider === provider && task.model.key.modelId === modelId ? task.model.name : modelId;
  return (
    <div className="mb" data-testid="model-breakdown">
      <div className="ctx-head">
        <strong className="mb-title">{t("composer.breakdown.title")}</strong>
        {task.sessionUsage !== null && <span className="ctx-num">{formatCount(task.sessionUsage.tokens.total)}</span>}
      </div>
      {speed !== null && (
        <p className="ctx-note" data-testid="usage-tps" data-live={speed.live || undefined}>
          {t("composer.usage.tps", { n: speed.text })}
        </p>
      )}
      {load.kind === "error" && (
        <p className="ctx-note" role="alert">
          {t("composer.breakdown.failed", { message: describeError(t, load.error) })}
        </p>
      )}
      {load.kind === "ready" &&
        load.data.models.map((row) => {
          const hitRate = cacheHitRate(row);
          return (
            <section key={`${row.provider}/${row.modelId}`} className="mb-model" data-testid="model-usage">
              <div className="mb-model-head">
                <span className="mb-model-name" title={`${row.provider}/${row.modelId}`}>
                  {nameOf(row.provider, row.modelId)}
                </span>
                <span className="ctx-num">{row.cost > 0 ? formatMoney(row.cost) : null}</span>
              </div>
              <dl className="mb-grid">
                <div>
                  <dt>{t("composer.usage.input")}</dt>
                  <dd className="ctx-num">{formatCount(row.input)}</dd>
                </div>
                <div>
                  <dt>{t("composer.usage.output")}</dt>
                  <dd className="ctx-num">{formatCount(row.output)}</dd>
                </div>
                <div>
                  <dt>{t("composer.usage.cache")}</dt>
                  <dd className="ctx-num">{formatCount(row.cacheRead)}</dd>
                </div>
                <div>
                  <dt>{t("composer.usage.cacheWrite")}</dt>
                  <dd className="ctx-num">{formatCount(row.cacheWrite)}</dd>
                </div>
                {hitRate !== null && (
                  <div>
                    <dt>{t("composer.usage.cacheHit")}</dt>
                    <dd className="ctx-num" data-testid="model-usage-cache-hit">
                      {formatPercent(hitRate * 100)}%
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          );
        })}
      {load.kind === "ready" && load.data.whole !== null && (
        <p className="ctx-note" data-testid="model-usage-whole">
          {t("composer.breakdown.whole", {
            tokens: formatCount(load.data.whole.total),
            cost: formatMoney(load.data.whole.cost),
          })}
        </p>
      )}
    </div>
  );
}

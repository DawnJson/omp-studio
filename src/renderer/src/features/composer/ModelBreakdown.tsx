// 上下文浮层里点"会话用量"在左边展开的按模型明细（照 Claude Code 的 Usage → Breakdown）：头一行本会话 token 总数，每个模型的输入 / 输出 / 缓存读取 / 缓存写入和费用。
// 数据由主进程读会话文件得到（getSessionModelUsage），范围和 omp 的会话统计一致；压缩过时底部另给整个会话（含压缩前）的合计。
// 浮层打开时读一次；打开期间一轮结束（updatedAt 变了）再读。还没有回复（会话文件里没有模型记录）时浮层不提供这个按钮，保持单栏。
import { useEffect, useState } from "react";
import type { SessionModelUsage, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { formatCount, formatMoney } from "./usage-format.ts";

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

export function ModelBreakdown({ task, load }: { task: TaskState; load: ModelUsageLoad }) {
  const t = useT();
  const nameOf = (provider: string, modelId: string) =>
    task.model?.key.provider === provider && task.model.key.modelId === modelId ? task.model.name : modelId;
  return (
    <div className="mb" data-testid="model-breakdown">
      <div className="ctx-head">
        <strong className="mb-title">{t("composer.breakdown.title")}</strong>
        {task.sessionUsage !== null && <span className="ctx-num">{formatCount(task.sessionUsage.tokens.total)}</span>}
      </div>
      {load.kind === "error" && (
        <p className="ctx-note" role="alert">
          {t("composer.breakdown.failed", { message: describeError(t, load.error) })}
        </p>
      )}
      {load.kind === "ready" &&
        load.data.models.map((row) => (
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
            </dl>
          </section>
        ))}
      {load.kind === "ready" && load.data.whole !== null && (
        <p className="ctx-note" data-testid="model-usage-whole">
          {t("composer.breakdown.whole", {
            count: load.data.compactions,
            tokens: formatCount(load.data.whole.total),
            cost: formatMoney(load.data.whole.cost),
          })}
        </p>
      )}
    </div>
  );
}

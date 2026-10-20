// 点工具行的 token 图标弹出的按模型明细（照 Claude Code 的 Usage → Breakdown）：头一行本会话 token 总数，每个模型的输入 / 输出 / 缓存读取 / 缓存写入和费用。
// 数据由主进程读会话文件得到（getSessionModelUsage），范围和 omp 的会话统计一致；压缩过时底部另给整个会话（含压缩前）的合计。
// 打开时读一次；打开期间一轮结束（updatedAt 变了）再读。
import { useEffect, useState } from "react";
import type { SessionModelUsage, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { describeError } from "../../ui/errors.ts";
import { formatCount, formatMoney } from "./usage-format.ts";

type Load = { kind: "loading" } | { kind: "ready"; data: SessionModelUsage } | { kind: "error"; error: unknown };

export function ModelBreakdown({ task }: { task: TaskState }) {
  const t = useT();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    window.studio.getSessionModelUsage(task.id).then(
      (data) => current && setLoad({ kind: "ready", data }),
      (error: unknown) => current && setLoad({ kind: "error", error }),
    );
    return () => {
      current = false;
    };
  }, [task.id, task.updatedAt]);

  const nameOf = (provider: string, modelId: string) =>
    task.model?.key.provider === provider && task.model.key.modelId === modelId ? task.model.name : modelId;

  return (
    <div className="mb" data-testid="model-breakdown">
      <div className="ctx-head">
        <strong className="mb-title">{t("composer.breakdown.title")}</strong>
        {task.sessionUsage !== null && <span className="ctx-num">{formatCount(task.sessionUsage.tokens.total)}</span>}
      </div>
      {load.kind === "loading" && <p className="ctx-note">{t("composer.breakdown.loading")}</p>}
      {load.kind === "error" && (
        <p className="ctx-note" role="alert">
          {t("composer.breakdown.failed", { message: describeError(t, load.error) })}
        </p>
      )}
      {load.kind === "ready" && load.data.models.length === 0 && (
        <p className="ctx-note">{t("composer.breakdown.empty")}</p>
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

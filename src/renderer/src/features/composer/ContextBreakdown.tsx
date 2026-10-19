// 点上下文圆环弹出的构成（照 Claude Code 的 /context）：一条按类别分段的横条 + 每类的 token 和占窗口的比例。
// 总量是 omp 的 contextUsage；系统提示词、工具定义按 get_state 的 systemPrompt / dumpTools 字符数估（omp 不给分项），
// 消息 = 总量 - 这两项；自动压缩预留 = 窗口 - omp 的压缩触发点（compaction.* 设置，读不到就不画这一段）。
// 新任务草稿还没有会话：用量是 0，窗口取所选模型的，只有剩余空间和预留两段。
import { useEffect, useState } from "react";
import { compactionTrigger } from "../../../../shared/compaction-trigger.ts";
import type { CompactionSettings, ModelKey, ProjectId, TaskState } from "../../../../shared/ipc.ts";
import { useT } from "../../i18n/use-t.ts";
import { contextRows, type ContextRow } from "./context-rows.ts";
import { formatCount, formatPercent } from "./usage-format.ts";

/** 压缩设置（和模型无关，按项目读）只在打开时读一次（`omp config list`，约 0.2 秒）；读不到就不画预留段。 */
function useCompaction(projectId: ProjectId | null): CompactionSettings | null {
  const [settings, setSettings] = useState<CompactionSettings | null>(null);
  useEffect(() => {
    let current = true;
    window.studio.getModelInsights(projectId, []).then(
      (insights) => current && setSettings(insights.compaction),
      () => current && setSettings(null),
    );
    return () => {
      current = false;
    };
  }, [projectId]);
  return settings;
}

export interface ContextBreakdownProps {
  context: NonNullable<TaskState["contextUsage"]>;
  /** 系统提示词 / 工具定义的估算；草稿（还没有会话）时为 null。 */
  parts: TaskState["contextParts"];
  modelKey: ModelKey | null;
  projectId: ProjectId | null;
  /** 草稿：在底部说明系统提示词和工具定义要等会话建立后才知道。 */
  draft?: boolean;
}

export function ContextBreakdown({ context, parts, modelKey, projectId, draft = false }: ContextBreakdownProps) {
  const t = useT();
  const settings = useCompaction(projectId);
  const window = context.contextWindow;
  const trigger = settings !== null && modelKey !== null ? compactionTrigger(settings, modelKey, window).tokens : null;
  const rows = contextRows(context, parts, trigger);
  const share = (tokens: number) => (window > 0 ? (tokens / window) * 100 : 0);
  const label = (row: ContextRow) =>
    row.part === "tools" && parts !== null
      ? t("composer.context.tools", { n: parts.toolCount })
      : t(`composer.context.${row.part}`);
  return (
    <div className="ctx" data-testid="context-breakdown">
      <div className="ctx-head">
        <strong>{t("composer.context.title")}</strong>
        <span className="ctx-num">
          {formatCount(context.tokens)} / {formatCount(window)} · {formatPercent(context.percent)}%
        </span>
      </div>
      <div className="ctx-bar" aria-hidden="true">
        {rows.map((row) =>
          row.tokens > 0 ? (
            <span key={row.part} className="ctx-seg" data-part={row.part} style={{ flexGrow: row.tokens }} />
          ) : null,
        )}
      </div>
      <dl className="ctx-rows">
        {rows.map((row) => (
          <div key={row.part} className="ctx-row" data-testid="context-row" data-part={row.part}>
            <dt>
              <span className="ctx-swatch" data-part={row.part} aria-hidden="true" />
              {label(row)}
            </dt>
            <dd className="ctx-num">
              {row.estimated && "≈"}
              {formatCount(row.tokens)}
            </dd>
            <dd className="ctx-num ctx-share">{formatPercent(share(row.tokens))}%</dd>
          </div>
        ))}
      </dl>
      <p className="ctx-note">
        {[
          parts !== null && t("composer.context.estimate"),
          draft && t("composer.context.draftNote"),
          trigger !== null && t("composer.context.compactAt", { n: formatCount(trigger) }),
        ]
          .filter((part) => typeof part === "string")
          .join(" · ")}
      </p>
    </div>
  );
}

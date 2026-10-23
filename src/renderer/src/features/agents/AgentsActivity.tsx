// 子代理面板的 Activity 页（omp Agent Hub 的 "2 Activity"）：所有子代理的工具调用、回复、错误按时间从新到旧排成一条流，
// 可按 All / Errors / Responses / Tools 过滤；点一行 = 回到 Agents 页并选中那个子代理。数据：use-agents-activity.ts（子代理记录文件）。
import { useMemo, useState } from "react";
import type { TaskId } from "../../../../shared/ipc.ts";
import { ACTIVITY_FILTERS, filterActivity, type ActivityFilter } from "../../../../shared/tsp/agent-activity.ts";
import type { HubAgent } from "../../../../shared/tsp/agent-hub.ts";
import { useT } from "../../i18n/use-t.ts";
import { Tabs } from "../../ui/controls.tsx";
import { useAgentsActivity } from "./use-agents-activity.ts";

const clock = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function AgentsActivity({
  taskId,
  agents,
  onOpenAgent,
}: {
  taskId: TaskId;
  agents: readonly HubAgent[];
  onOpenAgent(name: string): void;
}) {
  const t = useT();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const { items, loading } = useAgentsActivity(taskId, agents, true);
  const shown = useMemo(() => filterActivity(items, filter), [items, filter]);
  return (
    <div className="agents-activity" data-testid="agents-activity">
      <Tabs<ActivityFilter>
        label={t("agents.activityFilter")}
        idBase={`agents-activity-${taskId}`}
        testId="agents-activity-filter"
        value={filter}
        tabs={ACTIVITY_FILTERS.map((id) => ({ id, label: t(`agents.filter.${id}`) }))}
        onChange={setFilter}
      />
      {shown.length === 0 ? (
        <p className="agents-muted" data-testid="agents-activity-empty">
          {loading
            ? t("agents.activityLoading")
            : filter === "all"
              ? t("agents.activityEmpty")
              : t("agents.activityNone")}
        </p>
      ) : (
        <ul className="agents-activity-list" aria-label={t("agents.activityList")}>
          {shown.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="agents-act-row"
                data-testid="agents-activity-row"
                data-kind={item.kind}
                data-agent={item.agent}
                data-failed={item.failed || undefined}
                title={t("agents.activityOpen", { name: item.agent })}
                onClick={() => onOpenAgent(item.agent)}
              >
                <span className="agents-act-time">{item.at > 0 ? clock.format(item.at) : ""}</span>
                <span className="agents-act-agent">{item.agent}</span>
                <span className="agents-act-kind">{t(`agents.kind.${item.kind}`)}</span>
                <span className="agents-act-text">
                  {item.tool !== null && <b>{item.tool}</b>}
                  {item.tool !== null && item.text !== "" && " · "}
                  {item.text}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
